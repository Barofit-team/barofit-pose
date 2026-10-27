import {validateFrame,jsonSafe} from '../common/frame.js';
import {frameResult} from '../common/realtime.js';
import {itemResult,setSummary,setCompleted} from '../common/result.js';

export const JUMPING_JACK_VERSION='jumping-jack-0.1';
// Engineering starting values, not NASM/clinical numerical cutoffs. Frontal standard jacks only.
export const JACK_CONFIG=Object.freeze({visibility:.5,maxGapMs:250,armPeakDeg:145,
  legPeakWidth:1.15,legReturnWidth:.9,armReturnDeg:40,excursion:.35,
  reversal:.18,minRepMs:350,maxRepMs:5000,syncFraction:.20,syncFloorMs:100,
  torsoLeanDeg:15,leanDwellMs:250,feedbackMs:1600,minSyncCorrelation:.2});
const KEYS=['arm_raise','leg_open','coordination','return','torso'];
const CODES={arm_raise:'ARMS_LOW',leg_open:'LEGS_NARROW',coordination:'ARMS_LEGS_ASYNC',return:'RETURN_INCOMPLETE',torso:'TORSO_LEAN'};
const avg=(a,b)=>a.map((v,i)=>(v+b[i])/2);
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
function angle(a,b,c){const u=[a[0]-b[0],a[1]-b[1]],v=[c[0]-b[0],c[1]-b[1]];
  return Math.acos(Math.max(-1,Math.min(1,(u[0]*v[0]+u[1]*v[1])/(Math.hypot(...u)*Math.hypot(...v)))))*180/Math.PI;}
export function jackMetrics(frame,config=JACK_CONFIG){
  const p=frame.landmarks;
  const point=i=>{const a=p[i];return a&&[a[0],a[1],a[3],a[4]].every(Number.isFinite)&&
    a[3]>=config.visibility&&a[4]>=config.visibility&&a[0]>=.01&&a[0]<=.99&&a[1]>=.01&&a[1]<=.99?[a[0]*frame.width,a[1]*frame.height]:null;};
  const q=Object.fromEntries([11,12,15,16,23,24,27,28].map(i=>[i,point(i)]));
  if(![11,12,23,24,27,28].every(i=>q[i]))return null;
  const s=avg(q[11],q[12]),h=avg(q[23],q[24]),sw=distance(q[11],q[12]),L=distance(s,h);
  if(L<20||sw/L<.40||s[1]>=h[1]||h[1]>=Math.min(q[27][1],q[28][1]))return null;
  const left=q[15]?angle(q[23],q[11],q[15]):null,right=q[16]?angle(q[24],q[12],q[16]):null;
  return {legWidth:Math.abs(q[27][0]-q[28][0])/sw,armLeftDeg:left,armRightDeg:right,
    armMinDeg:left!==null&&right!==null?Math.min(left,right):null,
    armMaxDeg:left!==null&&right!==null?Math.max(left,right):null,
    torsoLeanDeg:Math.atan2(Math.abs(h[0]-s[0]),h[1]-s[1])*180/Math.PI,
    shoulderWidthPx:sw,torsoLengthPx:L};
}

/** Same public lifecycle and v2 envelope as the existing analyzers. Count is independent of quality. */
export class JumpingJackAnalyzer {
  constructor(config={}){this.config={...JACK_CONFIG,...config};this.closed=false;this.lastTime=null;
    this.count=0;this.observedSeconds=0;this.gapSeconds=0;this.repetitions=[];this.lastRep=null;
    this.totals=Object.fromEntries(KEYS.map(k=>[k,{compliant:0,warning:0,unknown:0}]));this.resetMotion();}
  resetMotion(){this.phase='not_ready';this.low=null;this.samples=[];this.peak=null;this.trough=null;this.previousMetric=null;this.leanSince=null;}
  breakContinuity(reason='pause'){this.resetMotion();this.lastRep=null;return [{type:'tracking.interrupted',t:this.lastTime===null?null:this.lastTime/1000,reason}];}
  pushFrame(frame){
    validateFrame(frame);const t=frame.timestampMs,c=this.config;
    const reason=this.closed?'finished':this.lastTime!==null&&t<=this.lastTime?'non_monotonic_timestamp':null;
    if(reason)return frameResult({count:this.count,observedSeconds:this.observedSeconds},frame,{exercise:'jumping_jack',engineVersion:JUMPING_JACK_VERSION,ignoredReason:reason});
    const events=[];let m=jackMetrics(frame,c);
    if(this.lastTime!==null){const dt=t-this.lastTime;if(dt>c.maxGapMs){this.gapSeconds+=dt/1000;this.resetMotion();this.lastRep=null;events.push({type:'frame.gap',t:t/1000,gap_s:dt/1000});}
      else if(m&&this.previousMetric)this.observedSeconds+=dt/1000;}
    this.lastTime=t;
    const items=Object.fromEntries(KEYS.map(k=>[k,m?'pending_feedback':'tracking_unavailable']));
    const currentCodes=[];
    if(!m){if(this.phase!=='not_ready')events.push({type:'tracking.interrupted',t:t/1000,reason:'required_landmarks'});this.resetMotion();this.lastRep=null;}
    else{
      if(m.armMinDeg===null)items.arm_raise=items.coordination=items.return='tracking_unavailable';
      if(m.torsoLeanDeg>c.torsoLeanDeg){this.leanSince??=t;items.torso=t-this.leanSince>=c.leanDwellMs?'warning':'pending_feedback';}
      else {this.leanSince=null;items.torso='within_reference';}
      if(items.torso==='warning')currentCodes.push(CODES.torso);
      const sample={t,...m,torsoWarning:items.torso==='warning'};
      if(this.phase==='not_ready'){
        // Track a local low; a clip beginning open must close and then open again.
        this.phase='closed';this.low=sample;this.samples=[sample];
      } else if(this.phase==='closed'){
        if(m.legWidth<=this.low.legWidth){this.low=sample;this.samples=[sample];}
        else this.samples.push(sample);
        if(t-this.low.t>c.maxRepMs){this.low=sample;this.samples=[sample];}
        if(m.legWidth-this.low.legWidth>=c.excursion){this.phase='opening';this.peak=sample;}
      }else{
        this.samples.push(sample);if(m.legWidth>this.peak.legWidth)this.peak=sample;
        if(this.peak.legWidth-m.legWidth>=c.reversal){this.phase='closing';
          if(!this.trough||m.legWidth<this.trough.legWidth)this.trough=sample;}
        if(t-this.low.t>c.maxRepMs){events.push({type:'attempt.interrupted',t:t/1000,reason:'timeout'});this.resetMotion();}
        else if(this.phase==='closing'&&this.peak.legWidth-this.trough.legWidth>=c.excursion&&
          (m.legWidth-this.trough.legWidth>=c.reversal||t-this.trough.t>=150)){
          if(this.trough.t-this.low.t>=c.minRepMs){const rep=this.rate(this.trough);this.count++;rep.number=this.count;rep.timestampMs=t;this.lastRep=rep;this.repetitions.push(rep);
            for(const k of KEYS)this.totals[k][rep.items[k]==='warning'?'warning':rep.items[k]==='within_reference'?'compliant':'unknown']++;
            events.push({type:'rep.completed',t:t/1000,rep:this.count,start_s:this.low.t/1000,end_s:this.trough.t/1000},
              {type:'rep.feedback',t:t/1000,rep:this.count,items:rep.items,codes:rep.codes,metrics:rep.metrics});}
          this.phase='closed';this.low=this.trough;this.samples=this.samples.filter(x=>x.t>=this.low.t);this.peak=null;this.trough=null;
        }
      }
      this.previousMetric=m;
    }
    const last=this.lastRep&&t-this.lastRep.timestampMs<=c.feedbackMs?this.lastRep:null;
    const r=frameResult({tracking:m?'tracking':'tracking_unavailable',side:null,count:this.count,
      holdSeconds:null,observedSeconds:this.observedSeconds,movementPhase:this.phase,items,
      codes:currentCodes,metrics:m??{},events},frame,{exercise:'jumping_jack',engineVersion:JUMPING_JACK_VERSION});
    r.lastRepetition=last;r.codes=[...new Set([...currentCodes,...(last?.codes??[])])];return jsonSafe(r);
  }
  rate(end){
    const c=this.config,s=this.samples.filter(x=>x.t<=end.t),valid=s.filter(x=>x.armMinDeg!==null),coverage=valid.length/s.length;
    const legMax=this.peak.legWidth,armMax=valid.length?Math.max(...valid.map(x=>x.armMinDeg)):null;
    const duration=end.t-this.low.t,tolerance=Math.max(c.syncFloorMs,duration*c.syncFraction);
    // Compare near-peak plateaus, not a noisy single maximum sample.
    const legs=s.filter(x=>x.legWidth>=legMax-.12);
    const arms=valid.filter(x=>x.armMinDeg>=armMax-10);
    const delta=legs.length&&arms.length?Math.min(...legs.flatMap(l=>arms.map(a=>Math.abs(l.t-a.t)))):null;
    const reliableArms=coverage>=.8&&valid.some(x=>Math.abs(x.t-this.peak.t)<=tolerance);
    const mean=(xs)=>xs.reduce((a,b)=>a+b,0)/xs.length;
    const ma=mean(valid.map(x=>x.armMinDeg)),ml=mean(valid.map(x=>x.legWidth));
    const cov=valid.reduce((v,x)=>v+(x.armMinDeg-ma)*(x.legWidth-ml),0);
    const den=Math.sqrt(valid.reduce((v,x)=>v+(x.armMinDeg-ma)**2,0)*valid.reduce((v,x)=>v+(x.legWidth-ml)**2,0));
    const correlation=den>1e-8?cov/den:null;
    const status=b=>b?'warning':'within_reference';
    const returnSamples=this.samples.filter(x=>Math.abs(x.t-end.t)<=120&&x.armMaxDeg!==null);
    const returnArm=returnSamples.length?Math.min(...returnSamples.map(x=>x.armMaxDeg)):null;
    const items={arm_raise:reliableArms?status(armMax<c.armPeakDeg):'unknown',
      leg_open:status(legMax<c.legPeakWidth),
      coordination:reliableArms&&armMax-Math.min(...valid.map(x=>x.armMinDeg))>=30&&correlation!==null?
        status(delta>tolerance||correlation<c.minSyncCorrelation):'unknown',
      return:returnArm!==null?status(end.legWidth>c.legReturnWidth||returnArm>c.armReturnDeg):'unknown',
      torso:status(s.some(x=>x.torsoWarning))};
    return {number:0,timestampMs:end.t,items,codes:KEYS.filter(k=>items[k]==='warning').map(k=>CODES[k]),
      metrics:{durationMs:duration,armPeakMinDeg:armMax,legPeakWidth:legMax,legReturnWidth:end.legWidth,
        armReturnMaxDeg:returnArm,syncLagMs:delta,syncToleranceMs:tolerance,armLegCorrelation:correlation,armCoverage:coverage}};
  }
  summary(){return setSummary({exercise:'jumping_jack',engineVersion:JUMPING_JACK_VERSION,count:this.count,
    observedSeconds:this.observedSeconds,gapSeconds:this.gapSeconds,
    items:Object.fromEntries(KEYS.map(k=>[k,itemResult('repetition',this.totals[k].compliant,this.totals[k].warning,this.totals[k].unknown)])),
    details:{repetitions:this.repetitions,configuration:this.config}});}
  finish(){if(this.closed)return [];this.closed=true;return [setCompleted(this.summary(),this.lastTime)];}
}
