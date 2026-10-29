import {SquatRule,DEFAULT_CONFIG,IDS,metrics,SQUAT_SOURCE_COMMIT} from './engine.js';
import {itemResult,setSummary,setCompleted} from '../common/result.js';
import {pushRealtime} from '../common/realtime.js';
import {validateFrame,jsonSafe} from '../common/frame.js';

export const SQUAT_VERSION='squat-experimental-0.1-js-1.0';
// These are adapter-only settings, not changes to the notebook's exercise rules.
export const SIDE_CONFIG=Object.freeze({prepare_s:.4,reselect_after_s:.4});
const sides=['left','right'],finite=Number.isFinite;
const emptyMetrics=()=>({knee_deg:null,hip_deg:null,elbow_deg:null,trunk_deg:null});
const assessed=s=>['within_reference','warning'].includes(s);
const itemStatus=s=>s==='unknown'?'tracking_unavailable':s==='not_evaluated'?'pending_feedback':s;
const checkSide=side=>{if(side!==null&&!sides.includes(side))throw new TypeError('side must be left, right, or null (automatic)');};

/**
 * Causal adapter only. The notebook selected a side after scanning the full video.
 * Here automatic selection needs continuous, visible, standing preparation.
 * The selected side stays locked until tracking fails; no frame-by-frame swapping.
 */
export class SquatSideSelector {
  constructor({side=null,prepare_s=.4,reselect_after_s=.4,standing_deg=155}={}){
    checkSide(side);
    if(!finite(prepare_s)||prepare_s<0||!finite(reselect_after_s)||reselect_after_s<0)
      throw new TypeError('side selection durations must be nonnegative');
    this.fixed=side;this.c={prepare_s,reselect_after_s,standing_deg};this.reset();
  }
  reset(){
    this.side=this.fixed;this.badSince=null;
    this.candidates=Object.fromEntries(sides.map(s=>[s,{since:null,sum:0,n:0}]));
  }
  setSide(side){checkSide(side);this.fixed=side;this.reset();}
  step(t,rows){
    const from=this.side;
    for(const side of sides){
      const r=rows[side],candidate=this.candidates[side];
      if(r.available&&r.metrics.knee_deg>=this.c.standing_deg){
        if(candidate.since===null)candidate.since=t;
        candidate.sum+=r.quality;candidate.n++;
      }else this.candidates[side]={since:null,sum:0,n:0};
    }
    const choose=()=>{
      const eligible=sides.filter(s=>{
        const c=this.candidates[s];
        return c.since!==null&&t-c.since>=this.c.prepare_s;
      });
      eligible.sort((a,b)=>{
        const A=this.candidates[a],B=this.candidates[b];
        return B.sum/B.n-A.sum/A.n;
      });
      return eligible[0]??null;
    };
    if(this.fixed!==null){
      return {side:this.side,changed:false,from,available:rows[this.side].available,
        selecting:false};
    }
    if(this.side===null){this.side=choose();this.badSince=null;}
    else if(rows[this.side].available)this.badSince=null;
    else{
      if(this.badSince===null)this.badSince=t;
      if(t-this.badSince>=this.c.reselect_after_s){
        const selected=choose();
        if(selected!==null){this.side=selected;this.badSince=null;}
      }
    }
    return {side:this.side,changed:from!==this.side,from,
      available:this.side!==null&&rows[this.side].available,
      selecting:this.side===null};
  }
}

/** Common per-frame wrapper. No TTS, timer, network, or automatic set transitions. */
export class SquatAnalyzer {
  constructor({side=null,config={},sideConfig={}}={}){
    this.rule=new SquatRule(config);
    this.selector=new SquatSideSelector({...SIDE_CONFIG,...sideConfig,side,standing_deg:this.rule.c.standing_deg});
    this.lastTime=null;this.previous=null;this.closed=false;this.pendingEvents=[];this.discontinuous=false;
    this.observedSeconds=0;this.gapSeconds=0;
    this.trunkTotals={compliant_s:0,warning_s:0,unknown_s:0};
  }
  setSide(side){
    if(this.closed)return [];
    const from=this.selector.side;
    this.selector.setSide(side);this.rule.reset();this.previous=null;
    const event={type:'side.requested',t:this.lastTime,from,to:side,reason:'manual'};
    this.pendingEvents.push(event);return [event];
  }
  pushFrame(frame){
    const r=pushRealtime(this,frame,'squat',SQUAT_VERSION);
    if(!r.ignored){
      r.phase=r.details.state;
      // Depth is a completed-repetition assessment, not current standing posture.
      const rep=r.events.find(e=>e.type==='rep.completed');
      r.items={trunk:r.items.trunk};
      r.currentCodes=r.codes.filter(c=>c!=='SQUAT_SHALLOW');
      r.lastRepetition=rep?{number:rep.rep,timestampMs:rep.t*1000,
        items:{depth:rep.depth_state},codes:rep.depth_state==='warning'?['SQUAT_SHALLOW']:[],
        metrics:{min_knee_deg:rep.min_knee_deg,start_s:rep.start_s,end_s:rep.end_s}}:null;
    }
    return r;
  }
  _pushFrameLegacy(frame){
    validateFrame(frame);
    const t=frame.timestampMs/1000;
    if(this.closed||this.lastTime!==null&&t<=this.lastTime)return {ignored:true,events:[]};
    const events=this.pendingEvents.splice(0),gap=this.lastTime!==null?t-this.lastTime:0;
    if(gap>this.rule.c.max_gap_s&&!this.discontinuous){
      this.rule.reset();this.selector.reset();this.previous=null;this.gapSeconds+=gap;
      events.push({type:'frame.gap',t,gap_s:gap});
    }
    this.discontinuous=false;
    const rows=Object.fromEntries(sides.map(side=>{
      const m=metrics(frame.landmarks,[frame.width,frame.height],side,this.rule.c.min_quality);
      const required=[IDS[side][0],...IDS[side].slice(3)];
      const available=finite(m.knee_deg)&&finite(m.trunk_deg);
      const quality=available?Math.min(...required.flatMap(i=>frame.landmarks[i].slice(3))):0;
      return [side,{metrics:m,quality,available}];
    }));
    const selected=this.selector.step(t,rows);
    if(selected.changed){
      this.rule.reset();events.push({type:'side.changed',t,from:selected.from,to:selected.side});
    }
    // Live adapter gates on all four required joints. A missing shoulder also
    // interrupts the current cycle; the pure rule above retains source semantics.
    const m=selected.side?rows[selected.side].metrics:emptyMetrics();
    const raw=this.rule.step(t,selected.available?m.knee_deg:null,selected.available?m.trunk_deg:null);
    const codes=raw.codes,items={depth:itemStatus(raw.depth_state),trunk:itemStatus(raw.trunk_state)};
    for(const rep of raw.events)events.push({type:'rep.completed',t,...rep});
    if(this.previous){
      const dt=t-this.previous.t;
      this.observedSeconds+=dt;
      const eligible=this.previous.side===selected.side&&assessed(this.previous.trunk)&&assessed(items.trunk);
      this.trunkTotals[eligible?(this.previous.trunk==='warning'?'warning_s':'compliant_s'):'unknown_s']+=dt;
      if(this.previous.codes.join('|')!==codes.join('|'))events.push({type:'feedback.changed',t,codes});
    }else if(codes.length)events.push({type:'feedback.changed',t,codes});
    this.previous={t,side:selected.side,trunk:items.trunk,codes:[...codes]};this.lastTime=t;
    return jsonSafe({schemaVersion:'1.0',exercise:'squat',engineVersion:SQUAT_VERSION,
      sourceCommit:SQUAT_SOURCE_COMMIT,experimental:true,timestampMs:frame.timestampMs,
      ignored:false,tracking:raw.state==='UNOBSERVABLE'?(selected.selecting&&sides.some(s=>rows[s].available)?'selecting_side':'tracking_unavailable'):'tracking',
      side:selected.side,count:raw.count,holdSeconds:null,state:raw.state,codes,items,metrics:m,events,
      observedSeconds:this.observedSeconds,selectionMode:this.selector.fixed?'fixed':'automatic',
      raw});
  }
  breakContinuity(reason='pause'){
    if(this.closed)return [];
    this.rule.reset();this.selector.reset();this.previous=null;
    // Preserve monotonic timestamps but do not count time spent paused.
    this.discontinuous=true;
    return [{type:'tracking.interrupted',t:this.lastTime,reason}];
  }
  summary(){
    const reps=this.rule.reps.map(r=>({...r})),warning=reps.filter(r=>r.depth_state==='warning').length;
    return setSummary({exercise:'squat',engineVersion:SQUAT_VERSION,count:this.rule.count,
      observedSeconds:this.observedSeconds,gapSeconds:this.gapSeconds,
      details:{reps,experimental:true,sourceCommit:SQUAT_SOURCE_COMMIT},
      items:{depth:itemResult('repetition',reps.length-warning,warning),
        trunk:itemResult('time',this.trunkTotals.compliant_s,this.trunkTotals.warning_s,this.trunkTotals.unknown_s)}});
  }
  finish(){
    if(this.closed)return [];
    this.closed=true;
    return [setCompleted(this.summary(),this.lastTime===null?null:this.lastTime*1000)];
  }
}
