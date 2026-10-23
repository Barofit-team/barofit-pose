import {validateFrame,jsonSafe} from '../common/frame.js';
import {frameResult} from '../common/realtime.js';
import {itemResult,setSummary,setCompleted} from '../common/result.js';
import {TempoTracker,measureTempo,TEMPO_CONFIG} from './tempo.js';

export const LEG_RAISE_VERSION='leg-raise-0.1.1';
// Side-view, supine, double STRAIGHT leg raise. Numerical tolerances are engineering values.
export const LEG_RAISE_CONFIG=Object.freeze({visibility:.5,maxGapMs:300,sideLossMs:300,
  readyMs:250,torsoTiltDeg:35,smoothingMs:100,minExcursionDeg:25,reversalDeg:8,
  returnToleranceDeg:12,minRepMs:650,maxRepMs:15000,kneeMinDeg:155,kneeDwellMs:250,
  fastLowerMs:1100,fastLowerSpeedDegS:80,feedbackMs:1800});
const KEYS=['knee_extension','lowering_control','lumbar_contact'];
const CODES={knee_extension:'KNEE_BENT',lowering_control:'LOWERING_FAST'};
const angle=(a,b,c)=>{
  const u=[a[0]-b[0],a[1]-b[1]],v=[c[0]-b[0],c[1]-b[1]],d=Math.hypot(...u)*Math.hypot(...v);
  return d>1e-6?Math.acos(Math.max(-1,Math.min(1,(u[0]*v[0]+u[1]*v[1])/d)))*180/Math.PI:null;
};
export function legRaiseMetrics(frame,side,config=LEG_RAISE_CONFIG){
  const ids=side==='left'?[11,23,25,27]:[12,24,26,28];
  const raw=ids.map(i=>frame.landmarks[i]);
  if(raw.some(p=>!p||![p[0],p[1],p[3],p[4]].every(Number.isFinite)||p[3]<config.visibility||p[4]<config.visibility||p[0]<0||p[0]>1||p[1]<0||p[1]>1))return null;
  const [s,h,k,a]=raw.map(p=>[p[0]*frame.width,p[1]*frame.height]);
  const torsoLengthPx=Math.hypot(s[0]-h[0],s[1]-h[1]);
  if(torsoLengthPx<25)return null;
  const torsoTiltDeg=Math.atan2(Math.abs(s[1]-h[1]),Math.abs(s[0]-h[0]))*180/Math.PI;
  const kneeDeg=angle(h,k,a),hipDeg=angle(s,h,k);
  if(kneeDeg===null||hipDeg===null)return null;
  // Groundward leg lowering is measured relative to the torso; no lumbar curvature inference.
  const legElevationDeg=180-hipDeg;
  return {kneeDeg,legElevationDeg,torsoTiltDeg,torsoLengthPx,
    quality:Math.min(...raw.flatMap(p=>[p[3],p[4]])),bodyReady:torsoTiltDeg<=config.torsoTiltDeg,
    landmarkIds:ids};
}

export class LegRaiseAnalyzer {
  constructor(config={}){
    this.tempoTracker=new TempoTracker();
    this.config={...LEG_RAISE_CONFIG,...config};this.closed=false;this.lastTime=null;this.side=null;
    this.count=0;this.observedSeconds=0;this.gapSeconds=0;this.repetitions=[];this.lastRep=null;
    this.totals=Object.fromEntries(KEYS.map(k=>[k,{compliant:0,warning:0,unknown:0}]));this.resetMotion();
  }
  resetMotion(){this.phase='not_ready';this.readySince=null;this.low=null;this.peak=null;this.samples=[];this.smoothed=null;this.previousValid=false;this.lostSince=null;this.kneeSince=null;this.tempoTracker.reset();}
  breakContinuity(reason='pause'){
    this.resetMotion();this.side=null;this.lastRep=null;
    return [{type:'tracking.interrupted',t:this.lastTime===null?null:this.lastTime/1000,reason}];
  }
  pushFrame(frame){
    validateFrame(frame);const t=frame.timestampMs,c=this.config;
    const ignoredReason=this.closed?'finished':this.lastTime!==null&&t<=this.lastTime?'non_monotonic_timestamp':null;
    if(ignoredReason)return frameResult({count:this.count,observedSeconds:this.observedSeconds},frame,{exercise:'leg_raise',engineVersion:LEG_RAISE_VERSION,ignoredReason});
    const events=[],dt=this.lastTime===null?0:t-this.lastTime;
    if(dt>c.maxGapMs){this.gapSeconds+=dt/1000;this.resetMotion();this.lastRep=null;events.push({type:'frame.gap',t:t/1000,gap_s:dt/1000});}
    this.lastTime=t;
    const sides={left:legRaiseMetrics(frame,'left',c),right:legRaiseMetrics(frame,'right',c)};
    if(!this.side){this.side=Object.keys(sides).filter(k=>sides[k]?.bodyReady).sort((a,b)=>sides[b].quality-sides[a].quality)[0]??null;}
    let m=this.side?sides[this.side]:null;
    if(!m?.bodyReady){
      const lost=this.lostSince??t;
      this.resetMotion();this.lostSince=lost;this.lastRep=null;
      if(t-lost>=c.sideLossMs){
        const other=this.side==='left'?'right':'left';
        if(sides[other]?.bodyReady){this.side=other;m=sides[other];this.resetMotion();events.push({type:'tracking.side_changed',t:t/1000,side:other});}
      }
    }
    const usable=!!m?.bodyReady;
    const items={knee_extension:usable?'pending_feedback':'tracking_unavailable',lowering_control:usable?'pending_feedback':'tracking_unavailable',lumbar_contact:'not_supported'};
    const currentCodes=[];
    if(usable){
      if(this.previousValid&&dt<=c.maxGapMs)this.observedSeconds+=dt/1000;
      this.lostSince=null;this.readySince??=t;
      const alpha=dt>0?1-Math.exp(-dt/c.smoothingMs):1;
      this.smoothed=this.smoothed===null?m.legElevationDeg:this.smoothed+alpha*(m.legElevationDeg-this.smoothed);
      m={...m,smoothedElevationDeg:this.smoothed};
      if(m.kneeDeg<c.kneeMinDeg)this.kneeSince??=t;else this.kneeSince=null;
      const kneeWarning=this.kneeSince!==null&&t-this.kneeSince>=c.kneeDwellMs;
      const sample={t,elevation:this.smoothed,kneeDeg:m.kneeDeg,kneeWarning};
      this.tempoTracker.push(sample);
      if(t-this.readySince>=c.readyMs){
        items.knee_extension=kneeWarning?'warning':'within_reference';
        if(kneeWarning)currentCodes.push(CODES.knee_extension);
        if(this.phase==='not_ready'){this.phase='ready';this.low=sample;this.samples=[sample];}
        else if(this.phase==='ready'){
          if(sample.elevation<=this.low.elevation||t-this.low.t>c.maxRepMs){this.low=sample;this.samples=[sample];}
          else this.samples.push(sample);
          if(sample.elevation-this.low.elevation>=c.minExcursionDeg){this.phase='raising';this.peak=sample;}
        }else{
          this.samples.push(sample);
          if(sample.elevation>this.peak.elevation){this.peak=sample;this.phase='raising';}
          if(this.peak.elevation-sample.elevation>=c.reversalDeg)this.phase='lowering';
          if(t-this.low.t>c.maxRepMs){events.push({type:'attempt.interrupted',t:t/1000,reason:'timeout'});this.resetMotion();}
          else if(this.phase==='lowering'&&sample.elevation<=this.low.elevation+c.returnToleranceDeg){
            if(t-this.low.t>=c.minRepMs){
              const duration=t-this.peak.t,span=this.peak.elevation-sample.elevation;
              const fast=duration<c.fastLowerMs&&span/(duration/1000)>c.fastLowerSpeedDegS;
              const repItems={knee_extension:this.samples.some(x=>x.kneeWarning)?'warning':'within_reference',lowering_control:fast?'warning':'within_reference',lumbar_contact:'not_supported'};
              const rep={number:++this.count,timestampMs:t,items:repItems,codes:Object.keys(CODES).filter(k=>repItems[k]==='warning').map(k=>CODES[k]),
                metrics:{startMs:this.low.t,peakMs:this.peak.t,endMs:t,durationMs:t-this.low.t,loweringDurationMs:duration,loweringSpeedDegS:span/(duration/1000),
                  startElevationDeg:this.low.elevation,peakElevationDeg:this.peak.elevation,returnElevationDeg:sample.elevation,minKneeDeg:Math.min(...this.samples.map(x=>x.kneeDeg)),side:this.side,tempo:measureTempo(this.samples)}};
              this.repetitions.push(rep);this.lastRep=rep;
              for(const k of KEYS)this.totals[k][repItems[k]==='warning'?'warning':repItems[k]==='within_reference'?'compliant':'unknown']++;
              events.push({type:'rep.completed',t:t/1000,rep:this.count,start_s:this.low.t/1000,end_s:t/1000},
                {type:'rep.feedback',t:t/1000,rep:this.count,items:rep.items,codes:rep.codes,metrics:rep.metrics});
            }
            this.phase='ready';this.low=sample;this.samples=[sample];this.peak=null;
          }
        }
      }
      this.previousValid=true;
      m={...m,tempo:this.tempoTracker.value};
    }else{this.previousValid=false;}
    const r=frameResult({tracking:usable?'tracking':'tracking_unavailable',side:this.side,count:this.count,holdSeconds:null,observedSeconds:this.observedSeconds,
      movementPhase:this.phase,items,codes:currentCodes,metrics:m??{},events},frame,{exercise:'leg_raise',engineVersion:LEG_RAISE_VERSION});
    r.lastRepetition=this.lastRep&&t-this.lastRep.timestampMs<=c.feedbackMs?this.lastRep:null;
    r.codes=[...new Set([...currentCodes,...(r.lastRepetition?.codes??[])])];return jsonSafe(r);
  }
  summary(){return setSummary({exercise:'leg_raise',engineVersion:LEG_RAISE_VERSION,count:this.count,observedSeconds:this.observedSeconds,gapSeconds:this.gapSeconds,
    items:Object.fromEntries(KEYS.map(k=>[k,itemResult('repetition',this.totals[k].compliant,this.totals[k].warning,this.totals[k].unknown)])),
    details:{repetitions:this.repetitions,configuration:this.config,protocol:'supine_double_straight_leg_raise',unsupportedItems:['lumbar_contact'],tempoConfiguration:TEMPO_CONFIG}});}
  finish(){if(this.closed)return [];this.closed=true;return [setCompleted(this.summary(),this.lastTime)];}
}
