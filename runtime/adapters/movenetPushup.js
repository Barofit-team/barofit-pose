/** Optional MoveNet-specific live adapter. Uses the shared activity gate.
 * Uses raw MoveNet scores with threshold .3. Missing elbow does not suppress the
 * existing independent shoulder cycle. Unobserved coordinates are never filled.
 */
import {PushupAnalyzer} from '../pushup/analyzer.js';
import {LivePushupEngine,inspectSide,SIDE_POLICY} from '../pushup/liveEngine.js';
import config from '../pushup/config.js';
import {moveNetLandmarks} from './movenet.js';

export const MOVENET_PUSHUP_VERSION='movenet-pushup-adapter-0.1';
const SIDES=['left','right'];
const qualitySettings=()=>{const s=JSON.parse(JSON.stringify(config));s.pipeline.cfg.visibility_min=.3;s.pipeline.cfg.presence_min=.3;return s;};
function inspect(frame,side,settings){
 const d=inspectSide(frame,side,settings),f=d.features;
 // Elbow quality is needed to rate elbow, not to observe shoulder movement.
 const reasons=Object.entries(d.joints).filter(([k,j])=>k!=='elbow'&&!j.ok).map(([k,j])=>`${k}:${j.reason}`);
 if(!reasons.length){
  if(!(f.body>SIDE_POLICY.min_body))reasons.push('body_too_small');
  if(!(f.horizontal>=SIDE_POLICY.min_horizontal))reasons.push('body_not_horizontal');
  if(!(f.chest/f.body>SIDE_POLICY.min_chest_body))reasons.push('support_pose_not_visible');
 }
 return {...d,ready:reasons.length===0,reasons,elbowAvailable:d.joints.elbow.ok,
  quality:Object.entries(d.joints).filter(([k])=>k!=='elbow').reduce((s,[,j])=>s+Math.min(j.visibility??0,j.presence??0),0)/4};
}
export class MoveNetLivePushupEngine extends LivePushupEngine {
 constructor({shortGapMs=180,elbowIndependent=true}={}){
  const settings=qualitySettings();super(settings);
  if(!Number.isFinite(shortGapMs)||shortGapMs<0||shortGapMs>200)throw new RangeError('shortGapMs must be 0..200');
  // At 15 Hz one absent sample gives a 133 ms observed-to-observed gap.
  // 180 ms tolerates that gap, but not two absent samples (200 ms).
  // This is an engineering grace period, not an anatomical threshold.
  this.shortGapMs=shortGapMs;this.elbowIndependent=elbowIndependent;this.lastGood=null;this.shortLoss=false;this.resetDone=false;
 }
 breakContinuity(reason='pause'){
  this.lastGood=null;this.shortLoss=false;this.resetDone=false;
  return super.breakContinuity(reason);
 }
 missingRow(t){
  // Preserve missing observations in rating coverage. No coordinate imputation,
  // no motion update, and no elapsed missing interval is treated as good posture.
  this.core.hipState(NaN,t);
  this.core.rows.push({t,elbow:NaN,hip:NaN,chest:NaN,hand:NaN,body:NaN,horizontal:NaN,quality:0,hipStatus:'tracking_unavailable',valid:false});
  this.core.rows=this.core.rows.filter(r=>t-r.t<=this.settings.motion.max_s+this.settings.motion.feedback_wait_s+2);
 }
 pushFrame(packet){
  const t=packet.timestampMs/1000;
  if(this.closed||!Number.isFinite(t)||this.lastTime!==null&&t<=this.lastTime)return {ignored:true,events:[],count:this.count};
  const dt=this.lastTime===null?null:t-this.lastTime;this.lastTime=t;const events=[];
  if(dt!==null&&dt>this.settings.motion.gap_s){events.push(...this.breakContinuity('frame_gap'));events.push({type:'frame.gap',t,gap_s:dt});}
  const check=this.elbowIndependent?inspect:inspectSide;
  const diagnostics=Object.fromEntries(SIDES.map(s=>[s,check(packet,s,this.settings)]));
  for(const s of SIDES){if(!diagnostics[s].ready)this.goodSince[s]=null;else this.goodSince[s]??=t;}
  const stable=s=>this.goodSince[s]!==null&&t-this.goodSince[s]>=SIDE_POLICY.acquire_s;
  if(!this.side){
   const options=SIDES.filter(stable).sort((a,b)=>diagnostics[b].quality-diagnostics[a].quality);
   if(!options.length)return {events,count:this.count,side:null,tracking:Object.values(diagnostics).some(d=>d.ready)?'selecting_side':'tracking_unavailable',codes:[],diagnostics};
   this.side=options[0];this.core.side=this.side;events.push({type:'side.selected',t,side:this.side,reason:'movenet_stable_motion_joints'});
  }
  const inactive=this.activityResult(packet,events,diagnostics);if(inactive)return inactive;
  if(!diagnostics[this.side].ready){
   this.lostSince??=t;
   if(!this.shortLoss){events.push({type:'tracking.blocked',t,side:this.side,reasons:diagnostics[this.side].reasons});this.shortLoss=true;}
   if(this.lastGood===null||(t-this.lastGood)*1000>this.shortGapMs+1e-6){
    if(!this.resetDone){events.push(...this.core.breakContinuity());events.push({type:'motion.reset',t,reason:'movenet_missing_motion_joints'});this.resetDone=true;}
   }else this.missingRow(t);
   const other=this.side==='left'?'right':'left';
   if(t-this.lostSince>=SIDE_POLICY.lost_s&&stable(other)){
    const from=this.side;events.push(...this.core.breakContinuity());this.side=other;this.core.side=other;this.resetDone=false;this.shortLoss=false;this.lostSince=null;this.lastGood=null;
    events.push({type:'side.changed',t,from,to:other,reason:'movenet_other_stable'});
   }else return {events,count:this.count,side:this.side,tracking:'tracking_unavailable',codes:[],items:null,hipStatus:'tracking_unavailable',diagnostics};
  }else{
   if(this.shortLoss){
    if(!this.resetDone&&this.lastGood!==null&&(t-this.lastGood)*1000>this.shortGapMs+1e-6){events.push(...this.core.breakContinuity());events.push({type:'motion.reset',t,reason:'movenet_gap_exceeded_on_recovery'});}
    events.push({type:'tracking.recovered',t,side:this.side});
   }
   this.lostSince=null;this.shortLoss=false;this.resetDone=false;
  }
  const result=this.core.pushFrame(packet);this.lastGood=t;
  return {...result,side:this.side,events:[...events,...result.events],diagnostics,
   usedFeatures:this.core.rows.length?{...this.core.rows.at(-1)}:null};
 }
}
export class MoveNetPushupAnalyzer extends PushupAnalyzer {
 constructor(options={}){super(qualitySettings());this.engine=new MoveNetLivePushupEngine(options);}
 pushKeypoints({keypoints,...frame}){
  const result=this.pushFrame({...frame,landmarks:moveNetLandmarks(keypoints)});
  // Preserve the closed v2 envelope. Extra provenance is diagnostic metadata.
  if(!result.ignored){
   result.details.diagnostics??={};
   result.details.diagnostics.poseAdapter={name:MOVENET_PUSHUP_VERSION,scoreThreshold:.3,shortGapMs:this.engine.shortGapMs,elbowIndependent:this.engine.elbowIndependent};
  }
  return result;
 }
}
