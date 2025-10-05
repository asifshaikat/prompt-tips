import express from 'express';
import helmet from 'helmet';
import etag from 'etag';
import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'js-yaml';
import { ViewStore } from './lib/viewStore.js';
import { itemPaths } from './lib/utils.js';

const PORT = process.env.PORT || 3000;
const DATA = process.env.DATA_DIR || path.join(process.cwd(),'data');
const MAX_JSON_BODY = Number(process.env.MAX_JSON_BODY || 4096);
const CACHE_MAX_AGE = Number(process.env.CACHE_MAX_AGE || 60);
const SWR = Number(process.env.STALE_WHILE_REVALIDATE || 300);

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: MAX_JSON_BODY }));

// Two stores: tips & prompts
const tipsStore = new ViewStore({ DATA, collection:'tips', cacheMaxAge: CACHE_MAX_AGE, swr: SWR }); await tipsStore.init();
const promptsStore = new ViewStore({ DATA, collection:'prompts', cacheMaxAge: CACHE_MAX_AGE, swr: SWR }); await promptsStore.init();

// Helper to DRY collection endpoints
function createCollectionEndpoints(app, store){
  const collection = store.collection;        // 'tips' or 'prompts'

  // LIST: GET /api/{collection}
  app.get(`/api/${collection}`, (req, res) => {
    store.headers(res);
    const { sort='hot', window='all', cursor, limit=20 } = req.query;
    const { items, nextCursor } = store.select({ sort, window, cursor, limit });
    const payload = { items, nextCursor, cachedAt: new Date().toISOString() };
    const body = JSON.stringify(payload);
    const tag = etag(body);
    res.setHeader('ETag', tag);
    if (req.headers['if-none-match'] === tag) return res.status(304).end();
    res.json(payload);
  });

  // DETAIL: GET /api/{collection}/:id
  app.get(`/api/${collection}/:id`, async (req, res) => {
    store.headers(res);
    const id = Number(req.params.id);
    const item = await store.getTip(id);
    if(!item) return res.status(404).json({ error: 'Not found' });
    res.json(item);
  });

  // VOTE: POST /api/{collection}/:id/vote
  app.post(`/api/${collection}/:id/vote`, async (req, res) => {
    const id = Number(req.params.id);
    const { vote, userToken } = req.body || {};
    if (![1,0,-1].includes(vote)) return res.status(400).json({ error: 'Invalid vote' });
    if (!userToken) return res.status(400).json({ error: 'Missing userToken' });
    try{
      const counts = await store.postVote(id, userToken, vote);
      res.json({ id, ...counts });
    }catch(e){
      const msg = /Busy/.test(e.message) ? 'Busy, please retry' : 'Error';
      res.status(/Busy/.test(e.message)?429:500).json({ error: msg });
    }
  });
}

// Register endpoints for both collections
createCollectionEndpoints(app, tipsStore);
createCollectionEndpoints(app, promptsStore);

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



// Unified feed endpoint: /api/feed?type=tips|prompts&sort=hot|new|top&window=all|24h|7d|30d&tag=&q=&cursor=&limit=20
app.get('/api/feed', (req, res) => {
  const type = (req.query.type === 'prompts') ? 'prompts' : 'tips';
  const store = type === 'prompts' ? promptsStore : tipsStore;
  store.headers(res);
  const { sort='hot', window='all', tag=null, q=null, cursor=null, limit=20 } = req.query;
  const { items, nextCursor } = store.select({ sort, window, tag, q, cursor, limit });
  const payload = { type, items, nextCursor, cachedAt: new Date().toISOString() };
  const body = JSON.stringify(payload);
  const tagHdr = etag(body);
  res.setHeader('ETag', tagHdr);
  if (req.headers['if-none-match'] === tagHdr) return res.status(304).end();
  res.json(payload);
});

// Simple permalink (tips)
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
  const tag = etag(html);
  res.setHeader('ETag', tag);
  if (req.headers['if-none-match'] === tag) return res.status(304).end();
  res.send(html);
});

// Static
app.use(express.static(path.join(process.cwd(), 'public')));

const server = app.listen(PORT, ()=> {
  console.log(`[tips] listening on :${PORT}`);
});

// Graceful shutdown
async function gracefulExit(signal){
  console.log(`[tips] received ${signal}, flushing views...`);
  try { if (typeof tipsStore?.flushDirty === 'function') await tipsStore.flushDirty(); } catch(e){ console.error('flush tips error', e); }
  try { if (typeof promptsStore?.flushDirty === 'function') await promptsStore.flushDirty(); } catch(e){ console.error('flush prompts error', e); }
  server.close(()=> process.exit(0));
}
process.on('SIGINT', ()=>gracefulExit('SIGINT'));
process.on('SIGTERM', ()=>gracefulExit('SIGTERM'));

function escapeHtml(s){return String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;' }[m]))}
