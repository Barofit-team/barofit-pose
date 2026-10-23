// Observation-only sidecar. These tolerances NEVER decide counts or posture warnings.
export const TEMPO_CONFIG=Object.freeze({velocityWindowMs:250,minVelocityWindowMs:120,
  stillSpeedDegS:4,minPauseMs:300,positionBandDeg:5});
function velocity(samples,c){
  if(samples.length<2||samples.at(-1).t-samples[0].t<c.minVelocityWindowMs)return null;
  const t0=samples[0].t,ts=samples.map(p=>(p.t-t0)/1000);
  const mt=ts.reduce((a,b)=>a+b,0)/ts.length,ma=samples.reduce((a,p)=>a+p.elevation,0)/samples.length;
  let num=0,den=0;for(let i=0;i<samples.length;i++){num+=(ts[i]-mt)*(samples[i].elevation-ma);den+=(ts[i]-mt)**2;}
  return den>0?num/den:null;
}
const kind=(v,c)=>v===null?'unknown':Math.abs(v)<=c.stillSpeedDegS?'still':v>0?'rising':'lowering';
function append(segments,s){
  const last=segments.at(-1);
  if(last&&last.state===s.state&&last.position===s.position&&Math.abs(last.endMs-s.startMs)<1e-6){last.endMs=s.endMs;last.durationMs=last.endMs-last.startMs;}
  else segments.push({...s,durationMs:s.endMs-s.startMs});
}

/** Finalized partition of exactly the existing count interval. Short still candidates
 * remain unclassified, rather than inventing movement or awarding a hold. */
export function measureTempo(samples,c=TEMPO_CONFIG){
  const result={method:'projected_leg_angle_velocity_v1',unit:'milliseconds',
    riseMovingMs:0,lowerMovingMs:0,pauseMs:0,topHoldMs:0,bottomHoldMs:0,midPauseMs:0,
    unclassifiedMs:0,intervalMs:0,segments:[]};
  if(samples.length<2)return result;
  const lo=Math.min(...samples.map(p=>p.elevation)),hi=Math.max(...samples.map(p=>p.elevation));
  const runs=[];let start=0;
  for(let i=1;i<samples.length;i++){
    while(start<i&&samples[i].t-samples[start].t>c.velocityWindowMs)start++;
    const state=kind(velocity(samples.slice(start,i+1),c),c);
    append(runs,{startMs:samples[i-1].t,endMs:samples[i].t,state,position:null});
  }
  for(const run of runs){
    const confirmed=run.state==='still'&&run.durationMs>=c.minPauseMs;
    const state=run.state==='still'&&!confirmed?'unknown':run.state;
    for(let i=1;i<samples.length;i++){
      const a=samples[i-1],b=samples[i];if(a.t<run.startMs||b.t>run.endMs)continue;
      const e=(a.elevation+b.elevation)/2;
      const position=confirmed?(hi-lo<2*c.positionBandDeg?'unresolved':hi-e<=c.positionBandDeg?'top':e-lo<=c.positionBandDeg?'bottom':'middle'):null;
      append(result.segments,{startMs:a.t,endMs:b.t,state,position});
      const dt=b.t-a.t;
      if(state==='rising')result.riseMovingMs+=dt;
      else if(state==='lowering')result.lowerMovingMs+=dt;
      else if(confirmed){result.pauseMs+=dt;if(position==='top')result.topHoldMs+=dt;else if(position==='bottom')result.bottomHoldMs+=dt;else result.midPauseMs+=dt;}
      else result.unclassifiedMs+=dt;
    }
  }
  result.intervalMs=samples.at(-1).t-samples[0].t;
  return result;
}

/** Causal display state. A pause is confirmed after minPauseMs; never uses future frames. */
export class TempoTracker{
  constructor(c=TEMPO_CONFIG){this.config=c;this.reset();}
  reset(){this.samples=[];this.candidate=null;this.since=null;this.last=null;this.value={state:'warming_up',stateDurationMs:0,pauseDurationMs:0,angularVelocityDegS:null};}
  push(p){
    const c=this.config;this.samples.push({t:p.t,elevation:p.elevation});
    while(this.samples.length>1&&p.t-this.samples[0].t>c.velocityWindowMs)this.samples.shift();
    const v=velocity(this.samples,c),k=kind(v,c);
    if(k!==this.candidate){this.candidate=k;this.since=this.last??p.t;}
    const duration=p.t-this.since,confirmed=k==='still'&&duration>=c.minPauseMs;
    this.value={state:k==='unknown'?'warming_up':k==='still'?(confirmed?'still':'settling'):k,
      stateDurationMs:duration,pauseDurationMs:confirmed?duration:0,angularVelocityDegS:v};
    this.last=p.t;return this.value;
  }
}
