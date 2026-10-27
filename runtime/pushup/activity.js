/** Standard (toe-supported) push-up context, shared by pose extractors.
 * This is not a posture grade or an automatic set-finish detector.
 * Angles are engineering gates in the camera plane, not anatomical truth.
 */
export const PUSHUP_ACTIVITY_VERSION='pushup-activity-1.0';
const IDS={left:[11,23,25,27],right:[12,24,26,28]};
export function activityGeometry(frame,side,settings){
 const ids=IDS[side];if(!ids)return {kneeDeg:null,horizontal:null,reason:'side_unavailable'};
 const q=settings.pipeline.cfg;
 const p=ids.map(id=>frame.landmarks?.[id]).map(p=>p&&[p[0],p[1],p[3],p[4]].every(Number.isFinite)&&p[0]>=0&&p[0]<=1&&p[1]>=0&&p[1]<=1&&p[3]>=q.visibility_min&&p[4]>=q.presence_min?[p[0]*frame.width,p[1]*frame.height]:null);
 const [s,h,k,a]=p;let kneeDeg=null,horizontal=null;
 if(s&&a){const dx=a[0]-s[0],dy=a[1]-s[1],L=Math.hypot(dx,dy);if(L>1)horizontal=Math.abs(dx)/L;}
 if(h&&k&&a){const u=[h[0]-k[0],h[1]-k[1]],v=[a[0]-k[0],a[1]-k[1]],L=Math.hypot(...u)*Math.hypot(...v);if(L>9)kneeDeg=Math.acos(Math.max(-1,Math.min(1,(u[0]*v[0]+u[1]*v[1])/L)))*180/Math.PI;}
 return {kneeDeg,horizontal,reason:kneeDeg===null?'knee_unobservable':null};
}
export class PushupActivityGate {
 constructor(settings){this.settings=settings;this.reset();}
 reset(){this.state='preparation';this.side=null;this.exitSince=null;this.resumeSince=null;this.blocked=false;this.confirmed=false;this.lastTime=null;}
 step(frame,side){
  const t=frame.timestampMs/1000,c=this.settings.pipeline.v3;
  if(this.side!==side||(this.lastTime!==null&&t-this.lastTime>this.settings.motion.gap_s)){
   if(this.blocked){this.resumeSince=null;this.exitSince=null;}
   else this.reset();
  }
  this.side=side;this.lastTime=t;const geometry=activityGeometry(frame,side,this.settings);
  const tucked=geometry.kneeDeg!==null&&geometry.kneeDeg<c.exit_knee_deg;
  const upright=geometry.horizontal!==null&&geometry.horizontal<c.exit_resume_horizontal;
  const exit=tucked||upright;
  const resume=geometry.kneeDeg!==null&&geometry.kneeDeg>=c.exit_resume_knee_deg&&geometry.horizontal!==null&&geometry.horizontal>=c.exit_resume_horizontal;
  const previous=this.state;let interrupt=false;
  if(exit){
   this.blocked=true;this.resumeSince=null;this.exitSince??=t;
   if(!this.confirmed&&t-this.exitSince+1e-9>=c.exit_hold_s){this.confirmed=true;interrupt=true;}
   this.state=this.confirmed?'outside_exercise':'exit_candidate';
  }else if(this.blocked){
   this.exitSince=null;
   if(resume){this.resumeSince??=t;this.state='resuming';if(!this.confirmed||t-this.resumeSince+1e-9>=c.exit_hold_s){this.blocked=false;this.confirmed=false;this.resumeSince=null;this.state='active';}}
   else{this.resumeSince=null;this.state=this.confirmed?'outside_exercise':'exit_candidate';}
  }else this.state='active';
  // Missing knee alone is not evidence of ending. The existing required-joint
  // gate still handles missing body/arm observations. After a detected exit,
  // missing knee CANNOT re-arm the counter.
  return {version:PUSHUP_ACTIVITY_VERSION,state:this.state,allow:this.state==='active',confirmed:this.confirmed,interrupt,changed:previous!==this.state,
   reason:exit?(tucked?'knee_tucked':'body_upright'):this.blocked?(resume?'confirming_return':'awaiting_extended_support'):geometry.reason,
   geometry};
 }
}
