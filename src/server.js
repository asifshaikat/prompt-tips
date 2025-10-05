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

const store = new ViewStore({ DATA, cacheMaxAge: CACHE_MAX_AGE, swr: SWR });
await store.init();

app.get('/api/tips', (req, res) => {
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

app.get('/api/tips/:id', async (req, res) => {
  store.headers(res);
  const id = Number(req.params.id);
  const tip = await store.getTip(id);
  if(!tip) return res.status(404).json({ error: 'Not found' });
  res.json(tip);
});

app.post('/api/tips/:id/vote', async (req, res) => {
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

// simple permalink page (optional SSR-lite)
app.get('/tips/:slugId', async (req, res) => {
  const id = Number(String(req.params.slugId).split('-')[0]);
  const tip = await store.getTip(id);
  if(!tip) return res.status(404).send('Not found');
  const html = `<!doctype html><meta charset="utf-8">
<title>${escapeHtml(tip.title)} — Prompt Tips</title>
<meta name="description" content="${escapeHtml(tip.content).slice(0,150)}">
<div style="font-family:system-ui;max-width:720px;margin:40px auto;padding:0 16px">
<h1>${escapeHtml(tip.title)}</h1>
<p>${escapeHtml(tip.content).replace(/\n/g,'<br>')}</p>
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
