import {jsonSafe} from './frame.js';
import {itemLabel} from './itemLabels.js';

const assessed=s=>s==='warning'||s==='within_reference';
const validCodes=codes=>[...new Set((codes??[]).filter(c=>typeof c==='string'&&/^[A-Z_]{1,50}$/.test(c)))].sort();
const percentage=(a,b)=>b>0?Math.max(0,Math.min(100,100*a/b)):null;
const score=items=>{
  const values=Object.values(items??{}).filter(i=>Number.isFinite(i.evaluated)&&i.evaluated>0)
    .map(i=>percentage(i.compliant,i.evaluated));
  return values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
};
export function normalizeRepetition(raw,index=0) {
  const number=raw.number??raw.rep??raw.index??index+1;
  if(!Number.isInteger(number)||number<1)return null;
  const items=raw.items??(raw.depth_state?{depth:raw.depth_state}:{});
  const codes=validCodes(raw.codes??(raw.depth_state==='warning'?['SQUAT_SHALLOW']:[]));
  const side=raw.side??raw.metrics?.side??null;
  return {...raw,number,timestampMs:raw.timestampMs??(Number.isFinite(raw.end_s)?raw.end_s*1000:null),
    side:['left','right'].includes(side)?side:null,items:{...items},codes,metrics:{...(raw.metrics??{})}};
}
function breakdown(reps,bins,timeBased,elapsed=0) {
  const common=(early,late,min)=>Object.keys(early).filter(k=>early[k][1]>=min-1e-9&&late[k]?.[1]>=min-1e-9);
  const mean=(totals,keys)=>keys.reduce((n,k)=>n+percentage(totals[k][0],totals[k][1]),0)/keys.length;
  const add=(to,key,good,total)=>{to[key]??=[0,0];to[key][0]+=good;to[key][1]+=total;};
  const early={},late={};
  if(timeBased) {
    const entries=[...bins.entries()];
    const end=Math.max(Math.ceil(elapsed-1e-9),entries.length?Math.max(...entries.map(([i])=>i))+1:0);
    for(const [i,items] of entries)for(const [key,[good,total]] of Object.entries(items))
      add(i<end/2?early:late,key,good,total);
  } else {
    const mid=Math.floor(reps.length/2);
    reps.forEach((r,i)=>Object.entries(r.items).forEach(([key,s])=>{
      if(assessed(s))add(i<mid?early:late,key,s==='within_reference'?1:0,1);
    }));
  }
  const minimum=timeBased?5:3,keys=common(early,late,minimum);
  const earlyScore=keys.length?mean(early,keys):null,lateScore=keys.length?mean(late,keys):null;
  const drop=earlyScore===null?null:earlyScore-lateScore;
  return {candidate:drop===null?null:drop>=15,earlyScore,lateScore,dropPoints:drop,
    thresholdPoints:15,comparisonBasis:timeBased?'evaluated_time_halves':'repetition_halves',
    minimumEvaluatedPerItem:minimum,unit:timeBased?'seconds':'repetitions',itemIds:keys,
    reason:keys.length?'compared':'insufficient_evaluated_data'};
}
export function reportDetails(summary,monitor=null) {
  const legacy=summary.details??{};
  const map=new Map();
  for(const [i,r] of (legacy.repetitions??legacy.reps??[]).entries()){
    const normalized=normalizeRepetition(r,i);if(normalized)map.set(normalized.number,normalized);
  }
  // Native completed records include delayed revisions; they take precedence over older frame cards.
  if(monitor)for(const [number,r] of monitor.reps){
    const native=map.get(number);
    map.set(number,native?{...native,side:native.side??r.side,
      timestampMs:native.timestampMs??r.timestampMs,metrics:{...r.metrics,...native.metrics}}:r);
  }
  const reps=[...map.values()].sort((a,b)=>a.number-b.number);
  const timeBased=Object.values(summary.items??{}).some(i=>i.aggregationBasis==='time')&&
    !Object.values(summary.items??{}).some(i=>i.aggregationBasis==='repetition');
  const repetitionErrors={};
  for(const r of reps)for(const code of validCodes(r.codes))repetitionErrors[code]=(repetitionErrors[code]??0)+1;
  const episodeCounts=monitor?.episodeCounts??{};
  const errorCounts=timeBased?{...episodeCounts}:{},errorCountBasisByCode={};
  if(timeBased)for(const code of Object.keys(episodeCounts))errorCountBasisByCode[code]='warning_episodes';
  if(summary.exercise==='squat'&&episodeCounts.TRUNK_LEAN){
    errorCounts.TRUNK_LEAN=episodeCounts.TRUNK_LEAN;errorCountBasisByCode.TRUNK_LEAN='warning_episodes';
  }
  if(!timeBased)for(const [code,n] of Object.entries(repetitionErrors)){
    errorCounts[code]=n;errorCountBasisByCode[code]='completed_repetitions';
  }
  const feedbackCodes=validCodes([...Object.keys(episodeCounts),...Object.keys(repetitionErrors)]);
  const total=monitor?.trackingTotalSeconds??0,available=monitor?.trackingAvailableSeconds??0;
  const nativeSide=legacy.sideCounts;
  const complete=summary.count===null?null:reps.length===summary.count&&reps.every((r,i)=>r.number===i+1);
  const knownSides=complete&&reps.every(r=>['left','right'].includes(r.side));
  const sideCounts=nativeSide??(knownSides&&reps.length?{
    left:reps.filter(r=>r.side==='left').length,right:reps.filter(r=>r.side==='right').length}:null);
  return jsonSafe({...legacy,repetitions:reps,sideCounts,sideHoldSeconds:legacy.sideHoldSeconds??null,
    itemLabels:Object.fromEntries(Object.keys(summary.items??{}).map(id=>[id,itemLabel(id)])),
    report:{schemaVersion:'1.0',feedbackCodes,errorCounts,
      errorCountBasis:'per_code',errorCountBasisByCode,
      repetitionErrorCounts:repetitionErrors,warningEpisodeCounts:{...episodeCounts},
      warningSeconds:{...(monitor?.warningSeconds??{})},
      postureScore:score(summary.items),scoreBasis:'mean_of_evaluated_item_compliance_pct',
      evaluatedItemCount:Object.values(summary.items??{}).filter(i=>i.evaluated>0).length,
      trackingAvailablePct:percentage(available,total),
      tracking:{basis:monitor?.trackingBasis??'analyzer_continuous_intervals',
        totalSeconds:total,availableSeconds:available,unavailableSeconds:Math.max(0,total-available),
        acceptedFrames:monitor?.acceptedFrames??0},
      lateFormBreakdown:monitor&&(monitor.externalTracking?monitor.trackingPrevious?.available===false:monitor.previous?.tracking===false)?
        {...breakdown([],new Map(),timeBased),reason:'tracking_unavailable_at_end'}:
        !timeBased&&!complete?
        {...breakdown([],new Map(),false),reason:'incomplete_repetition_records'}:
        breakdown(reps,monitor?.bins??new Map(),timeBased,monitor?.elapsed??0),
      repetitionRecordsComplete:complete}});
}
export class ReportAccumulator {
  constructor(){this.closed=false;this.reps=new Map();this.previous=null;this.episodeCounts={};this.warningSeconds={};
    this.trackingTotalSeconds=0;this.trackingAvailableSeconds=0;this.acceptedFrames=0;
    this.elapsed=0;this.bins=new Map();this.externalTracking=false;}
  events(events,side=null) {
    for(const event of events??[]) {
      if(!['rep.completed','rep.feedback'].includes(event.type))continue;
      const n=event.number??event.rep??event.index;
      if(!Number.isInteger(n)||n<1)continue;
      this.upsert({...event,number:n,timestampMs:Number.isFinite(event.t)?event.t*1000:null,
        side:event.side??side});
    }
  }
  upsert(raw) {
    const r=normalizeRepetition(raw);if(!r)return;
    const old=this.reps.get(r.number);
    this.reps.set(r.number,{...old,...r,side:r.side??old?.side??null,
      timestampMs:r.timestampMs??old?.timestampMs??null,
      items:Object.keys(r.items).length?r.items:(old?.items??{}),
      codes:raw.items!==undefined||raw.codes!==undefined?r.codes:(old?.codes??[])});
  }
  observe(r) {
    if(this.closed||r.ignored)return;
    this.acceptedFrames++;
    this.events(r.events,r.side);
    if(r.lastRepetition)this.upsert({...r.lastRepetition,side:r.lastRepetition.metrics?.side??r.side});
    const codes=validCodes(r.currentCodes),previous=this.previous;
    const tracking=r.tracking==='tracking',t=r.timestampMs;
    if(previous) {
      const dt=(t-previous.t)/1000;
      if(dt>0) {
        if(!this.externalTracking){this.trackingTotalSeconds+=dt;
          if(dt<=.4&&tracking&&previous.tracking)this.trackingAvailableSeconds+=dt;}
        if(dt<=.4&&tracking&&previous.tracking&&r.side===previous.side) {
          for(const code of codes.filter(c=>previous.codes.includes(c)))
            this.warningSeconds[code]=(this.warningSeconds[code]??0)+dt;
          const bucket=Math.floor(this.elapsed+1e-9);
          if(!this.bins.has(bucket))this.bins.set(bucket,{});
          const items=this.bins.get(bucket);
          for(const [key,status] of Object.entries(r.items))if(assessed(status)&&assessed(previous.items[key])){
            items[key]??=[0,0];items[key][1]+=dt;
            if(status==='within_reference'&&previous.items[key]==='within_reference')items[key][0]+=dt;
          }
        }
        this.elapsed+=dt;
      }
    }
    for(const code of codes)if(!previous?.codes.includes(code))
      this.episodeCounts[code]=(this.episodeCounts[code]??0)+1;
    this.previous={t,tracking,side:r.side,codes,items:{...r.items}};
  }
  interrupt(events,reason='pause'){if(this.closed)return;this.events(events);
    this.previous=typeof reason==='string'&&reason.includes('gap')&&this.previous?{...this.previous,tracking:false,codes:[],items:{}}:null;}
  observeTracking(t,available,included) {
    if(this.closed)return;
    if(!this.externalTracking){
      this.externalTracking=true;this.trackingBasis='session_observability_intervals';
      this.trackingTotalSeconds=0;this.trackingAvailableSeconds=0;this.trackingPrevious=null;
    }
    const p=this.trackingPrevious;
    if(included&&p?.included&&t>p.t) {
      const dt=(t-p.t)/1000;this.trackingTotalSeconds+=dt;
      if(available&&p.available&&dt<=.4)this.trackingAvailableSeconds+=dt;
    }
    this.trackingPrevious={t,available,included};
  }
}
const monitors=new WeakMap();
/** Aggregate public outputs without changing exercise rules or retaining landmark coordinates. */
export function installReport(analyzer) {
  if(monitors.has(analyzer))return;
  const monitor=new ReportAccumulator();monitors.set(analyzer,monitor);
  const push=analyzer.pushFrame.bind(analyzer),summary=analyzer.summary.bind(analyzer);
  const interrupt=analyzer.breakContinuity.bind(analyzer),finish=analyzer.finish.bind(analyzer);
  const enrich=()=>{
    const s=summary();return {...s,details:reportDetails(s,monitor)};
  };
  analyzer.pushFrame=frame=>{const r=push(frame);monitor.observe(r);return r;};
  analyzer.summary=enrich;
  analyzer.breakContinuity=(...args)=>{if(monitor.closed)return [];const events=interrupt(...args);monitor.interrupt(events,args[0]);return events;};
  analyzer.finish=()=>{
    if(monitor.closed)return [];
    const events=finish();monitor.events(events);monitor.closed=true;
    return events.map(e=>e.type==='set.completed'?{...e,summary:enrich()}:e);
  };
}
export function observeSessionTracking(analyzer,t,available,included) {
  monitors.get(analyzer)?.observeTracking(t,available,included);
}
/** No frontend file is modified; this adapter supplies the existing workout DTO fields. */
export function workoutReportFields(summary) {
  const report=summary.details?.report;
  if(!report||report.schemaVersion!=='1.0'||!Array.isArray(report.feedbackCodes)||
     report.feedbackCodes.some(c=>typeof c!=='string'||!/^[A-Z_]{1,50}$/.test(c))||
     !report.errorCounts||Array.isArray(report.errorCounts)||typeof report.errorCounts!=='object'||
     Object.entries(report.errorCounts).some(([code,n])=>!/^[A-Z_]{1,50}$/.test(code)||!Number.isInteger(n)||n<0||n>2147483647)||
     !(report.trackingAvailablePct===null||Number.isFinite(report.trackingAvailablePct)&&report.trackingAvailablePct>=0&&report.trackingAvailablePct<=100))
    throw new TypeError('Expected a summary with set report v1');
  if(report.feedbackCodes.length>20||Object.keys(report.errorCounts).length>20)
    throw new RangeError('Workout DTO supports at most 20 feedback/error codes');
  return jsonSafe({feedbackCodes:report.feedbackCodes,errorCounts:report.errorCounts,
    trackingAvailablePct:report.trackingAvailablePct});
}
