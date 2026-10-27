import test from 'node:test';
import assert from 'node:assert/strict';
import {MoveNetPushupAnalyzer,PushupAnalyzer} from '../../runtime/index.js';
import {MOVENET_TO_MEDIAPIPE} from '../../runtime/adapters/movenet.js';
import config from '../../runtime/pushup/config.js';
function packet(t,{moving=false,elbow=.8,wrist=.8,side='left'}={}){
 const y=moving?.3+.23*(1-Math.cos(Math.max(0,Math.min(6,t-1.5))*Math.PI))/2:.3;
 const keypoints=Array.from({length:17},()=>[0,0,0]);
 const ids=side==='left'?[11,13,15,23,27]:[12,14,16,24,28];
 const points=[[y,.25,.8],[.5,.3,elbow],[.7,.3,wrist],[.43,.55,.8],[.46,.85,.8]];
 ids.forEach((id,i)=>keypoints[MOVENET_TO_MEDIAPIPE.indexOf(id)]=points[i]);
 return {timestampMs:Math.round(t*1000),width:640,height:360,keypoints};
}
function run(fn,options){const a=new MoveNetPushupAnalyzer(options),results=[];for(let i=0;i<=160;i++)results.push(a.pushKeypoints(fn(i/20,i)));return {a,results};}
test('MoveNet native gate is .3; MediaPipe default stays .5',()=>{
 const {a,results}=run(t=>packet(t,{elbow:.3,wrist:.3}));assert.equal(a.engine.side,'left');assert.equal(a.summary().count,0);
 assert.equal(results.at(-1).details.diagnostics.poseAdapter.scoreThreshold,.3);
 assert.equal(new PushupAnalyzer().engine.settings.pipeline.cfg.visibility_min,.5);assert.equal(config.pipeline.cfg.visibility_min,.5);
 const low=run(t=>packet(t,{wrist:.299}));assert.equal(low.a.engine.side,null);
});
test('missing elbow permits observed shoulder cycles but never labels missing elbow normal',()=>{
 const {a,results}=run(t=>packet(t,{moving:true,elbow:.1}));assert.equal(a.summary().count,3);
 const ratings=results.flatMap(r=>r.events).filter(e=>e.type==='rep.feedback');assert(ratings.length>=2);
 assert(ratings.every(e=>e.items.elbow==='tracking_unavailable'));
 assert(results.flatMap(r=>r.events).filter(e=>e.type==='rep.completed').every(e=>e.signal==='shoulder'));
});
test('short occlusion retains candidate without inventing coordinates or posture evidence',()=>{
 const a=new MoveNetPushupAnalyzer();for(let i=0;i<40;i++)a.pushKeypoints(packet(i/20));
 a.engine.core.cycles[1].bottom={x:.01,t:1.9};const r=a.pushKeypoints(packet(2,{wrist:.1}));
 assert.equal(r.tracking,'tracking_unavailable');assert.equal(r.items.hip,'tracking_unavailable');assert.deepEqual(r.currentCodes,[]);
 assert.equal(a.engine.core.cycles[1].bottom.t,1.9);assert(Number.isNaN(a.engine.core.rows.at(-1).chest));
 const recovered=a.pushKeypoints(packet(2.05));assert(!recovered.events.some(e=>e.type==='motion.reset'));
});
test('long occlusion resets partial movement; cannot count across side switch',()=>{
 const a=new MoveNetPushupAnalyzer();for(let i=0;i<40;i++)a.pushKeypoints(packet(i/20));
 a.engine.core.cycles[1].bottom={x:.01,t:1.9};let ev=[];
 for(let i=40;i<=70;i++)ev.push(...a.pushKeypoints(packet(i/20,{side:'right'})).events);
 assert.equal(a.engine.side,'right');assert.equal(a.summary().count,0);assert(ev.some(e=>e.type==='side.changed'));
 assert(ev.some(e=>e.type==='motion.reset'));assert(!ev.some(e=>e.type==='rep.completed'));
});
test('stationary input with alternating brief quality dips adds no repetitions',()=>{
 const {a}=run((t,i)=>packet(t,{elbow:.1,wrist:i%13===0?.1:.8}));assert.equal(a.summary().count,0);
});
test('timestamp gaps, explicit pause and finish cannot bridge candidates',()=>{
 const a=new MoveNetPushupAnalyzer();for(let i=0;i<40;i++)a.pushKeypoints(packet(i/20));
 a.engine.core.cycles[1].bottom={x:.01,t:1.9};const r=a.pushKeypoints(packet(3));assert(r.events.some(e=>e.type==='frame.gap'));
 assert.equal(a.engine.core.cycles[1].bottom,null);assert(a.pushKeypoints(packet(2)).ignored);
 a.breakContinuity();assert.equal(a.engine.side,null);a.finish();assert.deepEqual(a.finish(),[]);assert(a.pushKeypoints(packet(4)).ignored);
});
