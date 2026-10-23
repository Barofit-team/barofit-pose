import test from 'node:test';
import assert from 'node:assert/strict';
import {LegRaiseAnalyzer,PushupAnalyzer} from '../../runtime/index.js';
function frame(t,{angle=5+80*(1-Math.cos(2*Math.PI*t/4000))/2,bend=0,left=1,right=1,standing=false}={}){
 const lm=Array.from({length:33},()=>[null,null,null,null,null]);
 for(const [s,h,k,a,q,dy] of [[11,23,25,27,left,0],[12,24,26,28,right,.015]]){
  const r=angle*Math.PI/180,b=(angle+bend)*Math.PI/180;
  lm[s]=[.2,standing?.2:.7+dy,0,q,q];lm[h]=[.45,.7+dy,0,q,q];
  lm[k]=[.45+.22*Math.cos(r),.7+dy-.22*Math.sin(r),0,q,q];
  lm[a]=[lm[k][0]+.22*Math.cos(b),lm[k][1]-.22*Math.sin(b),0,q,q];
 }
 return {timestampMs:t,width:1000,height:1000,landmarks:lm};
}
function run(options={},end=12300){const a=new LegRaiseAnalyzer();for(let t=0;t<=end;t+=50)a.pushFrame(frame(t,options));return a;}
test('three complete cycles, quality independent, lumbar never compliant',()=>{
 const a=run();assert.equal(a.count,3);assert.equal(a.summary().items.knee_extension.warning,0);
 assert.equal(a.summary().items.lowering_control.warning,0);assert.equal(a.summary().items.lumbar_contact.unknown,3);
 assert.equal(a.summary().items.lumbar_contact.compliancePct,null);
});
test('bent knees are feedback only, single visible side is sufficient',()=>{
 const a=run({bend:50,right:0});assert.equal(a.count,3);assert.equal(a.summary().items.knee_extension.warning,3);assert.equal(a.side,'left');
});
test('initial top clip does not invent first partial repetition',()=>{
 const a=new LegRaiseAnalyzer();for(let t=0;t<=6000;t+=50)a.pushFrame(frame(t,{angle:5+80*(1+Math.cos(2*Math.PI*t/4000))/2}));assert.equal(a.count,1);
});
test('stationary, standing and tiny motion are not repetitions',()=>{
 assert.equal(run({angle:45}).count,0);assert.equal(run({standing:true}).count,0);
 const a=new LegRaiseAnalyzer();for(let t=0;t<5000;t+=50)a.pushFrame(frame(t,{angle:15+5*Math.sin(t/100)}));assert.equal(a.count,0);
});
test('standing up and tracking gap break a pending repetition',()=>{
 for(const kind of ['standing','gap','missing','pause']){
  const a=new LegRaiseAnalyzer();for(let t=0;t<=2000;t+=50)a.pushFrame(frame(t));
  if(kind==='pause')a.breakContinuity();
  else if(kind==='standing')a.pushFrame(frame(2050,{standing:true}));
  else if(kind==='missing')a.pushFrame({...frame(2050),landmarks:[]});
  for(let t=2400;t<=4000;t+=50)a.pushFrame(frame(t));assert.equal(a.count,0,kind);
 }
});
test('side switch resets movement instead of splicing limbs',()=>{
 const a=new LegRaiseAnalyzer();for(let t=0;t<=2000;t+=50)a.pushFrame(frame(t,{right:0}));
 for(let t=2050;t<4000;t+=50)a.pushFrame(frame(t,{left:0}));assert.equal(a.side,'right');assert.equal(a.count,0);
});
test('fast descent warns while slow descent does not',()=>{
 const a=new LegRaiseAnalyzer();for(let t=0;t<4000;t+=40){const angle=t<400?5:t<2400?5+80*(t-400)/2000:t<2800?85-80*(t-2400)/400:5;a.pushFrame(frame(t,{angle}));}
 assert.equal(a.count,1);assert.equal(a.summary().items.lowering_control.warning,1);
});
test('v2 envelope, unsupported item, duplicate timestamp and terminal lifecycle',()=>{
 const a=run(),f=frame(12400),r=a.pushFrame(f);
 assert.deepEqual(Object.keys(r).sort(),Object.keys(new PushupAnalyzer().pushFrame(f)).sort());
 assert.equal(r.items.lumbar_contact,'not_supported');assert.equal(r.measurementBasis.count,'completed_raise_lower_attempt');
 assert.equal(a.pushFrame(f).ignoredReason,'non_monotonic_timestamp');assert.equal(a.finish()[0].schemaVersion,'2.0');assert.deepEqual(a.finish(),[]);
 assert.equal(a.pushFrame(frame(12500)).ignoredReason,'finished');assert.equal(new LegRaiseAnalyzer().finish()[0].timestampMs,null);
});
