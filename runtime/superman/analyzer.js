import {validateFrame,jsonSafe} from '../common/frame.js';
import {frameResult} from '../common/realtime.js';
import {itemResult,setSummary,setCompleted} from '../common/result.js';
import {measureTempo,TempoTracker,TEMPO_CONFIG} from '../leg_raise/tempo.js';
import {supermanMetrics} from './metrics.js';

export const SUPERMAN_VERSION='superman-0.3.0';
// Engineering settings for projected, side/oblique prone bilateral Superman.
// Sources prescribe extended limbs and controlled motion, not these numeric limits.
export const SUPERMAN_CONFIG=Object.freeze({visibility:.5,maxGapMs:300,sideLossMs:300,readyMs:200,
 smoothingMs:100,minExcursionDeg:8,returnToleranceDeg:4,returnFraction:.25,reversalDeg:4,minRepMs:600,maxRepMs:30000,
 kneeMinDeg:150,elbowMinDeg:145,warningDwellMs:250,armDwellMs:400,fastCycleMs:1600,
 holdSpeedDegS:8,holdDwellMs:250,feedbackMs:2000,
 supportArmBodyMaxDeg:110,supportWristBelow:.55,supportElbowBelow:.35,supportDwellMs:200,
 baselineWindowMs:400,baselineRangeDeg:4,armMinSegmentRatio:.15,armMaxSegmentRatio:.85});
const KEYS=['knee_extension','arm_extension','movement_control'];
const CODES={knee_extension:'KNEE_BENT',arm_extension:'ELBOW_BENT',movement_control:'MOVEMENT_FAST'};
const UNSUPPORTED=['lumbar_neutral','shoulder_shrug','leg_spread'];
const median=a=>a.length?[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)]:null;

export class SupermanAnalyzer{
 constructor(config={}){this.config={...SUPERMAN_CONFIG,...config};this.closed=false;this.lastTime=null;this.side=null;this.requireReentryStable=false;this.supportSince=null;
  this.count=0;this.holdSeconds=0;this.observedSeconds=0;this.gapSeconds=0;this.repetitions=[];this.lastRep=null;
  this.totals=Object.fromEntries(KEYS.map(k=>[k,{compliant:0,warning:0,unknown:0}]));this.resetMotion();}
 resetMotion(){this.phase='not_ready';this.readySince=null;this.low=null;this.peak=null;this.samples=[];this.armSamples=[];this.smoothed=null;this.previousValid=false;this.lostSince=null;this.warningSince={};this.previousHolding=false;this.baselineSamples=[];this.tempoTracker=new TempoTracker({...TEMPO_CONFIG,velocityWindowMs:400,stillSpeedDegS:this.config.holdSpeedDegS,minPauseMs:this.config.holdDwellMs});}
 breakContinuity(reason='pause'){this.resetMotion();this.supportSince=null;this.side=null;this.lastRep=null;return [{type:'tracking.interrupted',t:this.lastTime===null?null:this.lastTime/1000,reason}];}
 pushFrame(frame){
  validateFrame(frame);const t=frame.timestampMs,c=this.config;
  const ignoredReason=this.closed?'finished':this.lastTime!==null&&t<=this.lastTime?'non_monotonic_timestamp':null;
  if(ignoredReason)return frameResult({count:this.count,holdSeconds:this.holdSeconds,observedSeconds:this.observedSeconds},frame,{exercise:'superman',engineVersion:SUPERMAN_VERSION,ignoredReason});
  const dt=this.lastTime===null?0:t-this.lastTime,events=[];
  if(dt>c.maxGapMs){this.gapSeconds+=dt/1000;this.resetMotion();this.supportSince=null;this.lastRep=null;events.push({type:'frame.gap',t:t/1000,gap_s:dt/1000});}
  this.lastTime=t;
  const sides={left:supermanMetrics(frame,'left',c.visibility),right:supermanMetrics(frame,'right',c.visibility)};
  // Count readiness uses trunk/legs, independently of the elbow assessment.
  const armReady=m=>m?.armBodyDeg!==null&&m?.armBodyDeg>110&&m?.armOut;
  const ready=m=>!!m?.bodyReady;
  if(!this.side)this.side=Object.keys(sides).filter(s=>ready(sides[s])).sort((a,b)=>sides[b].quality-sides[a].quality)[0]??null;
  let m=sides[this.side];
  if(!ready(m)){
   const lost=this.lostSince??t;this.resetMotion();this.lostSince=lost;this.lastRep=null;
   const other=this.side==='left'?'right':'left';
   if(t-lost>=c.sideLossMs&&ready(sides[other])){this.side=other;m=sides[other];this.resetMotion();events.push({type:'tracking.side_changed',t:t/1000,side:other});}
  }
  const supportMetrics=m??Object.values(sides).filter(Boolean).sort((a,b)=>b.quality-a.quality)[0];
  const supportLike=!!supportMetrics&&supportMetrics.armBodyDeg!==null&&supportMetrics.armBodyDeg<c.supportArmBodyMaxDeg&&supportMetrics.wristBelowTrunk!==null&&supportMetrics.wristBelowTrunk>c.supportWristBelow&&supportMetrics.elbowBelowTrunk>c.supportElbowBelow;
  if(supportLike){
   this.supportSince??=t;
   if(t-this.supportSince>=c.supportDwellMs){
    const wasActive=this.phase!=='not_ready';this.resetMotion();this.lastRep=null;this.requireReentryStable=true;
    if(wasActive)events.push({type:'attempt.interrupted',t:t/1000,reason:'support_posture'});
   }
   this.previousHolding=false;this.previousValid=false;
  }else this.supportSince=null;
  const usable=!!ready(m)&&!supportLike,items=Object.fromEntries([...KEYS,...UNSUPPORTED].map(k=>[k,UNSUPPORTED.includes(k)?'not_supported':usable?'pending_feedback':'tracking_unavailable'])),codes=[];
  if(usable){
   if(this.previousValid&&dt<=c.maxGapMs)this.observedSeconds+=dt/1000;
   this.lostSince=null;this.readySince??=t;
   const previous=this.smoothed,alpha=dt>0?1-Math.exp(-dt/c.smoothingMs):1;
   this.smoothed=previous===null?m.extensionDeg:previous+alpha*(m.extensionDeg-previous);
   const tempoLive=this.tempoTracker.push({t,elevation:this.smoothed}),speed=tempoLive.angularVelocityDegS;
   const length=(a,b)=>a&&b?Math.hypot(a[0]-b[0],a[1]-b[1])/m.torsoLengthPx:null;
   const upper=length(m.points.s,m.points.e),fore=length(m.points.e,m.points.w);
   const armReliable=m.armBodyDeg>=60&&[upper,fore].every(x=>x!==null&&x>=c.armMinSegmentRatio&&x<=c.armMaxSegmentRatio)&&fore/upper<=3.5;
   m={...m,upperArmRatio:upper,forearmRatio:fore,armMeasurementIssue:armReliable?null:'arm_geometry_unresolved',elbowDeg:armReliable?m.elbowDeg:null};
   const sample={t,elevation:this.smoothed,kneeDeg:m.kneeDeg,elbowDeg:m.elbowDeg};
   this.armSamples.push(sample);while(this.armSamples.length&&t-this.armSamples[0].t>c.maxRepMs)this.armSamples.shift();
   if(this.phase==='not_ready'){
    this.baselineSamples.push(sample);
    while(this.baselineSamples.length>1&&this.baselineSamples[1].t<=t-c.baselineWindowMs)this.baselineSamples.shift();
   }
   const baselineStable=this.baselineSamples.length>1&&t-this.baselineSamples[0].t>=c.baselineWindowMs&&Math.max(...this.baselineSamples.map(x=>x.elevation))-Math.min(...this.baselineSamples.map(x=>x.elevation))<=c.baselineRangeDeg;
   if(t-this.readySince>=c.readyMs&&(this.phase!=='not_ready'||!this.requireReentryStable||(baselineStable&&armReady(m)))){
    if(this.phase==='not_ready'){this.phase='ready';this.low=sample;this.samples=[sample];this.requireReentryStable=false;}
    else if(this.phase==='ready'){
     if(sample.elevation<=this.low.elevation||t-this.low.t>c.maxRepMs){this.low=sample;this.samples=[sample];}else this.samples.push(sample);
     if(sample.elevation-this.low.elevation>=c.minExcursionDeg){this.phase='raising';this.peak=sample;}
    }else{
     this.samples.push(sample);
     if(sample.elevation>this.peak.elevation){this.peak=sample;this.phase='raising';}
     if(this.peak.elevation-sample.elevation>=c.reversalDeg)this.phase='lowering';
     if(t-this.low.t>c.maxRepMs){events.push({type:'attempt.interrupted',t:t/1000,reason:'timeout'});this.resetMotion();}
     else if(this.phase==='lowering'&&sample.elevation<=this.low.elevation+Math.max(c.returnToleranceDeg,c.returnFraction*(this.peak.elevation-this.low.elevation))){
      if(t-this.low.t>=c.minRepMs){
       const raised=this.samples.filter(x=>x.elevation>=this.low.elevation+c.minExcursionDeg*.6);
       const enough=a=>a.length>=3&&a.at(-1).t-a[0].t>=c.warningDwellMs;
       const status=(field,min)=>{
        if(field!=='elbowDeg'){const a=raised.filter(x=>Number.isFinite(x[field]));if(!enough(a)||a.length<raised.length*.6)return 'unknown';let since=null,prev=null,longest=0;for(const x of raised){if(!Number.isFinite(x[field])||x[field]>=min){since=null;}else{since??=prev?.t??x.t;longest=Math.max(longest,x.t-since);}prev=x;}return longest>=(field==='elbowDeg'?c.armDwellMs:c.warningDwellMs)?'warning':'within_reference';}

        // Arm bending anywhere in a completed attempt is relevant; raised-only
        // assessment hides bends near the lower position. Missing data cannot
        // erase observed sustained warning evidence or imply compliance.
        const window=field==='elbowDeg'?this.armSamples:raised;
        const a=window.filter(x=>Number.isFinite(x[field]));
        let since=null,prev=null,longest=0;
        for(const x of window){
         if(!Number.isFinite(x[field])||x[field]>=min)since=null;
         else {since??=prev&&Number.isFinite(prev[field])&&prev[field]<min?prev.t:x.t;longest=Math.max(longest,x.t-since);}
         prev=x;
        }
        if(longest>=(field==='elbowDeg'?c.armDwellMs:c.warningDwellMs))return 'warning';
        return enough(a)&&a.length>=window.length*.6?'within_reference':'unknown';
       };
       const tempo=measureTempo(this.samples);tempo.method='projected_superman_extension_velocity_v1';
       const duration=t-this.low.t,fast=duration<c.fastCycleMs;
       const repItems={knee_extension:status('kneeDeg',c.kneeMinDeg),arm_extension:status('elbowDeg',c.elbowMinDeg),movement_control:fast?'warning':'within_reference'};
       const rep={number:++this.count,timestampMs:t,items:repItems,codes:KEYS.filter(k=>repItems[k]==='warning').map(k=>CODES[k]),metrics:{startMs:this.low.t,endMs:t,peakMs:this.peak.t,durationMs:duration,
        excursionDeg:this.peak.elevation-this.low.elevation,peakExtensionDeg:this.peak.elevation,raisedKneeDeg:median(raised.map(x=>x.kneeDeg).filter(Number.isFinite)),raisedElbowDeg:median(raised.map(x=>x.elbowDeg).filter(Number.isFinite)),side:this.side,tempo}};
       this.repetitions.push(rep);this.lastRep=rep;for(const k of KEYS)this.totals[k][repItems[k]==='warning'?'warning':repItems[k]==='within_reference'?'compliant':'unknown']++;
       events.push({type:'rep.completed',t:t/1000,rep:this.count,start_s:this.low.t/1000,end_s:t/1000},{type:'rep.feedback',t:t/1000,rep:this.count,items:rep.items,codes:rep.codes,metrics:rep.metrics});
      }
      this.phase='ready';this.low=sample;this.peak=null;this.samples=[sample];this.armSamples=[sample];this.warningSince={};
     }
    }
   }
   const active=this.peak&&this.low&&sample.elevation>=this.low.elevation+c.minExcursionDeg*.6;
   const confirmedHolding=!!active&&tempoLive.state==='still';
   if(confirmedHolding&&this.previousHolding&&dt<=c.maxGapMs)this.holdSeconds+=dt/1000;
   this.previousHolding=confirmedHolding;
   if(this.phase!=='not_ready')for(const [key,field,min]of [['knee_extension','kneeDeg',c.kneeMinDeg],['arm_extension','elbowDeg',c.elbowMinDeg]]){
    if(key==='knee_extension'&&!active){delete this.warningSince[key];continue;}
    if(m[field]===null){items[key]='tracking_unavailable';delete this.warningSince[key];continue;}
    const bad=m[field]<min;if(bad)this.warningSince[key]??=t;else delete this.warningSince[key];
    const warning=bad&&t-this.warningSince[key]>=(key==='arm_extension'?c.armDwellMs:c.warningDwellMs);items[key]=warning?'warning':bad?'pending_feedback':'within_reference';if(warning)codes.push(CODES[key]);
   }else this.warningSince={};
   m={...m,smoothedExtensionDeg:this.smoothed,extensionSpeedDegS:speed,holding:confirmedHolding,tempo:tempoLive};this.previousValid=true;
  }else this.previousValid=false;
  m=m?{...m,activityStatus:supportLike?'support_or_exit':!m.bodyReady?'not_prone':usable&&this.phase!=='not_ready'?'exercise_posture':'preparing'}:null;
  const r=frameResult({tracking:usable?'tracking':'tracking_unavailable',side:this.side,count:this.count,holdSeconds:this.holdSeconds,observedSeconds:this.observedSeconds,movementPhase:supportLike?'not_ready':this.phase,items,codes,metrics:m??{},events},frame,{exercise:'superman',engineVersion:SUPERMAN_VERSION});
  r.lastRepetition=this.lastRep&&t-this.lastRep.timestampMs<=c.feedbackMs?this.lastRep:null;r.codes=[...new Set([...codes,...(r.lastRepetition?.codes??[])])];return jsonSafe(r);
 }
 summary(){return setSummary({exercise:'superman',engineVersion:SUPERMAN_VERSION,count:this.count,holdSeconds:this.holdSeconds,observedSeconds:this.observedSeconds,gapSeconds:this.gapSeconds,
  items:Object.fromEntries(KEYS.map(k=>[k,itemResult('repetition',this.totals[k].compliant,this.totals[k].warning,this.totals[k].unknown)])),
  details:{repetitions:this.repetitions,configuration:this.config,protocol:'prone_bilateral_superman_side_or_oblique',holdBasis:'observed_raised_still_after_detected_ascent',unsupportedItems:UNSUPPORTED}});}
 finish(){if(this.closed)return [];this.closed=true;return [setCompleted(this.summary(),this.lastTime)];}
}
