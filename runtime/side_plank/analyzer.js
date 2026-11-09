import {pushRealtime} from '../common/realtime.js';
import {itemResult,setSummary,setCompleted} from '../common/result.js';
import {VALID_HOLD_CONFIG,validHoldInterval} from '../common/hold.js';
export const SIDE_PLANK_VERSION='side-plank-0.2-valid-hold';
export const SIDE_PLANK_CONFIG=Object.freeze({quality:.5,hipDropPct:4,hipRaiseUncertainPct:4,hipRaisePct:8,shoulderDeg:25,kneeDeg:160,confirmationMs:VALID_HOLD_CONFIG.confirmationSeconds*1000,warningMs:300,maxGapMs:VALID_HOLD_CONFIG.maxGapSeconds*1000});
const keys=['hip','shoulder','knee'];
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const angle=(a,b,c)=>{const u=[a[0]-b[0],a[1]-b[1]],v=[c[0]-b[0],c[1]-b[1]],den=Math.hypot(...u)*Math.hypot(...v);return den<1?null:Math.acos(Math.max(-1,Math.min(1,(u[0]*v[0]+u[1]*v[1])/den)))*180/Math.PI;};
export function sidePlankMetrics(frame){
 const p=frame.landmarks,q=SIDE_PLANK_CONFIG.quality;
 const point=i=>{const a=p[i];return a&&[a[0],a[1],a[3],a[4]].every(Number.isFinite)&&a[3]>=q&&a[4]>=q&&a[0]>=0&&a[0]<=1&&a[1]>=0&&a[1]<=1?[a[0]*frame.width,a[1]*frame.height]:null;};
 const ls=point(11),rs=point(12);
 if(!ls||!rs)return {side:null,observable:false};
 const side=ls[1]>rs[1]?'left':'right',d=side==='right'?1:0;
 const S=point(11+d),E=point(13+d),W=point(15+d),H=point(23+d),K=point(25+d),A=point(27+d);
 if(![S,E,W,H,A].every(Boolean))return {side,observable:false};
 const L=dist(S,A),dx=A[0]-S[0],dy=A[1]-S[1];
 if(L<30||Math.abs(dx)/L<.65||Math.abs(A[0]-E[0])<1)return {side,observable:false};
 const downward=[-dy/L*Math.sign(dx),Math.abs(dx)/L];
 const hipOffsetPct=100*((H[0]-S[0])*downward[0]+(H[1]-S[1])*downward[1])/L;
 const baselineY=E[1]+(A[1]-E[1])*(H[0]-E[0])/(A[0]-E[0]);
 const hipClearancePct=100*(baselineY-H[1])/L;
 const shoulderDeviationDeg=Math.atan2(Math.abs(E[0]-S[0]),E[1]-S[1])*180/Math.PI;
 const stackPct=100*Math.abs(ls[1]-rs[1])/L;
 // A forearm pointing at the camera can project to an almost straight elbow.
 // Elbow flexion is recorded, not used as a 2-D variant classifier.
 const bodyCandidate=stackPct>5 && Math.abs(ls[0]-rs[0])/L<.20 && (E[1]-S[1])/L>.035 && Math.abs(W[1]-E[1])/L<.14 && hipClearancePct>1;
 return {side,observable:true,bodyCandidate,hipOffsetPct,hipClearancePct,shoulderDeviationDeg,kneeDeg:K?angle(H,K,A):null,elbowDeg:angle(S,E,W),stackPct};
}
export class SidePlankAnalyzer{
 constructor(){this.closed=false;this.previous=null;this.lastTime=null;this.observedSeconds=0;this.holdSeconds=0;this.gapSeconds=0;this.sideSeconds={left:0,right:0};this.totals=Object.fromEntries(keys.map(k=>[k,{compliant:0,warning:0,unknown:0,notApplicable:0}]));this.reset();}
 reset(){this.candidateSide=null;this.since=null;this.pending={};}
 pushFrame(frame){return pushRealtime(this,frame,'side_plank',SIDE_PLANK_VERSION);}
 _pushFrameLegacy(frame){
  const t=frame.timestampMs,c=SIDE_PLANK_CONFIG,m=sidePlankMetrics(frame),events=[];
  const dimensions=frame.width+'x'+frame.height;
  const broken=this.previous&&(t-this.previous.t>c.maxGapMs||this.previous.side!==m.side||dimensions!==this.previous.dimensions);
  if(broken)this.reset();
  if(m.bodyCandidate){if(this.candidateSide!==m.side){this.candidateSide=m.side;this.since=t;}}
  else this.reset();
  const active=m.bodyCandidate&&t-this.since>=c.confirmationMs;
  const phase=!m.observable?'unobservable':active?'holding':m.bodyCandidate?'stabilizing':'positioning';
  const proposed={hip:m.hipOffsetPct>c.hipDropPct?'HIP_DROP':m.hipOffsetPct< -c.hipRaisePct?'HIP_RAISE':null,shoulder:m.shoulderDeviationDeg>c.shoulderDeg?'SHOULDER_ELBOW_OFFSET':null,knee:m.kneeDeg!==null&&m.kneeDeg<c.kneeDeg?'KNEE_BENT':null};
  const items={},codes=[];
  for(const k of keys){
   if(!m.observable||k==='knee'&&m.kneeDeg===null){items[k]='tracking_unavailable';delete this.pending[k];}
   else if(!active){items[k]=m.bodyCandidate?'pending_feedback':'not_applicable';delete this.pending[k];}
   else if(k==='hip'&&m.hipOffsetPct < -c.hipRaiseUncertainPct&&m.hipOffsetPct>=-c.hipRaisePct){items[k]='unknown';delete this.pending[k];}
   else if(proposed[k]){
    if(this.pending[k]?.code!==proposed[k])this.pending[k]={code:proposed[k],since:t};
    items[k]=t-this.pending[k].since>=c.warningMs?'warning':'pending_feedback';
    if(items[k]==='warning')codes.push(proposed[k]);
   }else{items[k]='within_reference';delete this.pending[k];}
  }
  const eligible=active&&keys.every(k=>items[k]==='within_reference');
  const prev=this.previous;
  if(prev){const dt=(t-prev.t)/1000;
   if(dt>c.maxGapMs/1000){this.gapSeconds+=dt;events.push({type:'frame.gap',t:t/1000,gap_s:dt});}
   else{
    this.observedSeconds+=dt;
    const validSeconds=validHoldInterval({previousTime:prev.t/1000,time:t/1000,previousEligible:prev.eligible,eligible,continuous:!broken,maxGapSeconds:c.maxGapMs/1000});
    this.holdSeconds+=validSeconds;if(validSeconds>0)this.sideSeconds[m.side]+=validSeconds;
    for(const k of keys){const a=prev.items[k],b=items[k];let bucket='unknown';
     if(!broken&&a==='not_applicable'&&b==='not_applicable')bucket='notApplicable';
     else if(!broken&&['warning','within_reference'].includes(a)&&['warning','within_reference'].includes(b))bucket=a==='warning'||b==='warning'?'warning':'compliant';
     this.totals[k][bucket]+=dt;
    }
   }
   if(prev.side!==m.side)events.push({type:'side.changed',t:t/1000,from:prev.side,to:m.side});
   if(prev.codes.join('|')!==codes.join('|'))events.push({type:'feedback.changed',t:t/1000,codes});
  }
  this.lastTime=t;this.previous={t,side:m.side,items,codes,eligible,dimensions};
  return {tracking:m.observable?'tracking':'tracking_unavailable',side:m.side,count:null,holdSeconds:this.holdSeconds,observedSeconds:this.observedSeconds,movementPhase:phase,items,codes,metrics:m,events};
 }
 breakContinuity(reason='pause'){if(this.closed)return [];this.previous=null;this.reset();return [{type:'tracking.interrupted',t:this.lastTime===null?null:this.lastTime/1000,reason}];}
 summary(){return setSummary({exercise:'side_plank',engineVersion:SIDE_PLANK_VERSION,holdSeconds:this.holdSeconds,observedSeconds:this.observedSeconds,gapSeconds:this.gapSeconds,items:Object.fromEntries(keys.map(k=>{const v=this.totals[k];return [k,itemResult('time',v.compliant,v.warning,v.unknown,v.notApplicable)];})),details:{sideHoldSeconds:{...this.sideSeconds},configuration:SIDE_PLANK_CONFIG}});}
 finish(){if(this.closed)return [];this.closed=true;return [setCompleted(this.summary(),this.lastTime)];}
}
