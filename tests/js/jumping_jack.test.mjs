import test from 'node:test';
import assert from 'node:assert/strict';
import {JumpingJackAnalyzer,PushupAnalyzer} from '../../runtime/index.js';
function frame(t,{arms='normal',peak=2.1,missing=false,legsOnly=false,tilt=0}={}){
 const phase=(t%1000)/1000,w=.4+(peak-.4)*(1-Math.cos(2*Math.PI*phase))/2;
 const h=arms==='opposite'?1-(1-Math.cos(2*Math.PI*phase))/2:(1-Math.cos(2*Math.PI*phase))/2;
 const ang=(legsOnly?10:10+h*165)*Math.PI/180;
 const a=Array.from({length:33},()=>[.5,.2,0,1,1]);
 a[11]=[.4+tilt,.3,0,1,1];a[12]=[.6+tilt,.3,0,1,1];a[23]=[.43,.55,0,1,1];a[24]=[.57,.55,0,1,1];
 a[27]=[.5-w*.1,.9,0,1,1];a[28]=[.5+w*.1,.9,0,1,1];
 a[15]=[a[11][0]-.23*Math.sin(ang),.3+.23*Math.cos(ang),0,missing?0:1,1];
 a[16]=[a[12][0]+.23*Math.sin(ang),.3+.23*Math.cos(ang),0,missing?0:1,1];
 return {timestampMs:t,width:1000,height:1000,landmarks:a};
}
function run(options={},end=3200){const a=new JumpingJackAnalyzer();for(let t=0;t<=end;t+=50)a.pushFrame(frame(t,options));return a;}
test('normal jacks count 3; quality has no warning',()=>{const a=run();assert.equal(a.count,3);for(const v of Object.values(a.summary().items))assert.equal(v.warning,0);});
test('arms omitted still count; low arm feedback does not suppress repetitions',()=>{const a=run({legsOnly:true});assert.equal(a.count,3);assert.equal(a.summary().items.arm_raise.warning,3);});
test('opposite arm/leg timing produces coordination warnings',()=>{const a=run({arms:'opposite'});assert.equal(a.count,3);assert.equal(a.summary().items.coordination.warning,3);});
test('small leg excursions count and get range feedback',()=>{const a=run({peak:.95});assert.equal(a.count,3);assert.equal(a.summary().items.leg_open.warning,3);});
test('missing wrists do not erase leg counts or become false low-arm warnings',()=>{const a=run({missing:true});assert.equal(a.count,3);assert.equal(a.summary().items.arm_raise.unknown,3);});
test('gap never bridges an unfinished repetition',()=>{const a=new JumpingJackAnalyzer();for(let t=0;t<=500;t+=50)a.pushFrame(frame(t));a.pushFrame(frame(1800));a.pushFrame(frame(1900));assert.equal(a.count,0);assert.ok(a.summary().gapSeconds>1);});
test('stationary poses and pause do not create counts',()=>{const a=new JumpingJackAnalyzer();for(let t=0;t<2000;t+=50){const f=frame(0);f.timestampMs=t;a.pushFrame(f);}assert.equal(a.count,0);a.breakContinuity();assert.equal(a.count,0);});
test('v2 envelope, monotonic timestamps, idempotent finish',()=>{const a=run();const f=frame(3300),r=a.pushFrame(f),p=new PushupAnalyzer().pushFrame(f);assert.deepEqual(Object.keys(r).sort(),Object.keys(p).sort());assert.equal(a.pushFrame(f).ignoredReason,'non_monotonic_timestamp');assert.equal(a.finish()[0].type,'set.completed');assert.deepEqual(a.finish(),[]);assert.equal(a.pushFrame(frame(3400)).ignoredReason,'finished');assert.equal(r.measurementBasis.count,'completed_open_close_attempt');});
test('finish-before-input and malformed frame',()=>{const a=new JumpingJackAnalyzer();assert.throws(()=>a.pushFrame({}));const e=a.finish()[0];assert.equal(e.timestampMs,null);assert.equal(e.summary.count,0);});
