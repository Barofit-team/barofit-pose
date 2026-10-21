import config from './config.js';
import {PushupEngine,features} from './engine.js';

export const JOINT_IDS={left:{shoulder:11,elbow:13,wrist:15,hip:23,ankle:27},right:{shoulder:12,elbow:14,wrist:16,hip:24,ankle:28}};
export const SIDE_POLICY={acquire_s:1.0,lost_s:1.0,max_gap_s:0.4,min_horizontal:0.5,min_body:0.15,min_chest_body:0.02};
const LABEL={shoulder:'어깨',elbow:'팔꿈치',wrist:'손목',hip:'골반',ankle:'발목'};
export const sideLabel=s=>s==='left'?'왼쪽':s==='right'?'오른쪽':'선택 대기';

export function inspectSide(packet,side,settings=config){
  const {landmarks:p,width,height}=packet,v=settings.pipeline.cfg;
  const joints={},reasons=[];
  for(const [name,id] of Object.entries(JOINT_IDS[side])){
    const q=p?.[id];let reason=null;
    if(!q||q.length<5||!q.slice(0,5).every(Number.isFinite))reason='missing';
    else if(q[0]<0||q[0]>1||q[1]<0||q[1]>1)reason='outside_image';
    else if(q[3]<v.visibility_min)reason='low_visibility';
    else if(q[4]<v.presence_min)reason='low_presence';
    joints[name]={id,visibility:q?.[3]??null,presence:q?.[4]??null,ok:!reason,reason};
    if(reason)reasons.push(`${name}:${reason}`);
  }
  const f=features(p,width,height,side,settings);
  const allPoints=Object.values(joints).every(j=>j.ok);
  if(allPoints){
    if(!(f.body>SIDE_POLICY.min_body))reasons.push('body_too_small');
    if(!(f.horizontal>=SIDE_POLICY.min_horizontal))reasons.push('body_not_horizontal');
    if(!(f.chest/f.body>SIDE_POLICY.min_chest_body))reasons.push('support_pose_not_visible');
    if(!Number.isFinite(f.elbow))reasons.push('elbow_geometry_invalid');
  }
  const quality=Object.values(joints).reduce((a,j)=>a+Math.min(j.visibility??0,j.presence??0),0)/5;
  return {ready:reasons.length===0,quality,reasons,joints,features:f};
}

export function trackingMessage(result){
  if(result.tracking==='selecting_side')return '푸시업 준비 위치에서 관절이 안정적으로 보이는 쪽을 확인하고 있어요.';
  const diagnostics=result.details?.diagnostics??result.diagnostics;
  const side=result.side??['left','right'].sort((a,b)=>(diagnostics?.[b]?.quality??0)-(diagnostics?.[a]?.quality??0))[0];
  const r=diagnostics?.[side]?.reasons?.[0];
  if(!r)return '관절을 다시 확인하고 있어요.';
  const [joint,reason]=r.split(':');
  if(LABEL[joint])return `${sideLabel(side)} ${LABEL[joint]} ${reason==='outside_image'?'좌표가 화면 밖으로 추정돼요':'추적 신뢰도가 낮아요'}.`;
  return {body_too_small:'몸이 화면에서 너무 작게 잡혀요.',body_not_horizontal:'푸시업 준비 위치에서 몸을 가로로 담아 주세요.',support_pose_not_visible:'손을 짚은 푸시업 준비 위치를 확인하고 있어요.',elbow_geometry_invalid:'팔꿈치 좌표를 다시 확인하고 있어요.'}[r]??'관절 추적을 다시 확인하고 있어요.';
}

/** Side selection is a live adapter; the validated cycle/rating engine stays unchanged. */
export class LivePushupEngine {
  constructor(settings=config){
    this.settings=settings;this.core=new PushupEngine({side:'left',settings});
    this.side=null;this.lastTime=null;this.goodSince={left:null,right:null};this.lostSince=null;
    this.blocked=false;this.closed=false;
  }
  get count(){return this.core.count;}
  breakContinuity(reason='pause'){
    const events=this.core.breakContinuity();
    if(this.side)events.push({type:'side.released',t:this.lastTime,side:this.side,reason});
    this.side=null;this.goodSince={left:null,right:null};this.lostSince=null;this.blocked=false;
    return events;
  }
  finish(){if(this.closed)return [];this.closed=true;return this.core.finish();}
  pushFrame(packet){
    const t=packet.timestampMs/1000;
    if(this.closed||!Number.isFinite(t)||this.lastTime!==null&&t<=this.lastTime)return {ignored:true,events:[],count:this.count};
    const dt=this.lastTime===null?null:t-this.lastTime;
    const gap=dt!==null&&dt>SIDE_POLICY.max_gap_s;this.lastTime=t;
    const events=[];
    if(dt!==null&&dt>this.settings.motion.gap_s)events.push({type:'frame.gap',t,gap_s:dt,cycle_reset_gap_s:this.settings.motion.gap_s});
    if(gap){events.push(...this.breakContinuity('frame_gap'));}
    const diagnostics={left:inspectSide(packet,'left',this.settings),right:inspectSide(packet,'right',this.settings)};
    for(const side of ['left','right']){
      if(!diagnostics[side].ready)this.goodSince[side]=null;
      else if(this.goodSince[side]===null)this.goodSince[side]=t;
    }
    const stable=s=>this.goodSince[s]!==null&&t-this.goodSince[s]>=SIDE_POLICY.acquire_s;
    if(!this.side){
      const candidates=['left','right'].filter(stable).sort((a,b)=>diagnostics[b].quality-diagnostics[a].quality);
      if(candidates.length){
        this.side=candidates[0];this.core.side=this.side;
        events.push({type:'side.selected',t,side:this.side,reason:'stable_required_joints'});
      }else return {events,count:this.count,side:null,tracking:Object.values(diagnostics).some(d=>d.ready)?'selecting_side':'tracking_unavailable',codes:[],diagnostics};
    }
    if(!diagnostics[this.side].ready){
      if(this.lostSince===null)this.lostSince=t;
      // Never bridge a partial repetition over missing geometry or a side change.
      if(!this.blocked){events.push(...this.core.breakContinuity());this.blocked=true;events.push({type:'tracking.blocked',t,side:this.side,reasons:diagnostics[this.side].reasons});}
      const other=this.side==='left'?'right':'left';
      if(t-this.lostSince>=SIDE_POLICY.lost_s&&stable(other)){
        const from=this.side;events.push(...this.core.breakContinuity());
        this.side=other;this.core.side=other;this.blocked=false;this.lostSince=null;
        events.push({type:'side.changed',t,from,to:other,reason:'selected_side_lost_other_stable'});
      }else return {events,count:this.count,side:this.side,tracking:'tracking_unavailable',codes:[],diagnostics};
    }else{
      this.lostSince=null;
      if(this.blocked){events.push({type:'tracking.recovered',t,side:this.side});this.blocked=false;}
    }
    const result=this.core.pushFrame(packet);
    return {...result,side:this.side,events:[...events,...result.events],diagnostics,
      usedFeatures:this.core.rows.length?{...this.core.rows[this.core.rows.length-1]}:null};
  }
}
