import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as pose from '../../runtime/index.js';
import {READINESS_PROFILES} from '../../runtime/common/readiness.js';

const snapshots=[];
const packet=(t,hide=[])=>({timestampMs:t,width:1000,height:1000,
  landmarks:Array.from({length:33},(_,i)=>[.2+i*.01,.5,0,hide.includes(i)?0:1,1])});
const absent=t=>({...packet(t),landmarks:[]});
const collect=r=>{snapshots.push(r);return r;};
class Counter {
  constructor(exercise='squat'){this.exercise=exercise;this.count=0;this.holdSeconds=0;this.time=null;this.calls=[];this.breaks=[];this.closed=false;}
  pushFrame(f){
    this.calls.push(f.timestampMs);
    if(this.time!==null)this.holdSeconds+=(f.timestampMs-this.time)/1000;
    if(f.landmarks[0][2]===1)this.count++;
    this.time=f.timestampMs;
    return {type:'frame.result',schemaVersion:'2.0',exercise:this.exercise};
  }
  breakContinuity(reason){this.breaks.push(reason);this.time=null;return [{type:'tracking.interrupted',reason}];}
  summary(){return {exercise:this.exercise,count:this.count,holdSeconds:this.holdSeconds};}
  finish(){if(this.closed)return [];this.closed=true;return [{type:'set.completed',summary:this.summary()}];}
}
const make=(opts={})=>{const analyzer=new Counter();return {a:analyzer,c:new pose.ExerciseSessionController({analyzer,...opts})};};
function initial(c,start=0) {let r;for(let t=start;t<=start+400;t+=100)r=collect(c.pushFrame(packet(t)));return r;}
function series(c,from,to,fn=packet) {let r;for(let t=from;t<=to;t+=100)r=collect(c.pushFrame(fn(t)));return r;}
test('default durations and initial stability do not invent an initial resume countdown',()=>{
 const {a,c}=make();
 assert.deepEqual(pose.SESSION_CONFIG,{lossMs:2000,countdownMs:5000,stabilizeMs:300,maxFrameGapMs:400});
 assert.equal(c.getState().phase,'waiting_for_pose');
 const r=initial(c);assert.equal(r.phase,'active');assert.equal(r.countdownRemainingMs,null);
 assert.deepEqual(a.calls,[300,400]);assert.equal(a.holdSeconds,.1);
});
test('loss blocks measurement immediately and confirms auto pause at exactly 2 seconds',()=>{
 const {a,c}=make();initial(c);
 const summary=c.summary(),calls=a.calls.length;
 let r=series(c,500,2400,absent);
 assert.equal(r.phase,'recognition_lost');assert.equal(r.lossDurationMs,1900);
 assert.equal(a.calls.length,calls);assert.deepEqual(c.summary(),summary);assert.equal(a.breaks.length,1);
 r=collect(c.pushFrame(absent(2500)));assert.equal(r.phase,'auto_paused');
 assert.ok(r.events.some(e=>e.type==='session.auto_paused'));
 assert.equal(r.recognition.observable,false);
});
test('stable recovery starts 5 seconds, includes no countdown samples or elapsed pause time',()=>{
 const {a,c}=make();initial(c);series(c,500,2500,absent);
 const before=c.summary(),calls=a.calls.length;
 let r=series(c,2600,2900);assert.equal(r.phase,'countdown');assert.equal(r.countdownRemainingMs,5000);
 r=series(c,3000,7800);assert.equal(r.phase,'countdown');assert.equal(r.countdownRemainingMs,100);
 assert.equal(a.calls.length,calls);assert.deepEqual(c.summary(),before);
 r=collect(c.pushFrame(packet(7900)));assert.equal(r.phase,'active');
 assert.ok(r.events.some(e=>e.type==='session.resumed'));assert.equal(a.calls.at(-1),7900);
 assert.deepEqual(c.summary(),before);
 collect(c.pushFrame(packet(8000)));assert.ok(c.summary().holdSeconds>before.holdSeconds);
});
test('any missing countdown frame cancels it and the next stable recovery starts a fresh 5 seconds',()=>{
 const {a,c}=make();initial(c);series(c,500,2500,absent);series(c,2600,5900);
 const calls=a.calls.length,r=collect(c.pushFrame(absent(6000)));
 assert.equal(r.phase,'auto_paused');assert.equal(r.countdownRemainingMs,null);
 assert.ok(r.events.some(e=>e.type==='session.countdown_cancelled'));
 let next=series(c,6100,6400);assert.equal(next.countdownRemainingMs,5000);
 next=series(c,6500,11300);assert.equal(next.phase,'countdown');assert.equal(a.calls.length,calls);
 next=collect(c.pushFrame(packet(11400)));assert.equal(next.phase,'active');
});
test('a short dropout discards motion but does not impose an automatic 5 second pause',()=>{
 const {a,c}=make();initial(c);collect(c.pushFrame(absent(500)));collect(c.pushFrame(absent(600)));
 const r=series(c,700,1000);assert.equal(r.phase,'active');assert.equal(r.countdownRemainingMs,null);
 assert.equal(a.breaks.length,1);
});
test('recovery arriving exactly at the loss threshold still needs the resume countdown',()=>{
 const {c}=make();initial(c);series(c,500,2400,absent);
 const r=collect(c.pushFrame(packet(2500)));
 assert.equal(r.phase,'auto_paused');assert.equal(r.recognition.observable,true);
 const r2=series(c,2600,2800);assert.equal(r2.phase,'countdown');assert.equal(r2.countdownRemainingMs,5000);
});
test('watchdog notices missing camera callbacks and ticks never synthesize analyzer samples or resume alone',()=>{
 const {a,c}=make();initial(c);
 collect(c.tick(900));assert.equal(c.getState().phase,'recognition_lost');
 let r=collect(c.tick(2400));assert.equal(r.phase,'auto_paused');
 assert.equal(r.recognition.reasonCode,'CAMERA_FRAME_TIMEOUT');
 assert.deepEqual(a.calls,[300,400]);
 series(c,2500,2800);
 r=collect(c.tick(2900));assert.equal(r.phase,'countdown');
 r=collect(c.tick(8000));assert.equal(r.phase,'auto_paused');
 assert.ok(r.events.some(e=>e.type==='session.countdown_cancelled'));
 assert.deepEqual(a.calls,[300,400]);
});
test('one visible side is sufficient, switching sides restabilizes without splicing measurement',()=>{
 const {a,c}=make();
 const leftHidden=[11,13,15,23,25,27],rightHidden=[12,14,16,24,26,28];
 series(c,0,400,t=>packet(t,rightHidden));
 assert.equal(c.getState().recognition.side,'left');assert.equal(c.getState().phase,'active');
 let r=collect(c.pushFrame(packet(500,leftHidden)));
 assert.equal(r.recognition.observable,true);assert.equal(r.measurementEnabled,false);
 assert.equal(r.recognition.side,'right');assert.equal(a.breaks.length,1);
 r=series(c,600,800,t=>packet(t,leftHidden));
 assert.equal(r.phase,'active');assert.equal(r.countdownRemainingMs,null);
 r=collect(c.pushFrame(packet(900,[...leftHidden,...rightHidden])));
 assert.equal(r.phase,'recognition_lost');assert.equal(r.recognition.observable,false);
});
test('bilateral exercises do not silently substitute a single visible limb',()=>{
 const a=new Counter('flutter_kicks'),c=new pose.ExerciseSessionController({analyzer:a});
 initial(c);const r=collect(c.pushFrame(packet(500,[28])));
 assert.equal(r.phase,'recognition_lost');assert.equal(r.recognition.observable,false);
});
test('manual pause never auto resumes and resume requires fresh recognition plus countdown',()=>{
 const {a,c}=make();initial(c);
 const before=c.summary();collect(c.pause());collect(c.pause());
 series(c,500,6000);assert.equal(c.getState().phase,'manually_paused');assert.deepEqual(c.summary(),before);
 collect(c.resume());series(c,6100,6400);assert.equal(c.getState().phase,'countdown');
 series(c,6500,11400);assert.equal(c.getState().phase,'active');assert.deepEqual(c.summary(),before);
 assert.equal(a.breaks.length,1);
});
test('duplicates, reversed timestamps and finished input cannot mutate counters or pending timers',()=>{
 const {a,c}=make();initial(c);const before=c.getState();
 for(const f of [packet(400),packet(300)]){const r=collect(c.pushFrame(f));assert.equal(r.ignoredReason,'non_monotonic_timestamp');}
 assert.deepEqual(c.getState(),before);
 collect(c.tick(500));assert.equal(c.pushFrame(packet(450)).ignored,true);
 assert.equal(c.tick(499).ignored,true);
 assert.equal(c.pushFrame(packet(500)).ignored,false);
 const events=c.finish();assert.equal(events.length,1);assert.deepEqual(c.finish(),[]);
 assert.equal(c.pushFrame(packet(600)).ignoredReason,'finished');
 assert.equal(c.tick(700).ignoredReason,'finished');assert.equal(c.pause().ignoredReason,'finished');
 assert.equal(c.resume().ignoredReason,'finished');assert.equal(a.closed,true);
});
test('dimension changes break continuity, pending countdown resets, returned snapshots are detached',()=>{
 const {c}=make();initial(c);
 const r=c.getState();r.recognition.observable=false;r.summary.count=99;
 assert.equal(c.getState().recognition.observable,true);assert.equal(c.summary().count,0);
 collect(c.pushFrame({...packet(500),width:1200}));
 assert.equal(c.getState().measurementEnabled,false);
 assert.equal(c.getState().phase,'waiting_for_pose');
 assert.deepEqual(c.getState(),c.getState());
});
test('invalid configuration and mismatched fixed working side are rejected',()=>{
 assert.throws(()=>new pose.ExerciseSessionController(),TypeError);
 for(const option of [{lossMs:0},{countdownMs:-1},{stabilizeMs:NaN},{maxFrameGapMs:Infinity}])
  assert.throws(()=>make(option),RangeError);
 assert.throws(()=>make({exercise:'burpee'}),RangeError);
 const a=new pose.SplitSquatAnalyzer({side:'left'});
 assert.throws(()=>new pose.ExerciseSessionController({analyzer:a,side:'right'}),RangeError);
 assert.throws(()=>make().c.tick(-1),TypeError);
 assert.throws(()=>make().c.pushFrame({...packet(0),width:0}),TypeError);
});

test('all 23 real exercise analyzers preserve completed totals and exclude paused/countdown intervals',()=>{
 const names=Object.entries(pose).filter(([name])=>name.endsWith('Analyzer')&&!name.startsWith('MoveNet'));
 assert.equal(names.length,23);
 for(const [name,C] of names) {
  const a=new C(),exercise=a.summary().exercise;
  assert.ok(READINESS_PROFILES[exercise],name);
  const c=new pose.ExerciseSessionController({analyzer:a});
  initial(c);
  const before=c.summary();series(c,500,2500,absent);
  assert.deepEqual(c.summary(),before,name);
  series(c,2600,7800);
  assert.deepEqual(c.summary(),before,name);
  const r=c.pushFrame(packet(7900));
  const after=c.summary();
  for(const key of ['count','holdSeconds','observedSeconds','gapSeconds'])
   assert.equal(after[key],before[key],name+' '+key);
  assert.equal(r.phase,'active',name);
 }
});
function split(t,active=false) {
 const f=packet(t);
 f.landmarks=Array.from({length:33},()=>[null,null,null,null,null]);
 for(const [id,x,y] of [[11,.4,.2],[23,.4,.4],[25,.4,.6],[27,active?.62:.4,active?.6:.85]])
  f.landmarks[id]=[x,y,0,1,1];
 return f;
}
function plank(t,sidePlank=false) {
 const f=packet(t);
 f.landmarks=Array.from({length:33},()=>[null,null,null,null,null]);
 const coords=sidePlank?{11:[.2,.20],12:[.2,.35],14:[.2,.55],16:[.1,.55],24:[.5,.4],26:[.7,.43333],28:[.9,.46667]}:
   {11:[.2,.3],13:[.2,.5],15:[.1,.5],23:[.5,.3],25:[.7,.3],27:[.9,.3]};
 for(const [id,xy] of Object.entries(coords))f.landmarks[id]=[...xy,0,1,1];
 return f;
}
test('real completed repetitions survive auto pause; a partial repetition is discarded on recovery',()=>{
 const a=new pose.SplitSquatAnalyzer(),c=new pose.ExerciseSessionController({analyzer:a});
 series(c,0,700,split);series(c,800,1200,t=>split(t,true));series(c,1300,1700,split);
 assert.equal(c.summary().count,1);
 series(c,1800,2200,t=>split(t,true));const before=c.summary();
 series(c,2300,4300,absent);assert.equal(c.summary().count,1);
 series(c,4400,9700,split);assert.equal(c.getState().phase,'active');
 assert.equal(c.summary().count,1);
 assert.equal(c.summary().observedSeconds,before.observedSeconds);
 series(c,9800,10200,t=>split(t,true));series(c,10300,10700,split);
 assert.equal(c.summary().count,2);
});
test('nonzero valid hold time from real plank and side plank is retained and cannot include recovery countdown',()=>{
 for(const [C,side] of [[pose.PlankAnalyzer,false],[pose.SidePlankAnalyzer,true]]) {
  const a=new C(),c=new pose.ExerciseSessionController({analyzer:a}),f=t=>plank(t,side);
  series(c,0,2500,f);const before=c.summary();
  assert.ok(before.holdSeconds>1,C.name);
  series(c,2600,4600,absent);
  assert.equal(c.summary().holdSeconds,before.holdSeconds);
  series(c,4700,10000,f);
  assert.equal(c.getState().phase,'active');assert.equal(c.summary().holdSeconds,before.holdSeconds);
  assert.equal(c.summary().observedSeconds,before.observedSeconds);
  series(c,10100,11500,f);
  assert.ok(c.summary().holdSeconds>before.holdSeconds);
 }
});
test('finishing while paused or counting down returns the original analyzer set event exactly once',()=>{
 for(const countdown of [false,true]) {
  const a=new pose.SplitSquatAnalyzer(),c=new pose.ExerciseSessionController({analyzer:a});
  series(c,0,700,split);series(c,800,1200,t=>split(t,true));series(c,1300,1700,split);
  series(c,1800,3800,absent);
  if(countdown)series(c,3900,4300,split);
  assert.equal(c.getState().phase,countdown?'countdown':'auto_paused');
  const result=c.finish().find(e=>e.type==='set.completed');
  assert.equal(result.summary.count,1);assert.equal(c.getState().phase,'finished');
  assert.equal(c.getState().measurementEnabled,false);assert.deepEqual(c.finish(),[]);
 }
});
test('fixed-side readiness cannot silently use the opposite limb after loss',()=>{
 const a=new pose.SplitSquatAnalyzer({side:'left'}),c=new pose.ExerciseSessionController({analyzer:a});
 series(c,0,700,split);
 const r=c.pushFrame(packet(800,[11,23,25,27]));
 assert.equal(r.recognition.observable,false);assert.equal(r.measurementEnabled,false);
});
test('control state is a JSON-safe separate envelope and never replaces movement phase',()=>{
 const c=new pose.ExerciseSessionController({analyzer:new pose.SplitSquatAnalyzer()});
 const r=series(c,0,500,split);
 assert.equal(r.type,'session.state');assert.equal(r.frameResult.type,'frame.result');
 assert.equal(r.frameResult.phase,'ready');
 assert.deepEqual(JSON.parse(JSON.stringify(r)),r);
});

if(process.env.BAROFIT_SESSION_QA_OUTPUT)process.on('exit',()=>{
 fs.writeFileSync(process.env.BAROFIT_SESSION_QA_OUTPUT,JSON.stringify(snapshots.filter(r=>r.summary.schemaVersion==='2.0')));
});
