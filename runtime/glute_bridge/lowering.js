// Short-window descent evidence. This is a kinematic coaching cue, not a
// diagnosis of muscle control. Candidate cutoffs calibrated on development clips.
export function loweringEvidence(samples,peakMs,c){
 const p=samples.filter(x=>x.t>=peakMs);let best=null;
 for(let i=0;i<p.length;i++)for(let j=i+1;j<p.length;j++){
  const ms=p[j].t-p[i].t;if(ms>c.lowerWindowMaxMs)break;
  if(ms<c.lowerWindowMinMs||j-i+1<4)continue;
  const drop=p[i].elevation-p[j].elevation;if(drop<c.lowerBurstMinDropDeg)continue;
  let up=0,maxStep=0,gap=false;
  for(let k=i;k<j;k++){const delta=p[k].elevation-p[k+1].elevation;up+=Math.max(0,-delta);maxStep=Math.max(maxStep,delta);if(p[k+1].t-p[k].t>c.maxGapMs)gap=true;}
  if(gap||up>c.lowerMaxReboundDeg||maxStep/drop>c.lowerMaxStepFraction)continue;
  const speed=drop/(ms/1000);
  if(!best||speed>best.speedDegS)best={startMs:p[i].t,endMs:p[j].t,durationMs:ms,dropDeg:drop,speedDegS:speed};
 }
 const duration=p.length>1?p.at(-1).t-p[0].t:null;
 const avg=duration>0?(p[0].elevation-p.at(-1).elevation)/(duration/1000):null;
 const whole=duration!==null&&duration<c.fastLowerMs&&avg>c.fastLowerSpeedDegS;
 const burst=best!==null&&best.speedDegS>c.lowerBurstSpeedDegS;
 return {method:'descent_window_v1',warning:whole||burst,reason:whole&&burst?'fast_descent_and_burst':whole?'fast_descent':burst?'rapid_segment':'within_reference',peakWindow:best};
}
