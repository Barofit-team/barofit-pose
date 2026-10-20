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
  assert.deepEqual(r.codes,code?[code]:[]);assert.equal(r.side,'left');assert.equal(r.holdSeconds,null);
 }
});
test('unknown is separate, large gaps and pauses do not inflate observed time',()=>{
 const e=new PlankAnalyzer();for(let i=0;i<20;i++)e.pushFrame(frame(i/10));
 const a=e.observedSeconds;e.breakContinuity();e.pushFrame(frame(10));assert.equal(e.observedSeconds,a);
 e.pushFrame({...frame(10.1),landmarks:[]});
 e.pushFrame(frame(12));assert(e.gapSeconds>1.8);
 const s=e.summary();for(const v of Object.values(s.items))assert(Math.abs(v.compliant_s+v.warning_s+v.unknown_s-s.observedSeconds)<1e-9);
 assert.equal(e.pushFrame(frame(11)).ignored,true);assert.equal(e.finish().length,1);assert.deepEqual(e.finish(),[]);
});
test('no stale alert after a pause or missing geometry',()=>{
 const e=new PlankAnalyzer();for(let i=0;i<40;i++)e.pushFrame(frame(i/15,'drop'));
 assert(e.pushFrame(frame(3,'drop')).items.hip==='pending_feedback'); // gap resets
 e.breakContinuity();const r=e.pushFrame({...frame(4),landmarks:[]});
 assert.deepEqual(r.codes,[]);assert.equal(r.tracking,'tracking_unavailable');
});
