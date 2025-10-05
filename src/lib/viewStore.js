import fs from 'node:fs/promises';
import fscb from 'node:fs';
import path from 'node:path';
import YAML from 'js-yaml';
import crypto from 'node:crypto';
import { atomicWrite, itemPaths, hot, wilson } from './utils.js';
import { renderMarkdown } from './markdown.js';

export class ViewStore {
  constructor({ DATA, collection='tips', cacheMaxAge=60, swr=300 }){
    this.collection = collection;
    this.DATA = DATA;
    this.cacheMaxAge = cacheMaxAge;
    this.swr = swr;
    this.mem = null;
    this.ptr = 'a';
    this.flushTimer = null;
    this.dirty = new Set();
  }

  async init(){
    await fs.mkdir(this.DATA, { recursive: true });
    await fs.mkdir(path.join(this.DATA, '.locks'), { recursive: true });
    const ptrFile = path.join(this.DATA, `${this.collection}.view.ptr`);
    try{ this.ptr = (await fs.readFile(ptrFile,'utf8')).trim() || 'a'; }
    catch{ await fs.writeFile(ptrFile,'a'); this.ptr = 'a'; }
    const active = this._activePath();
    try{
      const buf = await fs.readFile(active, 'utf8');
      this.mem = JSON.parse(buf);
    }catch{
      await this.rebuildGlobal();
    }
  }

  _activePath(){ return path.join(this.DATA, `${this.collection}.view.${this.ptr}.json`); }
  _inactivePath(){ return path.join(this.DATA, `${this.collection}.view.${this.ptr==='a'?'b':'a'}.json`); }

  etag(){
    try{
      const st = fscb.statSync(this._activePath());
      const src = `${st.mtimeMs}:${st.size}`;
      return `"v-${crypto.createHash('md5').update(src).digest('hex')}"`;
    }catch{ return `"v-0"`; }
  }

  headers(res){
    res.set('Cache-Control', `public, max-age=${this.cacheMaxAge}, stale-while-revalidate=${this.swr}`);
  }

  select({ sort='hot', window='all', tag=null, q=null, cursor=null, limit=20 }){
    if(!this.mem) return { items: [], nextCursor: null };
    const since = window==='24h' ? Date.now()-864e5 : window==='7d' ? Date.now()-7*864e5 : window==='30d' ? Date.now()-30*864e5 : 0;
    let items = this.mem.items.filter(x => x.status==='published' && (!since || Date.parse(x.created_at)>=since));
    if(tag){ items = items.filter(x => (x.tags||[]).includes(String(tag).toLowerCase())); }
    if(q){ const needle = String(q).toLowerCase().trim(); items = items.filter(x => (x.title+' '+x.content).toLowerCase().includes(needle)); }
    if(sort==='new'){
      items.sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at) || b.id-a.id);
    } else if(sort==='top'){
      items.sort((a,b)=> (wilson(b.love_count,b.meh_count) - wilson(a.love_count,a.meh_count)));
    } else {
      items.sort((a,b)=>{
        const sa = (a.love_count - a.meh_count), sb = (b.love_count - b.meh_count);
        return (hot(sb,b.created_at) - hot(sa,a.created_at));
      });
    }
    if(cursor){
      const [iso, idStr] = cursor.split('_');
      const cAt = Date.parse(iso); const cId = Number(idStr);
      items = items.filter(x => Date.parse(x.created_at) < cAt || (Date.parse(x.created_at)===cAt && x.id < cId));
    }
    const slice = items.slice(0, Number(limit));
    const last = slice.at(-1);
    return { items: slice, nextCursor: last ? `${last.created_at}_${last.id}` : null };
  }

  async getTip(id){
    if(!this.mem) return null;
    return this.mem.items.find(t => t.id===Number(id)) || null;
  }

  async postVote(id, userToken, newVote){
    const p = itemPaths(this.DATA, this.collection, id);
    await fs.mkdir(p.dir, { recursive: true });

    // naive lock
    let lockHandle;
    try { lockHandle = await fs.open(p.lock, 'wx'); }
    catch { throw new Error('Busy, retry'); }

    try {
      let map = {};
      try { map = JSON.parse(await fs.readFile(p.votesMap,'utf8')); } catch {}
      const oldVote = map[userToken] ?? 0;
      if(oldVote === newVote){
        const tip = await this.getTip(id);
        return { love_count: tip?.love_count ?? 0, meh_count: tip?.meh_count ?? 0 };
      }
      const delta = { love: 0, meh: 0 };
      if(oldVote === 1) delta.love--;
      if(oldVote === -1) delta.meh--;
      if(newVote === 1) delta.love++;
      if(newVote === -1) delta.meh++;

      map[userToken] = newVote;
      await atomicWrite(fs, p.votesMap, map);
      await fs.appendFile(p.votesLog, JSON.stringify({ userToken, old: oldVote, vote: newVote, ts: new Date().toISOString() })+'\n').catch(()=>{});

      let view;
      try { view = JSON.parse(await fs.readFile(p.view,'utf8')); }
      catch {
        const y = YAML.load(await fs.readFile(p.yaml,'utf8'));
        view = {
          id: y.id, slug: slugify(y.title),
          title: y.title, content: y.content, content_html: renderMarkdown(y.content), tags: y.tags || [],
          status: y.status, created_at: y.created_at, updated_at: y.updated_at,
          username: y.username,
          love_count: 0, meh_count: 0
        };
      }
      view.love_count += delta.love;
      view.meh_count  += delta.meh;
      await atomicWrite(fs, p.view, view);

      if(this.mem){
        const idx = this.mem.items.findIndex(x => x.id===Number(id));
        if(idx>=0){
          this.mem.items[idx].love_count = view.love_count;
          this.mem.items[idx].meh_count  = view.meh_count;
        }
      }
      this.dirty.add(Number(id));
      this._scheduleFlush();

      return { love_count: view.love_count, meh_count: view.meh_count };
    } finally {
      try { await lockHandle?.close(); await fs.unlink(p.lock); } catch {}
    }
  }

  _scheduleFlush(){
    if(this.flushTimer) return;
    this.flushTimer = setTimeout(()=> this.flushDirty().catch(console.error), 15000);
  }

  async flushDirty(){
    this.flushTimer && clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if(this.dirty.size === 0) return;
    const inactive = this._inactivePath();
    const payload = {
      version: 1,
      generated_at: new Date().toISOString(),
      tip_count: this.mem.items.length,
      items: this.mem.items.map(it => (it.content_html ? it : { ...it, content_html: renderMarkdown(it.content||'') }))
    };
    await atomicWrite(fs, inactive, payload);
    const nextPtr = this.ptr==='a' ? 'b' : 'a';
    await fs.writeFile(path.join(this.DATA,`${this.collection}.view.ptr`), nextPtr+'\n');
    this.ptr = nextPtr;
    this.dirty.clear();
  }

  async rebuildGlobal(){
    const items = await this._readAllPerTipViews();
    this.mem = {
      version: 1,
      generated_at: new Date().toISOString(),
      tip_count: items.length,
      items
    };
    const inactive = this._inactivePath();
    await atomicWrite(fs, inactive, this.mem);
    await fs.writeFile(path.join(this.DATA,`${this.collection}.view.ptr`), (this.ptr==='a'?'b':'a')+'\n');
    this.ptr = (this.ptr==='a'?'b':'a');
  }

  async _readAllPerTipViews(){
    const tipsDir = path.join(this.DATA,this.collection);
    let items = [];
    let shards = [];
    try { shards = await fs.readdir(tipsDir); } catch { return []; }
    for(const s of shards){
      const dir = path.join(tipsDir, s);
      let files = [];
      try { files = await fs.readdir(dir); } catch { continue; }
      for(const file of files){
        if(!file.endsWith('.view.json')) continue;
        try{
          const obj = JSON.parse(await fs.readFile(path.join(dir,file),'utf8'));
          if(obj.status === 'published') {
            if(!obj.content_html && obj.content){ obj.content_html = renderMarkdown(obj.content); }
            items.push(obj);
          }
        }catch{}
      }
    }
    return items;
  }
}

function slugify(t){ return String(t).toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''); }
