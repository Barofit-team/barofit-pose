import {PlankRule, HIP_CONFIG} from './engine.js';
import {validateFrame,jsonSafe} from '../common/frame.js';
export const PLANK_VERSION='plank-multi-0.2-js-1.0';
const assessed=s=>['within_reference','warning'].includes(s);
function status(s){return ['NO_WARNING','NO_HIP_WARNING'].includes(s)?'within_reference':
  s==='WARMUP'?'pending_feedback':s==='UNOBSERVABLE'?'tracking_unavailable':'warning';}

/** Per-frame rules plus sample-based evaluation-time accounting. No automatic exercise start detection. */
export class PlankAnalyzer {
  constructor(){this.rule=new PlankRule();this.lastTime=null;this.previous=null;this.closed=false;
    this.observedSeconds=0;this.gapSeconds=0;
    this.totals=Object.fromEntries(['hip','shoulder','knee'].map(k=>[k,{compliant_s:0,warning_s:0,unknown_s:0}]));}
  pushFrame(frame){
    validateFrame(frame);const t=frame.timestampMs/1000;
    if(this.closed||this.lastTime!==null&&t<=this.lastTime)return {ignored:true,events:[]};
    const raw=this.rule.step(t,frame.landmarks,[frame.width,frame.height]);
    const items={hip:status(raw.hip_state),shoulder:status(raw.shoulder_state),knee:status(raw.knee_state)};
    const codes=raw.warning_codes.split('|').filter(Boolean).map(c=>c==='HIP_HIGH'?'HIP_RAISE':c);
    const events=[];
    if(this.previous){
      const dt=t-this.previous.t;
      if(dt>HIP_CONFIG.max_gap_s){this.gapSeconds+=dt;events.push({type:'frame.gap',t,gap_s:dt});}
      else {
        this.observedSeconds+=dt;
        for(const [key,totals] of Object.entries(this.totals)){
          const before=this.previous.items[key],now=items[key];
          const eligible=this.previous.side===raw.side&&assessed(before)&&assessed(now);
          totals[eligible?(before==='warning'?'warning_s':'compliant_s'):'unknown_s']+=dt;
        }
      }
      if(this.previous.codes.join('|')!==codes.join('|'))events.push({type:'feedback.changed',t,codes});
      if(this.previous.side!==raw.side)events.push({type:'side.changed',t,from:this.previous.side,to:raw.side});
    }else if(codes.length)events.push({type:'feedback.changed',t,codes});
    this.lastTime=t;this.previous={t,items,side:raw.side,codes};
    return jsonSafe({schemaVersion:'1.0',exercise:'plank',engineVersion:PLANK_VERSION,timestampMs:frame.timestampMs,
      ignored:false,tracking:Object.values(items).some(assessed)?'tracking':Object.values(items).includes('pending_feedback')?'selecting_side':'tracking_unavailable',
      side:raw.side,count:null,holdSeconds:null,observedSeconds:this.observedSeconds,codes,items,events,
      metrics:Object.fromEntries(['hip_offset_pct','hip_angle_deg','shoulder_deviation_deg','knee_deg','elbow_deg'].map(k=>[k,raw[k]])),raw});
  }
  breakContinuity(reason='pause'){
    if(this.closed)return [];
    this.rule=new PlankRule();this.previous=null;
    return [{type:'tracking.interrupted',t:this.lastTime,reason}];
  }
  summary(){
    return {schemaVersion:'1.0',exercise:'plank',engineVersion:PLANK_VERSION,count:null,holdSeconds:null,
      observedSeconds:this.observedSeconds,gapSeconds:this.gapSeconds,
      items:Object.fromEntries(Object.entries(this.totals).map(([key,v])=>{
        const evaluable_s=v.compliant_s+v.warning_s;
        return [key,{...v,evaluable_s,compliance_pct:evaluable_s?100*v.compliant_s/evaluable_s:null}];
      }))};
  }
  finish(){if(this.closed)return [];this.closed=true;return [{type:'set.completed',t:this.lastTime,...this.summary()}];}
}
