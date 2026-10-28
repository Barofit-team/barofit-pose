import {validateFrame,jsonSafe} from '../common/frame.js';
import {frameResult} from '../common/realtime.js';
import {itemResult,setSummary,setCompleted} from '../common/result.js';
import {pikeMetrics} from './metrics.js';
import {PATH_CONFIG,assessPath} from './assessment.js';

export const PIKE_PUSHUP_VERSION='pike-pushup-0.2.0';
// Projected side-view engineering limits, NOT clinical/normative cutoffs.
export const PIKE_PUSHUP_CONFIG=Object.freeze({...PATH_CONFIG,visibility:.5,maxGapMs:300,sideLossMs:300,readyMs:100,
 smoothingMs:80,entryElbowDeg:145,minExcursionDeg:20,reversalDeg:5,returnToleranceDeg:12,minRepMs:600,maxRepMs:20000,
 hipMaxDeg:112,headForwardMin:.15,headAssessmentElbowMaxDeg:140,returnOverheadMinDeg:105,
 warningDwellMs:200,feedbackMs:2200});
const KEYS=['pike_shape','head_path','press_return'];
export const PIKE_PUSHUP_TEXT={PIKE_HIPS_LOW:'엉덩이를 높여 역V 자세를 유지하세요.',HEAD_PATH_BACK:'머리를 손 사이로 곧장 내리지 말고 손보다 앞쪽으로 내려보세요.',PRESS_OUT:'가슴을 앞으로 밀지 말고 위로 밀어 역V 자세로 돌아오세요.'};
const CODES={pike_shape:'PIKE_HIPS_LOW',head_path:'HEAD_PATH_BACK',press_return:'PRESS_OUT'};
const UNSUPPORTED=['lumbar_neutral','elbow_flare','toe_loading'];
const med=a=>{a=a.filter(Number.isFinite).sort((a,b)=>a-b);return a.length?a[Math.floor(a.length/2)]:null;};
function sustained(rows,predicate,dwell){let since=null;for(const x of rows){if(predicate(x)){since??=x.t;if(x.t-since>=dwell)return true;}else since=null;}return false;}
export class PikePushupAnalyzer{
 constructor(config={}){this.config={...PIKE_PUSHUP_CONFIG,...config};this.closed=false;this.lastTime=null;this.side=null;this.lostSince=null;this.count=0;this.observedSeconds=0;this.gapSeconds=0;this.lastRep=null;this.pendingAssessment=null;this.repetitions=[];this.totals=Object.fromEntries(KEYS.map(k=>[k,{compliant:0,warning:0,unknown:0}]));this.resetMotion();}
 resetMotion(){this.phase='not_ready';this.readySince=null;this.top=null;this.bottom=null;this.samples=[];this.smoothed=null;this.previousValid=false;this.warningSince={};this.referenceOverhead=null;}
 pressOut(overhead){return overhead<this.config.returnOverheadMinDeg;}
 breakContinuity(reason='pause'){this.finalizeAssessment([],false);this.resetMotion();this.side=null;this.lostSince=null;this.lastRep=null;return [{type:'tracking.interrupted',t:this.lastTime===null?null:this.lastTime/1000,reason}];}
 complete(sample,events){
  const c=this.config,rows=this.samples,bottomRows=rows.filter(x=>x.elbowDeg<=this.bottom.elbowDeg+12),topRows=rows.filter(x=>x.t>=this.bottom.t&&x.elbowDeg>=sample.elbowDeg-5);
  const head=med(bottomRows.map(x=>x.headForward)),overhead=med(topRows.map(x=>x.overheadDeg));
  this.finalizeAssessment(events,true);
  const assessment=assessPath(rows,this.top,this.bottom,c),items=assessment.items;
  const rep={number:++this.count,timestampMs:sample.t,items,codes:KEYS.filter(k=>items[k]==='warning').map(k=>CODES[k]),metrics:{side:this.side,startMs:this.top.t,bottomMs:this.bottom.t,endMs:sample.t,
   durationMs:sample.t-this.top.t,descentSeconds:(this.bottom.t-this.top.t)/1000,ascentSeconds:(sample.t-this.bottom.t)/1000,
   tempoBasis:'phase_elapsed_including_pauses',elbowExcursionDeg:this.top.elbowDeg-this.bottom.elbowDeg,minElbowDeg:this.bottom.elbowDeg,maxHipDeg:Math.max(...rows.map(x=>x.hipDeg)),bottomHeadForward:head,returnOverheadDeg:overhead,referenceOverheadDeg:this.referenceOverhead,...assessment.metrics}};
  this.repetitions.push(rep);this.lastRep=rep;for(const k of KEYS)this.totals[k][items[k]==='warning'?'warning':items[k]==='within_reference'?'compliant':'unknown']++;
  events.push({type:'rep.completed',t:sample.t/1000,rep:this.count,start_s:this.top.t/1000,end_s:sample.t/1000});
  this.pendingAssessment={rep,rows:[...rows],top:this.top,bottom:this.bottom,countTime:sample.t,peakElbow:sample.elbowDeg};
  this.phase='ready';this.top=sample;this.bottom=null;this.samples=[sample];this.warningSince={};
 }
 finalizeAssessment(events=[],settled=true){
  const p=this.pendingAssessment;if(!p)return;
  const a=assessPath(p.rows,p.top,p.bottom,this.config,{settled});
  if(!settled){a.metrics.pathAssessmentInterrupted=true;if(a.metrics.pressReturnAssessmentReason==='awaiting_return')a.metrics.pressReturnAssessmentReason='tracking_interrupted_before_return_confirmation';}
  for(const k of KEYS){const bucket=x=>x==='warning'?'warning':x==='within_reference'?'compliant':'unknown';this.totals[k][bucket(p.rep.items[k])]--;this.totals[k][bucket(a.items[k])]++;}
  p.rep.items=a.items;p.rep.codes=KEYS.filter(k=>a.items[k]==='warning').map(k=>CODES[k]);Object.assign(p.rep.metrics,a.metrics);
  events.push({type:'rep.feedback',t:(p.rows.at(-1)?.t??p.countTime)/1000,rep:p.rep.number,items:p.rep.items,codes:p.rep.codes,metrics:p.rep.metrics});
  this.pendingAssessment=null;
 }
 extendAssessment(s,events){
  const p=this.pendingAssessment;if(!p)return;
  if(p.peakElbow-s.elbowDeg>this.config.settleReversalDeg||s.t-p.countTime>this.config.feedbackSettleMs){this.finalizeAssessment(events,true);return;}
  p.rows.push(s);p.peakElbow=Math.max(p.peakElbow,s.elbowDeg);
  if(s.t-p.countTime>=this.config.feedbackSettleMs)this.finalizeAssessment(events,true);
 }
 pushFrame(frame){
  validateFrame(frame);const t=frame.timestampMs,c=this.config;
  const ignoredReason=this.closed?'finished':this.lastTime!==null&&t<=this.lastTime?'non_monotonic_timestamp':null;
  if(ignoredReason)return frameResult({count:this.count,observedSeconds:this.observedSeconds},frame,{exercise:'pike_pushup',engineVersion:PIKE_PUSHUP_VERSION,ignoredReason});
  const dt=this.lastTime===null?0:t-this.lastTime,events=[];
  if(dt>c.maxGapMs){this.finalizeAssessment(events,false);this.gapSeconds+=dt/1000;this.resetMotion();this.lastRep=null;events.push({type:'frame.gap',t:t/1000,gap_s:dt/1000});}
  this.lastTime=t;
  const sides={left:pikeMetrics(frame,'left',c.visibility),right:pikeMetrics(frame,'right',c.visibility)};
  if(!this.side)this.side=Object.keys(sides).filter(k=>sides[k]?.bodyReady).sort((a,b)=>sides[b].quality-sides[a].quality)[0]??null;
  let m=sides[this.side];
  if(!m?.bodyReady){this.finalizeAssessment(events,false);this.lostSince??=t;this.resetMotion();this.lastRep=null;const other=this.side==='left'?'right':'left';
   if(t-this.lostSince>=c.sideLossMs&&sides[other]?.bodyReady){this.side=other;m=sides[other];this.resetMotion();this.lostSince=null;events.push({type:'tracking.side_changed',t:t/1000,side:other});}}
  const usable=!!m?.bodyReady,items=Object.fromEntries(KEYS.map(k=>[k,usable?'pending_feedback':'tracking_unavailable']));
  for(const k of UNSUPPORTED)items[k]='not_supported';const codes=[];
  if(usable){
   this.lostSince=null;if(this.previousValid&&dt<=c.maxGapMs)this.observedSeconds+=dt/1000;this.previousValid=true;
   const alpha=dt?1-Math.exp(-dt/c.smoothingMs):1;this.smoothed=this.smoothed===null?m.elbowDeg:this.smoothed+alpha*(m.elbowDeg-this.smoothed);
   const s={...m,t,elbowDeg:this.smoothed};
   this.extendAssessment(s,events);
   if((this.phase==='not_ready'||this.phase==='ready')&&s.elbowDeg>=c.entryElbowDeg)this.referenceOverhead=Math.max(this.referenceOverhead??0,m.overheadDeg);
   if(this.phase==='not_ready'){
    if(s.elbowDeg>=c.entryElbowDeg){this.readySince??=t;if(t-this.readySince>=c.readyMs){this.phase='ready';this.top=s;this.samples=[s];}}
    else this.readySince=null;
   }else if(this.phase==='ready'){
    if(s.elbowDeg>=this.top.elbowDeg||t-this.top.t>c.maxRepMs){this.top=s;this.samples=[s];}else this.samples.push(s);
    if(this.top.elbowDeg-s.elbowDeg>=c.minExcursionDeg){this.phase='descending';this.bottom=s;}
   }else{
    this.samples.push(s);if(s.elbowDeg<this.bottom.elbowDeg){this.bottom=s;this.phase='descending';}
    if(s.elbowDeg-this.bottom.elbowDeg>=c.reversalDeg)this.phase='ascending';
    if(t-this.top.t>c.maxRepMs){events.push({type:'attempt.interrupted',t:t/1000,reason:'timeout'});this.resetMotion();}
    else if(this.phase==='ascending'&&s.elbowDeg>=Math.max(c.entryElbowDeg,this.top.elbowDeg-c.returnToleranceDeg)&&t-this.top.t>=c.minRepMs)this.complete(s,events);
   }
   // Current-phase path evaluation begins after the down/up reversal.
   // Hip/return confirmation waits for the independent post-count window.
   const path=this.bottom&&this.phase==='ascending'?assessPath(this.samples,this.top,this.bottom,c):null;
   if(path){m={...m,...path.metrics};for(const k of KEYS){const state=path.currentItems?.[k]??'pending_feedback';if(state==='warning'){this.warningSince[k]??=t;if(t-this.warningSince[k]>=c.warningDwellMs){items[k]='warning';codes.push(CODES[k]);}}else{delete this.warningSince[k];items[k]=state;}}}
   if(!m.points.n)items.head_path='tracking_unavailable';
   m={...m,smoothedElbowDeg:this.smoothed};
  }else this.previousValid=false;
  const r=frameResult({tracking:usable?'tracking':'tracking_unavailable',side:this.side,count:this.count,observedSeconds:this.observedSeconds,movementPhase:this.phase,items,codes,metrics:m??{},events},frame,{exercise:'pike_pushup',engineVersion:PIKE_PUSHUP_VERSION});
  r.lastRepetition=this.lastRep&&t-this.lastRep.timestampMs<=c.feedbackMs?this.lastRep:null;r.codes=[...new Set([...codes,...(r.lastRepetition?.codes??[])])];return jsonSafe(r);
 }
 summary(){return setSummary({exercise:'pike_pushup',engineVersion:PIKE_PUSHUP_VERSION,count:this.count,observedSeconds:this.observedSeconds,gapSeconds:this.gapSeconds,
  items:Object.fromEntries(KEYS.map(k=>[k,itemResult('repetition',this.totals[k].compliant,this.totals[k].warning,this.totals[k].unknown)])),
  details:{repetitions:this.repetitions,configuration:this.config,protocol:'floor_pike_pushup_side_view',unsupportedItems:UNSUPPORTED}});}
 finish(){if(this.closed)return [];this.finalizeAssessment([],true);this.closed=true;return [setCompleted(this.summary(),this.lastTime)];}
}
