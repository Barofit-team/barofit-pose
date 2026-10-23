import {validateFrame,jsonSafe} from '../../../runtime/common/frame.js';
import {frameResult} from '../../../runtime/common/realtime.js';
import {itemResult,setSummary,setCompleted} from '../../../runtime/common/result.js';
import {TempoTracker,measureTempo} from '../../../runtime/leg_raise/tempo.js';

export const GLUTE_BRIDGE_VERSION='glute-bridge-0.2.0';
// Engineering tolerances, not clinical cutoffs. Protocol: bilateral floor bridge, side view.
export const GLUTE_BRIDGE_CONFIG=Object.freeze({visibility:.5,maxGapMs:300,sideLossMs:300,
  readyMs:250,smoothingMs:100,bottomMaxDeg:155,minExcursionDeg:20,returnToleranceDeg:12,
  reversalDeg:6,minRepMs:650,maxRepMs:30000,topMinDeg:150,
  shinMaxTiltDeg:25,closeFootRatio:.30,closeFootKneeDeg:35,setupEvidenceMs:100,
  warningDwellMs:250,fastLowerMs:600,fastLowerSpeedDegS:65,feedbackMs:2000});
const median=a=>a.length?[...a].sort((x,y)=>x-y)[Math.floor(a.length/2)]:null;
function closeFootEvidence(setup,c){
 const valid=setup.length>=2&&setup.at(-1).t-setup[0].t>=c.setupEvidenceMs;
 const ratio=valid?median(setup.map(x=>x.hipAnkleLegRatio)):null,knee=valid?median(setup.map(x=>x.kneeDeg)):null;
 return {valid,ratio,knee,close:valid&&ratio<c.closeFootRatio&&knee<c.closeFootKneeDeg};
}
const KEYS=['hip_extension','foot_position','lowering_control','lumbar_neutral','knee_tracking'];
const CODES={hip_extension:'HIP_LIFT_LOW',foot_position:'FOOT_POSITION_OFFSET',lowering_control:'LOWERING_FAST'};
const angle=(a,b,c)=>{
 const u=[a[0]-b[0],a[1]-b[1]],v=[c[0]-b[0],c[1]-b[1]],d=Math.hypot(...u)*Math.hypot(...v);
 return d>1e-6?Math.acos(Math.max(-1,Math.min(1,(u[0]*v[0]+u[1]*v[1])/d)))*180/Math.PI:null;
};
export function gluteBridgeMetrics(frame,side,c=GLUTE_BRIDGE_CONFIG){
 const ids=side==='left'?[11,23,25,27]:[12,24,26,28],raw=ids.map(i=>frame.landmarks[i]);
 if(raw.some(p=>!p||![p[0],p[1],p[3],p[4]].every(Number.isFinite)||Math.min(p[3],p[4])<c.visibility||p[0]<0||p[0]>1||p[1]<0||p[1]>1))return null;
 const [s,h,k,a]=raw.map(p=>[p[0]*frame.width,p[1]*frame.height]);
 const torso=Math.hypot(s[0]-h[0],s[1]-h[1]),thigh=Math.hypot(k[0]-h[0],k[1]-h[1]),shin=Math.hypot(a[0]-k[0],a[1]-k[1]);
 if(Math.min(torso,thigh,shin)<20)return null;
 const hipDeg=angle(s,h,k),kneeDeg=angle(h,k,a),sx=k[0]-s[0],sy=k[1]-s[1],sk=Math.hypot(sx,sy);
 if(hipDeg===null||kneeDeg===null||Math.abs(sx)<.5*sk)return null;
 // Normal points screen-down for either facing direction; positive hip is below S-K line.
 const sign=Math.sign(sx),nx=-sy/sk*sign,ny=sx/sk*sign;
 const offset=(h[0]-s[0])*nx+(h[1]-s[1])*ny;
 const extensionDeg=180-Math.sign(offset||1)*(180-hipDeg);
 const shinTiltDeg=Math.atan2(Math.abs(k[0]-a[0]),Math.abs(k[1]-a[1]))*180/Math.PI;
 const floorTiltDeg=Math.atan2(Math.abs(s[1]-a[1]),Math.abs(s[0]-a[0]))*180/Math.PI;
 const between=(h[0]-s[0])*(a[0]-h[0])>0;
 const bodyReady=between&&s[1]>=h[1]-.2*torso&&a[1]-k[1]>.3*shin&&kneeDeg>15&&kneeDeg<155&&floorTiltDeg<25;
 const hipAnkleLegRatio=Math.hypot(h[0]-a[0],h[1]-a[1])/(thigh+shin);
 return {extensionDeg,hipDeg,kneeDeg,shinTiltDeg,hipAnkleLegRatio,hipOffsetRatio:offset/(torso+thigh),torsoLengthPx:torso,
  bodyReady,quality:Math.min(...raw.flatMap(p=>[p[3],p[4]])),landmarkIds:ids};
}
export class GluteBridgeAnalyzer {
 constructor(config={}){
  this.config={...GLUTE_BRIDGE_CONFIG,...config};this.closed=false;this.lastTime=null;this.side=null;
  this.count=0;this.observedSeconds=0;this.gapSeconds=0;this.repetitions=[];this.lastRep=null;
  this.totals=Object.fromEntries(KEYS.map(k=>[k,{compliant:0,warning:0,unknown:0}]));
  this.tempoTracker=new TempoTracker();this.resetMotion();
 }
 resetMotion(){this.phase='not_ready';this.readySince=null;this.low=null;this.peak=null;this.samples=[];this.history=[];this.cycleSetup=[];this.smoothed=null;this.previousValid=false;this.lostSince=null;this.warningSince={};this.tempoTracker.reset();}
 breakContinuity(reason='pause'){this.resetMotion();this.side=null;this.lastRep=null;return [{type:'tracking.interrupted',t:this.lastTime===null?null:this.lastTime/1000,reason}];}
 pushFrame(frame){
  validateFrame(frame);const t=frame.timestampMs,c=this.config;
  const ignoredReason=this.closed?'finished':this.lastTime!==null&&t<=this.lastTime?'non_monotonic_timestamp':null;
  if(ignoredReason)return frameResult({count:this.count,observedSeconds:this.observedSeconds},frame,{exercise:'glute_bridge',engineVersion:GLUTE_BRIDGE_VERSION,ignoredReason});
  const dt=this.lastTime===null?0:t-this.lastTime,events=[];
  if(dt>c.maxGapMs){this.gapSeconds+=dt/1000;this.resetMotion();this.lastRep=null;events.push({type:'frame.gap',t:t/1000,gap_s:dt/1000});}
  this.lastTime=t;
  const sides={left:gluteBridgeMetrics(frame,'left',c),right:gluteBridgeMetrics(frame,'right',c)};
  if(!this.side)this.side=Object.keys(sides).filter(k=>sides[k]?.bodyReady).sort((a,b)=>sides[b].quality-sides[a].quality)[0]??null;
  let m=this.side?sides[this.side]:null;
  if(!m?.bodyReady){
   const lost=this.lostSince??t;this.resetMotion();this.lostSince=lost;this.lastRep=null;
   const other=this.side==='left'?'right':'left';
   if(t-lost>=c.sideLossMs&&sides[other]?.bodyReady){this.side=other;m=sides[other];this.resetMotion();events.push({type:'tracking.side_changed',t:t/1000,side:other});}
  }
  const usable=!!m?.bodyReady;
  const items=Object.fromEntries(KEYS.map(k=>[k,['lumbar_neutral','knee_tracking'].includes(k)?'not_supported':usable?'pending_feedback':'tracking_unavailable']));
  const currentCodes=[];
  if(usable){
   if(this.previousValid&&dt<=c.maxGapMs)this.observedSeconds+=dt/1000;
   this.lostSince=null;this.readySince??=t;
   const alpha=dt>0?1-Math.exp(-dt/c.smoothingMs):1;
   this.smoothed=this.smoothed===null?m.extensionDeg:this.smoothed+alpha*(m.extensionDeg-this.smoothed);
   const sample={t,elevation:this.smoothed,shinTiltDeg:m.shinTiltDeg,kneeDeg:m.kneeDeg,hipAnkleLegRatio:m.hipAnkleLegRatio};
   this.history.push(sample);this.history=this.history.filter(x=>t-x.t<=1000);
   const tempo=this.tempoTracker.push(sample);m={...m,smoothedExtensionDeg:this.smoothed,tempo};
   if(t-this.readySince>=c.readyMs){
    if(this.phase==='not_ready'&&sample.elevation<=c.bottomMaxDeg){this.phase='ready';this.low=sample;this.samples=[sample];}
    else if(this.phase==='ready'){
     if(sample.elevation<=this.low.elevation||t-this.low.t>c.maxRepMs){this.low=sample;this.samples=[sample];}
     else this.samples.push(sample);
     if(sample.elevation-this.low.elevation>=c.minExcursionDeg){this.phase='raising';this.peak=sample;
      this.cycleSetup=this.history.filter(x=>x.t>=this.low.t-400&&x.elevation<=this.low.elevation+8);}
    }else if(this.phase==='raising'||this.phase==='lowering'){
     this.samples.push(sample);
     if(sample.elevation>this.peak.elevation){this.peak=sample;this.phase='raising';}
     if(this.peak.elevation-sample.elevation>=c.reversalDeg)this.phase='lowering';
     if(t-this.low.t>c.maxRepMs){events.push({type:'attempt.interrupted',t:t/1000,reason:'timeout'});this.resetMotion();}
     else if(this.phase==='lowering'&&sample.elevation<=this.low.elevation+c.returnToleranceDeg){
      if(t-this.low.t>=c.minRepMs){
       const top=this.samples.filter(x=>x.elevation>=this.peak.elevation-5);
       const shins=top.map(x=>x.shinTiltDeg).sort((a,b)=>a-b),topShin=shins[Math.floor(shins.length/2)];
       const loweringMs=t-this.peak.t,speed=(this.peak.elevation-sample.elevation)/(loweringMs/1000);
       // Setup geometry cannot be inferred from top shin tilt alone: a close foot can
       // remain below the knee at the top. Retain lower-position evidence separately.
       const setup=[...new Map([...this.cycleSetup,...this.samples.filter(x=>x.t<=this.peak.t&&x.elevation<=this.low.elevation+8)].map(x=>[x.t,x])).values()].sort((a,b)=>a.t-b.t);
       const {valid:setupValid,ratio:setupRatio,knee:setupKnee,close:footClose}=closeFootEvidence(setup,c);
       const flags={hip_extension:this.peak.elevation<c.topMinDeg,
        foot_position:topShin>c.shinMaxTiltDeg||footClose,lowering_control:loweringMs<c.fastLowerMs&&speed>c.fastLowerSpeedDegS};
       const repItems=Object.fromEntries(KEYS.map(k=>[k,k in flags?flags[k]?'warning':'within_reference':'not_supported']));
       if(!flags.foot_position&&!setupValid)repItems.foot_position='unknown';
       const measuredTempo=measureTempo(this.samples);measuredTempo.method='projected_bridge_extension_velocity_v1';
       const rep={number:++this.count,timestampMs:t,items:repItems,codes:Object.keys(flags).filter(k=>flags[k]).map(k=>CODES[k]),metrics:{
        startMs:this.low.t,peakMs:this.peak.t,endMs:t,durationMs:t-this.low.t,peakExtensionDeg:this.peak.elevation,
        startExtensionDeg:this.low.elevation,excursionDeg:this.peak.elevation-this.low.elevation,topShinTiltDeg:topShin,
        setupHipAnkleLegRatio:setupRatio,setupKneeDeg:setupKnee,footPositionReason:footClose?'close_setup':topShin>c.shinMaxTiltDeg?'top_shin_offset':setupValid?'within_reference':'setup_unobserved',
        loweringDurationMs:loweringMs,loweringSpeedDegS:speed,side:this.side,tempo:measuredTempo}};
       this.repetitions.push(rep);this.lastRep=rep;
       for(const k of KEYS)this.totals[k][repItems[k]==='warning'?'warning':repItems[k]==='within_reference'?'compliant':'unknown']++;
       events.push({type:'rep.completed',t:t/1000,rep:this.count,start_s:this.low.t/1000,end_s:t/1000},
        {type:'rep.feedback',t:t/1000,rep:this.count,items:rep.items,codes:rep.codes,metrics:rep.metrics});
      }
      this.phase='ready';this.low=sample;this.samples=[sample];this.peak=null;this.warningSince={};
     }
    }
    // Top-only live feedback: low angle DURING ascent is not an error.
    const atTop=this.peak&&this.smoothed>=this.peak.elevation-5&&(tempo.state==='still'||this.phase==='lowering');
    if(atTop){
     const setup=closeFootEvidence(this.cycleSetup,c);
     m.setupHipAnkleLegRatio=setup.ratio;m.setupKneeDeg=setup.knee;
     const flags={hip_extension:this.smoothed<c.topMinDeg,foot_position:m.shinTiltDeg>c.shinMaxTiltDeg||setup.close};
     for(const [k,bad] of Object.entries(flags)){
      if(bad)this.warningSince[k]??=t;else delete this.warningSince[k];
      const warn=bad&&t-this.warningSince[k]>=c.warningDwellMs;items[k]=warn?'warning':bad?'pending_feedback':'within_reference';
      if(warn)currentCodes.push(CODES[k]);
     }
    }else {for(const k of Object.keys(CODES))delete this.warningSince[k];};
    // Setup is not top position: only flag a markedly slanted shin, no 'pass' here.
    const closeSetup=m.hipAnkleLegRatio<c.closeFootRatio&&m.kneeDeg<c.closeFootKneeDeg;
    if(this.phase==='ready'&&(m.shinTiltDeg>35||closeSetup)){
     this.warningSince.setupFoot??=t;
     if(t-this.warningSince.setupFoot>=c.warningDwellMs){items.foot_position='warning';currentCodes.push(CODES.foot_position);}
    }else delete this.warningSince.setupFoot;

   }
   this.previousValid=true;
  }else this.previousValid=false;
  const r=frameResult({tracking:usable?'tracking':'tracking_unavailable',side:this.side,count:this.count,holdSeconds:null,observedSeconds:this.observedSeconds,
   movementPhase:this.phase,items,codes:currentCodes,metrics:m??{},events},frame,{exercise:'glute_bridge',engineVersion:GLUTE_BRIDGE_VERSION});
  r.lastRepetition=this.lastRep&&t-this.lastRep.timestampMs<=c.feedbackMs?this.lastRep:null;
  r.codes=[...new Set([...currentCodes,...(r.lastRepetition?.codes??[])])];return jsonSafe(r);
 }
 summary(){return setSummary({exercise:'glute_bridge',engineVersion:GLUTE_BRIDGE_VERSION,count:this.count,observedSeconds:this.observedSeconds,gapSeconds:this.gapSeconds,
  items:Object.fromEntries(KEYS.map(k=>[k,itemResult('repetition',this.totals[k].compliant,this.totals[k].warning,this.totals[k].unknown)])),
  details:{repetitions:this.repetitions,configuration:this.config,protocol:'bilateral_floor_bridge_side_view',unsupportedItems:['lumbar_neutral','knee_tracking']}});}
 finish(){if(this.closed)return [];this.closed=true;return [setCompleted(this.summary(),this.lastTime)];}
}
