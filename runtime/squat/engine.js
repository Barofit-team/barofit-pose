/**
 * Pure port of the experimental Python engine in feat/squat-colab / 54c56ab.
 * The notebook's thresholds and state transitions are unchanged.
 * Screen-plane angles are not validated anatomical or clinical thresholds.
 */
export const SQUAT_SOURCE_COMMIT = '54c56ab77c27d9e4b40314bc945519cca645607a';
export const IDS = Object.freeze({left:[11,13,15,23,25,27],right:[12,14,16,24,26,28]});
export const DEFAULT_CONFIG = Object.freeze({
  standing_deg:155,bent_deg:125,depth_deg:100,state_hold_s:.12,min_rep_s:.7,
  max_gap_s:.25,trunk_enter_deg:45,trunk_exit_deg:40,trunk_hold_s:.6,min_quality:.5,
});
const finite=Number.isFinite;
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1]];
const norm=a=>Math.sqrt(a[0]*a[0]+a[1]*a[1]);
export function angle(a,b,c){
  const u=sub(a,b),v=sub(c,b),den=norm(u)*norm(v);
  return den>1e-8?Math.acos(Math.max(-1,Math.min(1,(u[0]*v[0]+u[1]*v[1])/den)))*180/Math.PI:null;
}
export function metrics(pose,dims,side,quality=.5){
  if(!IDS[side])throw new TypeError('side must be left or right');
  const [s,e,w,h,k,a]=IDS[side];
  const valid=indices=>indices.every(i=>{
    const p=pose?.[i];
    return p?.length===5&&p.every(finite)&&p[3]>=quality&&p[4]>=quality&&
      p[0]>=0&&p[0]<=1&&p[1]>=0&&p[1]<=1;
  });
  const xy=i=>[pose[i][0]*dims[0],pose[i][1]*dims[1]];
  const knee=valid([h,k,a])?angle(xy(h),xy(k),xy(a)):null;
  const hip=valid([s,h,k])?angle(xy(s),xy(h),xy(k)):null;
  const elbow=valid([s,e,w])?angle(xy(s),xy(e),xy(w)):null;
  const trunk=valid([s,h])&&norm(sub(xy(s),xy(h)))>1e-8?
    Math.atan2(Math.abs(xy(s)[0]-xy(h)[0]),xy(h)[1]-xy(s)[1])*180/Math.PI:null;
  return {knee_deg:knee,hip_deg:hip,elbow_deg:elbow,trunk_deg:trunk};
}

/** Inputs are seconds and angles in degrees; no landmark selection or UI logic. */
export class SquatRule {
  constructor(config=DEFAULT_CONFIG){
    this.c={...DEFAULT_CONFIG,...config};this.count=0;this.reps=[];
    this.last_t=null;this.last_rep=-Infinity;this.reset();
  }
  // Interrupt only the unfinished movement, preserving completed repetitions.
  reset(){
    this.state='WAIT_STANDING';this.pending=null;this.pending_since=null;
    this.min_knee=null;this.start=null;this.lean_since=null;this.lean_warning=false;
  }
  step(t,knee,trunk){
    if(!finite(t)||t<0)throw new TypeError('time must be finite and nonnegative');
    if(this.last_t!==null&&t<=this.last_t)throw new RangeError('Timestamps must increase');
    if(this.last_t!==null&&t-this.last_t>this.c.max_gap_s)this.reset();
    this.last_t=t;
    const events=[],codes=[];
    if(!finite(knee)){
      this.reset();
      return {count:this.count,state:'UNOBSERVABLE',codes:[],events:[],depth_state:'unknown',trunk_state:'unknown'};
    }
    if(['READY','LOWERED'].includes(this.state)){
      if(this.start===null&&knee<this.c.standing_deg)this.start=t;
      if(this.start!==null)this.min_knee=this.min_knee===null?knee:Math.min(knee,this.min_knee);
    }
    const observed=knee>=this.c.standing_deg?'standing':knee<=this.c.bent_deg?'bent':null;
    if(observed===null){this.pending=null;this.pending_since=null;}
    else{
      if(observed!==this.pending){this.pending=observed;this.pending_since=t;}
      if(t-this.pending_since>=this.c.state_hold_s){
        if(observed==='standing'&&this.state==='WAIT_STANDING')this.state='READY';
        else if(observed==='bent'&&this.state==='READY')this.state='LOWERED';
        else if(observed==='standing'&&this.state==='LOWERED'){
          if(this.start!==null&&t-this.last_rep>=this.c.min_rep_s){
            this.count++;this.last_rep=t;
            const shallow=this.min_knee>this.c.depth_deg;
            const event={rep:this.count,start_s:this.start,end_s:t,min_knee_deg:this.min_knee,
              depth_state:shallow?'warning':'within_reference'};
            this.reps.push(event);events.push(event);
            if(shallow)codes.push('SQUAT_SHALLOW');
          }
          this.state='READY';this.start=null;this.min_knee=null;
        }else if(observed==='standing'&&this.state==='READY'){
          this.start=null;this.min_knee=null;
        }
      }
    }
    let trunk_state;
    if(!finite(trunk)){this.lean_since=null;this.lean_warning=false;trunk_state='unknown';}
    else{
      if(knee>=this.c.standing_deg||trunk<=this.c.trunk_exit_deg){
        this.lean_since=null;this.lean_warning=false;
      }else if(trunk>this.c.trunk_enter_deg&&knee<150){
        if(this.lean_since===null)this.lean_since=t;
        if(t-this.lean_since>=this.c.trunk_hold_s)this.lean_warning=true;
      }else if(!this.lean_warning)this.lean_since=null;
      trunk_state=this.lean_warning?'warning':this.lean_since!==null?'pending_feedback':'within_reference';
      if(this.lean_warning)codes.push('TRUNK_LEAN');
    }
    return {count:this.count,state:this.state,codes,events,
      depth_state:events.length?events.at(-1).depth_state:'not_evaluated',trunk_state};
  }
}
