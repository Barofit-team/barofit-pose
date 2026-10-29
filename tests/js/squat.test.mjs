import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {SquatRule,metrics,SQUAT_SOURCE_COMMIT,IDS} from '../../runtime/squat/engine.js';
import {SquatAnalyzer} from '../../runtime/squat/analyzer.js';

const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/squat-python-parity.json',import.meta.url),'utf8'));
function close(actual,expected,path='value',epsilon=1e-9){
  if(typeof expected==='number'){
    assert.equal(typeof actual,'number',path);
    assert(Math.abs(actual-expected)<epsilon,`${path}: ${actual} != ${expected}`);
  }else if(Array.isArray(expected)){
    assert(Array.isArray(actual),path);assert.equal(actual.length,expected.length,path);
    expected.forEach((v,i)=>close(actual[i],v,`${path}[${i}]`,epsilon));
  }else if(expected&&typeof expected==='object'){
    assert.deepEqual(Object.keys(actual).sort(),Object.keys(expected).sort(),path);
    for(const [key,value] of Object.entries(expected))close(actual[key],value,`${path}.${key}`,epsilon);
  }else assert.equal(actual,expected,path);
}
test('pure rule matches 319 Python reference frames and rep events',()=>{
  assert.equal(fixture.source_commit,SQUAT_SOURCE_COMMIT);
  for(const c of fixture.cases){
    const e=new SquatRule();
    c.frames.forEach((f,i)=>close(e.step(...f.input),f.output,`${c.name}[${i}]`));
    close(e.reps,c.reps,c.name+'.reps');
  }
});
test('screen-plane geometry matches Python with aspect ratios and missing points',()=>{
  // arccos is ill-conditioned near 180 degrees; allow sub-0.00001 degree rounding.
  for(const c of fixture.geometry)close(metrics(c.pose,c.dims,c.side),c.output,c.name,1e-5);
  const e=new SquatRule();e.step(0,170,10);
  assert.throws(()=>e.step(0,170,10),/increase/);
  assert.throws(()=>e.step(-1,170,10),/nonnegative/);
});
function frame(t,{left=170,right=170,leftQuality=.9,rightQuality=.8,missing=null}={}){
  const p=Array.from({length:33},()=>[0,0,0,0,0]);
  for(const [side,knee,quality] of [['left',left,leftQuality],['right',right,rightQuality]]){
    if(knee===null)continue;
    const a=knee*Math.PI/180;
    const points=[[.5,.15],[.55,.25],[.6,.35],[.5,.35],[.5,.6],[.5+.22*Math.sin(a),.6-.22*Math.cos(a)]];
    IDS[side].forEach((id,i)=>p[id]=[...points[i],0,quality,quality]);
  }
  if(missing!==null)p[missing]=[null,null,null,null,null];
  return {timestampMs:t*1000,width:1000,height:1000,landmarks:p};
}
function feed(e,seq,start=0,opts={}){
  let t=start,r;
  for(const knee of seq){r=e.pushFrame(frame(t,{left:knee,right:knee,...opts}));t+=.05;}
  return {t,r};
}
const repeat=(value,n=10)=>Array(n).fill(value);
test('fixed side counts completed attempts, shallow is feedback and does not reject count',()=>{
  const e=new SquatAnalyzer({side:'left'});
  const {r}=feed(e,[...repeat(170),...repeat(120),...repeat(170)]);
  assert.equal(r.count,1);
  assert.equal(e.summary().items.depth.warning,1);
  assert.equal(e.summary().items.depth.compliancePct,0);
});
test('automatic side requires standing preparation, locks despite transient quality changes',()=>{
  const e=new SquatAnalyzer();
  let {t,r}=feed(e,repeat(90,20));
  assert.equal(r.side,null);assert.equal(r.count,0);assert.equal(r.tracking,'selecting_side');
  ({t,r}=feed(e,repeat(170,16),t));
  assert.equal(r.side,'left');
  ({t,r}=feed(e,repeat(90,12),t,{leftQuality:.6,rightQuality:.99}));
  assert.equal(r.side,'left');
  ({r}=feed(e,repeat(170,12),t));
  assert.equal(r.count,1);
});
test('missing knee or shoulder interrupts the partial rep and preserves existing count',()=>{
  for(const missing of [25,11]){
    const e=new SquatAnalyzer({side:'left'});
    let {t}=feed(e,[...repeat(170),...repeat(90),...repeat(170),...repeat(90)]);
    const unavailable=e.pushFrame(frame(t,{missing}));t+=.05;
    assert.equal(unavailable.tracking,'tracking_unavailable');
    assert.deepEqual(unavailable.codes,[]);
    let {t:next,r}=feed(e,repeat(170),t);t=next;
    assert.equal(r.count,1);
    ({r}=feed(e,[...repeat(90),...repeat(170)],t));
    assert.equal(r.count,2);
  }
});
test('manual side switch and automatic reselection never join partial cycles',()=>{
  const fixed=new SquatAnalyzer({side:'left'});
  let {t}=feed(fixed,[...repeat(170),...repeat(90)]);
  fixed.setSide('right');
  let {r}=feed(fixed,repeat(170),t);
  assert.equal(r.count,0);assert.equal(r.side,'right');
  const auto=new SquatAnalyzer();
  ({t}=feed(auto,[...repeat(170,20),...repeat(90)]));
  ({t,r}=feed(auto,repeat(170,16),t,{left:null,right:170}));
  assert.equal(r.side,'right');assert.equal(r.count,0);
  ({r}=feed(auto,[...repeat(90),...repeat(170)],t,{left:null}));
  assert.equal(r.count,1);
});
test('gaps, pause, duplicate frames and finish preserve counts and valid time accounting',()=>{
  const e=new SquatAnalyzer({side:'left'});
  let {t}=feed(e,[...repeat(170),...repeat(90)]);
  let {r}=feed(e,repeat(170),t+1);
  assert.equal(r.count,0);assert(e.summary().gapSeconds>=1);
  const before=e.summary().observedSeconds;
  e.breakContinuity('pause');
  r=e.pushFrame(frame(20));
  assert.equal(e.summary().observedSeconds,before);
  assert.equal(e.pushFrame(frame(19)).ignored,true);
  assert.equal(e.pushFrame(frame(20)).ignored,true);
  assert.equal(r.count,0);
  const summary=e.summary();
  const {compliant:compliant_s,warning:warning_s,unknown:unknown_s}=summary.items.trunk;
  assert(Math.abs(compliant_s+warning_s+unknown_s-summary.observedSeconds)<1e-9);
  assert.equal(e.finish().length,1);assert.deepEqual(e.finish(),[]);
  assert.equal(e.pushFrame(frame(21)).ignored,true);
});
test('all missing landmarks are unavailable, not a normal posture',()=>{
  const e=new SquatAnalyzer();
  const r=e.pushFrame({...frame(0),landmarks:[]});
  assert.equal(r.tracking,'tracking_unavailable');assert.equal(r.count,0);
  assert.equal(r.items.trunk,'tracking_unavailable');assert.equal(r.lastRepetition,null);
  assert.equal(e.summary().items.depth.compliancePct,null);
  assert.throws(()=>new SquatAnalyzer({side:'front'}),/side/);
});

// Compare serialization against the unchanged raw adapter on identical causal input.
test('v2 preserves all squat counts, events, metrics and mixed-basis totals',()=>{
 const a=new SquatAnalyzer({side:'left'}),b=new SquatAnalyzer({side:'left'});
 const output=[];let t=0;
 for(const knee of [...repeat(170),...repeat(120),...repeat(170),...repeat(90),...repeat(170)]){
  const f=frame(t),angle=frame(t,{left:knee,right:knee});t+=.05;
  const r=a.pushFrame(angle),old=b._pushFrameLegacy(angle);output.push(r);
  assert.equal(r.count,old.count);assert.equal(r.phase,old.state);
  assert.deepEqual(r.codes,old.codes);assert.deepEqual(r.events,old.events);assert.deepEqual(r.metrics,old.metrics);
  assert.deepEqual(a.summary(),b.summary());
  assert.deepEqual(r.items,{trunk:old.items.trunk});
  const rep=old.events.find(e=>e.type==='rep.completed');
  assert.equal(r.lastRepetition?.items.depth??null,rep?.depth_state??null);
  assert(!r.currentCodes.includes('SQUAT_SHALLOW'));
 }
 const s=a.summary();assert.equal(s.count,2);assert.equal(s.items.depth.compliancePct,50);
 assert.equal(s.items.depth.aggregationBasis,'repetition');assert.equal(s.items.trunk.aggregationBasis,'time');
 assert.equal(s.details.reps.length,2);
 const end=a.finish().at(-1);assert.equal(end.timestampMs,a.lastTime*1000);assert.deepEqual(end.summary,s);
 assert.equal(a.pushFrame(frame(20)).ignoredReason,'finished');
});
