// Broad side-view forearm-plank observation gate, independent of posture quality.
// Engineering defaults, not anatomical correctness thresholds or floor-contact detection.
export const HOLD_CONFIG=Object.freeze({minQuality:.5,minHorizontal:.65,minShoulderClearance:.035,
  minBodyToUpperArm:2,maxForearmVertical:.65,confirmationSeconds:.3,maxGapSeconds:.25});
const norm=v=>Math.hypot(...v),sub=(a,b)=>[a[0]-b[0],a[1]-b[1]];
export function inspectHold(frame,side){
  const ids=side==='left'?[11,13,15,23,27]:side==='right'?[12,14,16,24,28]:null;
  const invalid=()=>({state:'unobservable',side,reasons:['required_joints_unavailable'],geometry:null});
  if(!ids)return invalid();
  const pts=ids.map(id=>frame.landmarks[id]);
  if(!pts.every(p=>p&&[p[0],p[1],p[3],p[4]].every(Number.isFinite)&&p[3]>=HOLD_CONFIG.minQuality&&p[4]>=HOLD_CONFIG.minQuality&&p[0]>=0&&p[0]<=1&&p[1]>=0&&p[1]<=1))return invalid();
  const [s,e,w,h,a]=pts.map(p=>[p[0]*frame.width,p[1]*frame.height]);
  const body=sub(a,s),L=norm(body),upper=norm(sub(e,s)),fore=norm(sub(w,e));
  if(Math.min(L,upper,fore)<1e-6)return invalid();
  const geometry={horizontal:Math.abs(body[0])/L,shoulderClearance:(e[1]-s[1])/L,
    bodyToUpperArm:L/upper,forearmVertical:Math.abs(w[1]-e[1])/fore,
    hipProjection:((h[0]-s[0])*body[0]+(h[1]-s[1])*body[1])/(L*L)};
  const reasons=[];
  if(geometry.horizontal<HOLD_CONFIG.minHorizontal)reasons.push('body_not_horizontal');
  if(geometry.shoulderClearance<HOLD_CONFIG.minShoulderClearance)reasons.push('upper_body_not_supported');
  if(geometry.bodyToUpperArm<HOLD_CONFIG.minBodyToUpperArm)reasons.push('body_not_extended');
  if(geometry.forearmVertical>HOLD_CONFIG.maxForearmVertical)reasons.push('forearm_not_horizontal');
  if(geometry.hipProjection<=0||geometry.hipProjection>=1)reasons.push('body_order_unavailable');
  return {state:reasons.length?'not_plank':'candidate',side,reasons,geometry};
}
export class HoldTimer{
  constructor(){this.seconds=0;this.reset();}
  reset(){this.previous=null;this.pendingSeconds=0;this.confirmed=false;}
  step(frame,side){
    const observation=inspectHold(frame,side),t=frame.timestampMs/1000;
    if(observation.state!=='candidate'){this.reset();return observation;}
    const dt=this.previous?t-this.previous.t:0;
    if(!this.previous||this.previous.side!==side||dt<=0||dt>HOLD_CONFIG.maxGapSeconds){
      this.pendingSeconds=0;this.confirmed=false;
    }else if(this.confirmed)this.seconds+=dt;
    else{
      this.pendingSeconds+=dt;
      if(this.pendingSeconds+1e-9>=HOLD_CONFIG.confirmationSeconds){
        this.seconds+=this.pendingSeconds;this.pendingSeconds=0;this.confirmed=true;
      }
    }
    this.previous={t,side};
    return {...observation,state:this.confirmed?'holding':'candidate'};
  }
}
