export const sleep = (ms) => new Promise(r=>setTimeout(r, ms));

export function shard(id){
  return String(Number(id) % 1000).padStart(3,'0');
}

export function tipPaths(DATA, id){
  const s = shard(id);
  const base = `${DATA}/tips/${s}/tip-${String(id).padStart(6,'0')}`;
  return {
    dir: `${DATA}/tips/${s}`,
    yaml: `${base}.yaml`,
    view: `${base}.view.json`,
    votesMap: `${base}.votes.map.json`,
    votesLog: `${base}.votes.log.jsonl`,
    lock: `${DATA}/.locks/tip-${id}.lock`
  };
}

export function hot(score, created_at){
  const s = Math.max(Math.abs(score), 1);
  return Math.log10(s) + (Date.parse(created_at)/1000)/45000;
}

export function wilson(love, meh, z=1.96){
  const n = love + meh; if(!n) return 0;
  const p = love/n;
  const denom = 1 + (z*z)/n;
  const num = p + (z*z)/(2*n) - z * Math.sqrt((p*(1-p)+(z*z)/(4*n))/n);
  return num/denom;
}

export function seekFilter(items, cursor){
  if(!cursor) return items;
  const [iso, idStr] = cursor.split('_');
  const cAt = Date.parse(iso); const cId = Number(idStr);
  return items.filter(x => Date.parse(x.created_at) < cAt || (Date.parse(x.created_at)===cAt && x.id < cId));
}

export async function atomicWrite(fs, file, obj){
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, typeof obj==='string'? obj : JSON.stringify(obj));
  await fs.rename(tmp, file);
}
