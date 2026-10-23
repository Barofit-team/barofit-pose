import test from 'node:test';
import assert from 'node:assert/strict';
import {measureTempo,TempoTracker} from '../../runtime/leg_raise/tempo.js';
import {LegRaiseAnalyzer} from '../../runtime/index.js';
function samples(fn,end=7000){return Array.from({length:end/50+1},(_,i)=>({t:i*50,elevation:fn(i*50)}));}
const approx=(a,b,t=300)=>assert.ok(Math.abs(a-b)<=t,`${a} != ${b} +/- ${t}`);
const profile=t=>t<1000?0:t<3000?(t-1000)*.04:t<5000?80:t<7000?80-(t-5000)*.04:0;
function partition(r){approx(r.riseMovingMs+r.lowerMovingMs+r.pauseMs+r.unclassifiedMs,r.intervalMs,1e-6);approx(r.topHoldMs+r.bottomHoldMs+r.midPauseMs,r.pauseMs,1e-6);approx(r.segments.reduce((a,s)=>a+s.durationMs,0),r.intervalMs,1e-6);}
test('rise, upper hold, lowering and bottom rest are partitioned without counting holds as motion',()=>{
 const r=measureTempo(samples(profile,8000));partition(r);approx(r.riseMovingMs,2000);approx(r.lowerMovingMs,2000);approx(r.topHoldMs,2000);approx(r.bottomHoldMs,2000);
});
test('small angular jitter during a hold is not continuous movement',()=>{
 const r=measureTempo(samples(t=>80+.1*Math.sin(t/90),3000));partition(r);assert.ok(r.pauseMs>2600);assert.equal(r.topHoldMs,0); // no excursion: cannot infer a top
});
test('a slow but continuous descent is distinct from stillness',()=>{
 const r=measureTempo(samples(t=>80-t*.01,4000));partition(r);assert.ok(r.lowerMovingMs>3700);assert.equal(r.pauseMs,0);
});
test('short pauses are not awarded as a confirmed hold',()=>{
 const r=measureTempo(samples(t=>t<2000?t*.04:t<2100?80:80-(t-2100)*.04,4000));partition(r);assert.equal(r.topHoldMs,0);
});
test('a middle pause is not credited as upper hold',()=>{
 const r=measureTempo(samples(t=>t<1000?t*.04:t<2000?40:t<3000?40+(t-2000)*.04:t<4000?80:80-(t-4000)*.04,6000));partition(r);approx(r.midPauseMs,1000);approx(r.topHoldMs,1000);
});
test('live tempo is causal, confirms stillness, and clears history at a break',()=>{
 const a=new TempoTracker();for(const p of samples(()=>80,1000))a.push(p);
 assert.equal(a.value.state,'still');assert.ok(a.value.pauseDurationMs>=750);
 a.reset();assert.equal(a.value.pauseDurationMs,0);assert.equal(a.push({t:5000,elevation:20}).state,'warming_up');
});
test('sidecar does not bridge missing joint input or finished input',()=>{
 const a=new LegRaiseAnalyzer();const f=t=>({timestampMs:t,width:1000,height:600,landmarks:[]});
 a.tempoTracker.push({t:0,elevation:60});a.tempoTracker.push({t:200,elevation:60});a.pushFrame(f(250));assert.equal(a.tempoTracker.value.pauseDurationMs,0);
 a.breakContinuity();a.finish();assert.deepEqual(a.pushFrame(f(500)).metrics,{});
});
