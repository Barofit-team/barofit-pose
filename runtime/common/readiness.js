import {validateFrame} from './frame.js';
const joints={shoulder:11,elbow:13,wrist:15,hip:23,knee:25,ankle:27,heel:29,foot_index:31};
const lower=['shoulder','hip','knee','ankle'];
const full=['shoulder','elbow','wrist','hip','knee','ankle'];
const side=names=>({mode:'either',joints:names});
const both=names=>({mode:'both',joints:names});
export const READINESS_PROFILES=Object.freeze(Object.fromEntries(Object.entries({
  pushup:side(full),plank:side(full),squat:side(lower),bird_dog:both(full),
  jumping_jack:both(full),leg_raise:side(lower),glute_bridge:side(lower),
  superman:side(full),pike_pushup:side(full),mountain_climber:side(full),
  lunge:side(lower),split_squat:side(lower),bulgarian_split_squat:side(lower),
  incline_pushup:side(full),side_lying_leg_raise:side(lower),dead_bug:both(full),
  standing_calf_raise:side([...lower,'heel','foot_index'])
}).map(([k,v])=>[k,Object.freeze({...v,joints:Object.freeze([...v.joints])})])));

/** Camera observability only. Never starts an exercise or gates its analyzer. */
export class CameraReadiness {
  constructor({exercise,side=null,minVisibility=.5,minPresence=.5,stableMs=1000,lostMs=500,maxGapMs=400}={}) {
    if(!READINESS_PROFILES[exercise])throw new RangeError('Unsupported exercise');
    if(![null,'left','right'].includes(side))throw new RangeError('Invalid side');
    if(READINESS_PROFILES[exercise].mode==='both'&&side!==null)throw new RangeError('Exercise requires both sides');
    if(![minVisibility,minPresence].every(v=>Number.isFinite(v)&&v>=0&&v<=1)||
       ![stableMs,lostMs,maxGapMs].every(v=>Number.isFinite(v)&&v>0))throw new RangeError('Invalid thresholds');
    Object.assign(this,{exercise,fixedSide:side,minVisibility,minPresence,stableMs,lostMs,maxGapMs});
    this.lastTime=null;this.reset();
  }
  reset(){this.ready=false;this.selectedSide=null;this.candidate=null;this.since=null;this.lostSince=null;this.dimensions=null;}
  breakContinuity(){this.reset();}
  inspect(frame,side){
    const names=READINESS_PROFILES[this.exercise].joints;
    const entries=names.map(name=>{
      const id=joints[name]+(side==='right'?1:0),p=frame.landmarks[id];
      let reason=null;
      if(!p||![p[0],p[1],p[3],p[4]].every(Number.isFinite))reason='MISSING_LANDMARK';
      else if(p[0]<0||p[0]>1||p[1]<0||p[1]>1)reason='BODY_OUT_OF_FRAME';
      else if(p[3]<this.minVisibility)reason='LOW_VISIBILITY';
      else if(p[4]<this.minPresence)reason='LOW_PRESENCE';
      return {name:side+'_'+name,reason};
    });
    return {side,entries,ok:entries.every(x=>!x.reason),good:entries.filter(x=>!x.reason).length};
  }
  pushFrame(frame){
    validateFrame(frame);
    const t=frame.timestampMs;
    if(this.lastTime!==null&&t<=this.lastTime)return {...this.latest,ignored:true,ignoredReason:'non_monotonic_timestamp'};
    const dimensions=frame.width+'x'+frame.height;
    if(this.lastTime!==null&&(t-this.lastTime>this.maxGapMs||this.dimensions&&this.dimensions!==dimensions))this.reset();
    this.dimensions=dimensions;this.lastTime=t;
    const left=this.inspect(frame,'left'),right=this.inspect(frame,'right');
    const mode=READINESS_PROFILES[this.exercise].mode;
    const options=this.fixedSide?[this.fixedSide==='left'?left:right]:[left,right];
    let pick=mode==='both'?{side:'both',ok:left.ok&&right.ok,entries:[...left.entries,...right.entries]}:
      options.find(x=>x.side===this.selectedSide)||options.find(x=>x.ok)||options.sort((a,b)=>b.good-a.good)[0];
    if(this.ready&&!pick.ok){
      this.lostSince??=t;
      if(t-this.lostSince>=this.lostMs){this.ready=false;this.selectedSide=null;this.candidate=null;this.since=null;
        if(mode!=='both')pick=options.find(x=>x.ok)||pick;}
    }else if(pick.ok)this.lostSince=null;
    if(!this.ready){
      if(pick.ok){if(this.candidate!==pick.side){this.candidate=pick.side;this.since=t;}
        if(t-this.since>=this.stableMs){this.ready=true;this.selectedSide=pick.side;this.lostSince=null;}}
      else {this.candidate=null;this.since=null;}
    }
    const bad=pick.entries.filter(x=>x.reason);
    const missing=bad.filter(x=>x.reason!=='BODY_OUT_OF_FRAME').map(x=>x.name);
    const outside=bad.filter(x=>x.reason==='BODY_OUT_OF_FRAME').map(x=>x.name);
    const status=this.ready?'ready':frame.landmarks.length===0?'no_person':pick.ok?'stabilizing':'adjust_camera';
    const reasonCode=pick.ok?(this.ready?null:'STABILIZING'):frame.landmarks.length===0?'NO_PERSON':outside.length?'BODY_OUT_OF_FRAME':bad[0]?.reason??null;
    const message=pick.ok?(this.ready?'촬영 준비가 완료됐어요.':'관절이 안정적으로 보이는지 확인하고 있어요.'):
      reasonCode==='NO_PERSON'?'카메라에 전신이 나오도록 위치해주세요.':outside.length?'필요한 관절이 화면 안에 들어오도록 카메라를 조정해주세요.':'가려진 관절이 보이도록 위치를 조정해주세요.';
    return this.latest={schemaVersion:'1.0',type:'camera.readiness',exercise:this.exercise,timestampMs:t,
      ignored:false,ignoredReason:null,status,ready:this.ready,observable:pick.ok,
      selectedSide:this.selectedSide,candidateSide:this.candidate,missingLandmarks:missing,
      outOfFrameLandmarks:outside,reasonCode,message,stableForMs:pick.ok&&this.since!==null?t-this.since:0};
  }
}

