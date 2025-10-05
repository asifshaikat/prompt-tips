import express from 'express';
import helmet from 'helmet';
import etag from 'etag';
import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'js-yaml';
import { ViewStore } from './lib/viewStore.js';
import { tipPaths } from './lib/utils.js';

const PORT = process.env.PORT || 3000;
const DATA = process.env.DATA_DIR || path.join(process.cwd(),'data');
const MAX_JSON_BODY = Number(process.env.MAX_JSON_BODY || 4096);
const CACHE_MAX_AGE = Number(process.env.CACHE_MAX_AGE || 60);
const SWR = Number(process.env.STALE_WHILE_REVALIDATE || 300);

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: MAX_JSON_BODY }));

const tipsStore = new ViewStore({ DATA, collection:'tips', cacheMaxAge: CACHE_MAX_AGE, swr: SWR });
await tipsStore.init();
const promptsStore = new ViewStore({ DATA, collection:'prompts', cacheMaxAge: CACHE_MAX_AGE, swr: SWR });
await promptsStore.init();

app.get('/api/tips', (req, res) => {
  tipsStore.headers(res);
  const { sort='hot', window='all', cursor, limit=20 } = req.query;
  const { items, nextCursor } = tipsStore.select({ sort, window, cursor, limit });
  const payload = { items, nextCursor, cachedAt: new Date().toISOString() };
  const body = JSON.stringify(payload);
  const tag = etag(body);
  res.setHeader('ETag', tag);
  if (req.headers['if-none-match'] === tag) return res.status(304).end();
  res.json(payload);
});

app.get('/api/tips/:id', async (req, res) => {
  tipsStore.headers(res);
  const id = Number(req.params.id);
  const tip = await tipsStore.getTip(id);
  if(!tip) return res.status(404).json({ error: 'Not found' });
  res.json(tip);
});

app.post('/api/tips/:id/vote', async (req, res) => {
  const id = Number(req.params.id);
  const { vote, userToken } = req.body || {};
  if (![1,0,-1].includes(vote)) return res.status(400).json({ error: 'Invalid vote' });
  if (!userToken) return res.status(400).json({ error: 'Missing userToken' });

  try{
    const counts = await tipsStore.postVote(id, userToken, vote);
    res.json({ id, ...counts });
  }catch(e){
    const msg = /Busy/.test(e.message) ? 'Busy, please retry' : 'Error';
    res.status(/Busy/.test(e.message)?429:500).json({ error: msg });
  }
});

// Username claim (global uniqueness, case-insensitive)
app.post('/api/username', async (req, res) => {
  const { userToken, username } = req.body || {};
  if (!userToken || typeof username !== 'string') return res.status(400).json({ error: 'Missing userToken or username' });
  const clean = username.trim();
  if (!/^[a-zA-Z0-9_\-]{3,20}$/.test(clean)) return res.status(400).json({ error: 'Invalid username' });
  const file = path.join(DATA, 'usernames.map.json');
  let map = {};
  try { map = JSON.parse(await fs.readFile(file,'utf8')); } catch {}
  const want = clean.toLowerCase();
  const clash = Object.entries(map).find(([tok, obj]) => (obj && typeof obj.username === 'string' && obj.username.toLowerCase() === want && tok !== userToken));
  if (clash) return res.status(409).json({ error: 'Username already taken' });
  const tmp = file + '.tmp';
  map[userToken] = { username: clean, set_at: new Date().toISOString() };
  await fs.writeFile(tmp, JSON.stringify(map));
  await fs.rename(tmp, file);
  res.json({ ok: true, username: clean });
});

// simple permalink page
app.get('/tips/:slugId', async (req, res) => {
  const id = Number(String(req.params.slugId).split('-')[0]);
  const tip = await tipsStore.getTip(id);
  if(!tip) return res.status(404).send('Not found');
  const html = `<!doctype html><meta charset="utf-8">
<title>${escapeHtml(tip.title)} — Prompt Tips</title>
<meta name="description" content="${escapeHtml((tip.content||'').slice(0,150))}">
<div style="font-family:system-ui;max-width:720px;margin:40px auto;padding:0 16px">
<h1>${escapeHtml(tip.title)}</h1>
<div>${tip.content_html || escapeHtml(tip.content||'').replace(/\n/g,'<br>')}</div>
<p class="meta" style="color:#666">By ${escapeHtml(tip.username||'Anon')} • ${new Date(tip.created_at).toLocaleString()}</p>
<p><a href="/">&larr; Back</a></p>
</div>`;
  res.setHeader('Cache-Control', `public, max-age=${CACHE_MAX_AGE}, stale-while-revalidate=${SWR}`);
  res.setHeader('ETag', etag(html));
  if (req.headers['if-none-match'] === etag(html)) return res.status(304).end();
  res.send(html);
});

app.use(express.static(path.join(process.cwd(), 'public')));

app.listen(PORT, ()=> {
  console.log(`[tips] listening on :${PORT}`);
});

function escapeHtml(s){return String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;' }[m]))}


// PROMPTS — list
app.get('/api/prompts', (req, res) => {
  promptsStore.headers(res);
  const { sort='hot', window='all', cursor, limit=20 } = req.query;
  const { items, nextCursor } = promptsStore.select({ sort, window, cursor, limit });
  const payload = { items, nextCursor, cachedAt: new Date().toISOString() };
  const body = JSON.stringify(payload);
  const tag = etag(body);
  res.setHeader('ETag', tag);
  if (req.headers['if-none-match'] === tag) return res.status(304).end();
  res.json(payload);
});

// PROMPTS — detail
app.get('/api/prompts/:id', async (req, res) => {
  promptsStore.headers(res);
  const id = Number(req.params.id);
  const item = await promptsStore.getTip(id);
  if(!item) return res.status(404).json({ error: 'Not found' });
  res.json(item);
});

// PROMPTS — vote
app.post('/api/prompts/:id/vote', async (req, res) => {
  const id = Number(req.params.id);
  const { vote, userToken } = req.body || {};
  if (![1,0,-1].includes(vote)) return res.status(400).json({ error: 'Invalid vote' });
  if (!userToken) return res.status(400).json({ error: 'Missing userToken' });
  try{
    const counts = await promptsStore.postVote(id, userToken, vote);
    res.json({ id, ...counts });
  }catch(e){
    const msg = /Busy/.test(e.message) ? 'Busy, please retry' : 'Error';
    res.status(/Busy/.test(e.message)?429:500).json({ error: msg });
  }
});

// PROMPTS — create (Markdown + username uniqueness already enforced via /api/username)
app.post('/api/prompts', async (req, res) => {
  const { title, content, tags=[], userToken, username } = req.body || {};
  const T = s => String(s||'').trim();
  if(!userToken) return res.status(400).json({ error: 'Missing userToken' });
  const vTitle = T(title), vContent = T(content);
  if(vTitle.length < 5 || vTitle.length > 80) return res.status(400).json({ error: 'Title length 5..80' });
  if(vContent.length < 1 || vContent.length > 2000) return res.status(400).json({ error: 'Content length 1..2000' });
  const vTags = (Array.isArray(tags)? tags : String(tags).split(',')).map(s=>String(s).toLowerCase().trim()).filter(s=>s && /^[a-z0-9-]{1,24}$/.test(s)).slice(0,5);

  // allocate id
  const countersFile = path.join(DATA,'counters.json');
  let ctr = {}; try { ctr = JSON.parse(await fs.readFile(countersFile,'utf8')); } catch {}
  ctr.nextPromptId = (ctr.nextPromptId || 1);
  const id = ctr.nextPromptId++;
  await fs.writeFile(countersFile+'.tmp', JSON.stringify(ctr)); await fs.rename(countersFile+'.tmp', countersFile);

  // write files
  const { renderMarkdown } = await import('./lib/markdown.js');
  const { itemPaths } = await import('./lib/utils.js');
  const p = itemPaths(DATA, 'prompts', id);
  await fs.mkdir(p.dir, { recursive: true });
  const now = new Date().toISOString();
  const slug = String(vTitle).toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  const yamlObj = { id, title: vTitle, content: vContent, tags: vTags, status:'published', created_at: now, updated_at: now, username: T(username)||null, user_token: userToken };
  await fs.writeFile(p.yaml+'.tmp', YAML.dump(yamlObj)); await fs.rename(p.yaml+'.tmp', p.yaml);
  const view = { id, slug, title: vTitle, content: vContent, content_html: renderMarkdown(vContent), tags: vTags, status:'published', created_at: now, updated_at: now, username: yamlObj.username, love_count:0, meh_count:0 };
  await fs.writeFile(p.view+'.tmp', JSON.stringify(view)); await fs.rename(p.view+'.tmp', p.view);
  await fs.writeFile(p.votesMap, '{}').catch(()=>{});

  // patch memory and mark dirty
  if(!promptsStore.mem) await promptsStore.rebuildGlobal();
  promptsStore.mem.items.push(view);
  promptsStore.dirty.add(id);
  promptsStore._scheduleFlush();

  res.status(201).json(view);
});

// Graceful shutdown: flush pending view swaps before exit
async function gracefulExit(signal){
  console.log(`[tips] received ${signal}, flushing views...`);
  try {
    if (typeof tipsStore?.flushDirty === 'function') await tipsStore.flushDirty();
  } catch(e){ console.error('flush tips error', e); }
  try {
    if (typeof promptsStore?.flushDirty === 'function') await promptsStore.flushDirty();
  } catch(e){ console.error('flush prompts error', e); }
  process.exit(0);
}
process.on('SIGINT', ()=>gracefulExit('SIGINT'));
process.on('SIGTERM', ()=>gracefulExit('SIGTERM'));
