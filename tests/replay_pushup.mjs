/** Optional local regression corpus. No real-person data is bundled. */
import fs from 'node:fs';
import path from 'node:path';
import {PushupEngine} from '../runtime/index.js';
if(!process.argv[2]) throw Error('Usage: node tests/replay_pushup.mjs DATA_DIRECTORY [REPORT_PATH]');
const dir=process.argv[2],report=[];
for(const entry of JSON.parse(fs.readFileSync(path.join(dir,'index.json'),'utf8'))) {
  const c=JSON.parse(fs.readFileSync(path.join(dir,entry.file),'utf8'));
  const engine=new PushupEngine({side:c.side});
  let countMismatch=0;const ratings=[];
  for(let i=0;i<c.packets.length;i++) {
    const r=engine.pushFrame(c.packets[i]);
    if(r.count!==c.expected_counts[i])countMismatch++;
    ratings.push(...r.events.filter(e=>e.type==='rep.feedback'));
  }
  let ratingMismatch=0;
  for(const expected of c.expected_ratings) {
    const actual=ratings.find(r=>r.rep===expected.rep);
    for(const k of Object.keys(expected.items))if(actual?.items[k]!==expected.items[k])ratingMismatch++;
  }
  report.push({case:entry.file,frames:c.packets.length,expectedCount:c.count,
    actualCount:engine.count,countMismatch,ratingMismatch});
}
if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(report.some(r=>r.countMismatch||r.ratingMismatch||r.actualCount!==r.expectedCount))process.exitCode=1;
