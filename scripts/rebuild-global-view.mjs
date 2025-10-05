import fs from 'node:fs/promises';
import path from 'node:path';

const DATA = process.env.DATA_DIR || path.join(process.cwd(),'data');
const PTR = path.join(DATA,'tips.view.ptr');
const A = path.join(DATA,'tips.view.a.json');
const B = path.join(DATA,'tips.view.b.json');

async function atomicWrite(file, obj){
  const tmp = file + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(obj));
  await fs.rename(tmp, file);
}

async function listPerTip(){
  const tipsDir = path.join(DATA,'tips');
  let shards = [];
  try{ shards = await fs.readdir(tipsDir); }catch{ return []; }
  const items = [];
  for(const s of shards){
    const dir = path.join(tipsDir,s);
    let files = [];
    try{ files = await fs.readdir(dir); }catch{ continue; }
    for(const f of files){
      if(!f.endsWith('.view.json')) continue;
      try{
        const obj = JSON.parse(await fs.readFile(path.join(dir,f),'utf8'));
        if(obj.status==='published') items.push(obj);
      }catch{}
    }
  }
  return items;
}

async function readPtr(){ try{ return (await fs.readFile(PTR,'utf8')).trim() || 'a'; } catch { return 'a'; } }
async function writePtr(v){ await fs.writeFile(PTR, v+'\n'); }

async function main(){
  await fs.mkdir(DATA, { recursive: true });
  const items = await listPerTip();
  const payload = { version: 1, generated_at: new Date().toISOString(), tip_count: items.length, items };
  const cur = await readPtr();
  const target = cur==='a' ? B : A;
  await atomicWrite(target, payload);
  await writePtr(cur==='a' ? 'b' : 'a');
  console.log('Rebuilt global view →', cur==='a' ? 'b' : 'a', 'tips:', items.length);
}

main().catch(e=>{ console.error(e); process.exit(1); });
