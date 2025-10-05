import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'js-yaml';
import { renderMarkdown } from '../src/lib/markdown.js';

const DATA = process.env.DATA_DIR || path.join(process.cwd(),'data');
const seedPath = path.join(DATA, 'seeds', 'tips.seed.yaml');

function shard(id){ return String(Number(id) % 1000).padStart(3,'0'); }
function slugify(t){ return String(t).toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''); }

async function atomicWrite(file, content){
  const tmp = file + '.tmp';
  await fs.writeFile(tmp, content);
  await fs.rename(tmp, file);
}

async function main(){
  const raw = await fs.readFile(seedPath, 'utf8');
  const tips = YAML.load(raw);
  await fs.mkdir(path.join(DATA,'tips'), { recursive: true });

  for(const t of tips){
    const s = shard(t.id);
    const dir = path.join(DATA, 'tips', s);
    await fs.mkdir(dir, { recursive: true });
    const base = path.join(dir, `tip-${String(t.id).padStart(6,'0')}`);
    await atomicWrite(base+'.yaml', YAML.dump(t));
    const view = {
      id: t.id,
      slug: slugify(t.title),
      title: t.title,
      content: t.content,
      content_html: renderMarkdown(t.content),
      tags: t.tags || [],
      status: t.status || 'published',
      created_at: t.created_at,
      updated_at: t.updated_at || t.created_at,
      username: t.username || null,
      love_count: 0,
      meh_count: 0
    };
    await atomicWrite(base+'.view.json', JSON.stringify(view));
    await fs.writeFile(base+'.votes.map.json', '{}').catch(()=>{});
  }
  console.log('Seeded', tips.length, 'tips.');
}

main().catch(e=>{ console.error(e); process.exit(1); });


// Optional: seed prompts if file exists
try {
  const promptsSeed = path.join(DATA,'seeds','prompts.seed.yaml');
  const rawP = await fs.readFile(promptsSeed,'utf8');
  const prompts = YAML.load(rawP);
  for(const p of prompts){
    const s = shard(p.id);
    const dir = path.join(DATA, 'prompts', s);
    await fs.mkdir(dir, { recursive: true });
    const base = path.join(dir, `prompt-${String(p.id).padStart(6,'0')}`);
    await atomicWrite(base+'.yaml', YAML.dump(p));
    const view = {
      id: p.id, slug: slugify(p.title), title: p.title, content: p.content,
      content_html: renderMarkdown(p.content), tags: p.tags || [],
      status: p.status || 'published', created_at: p.created_at, updated_at: p.updated_at || p.created_at,
      username: p.username || null, love_count: 0, meh_count: 0
    };
    await atomicWrite(base+'.view.json', JSON.stringify(view));
    await fs.writeFile(base+'.votes.map.json', '{}').catch(()=>{});
  }
  console.log('Seeded prompts:', prompts.length);
} catch {}
