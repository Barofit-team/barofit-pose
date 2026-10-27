import test from 'node:test';import assert from 'node:assert/strict';
import {SupermanAnalyzer,PushupAnalyzer} from '../../runtime/index.js';
function frame(t,{elevation=25*(1-Math.cos(2*Math.PI*t/4000))/2,bend=0,armBend=0,mirror=false,right=1,left=1,missingArm=false,notProne=false}={}){
 const r=elevation*Math.PI/360,h=[500,550],s=[500-220*Math.cos(r),550-220*Math.sin(r)],k=[500+190*Math.cos(r),550-190*Math.sin(r)],a=[k[0]+180*Math.cos(r+bend),k[1]-180*Math.sin(r+bend)],e=[s[0]-100*Math.cos(r),s[1]-100*Math.sin(r)],w=[e[0]-100*Math.cos(r+armBend),e[1]-100*Math.sin(r+armBend)];
 if(notProne){s[1]=150;k[1]=750;}
 const lm=Array.from({length:33},()=>[null,null,null,null,null]);
 for(const [ids,q]of [[[11,13,15,23,25,27],left],[[12,14,16,24,26,28],right]])for(let j=0;j<6;j++){const [x,y]=[s,e,w,h,k,a][j];lm[ids[j]]=[(mirror?1000-x:x)/1000,y/1000,0,missingArm&&j===2?0:q,missingArm&&j===2?0:q];}
 return {timestampMs:t,width:1000,height:1000,landmarks:lm};
}
function run(opt={},end=12400){const a=new SupermanAnalyzer();for(let t=0;t<=end;t+=50)a.pushFrame(frame(t,opt));return a;}
test('complete cycles count regardless of knee errors; mirrored and one-side input',()=>{
 for(const opt of [{},{mirror:true},{right:0}]){const a=run(opt);assert.equal(a.count,3);assert.equal(a.summary().items.knee_extension.warning,0);}
 const a=run({bend:Math.PI/2});assert.equal(a.count,3);assert.equal(a.summary().items.knee_extension.warning,3);
});
test('arm occlusion does not invalidate core cycles, unknown is not compliance',()=>{
 const a=run({missingArm:true});assert.equal(a.count,3);assert.equal(a.summary().items.arm_extension.unknown,3);assert.equal(a.summary().items.arm_extension.compliancePct,null);
});
test('sustained elbow bend warns without rejecting the repetition',()=>{
 const a=run({armBend:Math.PI/2});assert.equal(a.count,3);assert.equal(a.summary().items.arm_extension.warning,3);
});
test('static posture, incomplete return, tiny motion and non-prone posture never count',()=>{
 assert.equal(run({elevation:25}).count,0);assert.equal(run({notProne:true}).count,0);
 const a=new SupermanAnalyzer();for(let t=0;t<3000;t+=50)a.pushFrame(frame(t,{elevation:t/100}));assert.equal(a.count,0);
 const b=new SupermanAnalyzer();for(let t=0;t<3000;t+=50)b.pushFrame(frame(t,{elevation:2*Math.sin(t/200)}));assert.equal(b.count,0);
});
test('loss, timestamp gap, pause and side switch break incomplete cycle',()=>{
 for(const kind of ['loss','gap','pause','side']){const a=new SupermanAnalyzer();for(let t=0;t<=2000;t+=50)a.pushFrame(frame(t,{right:0}));
 if(kind==='loss')a.pushFrame({...frame(2050),landmarks:[]});if(kind==='pause')a.breakContinuity();
 for(let t=kind==='gap'?2500:2100;t<4100;t+=50)a.pushFrame(frame(t,kind==='side'?{left:0}:{right:0}));assert.equal(a.count,0,kind);}
});
test('fast cycles warn; raised hold accumulates without becoming another repetition',()=>{
 const a=new SupermanAnalyzer();for(let t=0;t<=5000;t+=50)a.pushFrame(frame(t,{elevation:25*(1-Math.cos(2*Math.PI*t/1100))/2}));assert.ok(a.count>=3);assert.equal(a.summary().items.movement_control.warning,a.count);
 const b=new SupermanAnalyzer();for(let t=0;t<6000;t+=50){const e=t<500?0:t<1500?(t-500)/40:t<4500?25:t<5500?25-(t-4500)/40:0;b.pushFrame(frame(t,{elevation:e}));}assert.equal(b.count,1);assert.ok(b.holdSeconds>2&&b.holdSeconds<3.5);
});
test('v2 envelope, monotonic input, idempotent finish, tempo partition',()=>{
 const a=run(),f=frame(13000),r=a.pushFrame(f);assert.deepEqual(Object.keys(r).sort(),Object.keys(new PushupAnalyzer().pushFrame(f)).sort());assert.equal(r.measurementBasis.count,'completed_superman_raise_lower_attempt');
 for(const rep of a.repetitions){const t=rep.metrics.tempo;assert.equal(t.riseMovingMs+t.lowerMovingMs+t.pauseMs+t.unclassifiedMs,t.intervalMs);}
 assert.equal(a.pushFrame(f).ignoredReason,'non_monotonic_timestamp');assert.equal(a.finish()[0].type,'set.completed');assert.deepEqual(a.finish(),[]);assert.equal(a.pushFrame(frame(14000)).ignoredReason,'finished');assert.equal(new SupermanAnalyzer().finish()[0].timestampMs,null);
});

function supportFrame(t,elevation=0,mirror=false){
 const f=frame(t,{elevation,mirror});
 for(const [s,e,w] of [[11,13,15],[12,14,16]]){
  const p=f.landmarks[s],dir=mirror?-1:1;
  f.landmarks[e]=[p[0]+.04*dir,p[1]+.10,0,1,1];
  f.landmarks[w]=[p[0]+.02*dir,p[1]+.20,0,1,1];
 }return f;
}
test('floor support and getting up do not add a repetition; prior count survives',()=>{
 for(const mirror of [false,true]){
  const a=new SupermanAnalyzer();for(let t=0;t<4400;t+=50)a.pushFrame(frame(t,{mirror}));
  assert.equal(a.count,1);
  let interrupted=false;
  for(let t=4400;t<7500;t+=50){const r=a.pushFrame(supportFrame(t,20*(1-Math.cos((t-4400)/300))/2,mirror));interrupted ||= r.events.some(e=>e.reason==='support_posture');assert.equal(r.metrics.activityStatus,'support_or_exit');}
  assert.equal(a.count,1);assert.ok(interrupted);
  for(let t=7500;t<8500;t+=50)a.pushFrame(frame(t,{elevation:0,mirror}));
  for(let t=8500;t<12800;t+=50)a.pushFrame(frame(t,{elevation:25*(1-Math.cos(2*Math.PI*(t-8500)/4000))/2,mirror}));
  assert.equal(a.count,2,'a fresh full repetition can resume after settling');
 }
});
test('setup after support waits for stable baseline and separates subsequent cycles',()=>{
 const a=new SupermanAnalyzer();for(let t=0;t<1000;t+=50)a.pushFrame(supportFrame(t));
 for(let t=1000;t<1600;t+=50)a.pushFrame(frame(t,{elevation:-20+(t-1000)/30}));
 for(let t=1600;t<2400;t+=50)a.pushFrame(frame(t,{elevation:0}));
 for(let t=2400;t<14800;t+=50)a.pushFrame(frame(t,{elevation:25*(1-Math.cos(2*Math.PI*(t-2400)/4000))/2,armBend:Math.PI/2}));
 assert.equal(a.count,3);assert.equal(a.summary().items.arm_extension.warning,3);
});
test('unresolved upper-arm tracking with no support evidence preserves the core cycle',()=>{
 const a=new SupermanAnalyzer();
 for(let t=0;t<=4400;t+=50){const f=frame(t);
  if(t>1400&&t<2600)for(const [s,e,w]of [[11,13,15],[12,14,16]]){
   const p=f.landmarks[s];f.landmarks[e]=[p[0]+.12,p[1]-.01,0,1,1];f.landmarks[w]=[p[0]-.04,p[1]-.04,0,1,1];
  }a.pushFrame(f);
 }assert.equal(a.count,1);assert.equal(a.summary().items.arm_extension.warning,0);
});

test('folded upper arm is feedback, not floor support or a count gate',()=>{
 for(const mirror of [false,true]){
  const a=new SupermanAnalyzer();
  for(let t=0;t<=12400;t+=50){
   const f=frame(t,{mirror});
   for(const [s,e,w]of [[11,13,15],[12,14,16]]){
    const p=f.landmarks[s],dir=mirror?1:-1;
    f.landmarks[e]=[p[0],p[1]+.08,0,1,1];
    f.landmarks[w]=[p[0]+dir*.09,p[1]+.08,0,1,1];
   }
   const r=a.pushFrame(f);
   assert.notEqual(r.metrics.activityStatus,'support_or_exit');
  }
  assert.equal(a.count,3);assert.equal(a.summary().items.arm_extension.warning,3);
 }
});
