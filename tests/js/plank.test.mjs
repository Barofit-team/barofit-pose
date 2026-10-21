import test from 'node:test';import assert from 'node:assert/strict';
import {PlankAnalyzer} from '../../runtime/index.js';
function frame(t,kind='normal'){
 const p=Array.from({length:33},()=>[0,0,0,0,0]);
 for(const [ids,c] of [[[11,13,15,23,25,27],.9],[[12,14,16,24,26,28],.8]]){
  const xy=[[.2,.3],[.2,.5],[.1,.5],[.5,.3],[.7,.3],[.9,.3]];
  if(kind==='drop'){xy[3][1]=.38;xy[4][1]=.34;}
  if(kind==='high'){xy[3][1]=.18;xy[4][1]=.24;}
  if(kind==='shoulder')xy[1][0]=.35;
  if(kind==='knee')xy[4][1]=.42;
  ids.forEach((id,i)=>p[id]=[...xy[i],0,c,c]);
 }
 return {timestampMs:t*1000,width:1000,height:1000,landmarks:p};
}
test('plank normal and four sustained warning cases',()=>{
 for(const [kind,code] of [['normal',null],['drop','HIP_DROP'],['high','HIP_RAISE'],['shoulder','SHOULDER_ELBOW_OFFSET'],['knee','KNEE_BENT']]){
  const e=new PlankAnalyzer();let r;for(let i=0;i<50;i++)r=e.pushFrame(frame(i/15,kind));
  assert.deepEqual(r.codes,code?[code]:[]);assert.equal(r.side,'left');assert(r.holdSeconds>=0&&r.holdSeconds<=r.observedSeconds); if(code){const h=r.holdSeconds;for(let i=50;i<65;i++)r=e.pushFrame(frame(i/15,kind));assert.equal(r.holdSeconds,h);}else assert(r.holdSeconds>2.8);
 }
});
test('unknown is separate, large gaps and pauses do not inflate observed time',()=>{
 const e=new PlankAnalyzer();for(let i=0;i<20;i++)e.pushFrame(frame(i/10));
 const a=e.observedSeconds;e.breakContinuity();e.pushFrame(frame(10));assert.equal(e.observedSeconds,a);
 e.pushFrame({...frame(10.1),landmarks:[]});
 e.pushFrame(frame(12));assert(e.gapSeconds>1.8);
 const s=e.summary();for(const v of Object.values(s.items))assert(Math.abs(v.compliant+v.warning+v.unknown-s.observedSeconds)<1e-9);
 assert.equal(e.pushFrame(frame(11)).ignored,true);assert.equal(e.finish().length,1);assert.deepEqual(e.finish(),[]);
});
test('no stale alert after a pause or missing geometry',()=>{
 const e=new PlankAnalyzer();for(let i=0;i<40;i++)e.pushFrame(frame(i/15,'drop'));
 assert(e.pushFrame(frame(3,'drop')).items.hip==='pending_feedback'); // gap resets
 e.breakContinuity();const r=e.pushFrame({...frame(4),landmarks:[]});
 assert.deepEqual(r.codes,[]);assert.equal(r.tracking,'tracking_unavailable');
});

test('valid time stops on missing support joints, gaps, duplicate frames and pause',()=>{
 const e=new PlankAnalyzer();for(let i=0;i<=10;i++)e.pushFrame(frame(i/10));
 const first=e.summary().holdSeconds;assert(first>0&&first<1);
 const missing=frame(1.1);missing.landmarks[13][3]=0;missing.landmarks[14][3]=0;
 assert.equal(e.pushFrame(missing).holdSeconds,first);
 e.pushFrame(frame(5));assert.equal(e.summary().holdSeconds,first);
 for(let i=1;i<=10;i++)e.pushFrame(frame(5+i/10));
 const resumed=e.summary().holdSeconds;assert(resumed>first);
 e.pushFrame(frame(6));assert.equal(e.summary().holdSeconds,resumed);
 e.breakContinuity();e.pushFrame(frame(20));assert.equal(e.summary().holdSeconds,resumed);
 assert.equal(e.finish().at(-1).summary.holdSeconds,resumed);
});

test('standing, high plank and compact kneeling do not accumulate forearm-plank time',()=>{
 for(const kind of ['standing','high_plank','kneeling']){
  const e=new PlankAnalyzer();
  for(let i=0;i<20;i++){
   const f=frame(i/10);
   const xy=kind==='standing'?[[.5,.2],[.5,.35],[.5,.5],[.5,.5],[.5,.7],[.5,.9]]:
    kind==='high_plank'?[[.2,.2],[.2,.35],[.2,.5],[.5,.25],[.7,.3],[.9,.4]]:
    [[.2,.3],[.2,.5],[.1,.5],[.35,.3],[.4,.5],[.45,.5]];
   for(const ids of [[11,13,15,23,25,27],[12,14,16,24,26,28]])ids.forEach((id,j)=>f.landmarks[id]=[...xy[j],0,.9,.9]);
   e.pushFrame(f);
  }
  assert.equal(e.summary().holdSeconds,0,kind);
 }
});

test('warmup is not backfilled into valid posture time',()=>{
 const e=new PlankAnalyzer();e.pushFrame(frame(0));e.pushFrame(frame(.1));
 assert.equal(e.summary().holdSeconds,0);
 e.pushFrame({...frame(.2),landmarks:[]});assert.equal(e.summary().holdSeconds,0);
 for(let i=0;i<=6;i++)e.pushFrame(frame(1+i/10));
 assert(e.summary().holdSeconds>=0&&e.summary().holdSeconds<.3);
});

test('missing knee evaluation blocks valid time, even if the plank itself is observable',()=>{
 const e=new PlankAnalyzer();
 for(let i=0;i<=20;i++){
  const f=frame(i/10,'drop');
  for(const p of f.landmarks)p[0]=1-p[0];
  f.landmarks[25][3]=0;f.landmarks[26][3]=0;
  const r=e.pushFrame(f);
  if(i===20){assert(r.codes.includes('HIP_DROP'));assert.equal(r.items.knee,'tracking_unavailable');}
 }
 assert.equal(e.summary().holdSeconds,0);
});

test('valid time resumes after a warning clears without resetting the accumulated total',()=>{
 const e=new PlankAnalyzer();let last=0,sawWarning=false,recovered=false;
 for(let i=0;i<=120;i++){
  const r=e.pushFrame(frame(i/10,i>=30&&i<70?'high':'normal'));
  if(r.codes.includes('HIP_RAISE')){sawWarning=true;assert.equal(r.holdSeconds,last);}
  if(i>80&&r.holdSeconds>last)recovered=true;
  assert(r.holdSeconds>=last&&r.holdSeconds<=r.observedSeconds);last=r.holdSeconds;
 }
 assert(sawWarning&&recovered);
});
