import fs from 'node:fs';import path from 'node:path';
import {PushupAnalyzer,MoveNetPushupAnalyzer} from '../runtime/index.js';
const [old,prev,root]=process.argv.slice(2);if(!root)throw Error('node examples/compare_pushup_activity.mjs POSE_COMPARISON_DIR MOVENET_FIX_DIR OUTPUT_DIR');fs.mkdirSync(root,{recursive:true});
const load=p=>fs.readFileSync(p,'utf8').trim().split('\n').map(JSON.parse);
const cases=JSON.parse(fs.readFileSync(old+'/cases.json','utf8')).filter(c=>c.exercise==='pushup');let report=[];
for(const c of cases){let row={...c,variants:{}};const d=root+'/'+c.id;fs.mkdirSync(d,{recursive:true});
 for(const [v,analyzer,input,before] of [['mediapipe',new PushupAnalyzer(),'mediapipe',old+'/'+c.id+'/mediapipe_results.jsonl'],['movenet',new MoveNetPushupAnalyzer(),'movenet_crop',prev+'/'+c.id+'/after_results.jsonl']]){
  const frames=load(old+'/'+c.id+'/'+input+'_input.jsonl');const results=frames.map(f=>v==='movenet'?analyzer.pushKeypoints(f):analyzer.pushFrame(f));
  fs.copyFileSync(before,d+'/'+v+'_before_results.jsonl');fs.writeFileSync(d+'/'+v+'_after_results.jsonl',results.map(r=>JSON.stringify(r)).join('\n'));
  const set=analyzer.finish().find(e=>e.type==='set.completed');fs.writeFileSync(d+'/'+v+'_after_set.json',JSON.stringify(set,null,2));
  const events=results.flatMap(r=>r.events);row.variants[v]={before:load(before).at(-1).count,after:analyzer.summary().count,repetitions:events.filter(e=>e.type==='rep.completed'),activity:events.filter(e=>e.type==='activity.changed')};
 }
 console.log(c.id,Object.fromEntries(Object.entries(row.variants).map(([v,r])=>[v,[r.before,r.after]])));report.push(row);
}
fs.writeFileSync(root+'/comparison.json',JSON.stringify(report,null,2));fs.writeFileSync(root+'/cases.json',JSON.stringify(cases,null,2));
