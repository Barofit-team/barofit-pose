import test from 'node:test';import assert from 'node:assert/strict';
import {PikePushupAnalyzer,PushupAnalyzer}from'../../runtime/index.js';
import {pikeMetrics}from'../../runtime/pike_pushup/metrics.js';
function frame(t,{progress=(1-Math.cos(2*Math.PI*t/4000))/2,mirror=false,roll=0,left=1,right=1,noHead=false,badHead=false,exit=false}={}){
 const top=[[350,350],[275,500],[200,650],[500,200],[650,420],[800,650],[300,430]],bottom=[[180,500],[250,580],[200,650],[500,250],[650,450],[800,650],[100,600]];
 const pts=top.map((a,i)=>a.map((v,j)=>v+(bottom[i][j]-v)*progress));
 // A moving head above/between the hands, rather than a frozen point while
 // the body moves. A frozen head alone cannot establish a measured trajectory.
 if(badHead)pts[6]=[320,430+170*progress];if(exit){pts[0]=[500,150];pts[1]=[500,300];pts[2]=[500,450];pts[3]=[500,400];}
 const lm=Array.from({length:33},()=>[null,null,null,null,null]);
 const transform=([x,y])=>{const r=roll*Math.PI/180,dx=x-500,dy=y-500;let xx=500+dx*Math.cos(r)-dy*Math.sin(r),yy=500+dx*Math.sin(r)+dy*Math.cos(r);return [(mirror?1000-xx:xx)/1000,yy/1000,0];};
 for(const [ids,q]of [[[11,13,15,23,25,27],left],[[12,14,16,24,26,28],right]])for(let j=0;j<6;j++)lm[ids[j]]=[...transform(pts[j]),q,q];
 lm[0]=[...transform(pts[6]),noHead?0:1,noHead?0:1];return {timestampMs:t,width:1000,height:1000,landmarks:lm};
}
function run(opt={},end=12500){const a=new PikePushupAnalyzer();for(let t=0;t<=end;t+=50)a.pushFrame(frame(t,opt));return a;}
test('three full attempts, mirrored and one-side input',()=>{for(const opt of [{},{mirror:true},{right:0},{roll:10}])assert.equal(run(opt).count,3);});
test('bad head path keeps counts; missing head is unknown not compliant',()=>{const a=run({badHead:true}),b=run({noHead:true});assert.equal(a.count,3);assert.equal(a.summary().items.head_path.warning,3);assert.equal(b.count,3);assert.equal(b.summary().items.head_path.compliancePct,null);assert.equal(b.summary().items.head_path.unknown,3);});
test('standing, static, small motion and bottom-only partial cycle do not count',()=>{assert.equal(run({exit:true}).count,0);assert.equal(run({progress:0}).count,0);assert.equal(run({progress:.02}).count,0);const a=new PikePushupAnalyzer();for(let t=2000;t<=4000;t+=50)a.pushFrame(frame(t));assert.equal(a.count,0);});
test('missing joints, gap, side change and explicit pause sever incomplete attempt',()=>{for(const kind of ['loss','gap','side','pause']){const a=new PikePushupAnalyzer();for(let t=0;t<=2000;t+=50)a.pushFrame(frame(t,{right:0}));if(kind==='loss')a.pushFrame({...frame(2050),landmarks:[]});if(kind==='pause')a.breakContinuity();for(let t=kind==='gap'?2500:2100;t<=4000;t+=50)a.pushFrame(frame(t,kind==='side'?{left:0}:{right:0}));assert.equal(a.count,0,kind);}});
test('end transition does not become a rep and later complete attempt resumes',()=>{const a=run({},4200);assert.equal(a.count,1);for(let t=4250;t<=6000;t+=50)a.pushFrame(frame(t,{exit:true}));assert.equal(a.count,1);for(let t=6000;t<=10200;t+=50)a.pushFrame({...frame(t-6000),timestampMs:t});assert.equal(a.count,2);});
test('v2 common keys, compliance denominator, monotonic input and idempotent finish',()=>{const a=run(),f=frame(13000),r=a.pushFrame(f);assert.deepEqual(Object.keys(r).sort(),Object.keys(new PushupAnalyzer().pushFrame(f)).sort());assert.equal(r.measurementBasis.count,'completed_pike_lower_raise_attempt');for(const x of Object.values(a.summary().items)){assert.equal(x.compliant+x.warning+x.unknown,a.count);assert.equal(x.aggregationBasis,'repetition');}assert.equal(a.pushFrame(f).ignoredReason,'non_monotonic_timestamp');assert.equal(a.finish()[0].type,'set.completed');assert.deepEqual(a.finish(),[]);assert.equal(a.pushFrame(frame(14000)).ignoredReason,'finished');assert.equal(new PikePushupAnalyzer().finish()[0].timestampMs,null);});
test('angles respect image aspect and camera roll',()=>{const f=frame(1000),a=pikeMetrics(f,'left'),b=pikeMetrics(frame(1000,{roll:10}),'left');for(const k of ['elbowDeg','hipDeg','overheadDeg','headForward'])assert.ok(Math.abs(a[k]-b[k])<1e-6,k);const scaled={...f,width:500,landmarks:f.landmarks.map(p=>p?.[0]===null?p:[p[0]*2,...p.slice(1)])};assert.equal(pikeMetrics(scaled,'left'),null,'out of frame is not fabricated');});
test('head translation alone does not replace trajectory; fixed head is unknown',()=>{
 for(const fixed of [false,true]){const a=new PikePushupAnalyzer();for(let t=0;t<=12500;t+=50){const f=frame(t);if(fixed)f.landmarks[0]=[.32,.6,0,1,1];else f.landmarks[0][0]+=.2;a.pushFrame(f);}a.finish();assert.equal(a.count,3);assert.equal(a.summary().items.head_path.warning,0);if(fixed)assert.equal(a.summary().items.head_path.unknown,3);}
});
test('count emits immediately, feedback settles once without a second count',()=>{
 const a=new PikePushupAnalyzer();let countEvents=0,feedbackEvents=0,lastCountTime=null,firstFeedbackTime=null;
 for(let t=0;t<=4500;t+=50){const r=a.pushFrame(frame(t));for(const e of r.events){if(e.type==='rep.completed'){countEvents++;lastCountTime=t;assert.equal(r.lastRepetition.metrics.pathAssessmentComplete,false);}if(e.type==='rep.feedback'){feedbackEvents++;firstFeedbackTime??=t;}}}
 assert.equal(countEvents,1);assert.equal(feedbackEvents,1);assert.ok(firstFeedbackTime>lastCountTime);assert.equal(a.count,1);a.finish();assert.equal(a.summary().items.pike_shape.evaluated,1);
});
test('tracking break during settlement leaves unavailable recovery unknown',()=>{
 const a=new PikePushupAnalyzer();let t=0;for(;t<4500;t+=50){a.pushFrame(frame(t));if(a.count)break;}
 a.breakContinuity();const s=a.summary();assert.equal(s.count,1);assert.equal(s.items.pike_shape.unknown,1);assert.equal(s.items.press_return.unknown,1);a.finish();assert.equal(a.summary().count,1);
});
