import test from 'node:test';
import assert from 'node:assert/strict';
import {GluteBridgeAnalyzer,PushupAnalyzer} from '../../runtime/index.js';
function frame(t,{extension=120+60*(1-Math.cos(2*Math.PI*t/4000))/2,feet=80,left=1,right=1,standing=false,mirror=false}={}){
 const lm=Array.from({length:33},()=>[null,null,null,null,null]);
 const s=[200,700],k=[700,400],sk=Math.hypot(500,300),offset=(sk/2)*Math.tan((180-extension)*Math.PI/360);
 const h=[450+300/sk*offset,550+500/sk*offset],a=[700+feet,700];
 for(const [ids,q] of [[[11,23,25,27],left],[[12,24,26,28],right]]){
  for(let j=0;j<4;j++){let [x,y]=[s,h,k,a][j];if(standing&&j===0)y=100;lm[ids[j]]=[(mirror?1000-x:x)/1000,y/1000,0,q,q];}
 }
 return {timestampMs:t,width:1000,height:1000,landmarks:lm};
}
function run(opt={},end=12400){const a=new GluteBridgeAnalyzer();for(let t=0;t<=end;t+=50)a.pushFrame(frame(t,opt));return a;}
test('three full cycles; normal feedback; mirror and one visible side',()=>{
 for(const opt of [{},{mirror:true},{right:0}]){const a=run(opt);assert.equal(a.count,3);assert.equal(a.summary().items.hip_extension.warning,0);assert.equal(a.summary().items.foot_position.warning,0);assert.equal(a.summary().items.lumbar_neutral.compliancePct,null);}
});
test('foot offset and reduced range affect feedback, not counts',()=>{
 const a=run({feet:200});assert.equal(a.count,3);assert.equal(a.summary().items.foot_position.warning,3);
 const b=new GluteBridgeAnalyzer();for(let t=0;t<=12400;t+=50)b.pushFrame(frame(t,{extension:110+35*(1-Math.cos(2*Math.PI*t/4000))/2}));assert.equal(b.count,3);assert.equal(b.summary().items.hip_extension.warning,3);
});
test('distant foot setup can warn without a completed repetition; summary remains unassessed',()=>{
 const a=new GluteBridgeAnalyzer();let r;
 for(let t=0;t<2000;t+=50)r=a.pushFrame(frame(t,{extension:120,feet:250}));
 assert.equal(a.count,0);assert.ok(r.currentCodes.includes('FOOT_POSITION_OFFSET'));
 assert.equal(a.summary().items.foot_position.compliancePct,null);
});
test('stationary, standing, tiny shifts and initial top do not fabricate repetitions',()=>{
 assert.equal(run({extension:175}).count,0);assert.equal(run({standing:true}).count,0);
 const a=new GluteBridgeAnalyzer();for(let t=0;t<5000;t+=50)a.pushFrame(frame(t,{extension:120+5*Math.sin(t/100)}));assert.equal(a.count,0);
 const b=new GluteBridgeAnalyzer();for(let t=0;t<4000;t+=50)b.pushFrame(frame(t,{extension:180-60*t/4000}));assert.equal(b.count,0);
});
test('tracking loss, side switch, pause and standing break pending motion',()=>{
 for(const kind of ['missing','gap','side','pause','standing']){
  const a=new GluteBridgeAnalyzer();for(let t=0;t<=2000;t+=50)a.pushFrame(frame(t,{right:0}));
  if(kind==='missing')a.pushFrame({...frame(2050),landmarks:[]});
  if(kind==='standing')a.pushFrame(frame(2050,{standing:true}));
  if(kind==='pause')a.breakContinuity();
  for(let t=kind==='gap'?2500:2100;t<=4000;t+=50)a.pushFrame(frame(t,kind==='side'?{left:0}:{right:0}));
  assert.equal(a.count,0,kind);
 }
});
test('fast lowering warns and per-rep tempo partitions counted interval',()=>{
 const a=new GluteBridgeAnalyzer();for(let t=0;t<4000;t+=40){const extension=t<400?120:t<2400?120+60*(t-400)/2000:t<2720?180-60*(t-2400)/320:120;a.pushFrame(frame(t,{extension}));}
 assert.equal(a.count,1);assert.equal(a.summary().items.lowering_control.warning,1);
 const p=a.repetitions[0].metrics.tempo;assert.equal(p.riseMovingMs+p.lowerMovingMs+p.pauseMs+p.unclassifiedMs,p.intervalMs);
});
test('common envelope, duplicate/terminal lifecycle, unsupported aggregation',()=>{
 const a=run(),f=frame(12500),r=a.pushFrame(f);assert.deepEqual(Object.keys(r).sort(),Object.keys(new PushupAnalyzer().pushFrame(f)).sort());
 assert.equal(r.measurementBasis.count,'completed_bridge_raise_lower_attempt');assert.equal(a.pushFrame(f).ignoredReason,'non_monotonic_timestamp');
 assert.equal(a.summary().items.lumbar_neutral.unknown,3);assert.equal(a.finish()[0].type,'set.completed');assert.deepEqual(a.finish(),[]);
 assert.equal(a.pushFrame(frame(12600)).ignoredReason,'finished');assert.equal(new GluteBridgeAnalyzer().finish()[0].timestampMs,null);
});
test('close foot with nearly vertical top shin is detected from bottom evidence; mirrored too',()=>{
 for(const mirror of [false,true]){
  const a=run({feet:0,mirror});assert.equal(a.count,3);
  assert.equal(a.summary().items.foot_position.warning,3);
  for(const r of a.repetitions){assert.equal(r.metrics.footPositionReason,'close_setup');assert.ok(r.metrics.topShinTiltDeg<25);}
 }
});
test('close setup must persist; missing frames clear its history',()=>{
 const a=new GluteBridgeAnalyzer();let r;
 for(let t=0;t<1000;t+=50)r=a.pushFrame(frame(t,{extension:120,feet:0}));
 assert.ok(r.currentCodes.includes('FOOT_POSITION_OFFSET'));
 a.pushFrame({...frame(1000),landmarks:[]});
 for(let t=1050;t<13450;t+=50)a.pushFrame({...frame(t-1050,{feet:80}),timestampMs:t});
 assert.equal(a.summary().items.foot_position.warning,0);
});
import {liftEvidence} from '../../runtime/glute_bridge/analyzer.js';
test('hip evidence distinguishes low projected height from normal projected angular flexion',()=>{
 const top=(o,h)=>[0,50,100,150].map(t=>({t,hipOffsetRatio:o,hipHeightRatio:h}));
 assert.equal(liftEvidence(top(.10,.29),158).warning,true);
 assert.equal(liftEvidence(top(.10,.37),158).warning,false);
 assert.equal(liftEvidence(top(.13,.55),151).warning,false);
 assert.equal(liftEvidence(top(.02,.29),175).warning,false);
 assert.equal(liftEvidence(top(.10,.29).slice(0,1),158).warning,false);
 assert.equal(liftEvidence(top(.15,.29),145).reason,'low_extension');
});
import {loweringEvidence} from '../../runtime/glute_bridge/lowering.js';
import {GLUTE_BRIDGE_CONFIG} from '../../runtime/glute_bridge/analyzer.js';
test('rapid segment survives a slow total descent; smooth descent does not warn',()=>{
 const p=[];for(let t=0;t<=1800;t+=50){const e=t<=700?180-t*.01:t<=1000?173-(t-700)*.13:134-(t-1000)*.015;p.push({t,elevation:e});}
 const r=loweringEvidence(p,0,GLUTE_BRIDGE_CONFIG);assert.equal(r.reason,'rapid_segment');assert.ok(r.peakWindow.speedDegS>105);
 const normal=p.map(x=>({t:x.t,elevation:180-x.t*.035}));assert.equal(loweringEvidence(normal,0,GLUTE_BRIDGE_CONFIG).warning,false);
});
test('single-coordinate jump and rebound do not create a burst warning',()=>{
 const p=Array.from({length:25},(_,i)=>({t:i*50,elevation:i<10?180:145}));
 assert.equal(loweringEvidence(p,0,GLUTE_BRIDGE_CONFIG).warning,false);
 const rebound=Array.from({length:25},(_,i)=>({t:i*50,elevation:i===10?140:180}));
 assert.equal(loweringEvidence(rebound,0,GLUTE_BRIDGE_CONFIG).warning,false);
});
