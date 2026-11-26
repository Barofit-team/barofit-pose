import fs from 'node:fs';
import * as pose from '../runtime/index.js';
const rows=[];
for(const [name,C] of Object.entries(pose).filter(([n])=>n.endsWith('Analyzer')&&!n.startsWith('MoveNet'))){
 const a=new C();rows.push(a.finish().at(-1));
 const b=new C();
 for(let t=0;t<1200;t+=100){
  const f={timestampMs:t,width:1000,height:1000,landmarks:Array.from({length:33},(_,i)=>[.2+i*.01,.5,0,.99,.99])};
  b.pushFrame(f);
 }
 rows.push(...b.finish().filter(e=>e.type==='set.completed'));
}
fs.writeFileSync(process.argv[2],JSON.stringify(rows));
