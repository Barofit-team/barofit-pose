import test from 'node:test';
import assert from 'node:assert/strict';
import {CameraReadiness,READINESS_PROFILES} from '../../runtime/index.js';
const frame=(t,hide=[])=>({timestampMs:t,width:640,height:480,landmarks:Array.from({length:33},(_,i)=>[.2+i*.01,.5,0,hide.includes(i)?0:.99,.99])});
const acquire=g=>{for(let t=0;t<=1000;t+=100)g.pushFrame(frame(t));};
test('all supported profiles acquire without changing posture analyzers',()=>{for(const exercise of Object.keys(READINESS_PROFILES)){const g=new CameraReadiness({exercise});acquire(g);assert.equal(g.latest.ready,true,exercise);}});
test('either-side profile accepts hidden opposite side',()=>{const g=new CameraReadiness({exercise:'pushup'});let r;for(let t=0;t<=1000;t+=100)r=g.pushFrame(frame(t,[12,14,16,24,26,28]));assert.equal(r.selectedSide,'left');assert.equal(r.ready,true);});
test('bilateral profile requires both sides',()=>{const g=new CameraReadiness({exercise:'jumping_jack'});const r=g.pushFrame(frame(0,[28]));assert.equal(r.ready,false);assert.deepEqual(r.missingLandmarks,['right_ankle']);});
test('loss grace then reacquire opposite side with fresh dwell',()=>{const g=new CameraReadiness({exercise:'pushup'});acquire(g);const hidden=[11,13,15,23,25,27];let r=g.pushFrame(frame(1100,hidden));assert.equal(r.ready,true);assert.equal(r.observable,false);for(let t=1200;t<=1600;t+=100)r=g.pushFrame(frame(t,hidden));assert.equal(r.ready,false);assert.equal(r.candidateSide,'right');for(let t=1700;t<=2600;t+=100)r=g.pushFrame(frame(t,hidden));assert.equal(r.selectedSide,'right');});
test('empty detections, missing values and outside are distinct',()=>{const g=new CameraReadiness({exercise:'plank',side:'left'});assert.equal(g.pushFrame({...frame(0),landmarks:[]}).status,'no_person');const f=frame(100);f.landmarks[27][0]=1.2;let r=g.pushFrame(f);assert.deepEqual(r.outOfFrameLandmarks,['left_ankle']);assert.deepEqual(r.missingLandmarks,[]);f.timestampMs=200;f.landmarks[27][0]=null;r=g.pushFrame(f);assert.deepEqual(r.missingLandmarks,['left_ankle']);});
test('gap, pause and dimension changes reset stability',()=>{const g=new CameraReadiness({exercise:'plank'});acquire(g);assert.equal(g.pushFrame(frame(2000)).ready,false);g.breakContinuity();assert.equal(g.pushFrame(frame(2100)).stableForMs,0);assert.equal(g.pushFrame({...frame(2200),width:1280}).stableForMs,0);});
test('duplicate and reversed timestamps cannot advance stability',()=>{const g=new CameraReadiness({exercise:'plank'});g.pushFrame(frame(100));assert.equal(g.pushFrame(frame(100)).ignored,true);assert.equal(g.pushFrame(frame(0)).ignored,true);assert.equal(g.lastTime,100);});
test('visibility confidence is not person detection accuracy; invalid configs rejected',()=>{assert.throws(()=>new CameraReadiness({exercise:'unknown'}));assert.throws(()=>new CameraReadiness({exercise:'plank',stableMs:NaN}));assert.throws(()=>new CameraReadiness({exercise:'dead_bug',side:'left'}));const g=new CameraReadiness({exercise:'plank',side:'left'});const f=frame(0);f.landmarks[11][4]=0;assert.equal(g.pushFrame(f).reasonCode,'LOW_PRESENCE');});
test('opt-in visible-side reselection uses a fresh stability dwell without the legacy loss grace',()=>{
 const g=new CameraReadiness({exercise:'plank',switchToVisibleSide:true});
 acquire(g);
 const hidden=[11,13,15,23,25,27];
 let r=g.pushFrame(frame(1100,hidden));
 assert.equal(r.observable,true);assert.equal(r.ready,false);assert.equal(r.candidateSide,'right');
 for(let t=1200;t<=2100;t+=100)r=g.pushFrame(frame(t,hidden));
 assert.equal(r.ready,true);assert.equal(r.selectedSide,'right');
});
test('side plank readiness needs both shoulders and one complete support-side chain',()=>{
 const g=new CameraReadiness({exercise:'side_plank'});
 let r=g.pushFrame(frame(0,[11,13,15,23,25,27]));
 assert.equal(r.observable,false);
 r=g.pushFrame(frame(100,[13,15,23,25,27]));
 assert.equal(r.observable,true);assert.equal(r.candidateSide,'right');
});

// Evaluation metadata: evaluatedSide/checkedLandmarks expose the same pick that produced missing/outOfFrame.
// Existing fields are asserted alongside so the metadata cannot hide a behaviour change.
const SP_LEFT=['left_shoulder','left_elbow','left_wrist','left_hip','left_knee','left_ankle','right_shoulder'];
const rightBodyHidden=[14,16,24,26,28];
const legacy=r=>({status:r.status,ready:r.ready,observable:r.observable,selectedSide:r.selectedSide,candidateSide:r.candidateSide,
  missingLandmarks:r.missingLandmarks,outOfFrameLandmarks:r.outOfFrameLandmarks,reasonCode:r.reasonCode});
test('side plank before any side is chosen reports the evaluated left side and its opposite-shoulder check',()=>{
 const g=new CameraReadiness({exercise:'side_plank'});
 const r=g.pushFrame(frame(0,[12,...rightBodyHidden]));
 assert.deepEqual(legacy(r),{status:'adjust_camera',ready:false,observable:false,selectedSide:null,candidateSide:null,
   missingLandmarks:['right_shoulder'],outOfFrameLandmarks:[],reasonCode:'LOW_VISIBILITY'});
 assert.equal(r.evaluatedSide,'left');
 assert.deepEqual(r.checkedLandmarks,SP_LEFT);
});
test('side plank metadata while stabilizing, after ready and across opposite-shoulder loss',()=>{
 const g=new CameraReadiness({exercise:'side_plank'});
 let r=g.pushFrame(frame(100,rightBodyHidden));
 assert.deepEqual(legacy(r),{status:'stabilizing',ready:false,observable:true,selectedSide:null,candidateSide:'left',
   missingLandmarks:[],outOfFrameLandmarks:[],reasonCode:'STABILIZING'});
 assert.equal(r.evaluatedSide,'left');assert.deepEqual(r.checkedLandmarks,SP_LEFT);
 for(let t=200;t<=1100;t+=100)r=g.pushFrame(frame(t,rightBodyHidden));
 assert.deepEqual(legacy(r),{status:'ready',ready:true,observable:true,selectedSide:'left',candidateSide:'left',
   missingLandmarks:[],outOfFrameLandmarks:[],reasonCode:null});
 assert.equal(r.evaluatedSide,'left');assert.deepEqual(r.checkedLandmarks,SP_LEFT);
 // Opposite shoulder lost: grace period keeps ready/selectedSide, then releases them; the evaluated chain stays left
 r=g.pushFrame(frame(1200,[12,...rightBodyHidden]));
 assert.deepEqual(legacy(r),{status:'ready',ready:true,observable:false,selectedSide:'left',candidateSide:'left',
   missingLandmarks:['right_shoulder'],outOfFrameLandmarks:[],reasonCode:'LOW_VISIBILITY'});
 assert.equal(r.evaluatedSide,'left');assert.deepEqual(r.checkedLandmarks,SP_LEFT);
 for(let t=1300;t<=1700;t+=100)r=g.pushFrame(frame(t,[12,...rightBodyHidden]));
 assert.deepEqual(legacy(r),{status:'adjust_camera',ready:false,observable:false,selectedSide:null,candidateSide:null,
   missingLandmarks:['right_shoulder'],outOfFrameLandmarks:[],reasonCode:'LOW_VISIBILITY'});
 assert.equal(r.evaluatedSide,'left');assert.deepEqual(r.checkedLandmarks,SP_LEFT);
});
test('other profiles report only their declared joints; bilateral reports both; ignored frames repeat the last evaluation',()=>{
 const pushup=new CameraReadiness({exercise:'pushup'}).pushFrame(frame(0,[12,14,16,24,26,28]));
 assert.equal(pushup.evaluatedSide,'left');
 assert.deepEqual(pushup.checkedLandmarks,['left_shoulder','left_elbow','left_wrist','left_hip','left_knee','left_ankle']);
 const squat=new CameraReadiness({exercise:'squat',side:'right'}).pushFrame(frame(0));
 assert.equal(squat.evaluatedSide,'right');assert.deepEqual(squat.checkedLandmarks,['right_shoulder','right_hip','right_knee','right_ankle']);
 const g=new CameraReadiness({exercise:'jumping_jack'});
 const jack=g.pushFrame(frame(100,[28]));
 assert.equal(jack.evaluatedSide,'both');assert.equal(jack.checkedLandmarks.length,12);
 assert.deepEqual(jack.missingLandmarks,['right_ankle']);
 const again=g.pushFrame(frame(100));
 assert.equal(again.ignored,true);assert.equal(again.evaluatedSide,'both');assert.deepEqual(again.checkedLandmarks,jack.checkedLandmarks);
 // No detection is still evaluated: every checked landmark is reported missing, as before
 const empty=new CameraReadiness({exercise:'side_plank'}).pushFrame({...frame(0),landmarks:[]});
 assert.equal(empty.status,'no_person');assert.equal(empty.evaluatedSide,'left');
 assert.deepEqual(empty.checkedLandmarks,SP_LEFT);assert.deepEqual(empty.missingLandmarks,SP_LEFT);
});
