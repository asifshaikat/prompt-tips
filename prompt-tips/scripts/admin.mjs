#!/usr/bin/env node
// scripts/admin.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'js-yaml';

const DATA = process.env.DATA_DIR || path.join(process.cwd(),'data');

function shard(id){ return String(Number(id) % 1000).padStart(3,'0'); }
function slugify(t){ return String(t).toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''); }
async function atomicWrite(file, content){
  const tmp = file + '.tmp';
  await fs.writeFile(tmp, content);
  await fs.rename(tmp, file);
}

async function loadYaml(yamlPath){
  const raw = await fs.readFile(yamlPath, 'utf8');
  return YAML.load(raw);
}
async function saveYaml(yamlPath, obj){
  await atomicWrite(yamlPath, YAML.dump(obj));
}
function tipPaths(id){
  const s = shard(id);
  const dir = path.join(DATA, 'tips', s);
  const base = path.join(dir, `tip-${String(id).padStart(6,'0')}`);
  return { dir, yaml: base+'.yaml', view: base+'.view.json', votesMap: base+'.votes.map.json' };
}

async function addTip({ id, title, content, tags=[] }){
  const p = tipPaths(id);
  await fs.mkdir(p.dir, { recursive: true });
  const now = new Date().toISOString();
  const tip = {
    id, title, content, tags, status: 'published',
    created_at: now, updated_at: now
  };
  await saveYaml(p.yaml, tip);
  const view = {
    id, slug: slugify(title), title, content, tags, status: 'published',
    created_at: now, updated_at: now, love_count: 0, meh_count: 0
  };
  await atomicWrite(p.view, JSON.stringify(view));
  await fs.writeFile(p.votesMap, '{}').catch(()=>{});
  console.log('Added tip', id);
}

async function editTip({ id, title, content, tags, status }){
  const p = tipPaths(id);
  let tip = await loadYaml(p.yaml);
  if(title != null) tip.title = title;
  if(content != null) tip.content = content;
  if(tags != null) tip.tags = tags;
  if(status != null) tip.status = status;
  tip.updated_at = new Date().toISOString();
  await saveYaml(p.yaml, tip);

  // update view
  let view;
  try{ view = JSON.parse(await fs.readFile(p.view,'utf8')); } catch { view = {}; }
  view = {
    id: tip.id,
    slug: slugify(tip.title),
    title: tip.title,
    content: tip.content,
    tags: tip.tags || [],
    status: tip.status || 'published',
    created_at: tip.created_at,
    updated_at: tip.updated_at,
    love_count: view.love_count || 0,
    meh_count: view.meh_count || 0
  };
  await atomicWrite(p.view, JSON.stringify(view));
  console.log('Edited tip', id);
}

async function archiveTip({ id }){
  const p = tipPaths(id);
  let tip = await loadYaml(p.yaml);
  tip.status = 'archived';
  tip.updated_at = new Date().toISOString();
  await saveYaml(p.yaml, tip);

  let view;
  try{ view = JSON.parse(await fs.readFile(p.view,'utf8')); } catch { view = null; }
  if(view){ view.status = 'archived'; await atomicWrite(p.view, JSON.stringify(view)); }
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
      console.error('Usage: node scripts/admin.mjs add --id 123 --title "..." --content "..." [--tags "tag1,tag2"]');
      process.exit(1);
    }
    await addTip({ id, title: args.title, content: args.content, tags: (args.tags||'').split(',').filter(Boolean) });
  } else if(cmd === 'edit'){
    const id = Number(args.id);
    if(!id){ console.error('Usage: node scripts/admin.mjs edit --id 123 [--title "..."] [--content "..."] [--tags "a,b"] [--status draft|published|archived]'); process.exit(1); }
    await editTip({ id, title: args.title, content: args.content, tags: args.tags ? args.tags.split(',').filter(Boolean) : null, status: args.status });
  } else if(cmd === 'archive'){
    const id = Number(args.id);
    if(!id){ console.error('Usage: node scripts/admin.mjs archive --id 123'); process.exit(1); }
    await archiveTip({ id });
  } else {
    console.log(`Admin CLI
  add     --id 123 --title "..." --content "..." [--tags "a,b"]
  edit    --id 123 [--title "..."] [--content "..."] [--tags "a,b"] [--status draft|published|archived]
  archive --id 123`);
  }
}

main().catch(e=>{ console.error(e); process.exit(1); });
