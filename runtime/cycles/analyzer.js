import {validateFrame} from '../common/frame.js';
import {frameResult} from '../common/realtime.js';
import {itemResult,setSummary,setCompleted} from '../common/result.js';
import {measure,profiles} from './measurements.js';

function qualityStatus(rule,value) {
  if (value===null) return 'unknown';
  const ok=rule.max!==undefined?value<=rule.max:value>=rule.min;
  return ok?'within_reference':'warning';
}

class CycleAnalyzer {
  constructor(exercise,{side=null}={}) {
    if (side!==null && side!=='left' && side!=='right') throw new RangeError('Expected left or right working side');
    this.exercise=exercise;
    this.rule=profiles[exercise];
    this.fixedSide=side;
    this.version=exercise+'-experimental-0.1';
    this.lastTime=null;
    this.gapSeconds=0;
    this.observedSeconds=0;
    this.count=0;
    this.closed=false;
    this.reps=[];
    this.resetMotion();
  }
  resetMotion() {
    this.ready=new Set();
    this.attempt=null;
    this.previousSides=[];
    this.latest=null;
    this.calfBaseline={};
  }
  breakContinuity(reason='pause') {
    if (this.closed) return [];
    this.resetMotion();
    this.resumePending=true;
    return [{type:'tracking.interrupted',t:this.lastTime===null?null:this.lastTime/1000,reason}];
  }
  complete(t) {
    const a=this.attempt, rule=this.rule;
    const range=a.peak>=rule.target?'within_reference':'warning';
    const quality=qualityStatus(rule,a.quality);
    const items={range,[rule.quality]:quality};
    this.latest={number:++this.count,timestampMs:t,items,
      codes:Object.keys(items).filter(k=>items[k]==='warning').map(k=>this.exercise.toUpperCase()+'_'+k.toUpperCase()),
      metrics:{side:a.side,peak:a.peak,qualityAtPeak:a.quality,durationMs:t-a.start}};
    this.reps.push(this.latest);
  }
  pushFrame(frame) {
    validateFrame(frame);
    const t=frame.timestampMs;
    const reason=this.closed?'finished':this.lastTime!==null && t<=this.lastTime?'non_monotonic_timestamp':null;
    const context={exercise:this.exercise,engineVersion:this.version,ignoredReason:reason};
    const base={count:this.count,observedSeconds:this.observedSeconds};
    if (reason) return frameResult(base,frame,context);
    const dt=this.lastTime===null || this.resumePending?0:t-this.lastTime;
    const events=[];
    const dimensions=frame.width+'x'+frame.height;
    if (dt>350 || (this.dimensions && dimensions!==this.dimensions)) {
      this.resetMotion(); this.gapSeconds+=dt/1000;
      events.push({type:'frame.gap',t:t/1000,gap_s:dt/1000});
    }
    this.dimensions=dimensions; this.lastTime=t; this.resumePending=false;
    const sides=this.fixedSide?[this.fixedSide]:['left','right'];
    const visible={};
    for (const side of sides) {
      const m=measure(this.exercise,frame,side);
      if (!m) { this.ready.delete(side); delete this.calfBaseline[side]; continue; }
      if (this.exercise==='standing_calf_raise') {
        this.calfBaseline[side]=Math.min(this.calfBaseline[side]??m.signal,m.signal);
        m.signal-=this.calfBaseline[side];
      }
      visible[side]=m;
    }
    const observed=Object.keys(visible);
    if (observed.some(s=>this.previousSides.includes(s))) this.observedSeconds+=dt/1000;
    this.previousSides=observed;
    if (this.attempt && !visible[this.attempt.side]) {
      this.attempt=null; this.latest=null; this.ready.clear();
    }
    const rule=this.rule;
    for (const side of observed) {
      const m=visible[side];
      if (m.signal<=rule.ready) this.ready.add(side);
      if (!this.attempt && this.ready.has(side) && m.signal>=rule.active) {
        this.attempt={start:t,side,peak:m.signal,quality:m.quality};
        this.ready.clear();
      }
    }
    const a=this.attempt;
    if (a) {
      const m=visible[a.side];
      if (m.signal>=a.peak) { a.peak=m.signal; a.quality=m.quality; }
      if (m.signal<=rule.ready || t-a.start>10000) {
        if (m.signal<=rule.ready && t-a.start>=150 && t-a.start<=10000) {
          this.complete(t);
          events.push({type:'rep.completed',t:t/1000,rep:this.count,side:a.side});
        }
        this.attempt=null;
      }
    }
    const side=a?.side??observed[0]??null;
    const items={};
    const codes=[];
    if (a && visible[a.side].signal>=rule.active) {
      items[rule.quality]=qualityStatus(rule,visible[a.side].quality);
      if (items[rule.quality]==='warning') codes.push(this.exercise.toUpperCase()+'_'+rule.quality.toUpperCase());
    }
    const result=frameResult({...base,count:this.count,observedSeconds:this.observedSeconds,side,
      tracking:side?'tracking':'tracking_unavailable',movementPhase:this.attempt?'active':this.ready.size?'ready':'not_ready',
      items,codes,metrics:side?{signal:visible[side].signal,quality:visible[side].quality}:{},events},frame,context);
    if (this.latest && t-this.latest.timestampMs<=1000) {
      result.lastRepetition={...this.latest,items:{...this.latest.items},codes:[...this.latest.codes],metrics:{...this.latest.metrics}}; result.codes=[...new Set([...codes,...this.latest.codes])];
    }
    return result;
  }
  summary() {
    const items={};
    for (const key of ['range',this.rule.quality]) {
      const n=status=>this.reps.filter(r=>r.items[key]===status).length;
      items[key]=itemResult('repetition',n('within_reference'),n('warning'),n('unknown'));
    }
    return setSummary({exercise:this.exercise,engineVersion:this.version,count:this.count,observedSeconds:this.observedSeconds,
      gapSeconds:this.gapSeconds,items,details:{experimental:true,repetitions:this.reps}});
  }
  finish() {
    if (this.closed) return [];
    this.closed=true;
    return [setCompleted(this.summary(),this.lastTime)];
  }
}


export class LungeAnalyzer extends CycleAnalyzer { constructor(options){super('lunge',options);} }
export class SplitSquatAnalyzer extends CycleAnalyzer { constructor(options){super('split_squat',options);} }
export class BulgarianSplitSquatAnalyzer extends CycleAnalyzer { constructor(options){super('bulgarian_split_squat',options);} }
export class SideLegRaiseAnalyzer extends CycleAnalyzer { constructor(options){super('side_lying_leg_raise',options);} }
export class InclinePushupAnalyzer extends CycleAnalyzer { constructor(options){super('incline_pushup',options);} }
export class StandingCalfRaiseAnalyzer extends CycleAnalyzer { constructor(options){super('standing_calf_raise',options);} }
export class DeadBugAnalyzer extends CycleAnalyzer { constructor(options){super('dead_bug',options);} }
