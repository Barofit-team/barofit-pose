import {withoutReport} from './report_helpers.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as pose from '../../runtime/index.js';

const classes={jump_squat:pose.JumpSquatAnalyzer,reverse_crunch:pose.ReverseCrunchAnalyzer,
  flutter_kicks:pose.FlutterKicksAnalyzer,burpee:pose.BurpeeAnalyzer,situp:pose.SitupAnalyzer};
function frame(id,stage,t,side='left') {
  const landmarks=Array.from({length:33},()=>[null,null,null,null,null]);
  const put=(id,x,y,o=side==='right'?1:0)=>{landmarks[id+o]=[x,y,0,1,1];};
  let s=[.45,.2],h=[.45,.4],k=[.45,.6],a=[.45,.85],w=[.4,.5];
  if(id==='jump_squat') {
    if(stage==='active'){h=[.45,.5];k=[.65,.65];}
    if(stage==='air'){s[1]-=.1;h[1]-=.1;k[1]-=.1;a[1]-=.1;}
  } else if(id==='burpee') {
    if(stage==='active'){s=[.2,.75];h=[.45,.75];k=[.65,.75];a=[.85,.75];w=[.2,.9];}
    if(stage==='crouch'){s=[.45,.65];h=[.45,.75];k=[.65,.75];}
  } else {
    s=[.2,.65];h=[.5,.65];k=[.75,.65];a=[.85,.65];
    if(id==='reverse_crunch' && stage==='active')k=[.55,.45];
    if(id==='situp'){k=[.62,.48];a=[.78,.65];if(stage==='active')s=[.36,.4];}
    if(id==='flutter_kicks') {
      const leftUp=stage!=='active';
      for(const o of [0,1]) {
        put(11,...s,o);put(23,...h,o);put(25,.65,.6,o);
        put(27,.85,(o===0)===leftUp?.35:.65,o);
      }
      return {timestampMs:t,width:1000,height:1000,landmarks};
    }
  }
  for(const [id,p] of [[11,s],[23,h],[25,k],[27,a],[15,w],[13,[.4,.4]]])put(id,...p);
  return {timestampMs:t,width:1000,height:1000,landmarks};
}
function stages(id) {return id==='jump_squat'?['rest','active','air','rest']:['rest','active','rest'];}
function run(a,id,steps=stages(id),start=0,side='left') {
  let t=start,r;
  for(const stage of steps)for(let n=0;n<4;n++,t+=100)r=a.pushFrame(frame(id,stage,t,side));
  return {t,r};
}
for(const [id,C] of Object.entries(classes)) {
  test(id+' completes two cycles, rest is not repetition, feedback stays unknown',()=>{
    for(const side of id==='flutter_kicks'?['left']:['left','right']) {
      const a=new C(id==='flutter_kicks'?{}:{side});
      let {t,r}=run(a,id,stages(id),0,side);
      assert.equal(r.count,1);assert.equal(r.lastRepetition.number,1);
      assert.equal(r.measurementBasis.count.includes('candidate'),true);
      const eventSummary=a.summary();assert.equal(eventSummary.items.form.unknown,1);
      assert.equal(eventSummary.items.form.compliancePct,null);
      ({t,r}=run(a,id,['rest','rest','rest'],t,side));assert.equal(r.count,1);
      ({t,r}=run(a,id,stages(id),t,side));assert.equal(r.count,2);
      assert.deepEqual(r.items,{form:'unknown'});assert.deepEqual(r.currentCodes,[]);
      assert.deepEqual(JSON.parse(JSON.stringify(r)),r);
      const snapshot=a.summary();
      snapshot.details.repetitions[0].number=999;
      assert.equal(a.summary().details.repetitions[0].number,1);
    }
  });
  test(id+' pause/loss/gap/resize discard unfinished cycle and permit a new complete cycle',()=>{
    for(const kind of ['pause','loss','gap','resize']) {
      const a=new C(),partial=stages(id).slice(0,-1);
      let {t}=run(a,id,partial);
      const before=a.summary();
      if(kind==='pause'){a.breakContinuity('pause');t+=5000;}
      if(kind==='gap')t+=5000;
      if(kind==='loss'){a.pushFrame({...frame(id,'rest',t),landmarks:[]});t+=100;}
      if(kind==='resize'){a.pushFrame({...frame(id,'rest',t),width:1200});t+=100;}
      let result=run(a,id,['rest'],t);t=result.t;
      assert.equal(a.summary().count,0,kind);
      if(kind==='pause') {
        assert.equal(a.summary().gapSeconds,before.gapSeconds);
        assert.ok(a.summary().observedSeconds-before.observedSeconds<=.301);
      }
      if(kind==='gap')assert.ok(a.summary().gapSeconds>=5);
      result=run(a,id,stages(id),t);
      assert.equal(result.r.count,1,kind);
      const total=a.summary().count;
      a.breakContinuity();assert.equal(a.summary().count,total);
    }
  });
  test(id+' ignored timestamps, empty finish, finish idempotency and input validation',()=>{
    const a=new C();run(a,id);
    const before=a.summary();
    for(const t of [0,100,1100]) {
      const r=a.pushFrame(frame(id,'active',t));
      assert.equal(r.ignoredReason,'non_monotonic_timestamp');
      assert.deepEqual(r.events,[]);assert.deepEqual(r.items,{});assert.equal(r.lastRepetition,null);
      assert.deepEqual(a.summary(),before);
    }
    const end=a.finish();assert.equal(end[0].summary.count,1);assert.equal(end[0].type,'set.completed');
    assert.deepEqual(a.finish(),[]);assert.deepEqual(a.breakContinuity(),[]);
    assert.equal(a.pushFrame(frame(id,'rest',9000)).ignoredReason,'finished');
    assert.deepEqual(a.summary(),before);
    const b=new C();assert.equal(b.finish()[0].timestampMs,null);
    assert.throws(()=>new C({side:'bad'}),RangeError);
    assert.throws(()=>new C().pushFrame({...frame(id,'rest',0),width:0}),TypeError);
  });
  test(id+' stationary, one-frame spike, poor confidence and missing limbs never complete a cycle',()=>{
    const a=new C();let {t}=run(a,id,['rest','rest']);
    a.pushFrame(frame(id,'active',t));t+=30;
    run(a,id,['rest'],t);assert.equal(a.summary().count,0);
    for(const type of ['visibility','presence','nonfinite','outside']) {
      const b=new C();let r;
      for(let i=0;i<25;i++){
        const f=frame(id,stages(id)[Math.floor(i/4)%stages(id).length],i*100);
        for(const p of f.landmarks) {
          if(type==='visibility')p[3]=.1;
          if(type==='presence')p[4]=.1;
          if(type==='nonfinite')p[0]=NaN;
          if(type==='outside')p[0]=1.5;
        }
        r=b.pushFrame(f);
      }
      assert.equal(r.tracking,'tracking_unavailable');assert.equal(r.count,0);
      assert.equal(b.summary().observedSeconds,0);
    }
  });
}
test('single-side exercises do not stitch across anatomical side changes',()=>{
  for(const [id,C] of Object.entries(classes).filter(([id])=>id!=='flutter_kicks')) {
    const a=new C();const {t}=run(a,id,stages(id).slice(0,-1),0,'left');
    run(a,id,['rest'],t,'right');assert.equal(a.summary().count,0,id);
  }
});
test('flutter requires both legs, two swaps and rejects rapid alternations',()=>{
  assert.throws(()=>new pose.FlutterKicksAnalyzer({side:'left'}),RangeError);
  const a=new pose.FlutterKicksAnalyzer();
  for(let t=0;t<1000;t+=100) {
    const f=frame('flutter_kicks',t%200?'active':'rest',t);
    f.landmarks[28]=[null,null,null,null,null];a.pushFrame(f);
  }
  assert.equal(a.summary().count,0);
  const b=new pose.FlutterKicksAnalyzer();run(b,'flutter_kicks',['rest','active']);
  assert.equal(b.summary().count,0);
});
test('jump squat cannot count squat without airborne candidate; burpee rejects crouch-only movement',()=>{
  for(const [id,C,steps] of [
    ['jump_squat',pose.JumpSquatAnalyzer,['rest','active','rest']],
    ['burpee',pose.BurpeeAnalyzer,['rest','crouch','rest']]]) {
    const a=new C();run(a,id,steps);assert.equal(a.summary().count,0);
  }
});
test('new profiles and schemas include all five exercises and the public result keys remain identical',()=>{
  const keys=Object.keys(new pose.PlankAnalyzer().pushFrame(frame('situp','rest',0))).sort();
  const schema=JSON.parse(fs.readFileSync(new URL('../../schemas/frame-result-v2.schema.json',import.meta.url)));
  for(const [id,C] of Object.entries(classes)) {
    const a=new C(),r=a.pushFrame(frame(id,'rest',0));
    assert.deepEqual(Object.keys(r).sort(),keys);
    assert.ok(schema.properties.exercise.enum.includes(id));
    assert.equal(schema.oneOf.filter(x=>x.properties.exercise.const===id).length,1);
    const g=new pose.CameraReadiness({exercise:id});assert.equal(g.exercise,id);
  }
});
test('timeouts abandon a long-held partial repetition and require a fresh starting posture',()=>{
  for(const [id,C] of Object.entries(classes)) {
    const a=new C();
    let {t}=run(a,id,stages(id).slice(0,-1));
    const stage=id==='jump_squat'?'air':'active';
    for(let i=0;i<110;i++,t+=100)a.pushFrame(frame(id,stage,t));
    run(a,id,['rest'],t);assert.equal(a.summary().count,0,id);
  }
});
test('completed counts and time totals survive a long pause with no countdown frames delivered',()=>{
  for(const [id,C] of Object.entries(classes)) {
    const a=new C();let {t}=run(a,id);
    a.breakContinuity('auto_pause');
    const before=a.summary();
    a.pushFrame(frame(id,'rest',t+5000));
    assert.deepEqual(withoutReport(a.summary()),withoutReport(before),id);
    const result=run(a,id,stages(id),t+5100);
    assert.equal(result.r.count,2,id);
  }
});
test('a working-side loss at the counting boundary never produces a bridged repetition',()=>{
  for(const [id,C] of Object.entries(classes)) {
    const a=new C();let {t}=run(a,id,stages(id).slice(0,-1));
    const f=frame(id,'rest',t);f.landmarks[27]=[null,null,null,null,null];
    a.pushFrame(f);
    const result=run(a,id,['rest'],t+100);
    assert.equal(result.r.count,0,id);
  }
});
test('jump squat bilateral auto measures minimum knee flexion and resets when the input sides change',()=>{
  const a=new pose.JumpSquatAnalyzer();
  const bilateral=(stage,t)=>{
    const f=frame('jump_squat',stage,t),right=frame('jump_squat','rest',t,'right');
    for(const i of [12,14,16,24,26,28])f.landmarks[i]=right.landmarks[i];
    return f;
  };
  for(let t=0;t<400;t+=100)a.pushFrame(bilateral('rest',t));
  for(let t=400;t<800;t+=100)a.pushFrame(bilateral('active',t));
  const r=a.pushFrame(frame('jump_squat','air',800));
  assert.equal(r.events[0].reason,'measurement_side_changed');
  run(a,'jump_squat',['rest'],900);
  assert.equal(a.summary().count,0);
});
