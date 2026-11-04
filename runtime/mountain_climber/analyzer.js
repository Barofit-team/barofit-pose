import {validateFrame} from '../common/frame.js';
import {frameResult} from '../common/realtime.js';
import {itemResult, setSummary, setCompleted} from '../common/result.js';

export const CLIMBER_VERSION = 'mountain-climber-0.5';
// Screen-plane pilot cutoffs, in projected torso lengths and milliseconds.
const CONFIG = Object.freeze({visibility: .5, maxGapMs: 220, enter: .18, returned: -.12,
  countSupportGraceMs:120, horizontalExcursion:.45, maxSupportShift:.55,
  shortKneeTravel:.23, shortFootTravel:.15, shortReturnFraction:.55, shortDriveMs:45,
  hipHigh: .33, hipAboveShoulder: .15, hipDwellMs: 50, minCycleMs: 150, maxCycleMs: 4500});
const SIDES = ['left', 'right'];
const ITEMS = ['hip_height'];
const CODES = {hip_height:'HIPS_HIGH'};
function point(frame,id,visibility=CONFIG.visibility){
  const p=frame.landmarks[id];
  if(!p || !p.every(Number.isFinite) || Math.min(p[3],p[4])<visibility ||
    p[0]<0 || p[0]>1 || p[1]<0 || p[1]>1)return null;
  return [p[0]*frame.width,p[1]*frame.height];
}
function sideGeometry(frame, side,kneeVisibility=CONFIG.visibility){
  const offset=SIDES.indexOf(side);
  const [s,nearWrist,h]=[11,15,23].map(id=>point(frame,id+offset));
  const k=point(frame,25+offset,kneeVisibility);
  const w=nearWrist??point(frame,16-offset);
  if(!s||!w||!h||!k)return null;
  const x=s[0]-h[0], y=s[1]-h[1], len=Math.hypot(x,y);
  if(len<8 || Math.abs(x)/len<.65 || w[1]-s[1]<.25*len)return null;
  const along=p=>((p[0]-h[0])*x+(p[1]-h[1])*y)/(len*len);
  const ankle=point(frame,27+offset),otherAnkle=point(frame,28-offset);
  return {s,h,y,len,along,w,wristId:nearWrist?15+offset:16-offset,
    foot:ankle?Math.sign(x)*(ankle[0]-h[0])/len:null,
    separation:ankle&&otherAnkle?Math.sign(x)*(ankle[0]-otherAnkle[0])/len:null,
    footFromHand:ankle?Math.sign(x)*(ankle[0]-w[0]):null,
    otherFootFromHand:otherAnkle?Math.sign(x)*(otherAnkle[0]-w[0]):null,
    kneeForward:along(k),horizontal:Math.sign(x)*(k[0]-h[0])/len};
}
function supportedMetrics(frame,geometry){
  if(!geometry)return null;
  const {s,h,y,len,along,kneeForward}=geometry;
  // Use the extended support leg. The driving ankle cannot define the plank line.
  const ankles=[27,28].map(id=>point(frame,id)).filter(p=>p&&along(p)<-.65);
  if(!ankles.length)return {kneeForward,hipLift:null,hipAboveShoulder:y/len};
  const ankle=ankles.sort((a,b)=>along(a)-along(b))[0];
  const dx=ankle[0]-s[0],dy=ankle[1]-s[1];
  const hipLift=Math.sign(dx)*(dy*(h[0]-s[0])-dx*(h[1]-s[1]))/(Math.hypot(dx,dy)*len);
  return {kneeForward,hipLift,hipAboveShoulder:y/len};
}
export function climberMetrics(frame,side){
  return supportedMetrics(frame,sideGeometry(frame,side));
}
function fresh(){return {readyAt:null,startedAt:null,peak:null,hipWarn:false,hipUnknown:false,horizontalCycle:false,lastSeen:null,supportMissing:false,rearHorizontal:null,anchor:null,short:null};}
// Measure a short excursion against this leg's observed rear position, not the form target.
function shortReturn(leg,g,t,high,hipUnknown,reliable=true){
  const k=g.horizontal, f=g.foot;
  if(f===null || g.otherFootFromHand===null){leg.short=null;return null;}
  let s=leg.short;
  if(s && (t-s.t>CONFIG.maxCycleMs || g.wristId!==s.wristId))s=leg.short=null;
  if(!s || (!s.confirmed && s.driveAt===null && k<=s.k)){
    if(g.kneeForward<=CONFIG.returned)leg.short={k,f,t,separation:g.separation,peak:k,footPeak:f,axial:g.kneeForward,driveAt:null,confirmed:false,high:false,
      wristId:g.wristId,footStart:g.footFromHand,otherStart:g.otherFootFromHand,advance:0,otherRetreat:0,hipUnknown};
    return null;
  }
  if(!reliable)return null;
  // A support foot rebounding as the other leg extends is not a second drive.
  // Compare the two excursions in the same pixel scale, relative to the planted hand.
  s.advance=Math.max(s.advance,g.footFromHand-s.footStart);
  s.otherRetreat=Math.max(s.otherRetreat,s.otherStart-g.otherFootFromHand);
  s.peak=Math.max(s.peak,k);s.footPeak=Math.max(s.footPeak,f);
  s.axial=Math.max(s.axial,g.kneeForward);s.high ||= high;
  s.hipUnknown ||= hipUnknown;
  if(k-s.k>=CONFIG.shortKneeTravel && f-s.f>=CONFIG.shortFootTravel &&
      s.separation!==null && g.separation!==null && g.separation-s.separation>=CONFIG.shortFootTravel){
    s.driveAt??=t;
    s.confirmed ||= t-s.driveAt>=CONFIG.shortDriveMs;
  }else s.driveAt=null;
  if(s.confirmed && g.kneeForward<=CONFIG.returned &&
      s.peak-k>=(s.peak-s.k)*CONFIG.shortReturnFraction &&
      s.footPeak-f>=(s.footPeak-s.f)*CONFIG.shortReturnFraction){
    leg.short=null;
    if(s.advance>s.otherRetreat && s.axial<CONFIG.enter && s.peak<CONFIG.enter && t-s.t>=CONFIG.minCycleMs)return s;
  }
  return null;
}
export class MountainClimberAnalyzer {
  constructor(){this.lastTime=null;this.closed=false;this.reps=[];this.observedSeconds=0;this.gapSeconds=0;this.reset();}
  reset(){this.legs=Object.fromEntries(SIDES.map(s=>[s,fresh()]));this.visible=false;this.hipSince=null;this.lastRep=null;}
  breakContinuity(reason='pause'){if(this.closed)return [];this.reset();return [{type:'tracking.interrupted',reason,t:this.lastTime===null?null:this.lastTime/1000}];}
  stepLeg(side,m,g,t,high,hipUnknown,events,weakRear){
    let leg=this.legs[side];
    // Planted hands should not teleport between adjacent frames (e.g. an edited camera cut).
    const prev=leg.anchor;
    if(g && prev?.wristId===g.wristId &&
        Math.hypot(g.w[0]-prev.w[0],g.w[1]-prev.w[1])>CONFIG.maxSupportShift*Math.max(g.len,prev.len)){
      leg=this.legs[side]=fresh();
    }
    leg.anchor=g;
    // Preserve the prior short grace period for a weak knee, not for a missing support foot.
    if(!m){
      if(!g || leg.lastSeen===null || t-leg.lastSeen>CONFIG.countSupportGraceMs){
        // A partly occluded knee may establish the rear baseline for a later
        // visible drive. It cannot establish a peak or complete a repetition.
        const rear=weakRear && !leg.short?.confirmed && leg.short?.driveAt===null?leg.short:null;
        leg=this.legs[side]=fresh();
        if(weakRear){leg.short=rear;leg.anchor=weakRear;shortReturn(leg,weakRear,t,high,hipUnknown,false);}
      }
      else {leg.supportMissing=true;leg.hipUnknown ||= hipUnknown;leg.hipWarn ||= high;}
      return;
    }
    if(leg.lastSeen!==null && t-leg.lastSeen>CONFIG.countSupportGraceMs && leg.supportMissing){
      leg=this.legs[side]=fresh();
    }
    leg.supportMissing=false;leg.lastSeen=t;leg.anchor=g;
    const horizontal=g.horizontal;
    const short=shortReturn(leg,g,t,high,hipUnknown);
    if(leg.readyAt!==null){leg.hipWarn ||= high;leg.hipUnknown ||= hipUnknown;}
    if(leg.startedAt!==null){leg.hipWarn ||= high;leg.peak=Math.max(leg.peak,m.kneeForward);}
    if(leg.startedAt!==null&&t-leg.startedAt>CONFIG.maxCycleMs){this.legs[side]=fresh();return high;}
    const axialRear=m.kneeForward<=CONFIG.returned;
    const horizontalRear=horizontal<=CONFIG.returned;
    // A tilted torso can keep the axial projection forward even at the rear.
    // Lock a horizontal-only drive to its own entry and return coordinates.
    const atRear=leg.startedAt!==null?(leg.horizontalCycle?horizontalRear:axialRear):
      axialRear || (horizontalRear && (leg.readyAt===null || leg.horizontalCycle));
    if(atRear){
      // Overlapping knees can swap sides briefly. Two supplemental returns
      // within the minimum cycle time are ambiguous in a side view.
      const previous=this.reps.at(-1);
      if(leg.startedAt===null && short && (!previous || t-previous.timestampMs>=CONFIG.minCycleMs)){
        leg.startedAt=short.t;leg.peak=short.axial;leg.hipWarn=short.high;leg.hipUnknown=short.hipUnknown;
      }
      if(leg.startedAt!==null && t-leg.startedAt>=CONFIG.minCycleMs){
        const items={hip_height:leg.hipWarn?'warning':leg.hipUnknown?'unknown':'within_reference'};
        const rep={number:this.reps.length+1,timestampMs:t,items,codes:ITEMS.filter(k=>items[k]==='warning').map(k=>CODES[k]),
          metrics:{side,peakKneeForward:leg.peak,cycleMs:t-leg.startedAt}};
        this.reps.push(rep);this.lastRep=rep;
        leg.short=null;
        events.push({type:'rep.completed',t:t/1000,rep:rep.number,side},{type:'rep.feedback',t:t/1000,...rep});
      }
      leg.rearHorizontal=leg.startedAt!==null || leg.rearHorizontal===null?horizontal:Math.min(leg.rearHorizontal,horizontal);
      leg.startedAt=null;leg.readyAt=t;leg.horizontalCycle=!axialRear;leg.peak=null;leg.hipWarn=high;leg.hipUnknown=hipUnknown;
    }else if(leg.startedAt===null&&leg.readyAt!==null&&
      ((!leg.horizontalCycle && m.kneeForward>=CONFIG.enter) || (horizontal>=CONFIG.enter && horizontal-leg.rearHorizontal>=CONFIG.horizontalExcursion))){
      leg.startedAt=leg.readyAt;leg.peak=m.kneeForward;leg.hipWarn ||= high;
    }
    return high;
  }
  pushFrame(frame){
    validateFrame(frame);const t=frame.timestampMs, events=[];
    const reason=this.closed?'finished':this.lastTime!==null&&t<=this.lastTime?'non_monotonic_timestamp':null;
    const serialize=(payload,ignoredReason=null)=>frameResult({count:this.reps.length,observedSeconds:this.observedSeconds,...payload},frame,
      {exercise:'mountain_climber',engineVersion:CLIMBER_VERSION,ignoredReason});
    if(reason)return serialize({},reason);
    const dt=this.lastTime===null?0:t-this.lastTime;
    if(dt>CONFIG.maxGapMs){this.reset();this.gapSeconds+=dt/1000;events.push({type:'frame.gap',t:t/1000,gap_s:dt/1000});}
    this.lastTime=t;
    const geometry=Object.fromEntries(SIDES.map(side=>[side,sideGeometry(frame,side)]));
    const metrics=Object.fromEntries(SIDES.map(side=>[side,supportedMetrics(frame,geometry[side])]));
    const visible=SIDES.some(s=>metrics[s]);if(this.visible&&visible)this.observedSeconds+=dt/1000;
    this.visible=visible;
    const hipVisible=Object.values(metrics).some(m=>m && m.hipLift!==null);
    const elevated=Object.values(metrics).some(m=>m && m.hipLift>CONFIG.hipHigh && m.hipAboveShoulder>CONFIG.hipAboveShoulder);
    if(elevated)this.hipSince??=t;else this.hipSince=null;
    const high=this.hipSince!==null && t-this.hipSince>=CONFIG.hipDwellMs;
    for(const [i,side] of SIDES.entries()){
      const weakRear=!geometry[side] && metrics[SIDES[1-i]]?sideGeometry(frame,side,.35):null;
      this.stepLeg(side,metrics[side],geometry[side]??weakRear,t,high,!hipVisible || (elevated && !high),events,weakRear);
    }
    if(!visible)this.lastRep=null;
    const r=serialize({tracking:visible?'tracking':'tracking_unavailable',movementPhase:visible?(SIDES.some(s=>this.legs[s].startedAt!==null)?'driving':'supported'):'not_ready',
      items:{hip_height:hipVisible?(high?'warning':elevated?'pending_feedback':'within_reference'):'tracking_unavailable'},
      codes:high?[CODES.hip_height]:[],metrics,events});
    r.lastRepetition=this.lastRep&&t-this.lastRep.timestampMs<=1000?this.lastRep:null;
    r.codes=[...new Set([...r.currentCodes,...(r.lastRepetition?.codes??[])])];return r;
  }
  summary(){const items={};for(const key of ITEMS){const ok=this.reps.filter(r=>r.items[key]==='within_reference').length;
      const warning=this.reps.filter(r=>r.items[key]==='warning').length;items[key]=itemResult('repetition',ok,warning,this.reps.length-ok-warning);}
    return setSummary({exercise:'mountain_climber',engineVersion:CLIMBER_VERSION,count:this.reps.length,observedSeconds:this.observedSeconds,gapSeconds:this.gapSeconds,
      items,details:{repetitions:this.reps,configuration:CONFIG}});}
  finish(){if(this.closed)return [];this.closed=true;return [setCompleted(this.summary(),this.lastTime)];}
}
