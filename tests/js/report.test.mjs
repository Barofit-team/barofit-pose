import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as pose from '../../runtime/index.js';
import {ReportAccumulator,reportDetails} from '../../runtime/common/report.js';
import {itemResult,setSummary} from '../../runtime/common/result.js';
const sample=(t,{codes=[],items={},tracking='tracking',rep=null,events=[],ignored=false}={})=>({
 timestampMs:t,side:'left',tracking,currentCodes:codes,codes,items,lastRepetition:rep,events,ignored});
const summary=(exercise='split_squat',count=0,items={range:itemResult('repetition',0,0)},details={})=>
 setSummary({exercise,engineVersion:'test',count,items,details});
const rep=(n,bad=false)=>({number:n,timestampMs:n*1000,items:{range:bad?'warning':'within_reference'},
 codes:bad?['SPLIT_SQUAT_RANGE']:[],metrics:{side:'left'}});
test('23 analyzers expose common detail keys, labels and null scores for unevaluated sets',()=>{
 const classes=Object.entries(pose).filter(([n])=>n.endsWith('Analyzer')&&!n.startsWith('MoveNet'));
 assert.equal(classes.length,23);
 for(const [name,C] of classes){
  const a=new C(),s=a.summary();
  for(const key of ['repetitions','sideCounts','sideHoldSeconds','itemLabels','report'])assert.ok(key in s.details,name);
  for(const id of Object.keys(s.items)){
   assert.notEqual(s.details.itemLabels[id],'자세 평가 항목',id);
   assert.equal(s.details.itemLabels[id],pose.itemLabel(id));
  }
  assert.equal(s.details.report.postureScore,null,name);
  assert.equal(s.details.report.trackingAvailablePct,null,name);
  assert.equal(s.details.report.lateFormBreakdown.candidate,null,name);
  const end=a.finish().at(-1);assert.deepEqual(end.summary,a.summary());assert.deepEqual(a.finish(),[]);
 }
});
test('warning episodes and continuous seconds are not frame counts',()=>{
 const m=new ReportAccumulator();
 for(let t=0;t<=1000;t+=100)m.observe(sample(t,{codes:['HIP_DROP'],items:{hip:'warning'}}));
 let r=reportDetails(summary('plank',null,{hip:itemResult('time',0,1)}),m).report;
 assert.deepEqual(r.errorCounts,{HIP_DROP:1});assert.ok(Math.abs(r.warningSeconds.HIP_DROP-1)<1e-9);
 m.observe(sample(1100));
 m.observe(sample(1200,{codes:['HIP_DROP']}));
 r=reportDetails(summary('plank',null,{hip:itemResult('time',0,1)}),m).report;
 assert.equal(r.errorCounts.HIP_DROP,2);assert.equal(r.errorCountBasisByCode.HIP_DROP,'warning_episodes');
});
test('same repetition card and event are deduplicated; final revision removes provisional codes',()=>{
 const m=new ReportAccumulator();
 for(let i=0;i<20;i++)m.observe(sample(i*100,{rep:rep(1,true),events:[{type:'rep.completed',rep:1,t:0}]}));
 let r=reportDetails(summary('split_squat',1,{range:itemResult('repetition',0,1)}),m);
 assert.equal(r.repetitions.length,1);assert.equal(r.report.errorCounts.SPLIT_SQUAT_RANGE,1);
 m.events([{type:'rep.feedback',rep:1,t:2,items:{range:'within_reference'},codes:[]}]);
 r=reportDetails(summary('split_squat',1,{range:itemResult('repetition',1,0)}),m);
 assert.deepEqual(r.report.errorCounts,{});assert.equal(r.repetitions[0].items.range,'within_reference');
});
test('native delayed feedback revision wins over old frame cards',()=>{
 const m=new ReportAccumulator();m.observe(sample(0,{rep:rep(1,true)}));
 const r=reportDetails(summary('pike_pushup',1,{range:itemResult('repetition',1,0)},{repetitions:[rep(1,false)]}),m);
 assert.deepEqual(r.report.errorCounts,{});assert.equal(r.repetitions[0].codes.length,0);
});
test('interrupted completed feedback remains unknown without deleting the completed record',()=>{
 const m=new ReportAccumulator();m.observe(sample(0,{events:[{type:'rep.completed',rep:1,t:0}]}));
 m.interrupt([{type:'rep.feedback',rep:1,t:.2,items:{hip:'interrupted'},codes:[]}]);
 const r=reportDetails(summary('pushup',1,{hip:itemResult('repetition',0,0,1)}),m);
 assert.equal(r.repetitions.length,1);assert.equal(r.repetitions[0].items.hip,'interrupted');
 assert.equal(r.report.postureScore,null);assert.deepEqual(r.report.errorCounts,{});
});
test('legacy squat reps are preserved and normalized without guessing trunk grades',()=>{
 const raw={rep:1,start_s:1,end_s:2,min_knee_deg:110,depth_state:'warning'};
 const r=summary('squat',1,{depth:itemResult('repetition',0,1)},{reps:[raw]}).details;
 assert.deepEqual(r.reps,[raw]);assert.equal(r.repetitions[0].number,1);assert.equal(r.repetitions[0].timestampMs,2000);
 assert.deepEqual(r.repetitions[0].items,{depth:'warning'});
 assert.equal(r.report.errorCounts.SQUAT_SHALLOW,1);
});
test('mixed squat time warning codes and per-repetition depth codes retain explicit distinct bases',()=>{
 const m=new ReportAccumulator();m.observe(sample(0,{codes:['TRUNK_LEAN']}));
 const r=reportDetails(summary('squat',1,{depth:itemResult('repetition',0,1),trunk:itemResult('time',0,1)},
 {reps:[{rep:1,end_s:1,depth_state:'warning'}]}),m).report;
 assert.deepEqual(r.errorCounts,{TRUNK_LEAN:1,SQUAT_SHALLOW:1});
 assert.equal(r.errorCountBasisByCode.TRUNK_LEAN,'warning_episodes');
 assert.equal(r.errorCountBasisByCode.SQUAT_SHALLOW,'completed_repetitions');
});
test('posture score averages evaluated item percentages; unknown and unsupported data never become a score',()=>{
 const r=summary('leg_raise',3,{a:itemResult('repetition',1,1,99),b:itemResult('time',3,1),c:itemResult('time',0,0,100)}).details.report;
 assert.equal(r.postureScore,62.5);assert.equal(r.evaluatedItemCount,2);
 for(const C of [pose.JumpSquatAnalyzer,pose.ReverseCrunchAnalyzer,pose.FlutterKicksAnalyzer,pose.BurpeeAnalyzer,pose.SitupAnalyzer]){
  const a=new C();assert.equal(a.summary().details.report.postureScore,null);
 }
});
test('tracking is duration weighted, includes invalid frames and gaps, excludes explicit pauses and ignored samples',()=>{
 const m=new ReportAccumulator();
 m.observe(sample(0));m.observe(sample(100));m.observe(sample(200,{tracking:'tracking_unavailable'}));m.observe(sample(300));
 let r=reportDetails(summary(),m).report;assert.ok(Math.abs(r.trackingAvailablePct-100/3)<1e-9);
 m.observe(sample(250,{ignored:true}));assert.equal(m.acceptedFrames,4);
 m.interrupt([]);m.observe(sample(10000));r=reportDetails(summary(),m).report;
 assert.ok(Math.abs(r.tracking.totalSeconds-.3)<1e-9);
 m.observe(sample(11000));r=reportDetails(summary(),m).report;
 assert.ok(Math.abs(r.tracking.unavailableSeconds-1.2)<1e-9);
});
test('same observed timing at 10 and 20 FPS produces the same availability rate',()=>{
 const run=step=>{const m=new ReportAccumulator();for(let t=0;t<=1000;t+=step)m.observe(sample(t));
  for(let t=1000+step;t<=2000;t+=step)m.observe(sample(t,{tracking:'tracking_unavailable'}));
  return reportDetails(summary(),m).report.trackingAvailablePct;};
 assert.ok(Math.abs(run(100)-50)<1e-9);assert.ok(Math.abs(run(50)-50)<1e-9);
});
test('repetition decline requires three assessed repetitions per half and common items',()=>{
 const reps=Array.from({length:6},(_,i)=>rep(i+1,i>=3));
 const r=summary('split_squat',6,{range:itemResult('repetition',3,3)},{repetitions:reps}).details.report;
 assert.equal(r.lateFormBreakdown.candidate,true);assert.equal(r.lateFormBreakdown.dropPoints,100);
 assert.equal(summary('split_squat',5,{}, {repetitions:reps.slice(0,5)}).details.report.lateFormBreakdown.candidate,null);
 reps[5].items.range='unknown';
 assert.equal(summary('split_squat',6,{}, {repetitions:reps}).details.report.lateFormBreakdown.candidate,null);
});
test('time decline needs evaluated time, not merely a long set or many frames',()=>{
 const m=new ReportAccumulator();
 for(let t=0;t<=12000;t+=100)m.observe(sample(t,{items:{hip:t<6000?'within_reference':'warning'}}));
 let r=reportDetails(summary('plank',null,{hip:itemResult('time',6,6)}),m).report;
 assert.equal(r.lateFormBreakdown.candidate,true);assert.equal(r.lateFormBreakdown.comparisonBasis,'evaluated_time_halves');
 const unknown=new ReportAccumulator();
 for(let t=0;t<=12000;t+=100)unknown.observe(sample(t,{items:{hip:'unknown'}}));
 r=reportDetails(summary('plank',null,{hip:itemResult('time',0,0,12)}),unknown).report;
 assert.equal(r.lateFormBreakdown.candidate,null);
});
test('unknown gaps in repetition records cannot be interpreted as late form breakdown',()=>{
 const s=summary('split_squat',20,{range:itemResult('repetition',3,3)},{repetitions:Array.from({length:6},(_,i)=>rep(i+1,i>=3))});
 assert.equal(s.details.report.repetitionRecordsComplete,false);
 assert.equal(s.details.report.lateFormBreakdown.candidate,null);
});
test('workout adapter uses real report fields and rejects old/malformed input',()=>{
 const s=summary('split_squat',1,{range:itemResult('repetition',0,1)},{repetitions:[rep(1,true)]});
 const payload=pose.workoutReportFields(s);
 assert.deepEqual(payload.feedbackCodes,['SPLIT_SQUAT_RANGE']);
 assert.deepEqual(payload.errorCounts,{SPLIT_SQUAT_RANGE:1});assert.equal(payload.trackingAvailablePct,null);
 payload.errorCounts.SPLIT_SQUAT_RANGE=99;assert.equal(s.details.report.errorCounts.SPLIT_SQUAT_RANGE,1);
 assert.throws(()=>pose.workoutReportFields({details:{}}),TypeError);
});
test('empty sets, duplicate frames, finish and returned objects never inflate or mutate reports',()=>{
 const a=new pose.SplitSquatAnalyzer();
 const f={timestampMs:0,width:1000,height:1000,landmarks:[]};
 a.pushFrame(f);const before=a.summary();
 a.pushFrame(f);assert.deepEqual(a.summary(),before);
 const changed=a.summary();changed.details.report.warningEpisodeCounts.X=100;
 assert.equal(a.summary().details.report.warningEpisodeCounts.X,undefined);
 a.finish();const final=a.summary();a.pushFrame({...f,timestampMs:1});
 assert.deepEqual(a.summary(),final);assert.deepEqual(a.finish(),[]);
});
function plankFrame(t,drop=false) {
 const p=Array.from({length:33},()=>[null,null,null,null,null]);
 for(const [ids,q] of [[[11,13,15,23,25,27],.9],[[12,14,16,24,26,28],.8]]){
  const xy=[[.2,.3],[.2,.5],[.1,.5],[.5,drop?.38:.3],[.7,drop?.34:.3],[.9,.3]];
  ids.forEach((id,i)=>p[id]=[...xy[i],0,q,q]);
 }
 return {timestampMs:t,width:1000,height:1000,landmarks:p};
}
function splitFrame(t,active=false) {
 const p=Array.from({length:33},()=>[null,null,null,null,null]);
 for(const [id,x,y] of [[11,.4,.2],[23,.4,.4],[25,.4,.6],[27,active?.5732:.4,active?.7:.85]])p[id]=[x,y,0,1,1];
 return {timestampMs:t,width:1000,height:1000,landmarks:p};
}
test('real plank warnings reach the set report once per sustained episode, not per frame',()=>{
 const a=new pose.PlankAnalyzer();
 for(let t=0;t<=4000;t+=100)a.pushFrame(plankFrame(t,true));
 const r=a.summary().details.report;
 assert.equal(r.errorCounts.HIP_DROP,1);assert.ok(r.warningSeconds.HIP_DROP>1);
 assert.ok(r.feedbackCodes.includes('HIP_DROP'));assert.ok(r.postureScore<100);
 assert.deepEqual(a.finish()[0].summary.details.report,r);
});
test('real cycle cards do not double count a completed range error while displayed for one second',()=>{
 const a=new pose.SplitSquatAnalyzer({side:'left'});
 for(const [t,active] of [[0,false],[100,true],[200,true],[300,false]])a.pushFrame(splitFrame(t,active));
 for(let t=400;t<=1300;t+=100)a.pushFrame(splitFrame(t));
 const s=a.summary();assert.equal(s.count,1);assert.equal(s.details.repetitions.length,1);
 assert.equal(s.details.report.errorCounts.SPLIT_SQUAT_RANGE,1);
 assert.deepEqual(a.finish()[0].summary,s);
});
test('session dropout is visible in tracking rate while countdown and manual pause do not inflate it',()=>{
 const a=new pose.PlankAnalyzer(),c=new pose.ExerciseSessionController({analyzer:a});
 for(let t=0;t<=1000;t+=100)c.pushFrame(plankFrame(t));
 for(let t=1100;t<=3100;t+=100)c.pushFrame({...plankFrame(t),landmarks:[]});
 const lost=a.summary().details.report;
 assert.equal(lost.tracking.basis,'session_observability_intervals');assert.ok(lost.trackingAvailablePct<50);
 for(let t=3200;t<=3500;t+=100)c.pushFrame(plankFrame(t));
 const before=a.summary().details.report.tracking.totalSeconds;
 for(let t=3600;t<8500;t+=100)c.pushFrame(plankFrame(t));
 assert.equal(a.summary().details.report.tracking.totalSeconds,before);
 c.pushFrame(plankFrame(8500));c.pause();
 const paused=a.summary().details.report.tracking.totalSeconds;
 for(let t=8600;t<10000;t+=100)c.pushFrame(plankFrame(t));
 assert.equal(a.summary().details.report.tracking.totalSeconds,paused);
});
test('report data contains summaries and grading metadata only, never landmark arrays',()=>{
 const a=new pose.PlankAnalyzer();for(let t=0;t<=1000;t+=100)a.pushFrame(plankFrame(t));
 const data=JSON.stringify(a.summary());
 assert.ok(!data.includes('landmarks'));assert.ok(!data.includes('visibility'));assert.ok(!data.includes('presence'));
});

test('workout contract limits and unknown labels fail safely without leaking invalid values',()=>{
 const s=summary(),bad=structuredClone(s);
 bad.details.report.trackingAvailablePct=NaN;
 assert.throws(()=>pose.workoutReportFields(bad),TypeError);
 s.details.report.feedbackCodes=Array.from({length:21},(_,i)=>'CODE'+'_'.repeat(i+1));
 assert.throws(()=>pose.workoutReportFields(s),RangeError);
 for(const key of ['unknown_future_item','toString','__proto__'])assert.equal(pose.itemLabel(key),'자세 평가 항목');
});

test('duplicate completion events cannot erase final feedback and native records retain observed side metadata',()=>{
 const m=new ReportAccumulator();
 m.observe(sample(100,{rep:rep(1,true)}));
 m.events([{type:'rep.completed',rep:1,t:.1}]);
 let d=reportDetails(summary('split_squat',1),m);
 assert.equal(d.report.errorCounts.SPLIT_SQUAT_RANGE,1);
 d=reportDetails(summary('squat',1,{}, {reps:[{rep:1,end_s:.1,depth_state:'warning'}]}),m);
 assert.equal(d.repetitions[0].side,'left');assert.deepEqual(d.sideCounts,{left:1,right:0});
});

test('the cross-language label catalog matches the runtime export',()=>{
 const catalog=JSON.parse(fs.readFileSync(new URL('../../schemas/posture-item-labels.json',import.meta.url)));
 assert.deepEqual(catalog.labels,pose.ITEM_LABELS);
});
test('an unobservable tail is not reported as evidence of no late posture decline',()=>{
 const m=new ReportAccumulator();
 for(let t=0;t<=12000;t+=100)m.observe(sample(t,{items:{hip:'within_reference'}}));
 for(let t=12100;t<=24000;t+=100)m.observe(sample(t,{tracking:'tracking_unavailable'}));
 const r=reportDetails(summary('plank',null,{hip:itemResult('time',12,0,12)}),m).report;
 assert.equal(r.lateFormBreakdown.candidate,null);
 assert.equal(r.lateFormBreakdown.reason,'tracking_unavailable_at_end');
});

test('closed analyzers and session state reads cannot mutate the final report',()=>{
 const a=new pose.PlankAnalyzer(),c=new pose.ExerciseSessionController({analyzer:a});
 for(let t=0;t<=1000;t+=100)c.pushFrame(plankFrame(t));
 for(let t=1100;t<=3100;t+=100)c.pushFrame({...plankFrame(t),landmarks:[]});
 const final=c.finish()[0].summary;
 assert.deepEqual(a.summary(),final);
 c.getState();c.tick(4000);a.breakContinuity('pause');a.pushFrame(plankFrame(5000));
 assert.deepEqual(a.summary(),final);
});
