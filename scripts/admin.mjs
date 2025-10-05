#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'js-yaml';
import { renderMarkdown } from '../src/lib/markdown.js';

const DATA = process.env.DATA_DIR || path.join(process.cwd(),'data');

function shard(id){ return String(Number(id) % 1000).padStart(3,'0'); }
function slugify(t){ return String(t).toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''); }
async function atomicWrite(file, content){
  const tmp = file + '.tmp';
  await fs.writeFile(tmp, content);
  await fs.rename(tmp, file);
}
async function loadYaml(yamlPath){ const raw = await fs.readFile(yamlPath, 'utf8'); return YAML.load(raw); }

function tipPaths(id){ // backwards compat
  return itemPaths('tips', id);
}
function itemPaths(collection, id){
  const s = shard(id);
  const dir = path.join(DATA, collection, s);
  const kind = collection==='prompts' ? 'prompt':'tip';
  const base = path.join(dir, `${kind}-${String(id).padStart(6,'0')}`);
  return { dir, yaml: base+'.yaml', view: base+'.view.json', votesMap: base+'.votes.map.json' };
}

async function addTip({ collection='tips', id, title, content, tags=[] , username=null}){
  const p = itemPaths(collection, id);
  await fs.mkdir(p.dir, { recursive: true });
  const now = new Date().toISOString();
  const tip = { id, title, content, tags, status: 'published', created_at: now, updated_at: now, username };
  await atomicWrite(p.yaml, YAML.dump(tip));
  const view = {
    id, slug: slugify(title), title, content,
    content_html: renderMarkdown(content),
    tags, status: 'published', created_at: now, updated_at: now, username,
    love_count: 0, meh_count: 0
  };
  await atomicWrite(p.view, JSON.stringify(view));
  await fs.writeFile(p.votesMap, '{}').catch(()=>{});
  console.log('Added tip', id);
}

async function editTip({ collection='tips', id, title, content, tags, status, username }){
  const p = itemPaths(collection, id);
  let tip = await loadYaml(p.yaml);
  if(title != null) tip.title = title;
  if(content != null) tip.content = content;
  if(tags != null) tip.tags = tags;
  if(status != null) tip.status = status;
  if(username != null) tip.username = username;
  tip.updated_at = new Date().toISOString();
  await atomicWrite(p.yaml, YAML.dump(tip));
  let view = {
    id: tip.id,
    slug: slugify(tip.title),
    title: tip.title,
    content: tip.content,
    content_html: renderMarkdown(tip.content),
    tags: tip.tags || [],
    status: tip.status || 'published',
    created_at: tip.created_at,
    updated_at: tip.updated_at,
    username: tip.username || null
  };
  try{
    const old = JSON.parse(await fs.readFile(p.view,'utf8'));
    view.love_count = old.love_count || 0;
    view.meh_count = old.meh_count || 0;
  }catch{ view.love_count = 0; view.meh_count = 0; }
  await atomicWrite(p.view, JSON.stringify(view));
  console.log('Edited tip', id);
}

async function archiveTip({ collection='tips', id }){
  const p = itemPaths(collection, id);
  let tip = await loadYaml(p.yaml);
  tip.status = 'archived';
  tip.updated_at = new Date().toISOString();
  await atomicWrite(p.yaml, YAML.dump(tip));
  try{
    const view = JSON.parse(await fs.readFile(p.view,'utf8'));
    view.status = 'archived';
    await atomicWrite(p.view, JSON.stringify(view));
  }catch{}
  console.log('Archived tip', id);
}

function parseArgs(){
  const [,, cmd, ...rest] = process.argv;
  const args = {};
  for(let i=0;i<rest.length;i++){
    if(rest[i].startsWith('--')){
      const k = rest[i].slice(2);
      const v = (i+1<rest.length && !rest[i+1].startsWith('--')) ? rest[++i] : true;
      args[k] = v;
    }
  }
  return { cmd, args };
}

async function main(){
  const { cmd, args } = parseArgs();
  if(cmd === 'add'){
    const id = Number(args.id);
    if(!id || !args.title || !args.content){
      console.error('Usage: node scripts/admin.mjs add --id 123 --title "..." --content "..." [--tags "a,b"] [--username "Name"]');
      process.exit(1);
    }
    await addTip({ collection: args.type||'tips', id, title: args.title, content: args.content, tags: (args.tags||'').split(',').filter(Boolean), username: args.username || null });
  } else if(cmd === 'edit'){
    const id = Number(args.id);
    if(!id){ console.error('Usage: node scripts/admin.mjs edit --id 123 [--title "..."] [--content "..."] [--tags "a,b"] [--status draft|published|archived] [--username "Name"]'); process.exit(1); }
    await editTip({ collection: args.type||'tips', id, title: args.title, content: args.content, tags: args.tags ? args.tags.split(',').filter(Boolean) : null, status: args.status, username: args.username });
  } else if(cmd === 'archive'){
    const id = Number(args.id);
    if(!id){ console.error('Usage: node scripts/admin.mjs archive --id 123'); process.exit(1); }
    await archiveTip({ collection: args.type||'tips', id });
  } else {
    console.log(`Admin CLI
  add     --type tips|prompts --id 123 --title "..." --content "..." [--tags "a,b"] [--username "Name"]
  edit    --type tips|prompts --id 123 [--title "..."] [--content "..."] [--tags "a,b"] [--status draft|published|archived] [--username "Name"]
  archive --type tips|prompts --id 123`);
  }
}

main().catch(e=>{ console.error(e); process.exit(1); });
