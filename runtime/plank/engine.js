/** Causal port of analysis/plank v0.2. All thresholds are unchanged. */
export const HIP_CONFIG = Object.freeze({drop_enter_pct:4,drop_exit_pct:3,high_enter_pct:-12,high_exit_pct:-10,
  median_window_s:.3,warmup_s:.4,enter_s:.6,release_s:.4,reselect_after_s:.4,max_gap_s:.25});
export const CONFIG = Object.freeze({shoulder_enter_deg:20,shoulder_exit_deg:15,knee_enter_deg:160,knee_exit_deg:165,
  window_s:.3,warmup_s:.4,enter_s:.6,release_s:.4,min_quality:.5});
export const IDS = {left:[11,13,15,23,25,27],right:[12,14,16,24,26,28]};
const finite=Number.isFinite;
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1]], norm=a=>Math.sqrt(a[0]*a[0]+a[1]*a[1]);
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1];
const median=a=>{const s=[...a].sort((a,b)=>a-b),m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2;};
const point=(pose,id,dims)=>[pose[id][0]*dims[0],pose[id][1]*dims[1]];
const inImage=p=>p[0]>=0&&p[0]<=1&&p[1]>=0&&p[1]<=1;
const qualityOK=p=>p.slice(3).every(finite)&&p.slice(3).every(v=>v>=.5);
function angle(a,b,c,epsilon=1e-8) {
  const u=sub(a,b),v=sub(c,b),den=norm(u)*norm(v);
  return den>epsilon?Math.acos(Math.max(-1,Math.min(1,dot(u,v)/den)))*180/Math.PI:null;
}
export function hipMetric(pose,dims,side) {
  const ids=IDS[side],q=[pose[ids[0]],pose[ids[3]],pose[ids[5]]];
  const r={hip_offset_pct:null,hip_angle_deg:null,min_visibility:null,min_presence:null,reliable:false};
  if(q.every(p=>p.slice(3).every(finite))) {
    r.min_visibility=Math.min(...q.map(p=>p[3]));r.min_presence=Math.min(...q.map(p=>p[4]));
  }
  if(!q.every(p=>p.slice(0,2).every(finite)))return r;
  const [s,h,a]=q.map(p=>[p[0]*dims[0],p[1]*dims[1]]),v=sub(a,s),length=norm(v);
  if(length<1e-6)return r;
  if(Math.abs(v[0])/length>=.1) {
    let n=[-v[1]/length,v[0]/length];if(n[1]<0)n=n.map(v=>-v);
    r.hip_offset_pct=dot(sub(h,s),n)/length*100;
  }
  r.hip_angle_deg=angle(s,h,a,1e-6);
  r.reliable=q.every(p=>qualityOK(p)&&inImage(p));return r;
}
function extraMetrics(pose,dims,side) {
  const [s,e,w,h,k,a]=IDS[side];
  const valid=ids=>ids.every(i=>pose[i].every(finite)&&qualityOK(pose[i])&&inImage(pose[i]));
  const S=point(pose,s,dims),E=point(pose,e,dims);
  const shoulder=valid([s,e])&&norm(sub(E,S))>1e-8,knee=valid([h,k,a]),elbow=valid([s,e,w]);
  const kneeAngle=knee?angle(point(pose,h,dims),point(pose,k,dims),point(pose,a,dims)):null;
  const elbowAngle=elbow?angle(S,E,point(pose,w,dims)):null;
  return {shoulder_deviation_deg:shoulder?Math.atan2(Math.abs(E[0]-S[0]),E[1]-S[1])*180/Math.PI:null,
    knee_deg:kneeAngle,elbow_deg:elbowAngle,shoulder_valid:shoulder,knee_valid:knee&&kneeAngle!==null,
    elbow_valid:elbow&&elbowAngle!==null,shoulder_elbow_dx_px:shoulder?E[0]-S[0]:null};
}
export class HipRule {
  constructor(){this.c=HIP_CONFIG;this.side=null;this.last_t=null;this.bad_since=null;this.switches=0;this.resetMotion();}
  resetMotion(){this.history=[];this.state='WARMUP';this.pending=null;this.pending_since=null;this.valid_since=null;}
  valid(r){return !!r?.reliable&&finite(r.hip_offset_pct);}
  step(t,rows){
    if(this.last_t!==null) {
      if(t<=this.last_t)throw Error('Timestamps must increase');
      if(t-this.last_t>this.c.max_gap_s)this.resetMotion();
    }
    this.last_t=t;
    const ok=Object.keys(rows).filter(s=>this.valid(rows[s]));
    const best=()=>[...ok].sort((a,b)=>Math.min(rows[b].min_visibility,rows[b].min_presence)-Math.min(rows[a].min_visibility,rows[a].min_presence))[0];
    if(this.side===null&&ok.length){this.side=best();this.resetMotion();}
    if(!ok.includes(this.side)){
      if(this.bad_since===null)this.bad_since=t;this.resetMotion();
      if(ok.length&&t-this.bad_since>=this.c.reselect_after_s){this.side=best();this.switches++;this.bad_since=null;}
      else return {side:this.side,state:'UNOBSERVABLE',offset_pct:null,angle_deg:null,pending:null,warning:false,side_switches:this.switches};
    }
    this.bad_since=null;const row=rows[this.side];
    if(this.valid_since===null)this.valid_since=t;
    this.history.push([t,row.hip_offset_pct]);while(this.history.length&&t-this.history[0][0]>this.c.median_window_s)this.history.shift();
    const v=median(this.history.map(x=>x[1]));
    if(t-this.valid_since>=this.c.warmup_s){
      if(this.state==='WARMUP')this.state='NO_HIP_WARNING';
      let target='NO_HIP_WARNING';
      if(v>this.c.drop_enter_pct)target='HIP_DROP';
      else if(v<this.c.high_enter_pct)target='HIP_HIGH';
      else if(this.state==='HIP_DROP'&&v>this.c.drop_exit_pct)target='HIP_DROP';
      else if(this.state==='HIP_HIGH'&&v<this.c.high_exit_pct)target='HIP_HIGH';
      if(target===this.state){this.pending=null;this.pending_since=null;}
      else {
        if(target!==this.pending){this.pending=target;this.pending_since=t;}
        const delay=target==='NO_HIP_WARNING'?this.c.release_s:this.c.enter_s;
        if(t-this.pending_since>=delay){this.state=target;this.pending=null;this.pending_since=null;}
      }
    }
    return {side:this.side,state:this.state,offset_pct:v,angle_deg:row.hip_angle_deg,pending:this.pending,
      warning:['HIP_DROP','HIP_HIGH'].includes(this.state),side_switches:this.switches};
  }
}
class SustainedRule {
  constructor(code,enter,release,low=false){Object.assign(this,{code,enter,release,low});this.reset();}
  reset(){this.q=[];this.since=null;this.pending=null;this.pending_since=null;this.state='WARMUP';}
  step(t,value){
    if(!finite(value)){this.reset();return ['UNOBSERVABLE',null];}
    if(this.since===null)this.since=t;
    this.q.push([t,value]);while(this.q.length&&t-this.q[0][0]>CONFIG.window_s)this.q.shift();
    value=median(this.q.map(x=>x[1]));
    if(t-this.since<CONFIG.warmup_s)return ['WARMUP',value];
    if(this.state==='WARMUP')this.state='NO_WARNING';
    const threshold=this.state===this.code?this.release:this.enter,bad=this.low?value<threshold:value>threshold;
    const target=bad?this.code:'NO_WARNING';
    if(target===this.state){this.pending=null;this.pending_since=null;}
    else {
      if(target!==this.pending){this.pending=target;this.pending_since=t;}
      if(t-this.pending_since>=(bad?CONFIG.enter_s:CONFIG.release_s)){this.state=target;this.pending=null;this.pending_since=null;}
    }
    return [this.state,value];
  }
}
export class PlankRule {
  constructor(){this.hip=new HipRule();this.last_side=null;this.last_t=null;
    this.shoulder=new SustainedRule('SHOULDER_ELBOW_OFFSET',CONFIG.shoulder_enter_deg,CONFIG.shoulder_exit_deg);
    this.knee=new SustainedRule('KNEE_BENT',CONFIG.knee_enter_deg,CONFIG.knee_exit_deg,true);}
  step(t,pose,dims){
    if(!pose?.length)pose=Array.from({length:33},()=>[null,null,null,null,null]);
    const hip=this.hip.step(t,Object.fromEntries(Object.keys(IDS).map(s=>[s,hipMetric(pose,dims,s)])));
    if(hip.side!==this.last_side||(this.last_t!==null&&t-this.last_t>.25)){this.shoulder.reset();this.knee.reset();}
    this.last_side=hip.side;this.last_t=t;
    const m=hip.side?extraMetrics(pose,dims,hip.side):{shoulder_deviation_deg:null,knee_deg:null,elbow_deg:null,
      shoulder_valid:false,knee_valid:false,elbow_valid:false,shoulder_elbow_dx_px:null};
    const [ss,sv]=this.shoulder.step(t,m.shoulder_deviation_deg),[ks,kv]=this.knee.step(t,m.knee_deg);
    const codes=[hip.state,ss,ks].filter(v=>['HIP_DROP','HIP_HIGH','SHOULDER_ELBOW_OFFSET','KNEE_BENT'].includes(v));
    return {time_s:t,side:hip.side,hip_state:hip.state,hip_offset_pct:hip.offset_pct,hip_angle_deg:hip.angle_deg,
      shoulder_state:ss,knee_state:ks,shoulder_filtered_deg:sv,knee_filtered_deg:kv,warning_codes:codes.join('|'),...m};
  }
}
