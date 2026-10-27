import test from 'node:test';import assert from 'node:assert/strict';
import {PushupAnalyzer,MoveNetPushupAnalyzer} from '../../runtime/index.js';
import {MOVENET_TO_MEDIAPIPE} from '../../runtime/adapters/movenet.js';
import {PushupActivityGate} from '../../runtime/pushup/activity.js';
import config from '../../runtime/pushup/config.js';
function frame(t,{tucked=false,moving=false,kneeMissing=false,hipDrop=false}={}){
 const p=Array.from({length:33},()=>[0,0,0,0,0]);const y=moving?.3+.20*(1-Math.cos(Math.max(0,t-1.5)*Math.PI))/2:.3;
 const s=[.25,y],h=[.55,hipDrop?.65:.4],a=[.85,.45],k=tucked?[.45,.6]:[(h[0]+a[0])/2,(h[1]+a[1])/2];
 for(const [j,xy] of [[11,s],[13,[.3,.5]],[15,[.3,.7]],[23,h],[25,k],[27,a]])p[j]=[...xy,0,.9,.9];
 if(kneeMissing)p[25][3]=p[25][4]=0;
 return {timestampMs:Math.round(t*1000),width:640,height:360,landmarks:p};
}
function push(a,f){return a instanceof MoveNetPushupAnalyzer?a.pushKeypoints({...f,keypoints:MOVENET_TO_MEDIAPIPE.map(j=>[f.landmarks[j][1],f.landmarks[j][0],f.landmarks[j][3]])}):a.pushFrame(f);}
for(const [name,ctor] of [['MediaPipe',PushupAnalyzer],['MoveNet',MoveNetPushupAnalyzer]]){
 test(name+': exit suppresses first-frame count, confirms, then requires stable return',()=>{
  const a=new ctor();for(let i=0;i<40;i++)push(a,frame(i/20));
  a.engine.core.cycles[1].peak={x:.6,t:1.2};a.engine.core.cycles[1].bottom={x:.05,t:1.8};a.engine.core.cycles[1].last=1.95;
  let r=push(a,frame(2,{tucked:true}));assert.equal(r.count,0);assert.equal(r.details.diagnostics.activity.state,'exit_candidate');assert(a.engine.core.cycles[1].bottom);
  for(let i=41;i<=50;i++)r=push(a,frame(i/20,{tucked:true,moving:true}));
  assert.equal(r.count,0);assert.equal(r.details.diagnostics.activity.state,'outside_exercise');assert.equal(a.engine.core.cycles[1].bottom,null);
  r=push(a,frame(2.55,{kneeMissing:true}));assert.equal(r.details.diagnostics.activity.allow,false);
  r=push(a,frame(2.6));assert.equal(r.details.diagnostics.activity.state,'resuming');
  for(let i=53;i<=58;i++)r=push(a,frame(i/20));assert.equal(r.details.diagnostics.activity.state,'active');assert.equal(r.count,0);
 });
 test(name+': isolated knee glitch retains candidate but marks its sample unknown',()=>{
  const a=new ctor();for(let i=0;i<40;i++)push(a,frame(i/20));
  a.engine.core.cycles[1].peak={x:.6,t:1.2};a.engine.core.cycles[1].bottom={x:.05,t:1.8};a.engine.core.cycles[1].last=1.95;
  const r=push(a,frame(2,{tucked:true}));assert(!r.events.some(e=>e.type==='motion.reset'));
  assert(Number.isNaN(a.engine.core.rows.at(-1).chest));const next=push(a,frame(2.05));
  assert.equal(next.details.diagnostics.activity.state,'active');assert(!next.events.some(e=>e.type==='motion.reset'));
 });
 test(name+': hip error alone is not an exercise exit; small-motion thresholds unchanged',()=>{
  const a=new ctor();for(let i=0;i<60;i++)push(a,frame(i/20,{hipDrop:true}));
  assert.equal(a.engine.activity.state,'active');assert.deepEqual(a.engine.core.cfg.motion,config.motion);
 });
}
test('confirmed exit survives observation gaps and side reselection',()=>{
 const g=new PushupActivityGate(config);g.step(frame(0),'left');g.step(frame(.1,{tucked:true}),'left');g.step(frame(.4,{tucked:true}),'left');
 // A continuous interval is required for confirmation after a time gap.
 g.step(frame(.45,{tucked:true}),'left');g.step(frame(.65,{tucked:true}),'left');
 assert(g.confirmed);let r=g.step(frame(2,{kneeMissing:true}),'left');assert(!r.allow);
 r=g.step(frame(2.05,{kneeMissing:true}),'right');assert(!r.allow);
});
