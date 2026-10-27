import fs from 'node:fs';
import path from 'node:path';
import {PushupAnalyzer,MoveNetPushupAnalyzer,PlankAnalyzer,BirdDogAnalyzer,JumpingJackAnalyzer,moveNetLandmarks} from '../runtime/index.js';
import config from '../runtime/pushup/config.js';
const [source,out]=process.argv.slice(2);if(!source||!out)throw Error('node examples/compare_movenet_fix.mjs previous-comparison-directory output-directory');
fs.mkdirSync(out,{recursive:true});const cases=JSON.parse(fs.readFileSync(path.join(source,'cases.json'),'utf8'));
const ctors={plank:PlankAnalyzer,bird_dog:BirdDogAnalyzer,jumping_jack:JumpingJackAnalyzer};
const load=p=>fs.readFileSync(p,'utf8').trim().split('\n').map(JSON.parse);const report=[];
// Non-pushup legacy engines hardcode gate .5. This compatibility transform makes
// raw score .3 its boundary. It is NOT a calibrated confidence or probability.
// Raw 17-point scores are retained in the source input and used for rendering.
const gateCompat=kp=>kp.map(([y,x,s])=>[y,x,s<.3?s*.5/.3:.5+(s-.3)*.5/.7]);
const exported=event=>{const e=structuredClone(event);for(const x of Object.values(e.summary.items))if(x.compliancePct>100&&x.compliancePct<100+1e-9)x.compliancePct=100;return e;};
for(const c of cases){
 const d=path.join(out,c.id);fs.mkdirSync(d,{recursive:true});const old=path.join(source,c.id),input=load(path.join(old,'movenet_crop_input.jsonl'));
 const settings=structuredClone(config);settings.pipeline.cfg.visibility_min=settings.pipeline.cfg.presence_min=.3;
 const analyzers=c.exercise==='pushup'?{before:new PushupAnalyzer(settings),after:new MoveNetPushupAnalyzer()}:{before:new ctors[c.exercise](),after:new ctors[c.exercise]()};
 const row={...c,variants:{}};
 for(const [v,a] of Object.entries(analyzers)){
  const results=input.map(r=>c.exercise==='pushup'&&v==='after'?a.pushKeypoints(r):a.pushFrame({...r,landmarks:moveNetLandmarks(c.exercise==='pushup'?r.keypoints:gateCompat(r.keypoints))}));
  const finish=a.finish(),raw=finish.find(e=>e.type==='set.completed'),event=exported(raw);
  fs.writeFileSync(path.join(d,v+'_results.jsonl'),results.map(r=>JSON.stringify(r)).join('\n'));
  fs.writeFileSync(path.join(d,v+'_set_raw.json'),JSON.stringify(raw,null,2));fs.writeFileSync(path.join(d,v+'_set.json'),JSON.stringify(event,null,2));
  const events=results.flatMap(r=>r.events);row.variants[v]={count:a.summary().count,holdSeconds:a.summary().holdSeconds,trackingFrames:results.filter(r=>r.tracking==='tracking').length,frames:results.length,blocks:events.filter(e=>e.type==='tracking.blocked'),repetitions:events.filter(e=>e.type==='rep.completed'),items:event.summary.items};
 }
 for(const [v,file] of [['mediapipe','mediapipe_set.json'],['old_q50','movenet_crop_set.json']]){const r=JSON.parse(fs.readFileSync(path.join(old,file),'utf8'));row.variants[v]={count:r.summary.count,holdSeconds:r.summary.holdSeconds};}
 report.push(row);console.log(c.id,Object.fromEntries(Object.entries(row.variants).map(([k,v])=>[k,v.count??v.holdSeconds])));
}
fs.writeFileSync(path.join(out,'comparison.json'),JSON.stringify(report,null,2));fs.writeFileSync(path.join(out,'cases.json'),JSON.stringify(cases,null,2));
fs.writeFileSync(path.join(out,'provenance.json'),JSON.stringify({source:path.resolve(source),scoreThreshold:.3,pushupAdapter:'movenet-pushup-adapter-0.1',shortGapMs:180,coordinateImputation:false,reusedIdenticalPoseFrames:true,otherExerciseChange:'quality gate only; before and after are identical controls',manualReview:{pushup_005_good:{mainCompletedAttempts:6,mainIntervalSeconds:[1.4,14.4],lastPartialReturnSeconds:[14.5,17.2],exitIntervalSeconds:[17.2,19.4],note:'Video begins mid-motion. This is a manual segment review, not a full annotated benchmark. MediaPipe events at17.533/18.533 are in the exit interval.'}}},null,2));
