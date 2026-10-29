import test from 'node:test';
import assert from 'node:assert/strict';
import {PushupAnalyzer,PlankAnalyzer,BirdDogAnalyzer,SquatAnalyzer} from '../../runtime/index.js';
import {trackingMessage} from '../../runtime/pushup/liveEngine.js';
import {frameResult} from '../../runtime/common/realtime.js';
const classes=[PushupAnalyzer,PlankAnalyzer,BirdDogAnalyzer,SquatAnalyzer];
const frame=t=>({timestampMs:t,width:1000,height:600,landmarks:[]});

test('all runtime snapshots have identical keys, including rejected frames and finish-before-first-frame',()=>{
 let keys;
 for(const C of classes){
  const e=new C();
  for(const f of [frame(100),frame(100),frame(50),frame(200)]){
   const r=e.pushFrame(f);keys??=Object.keys(r).sort();assert.deepEqual(Object.keys(r).sort(),keys);
   assert.deepEqual(JSON.parse(JSON.stringify(r)),r);
   assert.equal(r.timestampMs,f.timestampMs);
   if(r.ignored){assert.deepEqual(r.codes,[]);assert.deepEqual(r.items,{});assert.equal(r.lastRepetition,null);}
  }
  const before=e.summary();e.finish();const after=e.summary();
  assert.deepEqual(Object.keys(e.pushFrame(frame(300))).sort(),keys);
  assert.deepEqual(e.summary(),after);assert.equal(before.count,after.count);
  const empty=new C();empty.finish();assert.equal(empty.pushFrame(frame(0)).ignoredReason,'finished');
 }
});

test('current hip is not confused with a previous repetition warning; metadata and codes survive',()=>{
 const raw={items:{hip:'warning',elbow:'warning'},hipStatus:'within_reference',codes:['HIP_DROP','ELBOW_SHALLOW'],
   count:4,tracking:'tracking',metrics:{elbow:100},events:[{type:'rep.feedback',t:1,rep:4}]};
 const rated={rep:4,t:1,items:raw.items,codes:raw.codes,metrics:{elbow_bottom_deg:100}};
 const r=frameResult(raw,frame(1100),{exercise:'pushup',engineVersion:'test',lastRated:rated});
 assert.deepEqual(r.items,{hip:'within_reference'});assert.deepEqual(r.currentCodes,[]);
 assert.deepEqual(r.lastRepetition.items,raw.items);assert.equal(r.lastRepetition.number,4);
 assert.equal(r.lastRepetition.timestampMs,1000);assert.deepEqual(r.codes,raw.codes);
 assert.deepEqual(r.events,raw.events);assert.deepEqual(r.lastRepetition.metrics,rated.metrics);
 const expired=frameResult({...raw,items:null,codes:[]},frame(5000),{exercise:'pushup',engineVersion:'test',lastRated:rated});
 assert.equal(expired.lastRepetition,null);
});

test('missing hip stays unavailable and a warning candidate stays pending',()=>{
 for(const [hipStatus,expected] of [[null,'tracking_unavailable'],['candidate','pending_feedback'],['hip_raise','warning']]){
  const r=frameResult({hipStatus},frame(0),{exercise:'pushup',engineVersion:'test'});
  assert.equal(r.items.hip,expected);
 }
});

test('movement semantics and exercise-only details are preserved',()=>{
 const raw={phase:'bird_dog',movementPhase:'holding',sideCounts:{left:2,right:3},body:{reference_ready:true},holdingSides:['left'],holdSeconds:4,count:5};
 const r=frameResult(raw,frame(0),{exercise:'bird_dog',engineVersion:'test'});
 assert.equal(r.phase,'holding');assert.equal(r.details.enginePhase,'bird_dog');
 assert.deepEqual(r.details.sideCounts,raw.sideCounts);assert.deepEqual(r.details.body,raw.body);
 assert.equal(r.measurementBasis.holdSeconds,'observed_holding');
 assert.equal(new PlankAnalyzer().pushFrame(frame(0)).measurementBasis.holdSeconds,'all_required_items_compliant');
});

test('serialization leaves rules, events, metrics, summaries and time accumulation identical',()=>{
 for(const C of classes){
  const adapted=new C(),legacy=new C();
  for(let i=0;i<140;i++){
   const f=frame(i*100);f.landmarks=Array.from({length:33},()=>[null,null,null,null,null]);
   for(const ids of [[11,13,15,23,25,27],[12,14,16,24,26,28]]){
    const xy=[[.2,.3],[.2,.5],[.1,.5],[.5,i<65?.3:.4],[.7,.3],[.9,.3]];
    ids.forEach((id,j)=>f.landmarks[id]=[...xy[j],0,.9,.9]);
   }
   if(i===80){adapted.breakContinuity();legacy.breakContinuity();}
   const a=adapted.pushFrame(f),b=legacy._pushFrameLegacy(f);
   assert.equal(a.count,b.count??null);assert.equal(a.holdSeconds,b.holdSeconds??null);
   assert.deepEqual(a.codes,b.codes??[]);assert.deepEqual(a.events,b.events??[]);
   assert.deepEqual(a.metrics,b.metrics??{});
   assert.deepEqual(adapted.summary(),legacy.summary());
  }
  assert.deepEqual(adapted.finish(),legacy.finish());
 }
});

test('tracking guidance retains joint-specific reasons after details migration',()=>{
 const e=new PushupAnalyzer(),r=e.pushFrame(frame(0));
 assert.equal(trackingMessage(r),trackingMessage({...r,details:undefined,diagnostics:r.details.diagnostics}));
});
