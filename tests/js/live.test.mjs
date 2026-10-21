import test from 'node:test';
import assert from 'node:assert/strict';
import {LivePushupEngine, PushupAnalyzer, inspectSide, FeedbackVoice} from '../../runtime/index.js';
import {readFileSync} from 'node:fs';

function packet(t, {left=.9, right=.85, upright=false}={}) {
  const p=Array.from({length:33},()=>[0,0,0,0,0]);
  for(const [ids,confidence] of [[[11,13,15,23,27],left],[[12,14,16,24,28],right]]) {
    const points=upright?[[.4,.1],[.4,.3],[.4,.5],[.4,.55],[.4,.9]]:
      [[.3,.3],[.31,.5],[.32,.7],[.55,.38],[.85,.45]];
    ids.forEach((id,i)=>p[id]=[...points[i],0,confidence,confidence]);
  }
  return {timestampMs:t*1000,width:640,height:360,landmarks:p};
}
function frames(engine,start,end,options) {
  let result;
  for(let i=Math.round(start*10);i<=Math.round(end*10);i++) result=engine.pushFrame(packet(i/10,options));
  return result;
}
test('standing then visible support posture: acquire only the visible side',()=>{
  const e=new LivePushupEngine(); frames(e,0,3,{upright:true});
  assert.equal(e.side,null);assert.equal(e.count,0);
  frames(e,3.1,4.5,{left:.9,right:0});assert.equal(e.side,'left');assert.equal(e.count,0);
});
test('sustained occlusion switches sides without completing a fake movement',()=>{
  const e=new LivePushupEngine();frames(e,0,1.5,{left:.8,right:.95});assert.equal(e.side,'right');
  e.core.count=3;e.core.cycles[0].bottom={x:10,t:1.4};
  const events=[];
  for(let i=16;i<32;i++) events.push(...e.pushFrame(packet(i/10,{left:.9,right:0})).events);
  assert.equal(e.side,'left');assert.equal(e.count,3);assert.equal(e.core.cycles[0].bottom,null);
  assert.equal(events.filter(e=>e.type==='side.changed').length,1);
  assert.equal(events.filter(e=>e.type==='rep.completed').length,0);
});
test('brief loss and a better opposite confidence do not flip the selected side',()=>{
  const e=new LivePushupEngine();frames(e,0,1.5,{left:.95,right:.8});
  frames(e,1.6,1.8,{left:0,right:.95});frames(e,1.9,3,{left:.8,right:.99});assert.equal(e.side,'left');
});
test('missing required joint blocks tracking; mirror preserves qualification',()=>{
  const e=new LivePushupEngine();frames(e,0,1.5);const p=packet(1.6);p.landmarks[27][3]=.1;
  const r=e.pushFrame(p);assert.equal(r.tracking,'tracking_unavailable');assert.deepEqual(r.codes,[]);
  const mirrored=packet(2);for(const q of mirrored.landmarks) q[0]=1-q[0];
  assert.equal(inspectSide(mirrored,'left').ready,true);
});
test('common adapter preserves raw engine results and handles empty landmarks',()=>{
  const wrapper=new PushupAnalyzer(),raw=new LivePushupEngine();
  for(let i=0;i<60;i++) {
    const p=packet(i/10,{left:i<30?.9:0,right:.8});
    const a=wrapper.pushFrame(p),b=raw.pushFrame(p);
    assert.equal(a.count,b.count);assert.equal(a.side,b.side);
    assert.deepEqual(a.events,JSON.parse(JSON.stringify(b.events)));
    assert.equal(a.schemaVersion,'2.0');assert.equal(a.holdSeconds,null);
  }
  assert.equal(wrapper.pushFrame({...packet(6),landmarks:[]}).tracking,'tracking_unavailable');
  assert.equal(wrapper.pushFrame(packet(1)).ignored,true);
  wrapper.finish();assert.deepEqual(wrapper.finish(),[]);
});
test('shared synthetic fixture is accepted; no motion is counted for standing',()=>{
  const e=new PushupAnalyzer();
  const lines=readFileSync(new URL('../fixtures/standing.jsonl',import.meta.url),'utf8').trim().split('\n');
  for(const line of lines) assert.equal(e.pushFrame(JSON.parse(line)).count,0);
  assert.throws(()=>e.pushFrame({...packet(9),width:0}),TypeError);
});
test('speech cooldown prevents repeated display toggles from replaying the same warning',async()=>{
  let t=0,n=0;const voice=new FeedbackVoice({now:()=>t});
  const speak=async()=>{n++;return true;};
  const result={tracking:'tracking',codes:['HIP_DROP']};
  assert.equal(await voice.update(result,true,speak,{HIP_DROP:'drop'}),'HIP_DROP');
  t=7000;assert.equal(await voice.update(result,true,speak,{HIP_DROP:'drop'}),null);
  t=11000;assert.equal(await voice.update(result,true,speak,{HIP_DROP:'drop'}),'HIP_DROP');
  assert.equal(n,2);
});
