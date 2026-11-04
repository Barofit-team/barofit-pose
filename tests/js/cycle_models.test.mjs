import test from 'node:test';
import assert from 'node:assert/strict';
import * as pose from '../../runtime/index.js';

const exercises={
  lunge:pose.LungeAnalyzer, split_squat:pose.SplitSquatAnalyzer,
  bulgarian_split_squat:pose.BulgarianSplitSquatAnalyzer, side_lying_leg_raise:pose.SideLegRaiseAnalyzer,
  dead_bug:pose.DeadBugAnalyzer, incline_pushup:pose.InclinePushupAnalyzer, standing_calf_raise:pose.StandingCalfRaiseAnalyzer,
};

function frame(id,t,active,side='left') {
  const points=Array.from({length:33},()=>[null,null,null,null,null]);
  const offset=side==='left'?0:1;
  const put=(i,x,y)=>{points[i+offset]=[x,y,0,1,1];};
  put(11,.4,.2); put(23,.4,.4); put(25,.4,.6); put(27,active?.62:.4,active?.6:.85);
  if(id==='standing_calf_raise'){put(29,.4,active?.80:.89);put(31,.46,.90);}
  if(id==='incline_pushup'){put(11,.3,.3);put(13,.3,.5);put(15,active?.5:.3,active?.5:.70);put(23,.6,.5);}
  if(id==='side_lying_leg_raise'){put(11,.2,.55);put(23,.5,.55);put(25,.66,active?.40:.55);put(27,.82,active?.25:.55);}
  if(id==='dead_bug'){put(11,.2,.55);put(23,.5,.55);put(25,active?.7:.5,active?.50:.32);}
  return {timestampMs:t,width:800,height:800,landmarks:points};
}
for(const [id,C] of Object.entries(exercises)) {
  test(id+' counts a complete cycle on either side and preserves v2 lifecycle',()=>{
    for(const side of ['left','right']) {
      const a=new C({side});
      for(const [t,active] of [[0,false],[100,true],[200,true],[300,false]]) {
        const r=a.pushFrame(frame(id,t,active,side));
        assert.equal(r.exercise,id);assert.equal(r.type,'frame.result');
        if(t===300){assert.equal(r.count,1);assert.equal(r.lastRepetition.number,1);}
      }
      assert.equal(a.pushFrame(frame(id,299,true,side)).ignoredReason,'non_monotonic_timestamp');
      const end=a.finish();assert.equal(end[0].summary.count,1);assert.equal(end[0].type,'set.completed');
      assert.deepEqual(a.finish(),[]);assert.equal(a.pushFrame(frame(id,400,false,side)).ignoredReason,'finished');
    }
  });
  test(id+' discards partial cycles across missing frames, pause and gaps',()=>{
    for(const interruption of ['pause','loss','gap']) {
      const a=new C({side:'left'});a.pushFrame(frame(id,0,false));a.pushFrame(frame(id,100,true));
      if(interruption==='pause')a.breakContinuity('pause');
      if(interruption==='loss')a.pushFrame({...frame(id,200,true),landmarks:[]});
      a.pushFrame(frame(id,interruption==='loss'?300:5100,false));
      assert.equal(a.summary().count,0);
      assert.equal(a.summary().gapSeconds,interruption==='gap'?5:0);
    }
  });
}
test('pause never accrues a tracking gap or observed time across all public exercises',()=>{
  for(const [name,C] of Object.entries(pose).filter(([name])=>name.endsWith('Analyzer')&&!name.startsWith('MoveNet'))) {
    const a=new C();
    a.pushFrame(frame('lunge',100,false));a.breakContinuity('pause');
    const before=a.summary();
    assert.equal(a.pushFrame(frame('lunge',99,true)).ignoredReason,'non_monotonic_timestamp',name);
    const r=a.pushFrame(frame('lunge',5100,false));
    assert.equal(r.events.some(e=>e.type==='frame.gap'),false,name);
    assert.equal(a.summary().gapSeconds,before.gapSeconds,name);
    assert.equal(a.summary().observedSeconds,before.observedSeconds,name);
  }
});

test('dead bug counts an observed leg cycle with missing arm as unknown',()=>{
  const a=new pose.DeadBugAnalyzer({side:'left'});
  for(const [t,active] of [[0,false],[100,true],[300,false]]) a.pushFrame(frame('dead_bug',t,active));
  const summary=a.summary();
  assert.equal(summary.count,1);
  assert.equal(summary.items.opposite_arm.unknown,1);
  assert.equal(summary.items.opposite_arm.compliancePct,null);
});
test('incline pushup warns for a bent body without dropping the completed repetition',()=>{
  const a=new pose.InclinePushupAnalyzer({side:'left'});
  for(const [t,active] of [[0,false],[100,true],[300,false]]) {
    const f=frame('incline_pushup',t,active);
    f.landmarks[27]=[.65,.15,0,1,1];
    const r=a.pushFrame(f);
    if(active)assert.ok(r.currentCodes.includes('INCLINE_PUSHUP_BODY_LINE'));
  }
  assert.equal(a.summary().items.body_line.warning,1);
  assert.equal(a.summary().count,1);
});
