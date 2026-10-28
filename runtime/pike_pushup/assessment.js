// Side-view trajectory measurements. Limits are engineering values fitted to
// reviewed clips, not normative anatomical angles or a diagnosis of spinal form.
export const PATH_CONFIG=Object.freeze({feedbackSettleMs:600,settleReversalDeg:6,
 pathWindowMs:120,minPathDrop:.15,minPathSamples:4,headTravelRatioMin:.8,
 headTravelRatioNearHandsMin:1,returnHipRiseRatioMin:.5,returnShoulderRiseMin:.2,
 returnBackwardRatioMin:.5,pikeRecoveryOverheadMinDeg:120,headForearmTiltMinDeg:40,
 hipRecoveryRiseRatioMin:.9,lateAscentFraction:.5,pathDwellMs:100});
export const median=a=>{a=a.filter(Number.isFinite).sort((a,b)=>a-b);return a.length?a[Math.floor(a.length/2)]:null;};
const avg=(rows,key)=>median(rows.map(x=>x[key]));
const sustained=(rows,predicate,ms)=>{let since=null;for(const r of rows){if(predicate(r)){since??=r.t;if(r.t-since>=ms)return true;}else since=null;}return false;};
export function assessPath(rows,top,bottom,c,{settled=false}={}){
 const unknown={pike_shape:'unknown',head_path:'unknown',press_return:'unknown'};
 if(!top?.points||!bottom||rows.length<c.minPathSamples)return {items:unknown,metrics:{pathAssessmentComplete:settled}};
 const p=top.points,w=p.w,dx=p.a[0]-w[0],dy=p.a[1]-w[1],span=Math.hypot(dx,dy),L=top.torsoLengthPx;
 if(!(L>0&&span>0))return {items:unknown,metrics:{pathAssessmentComplete:settled}};
 const u=[dx/span,dy/span],v=u[0]>0?[u[1],-u[0]]:[-u[1],u[0]];
 const project=(r,k)=>{const q=r.points?.[k],wr=r.points?.w;if(!q||!wr)return [null,null];const x=q[0]-wr[0],y=q[1]-wr[1];return [-(x*u[0]+y*u[1])/L,(x*v[0]+y*v[1])/L];};
 const a=rows.map(r=>{const [sx,sy]=project(r,'s'),[nx,ny]=project(r,'n'),[hx,hy]=project(r,'h');return {...r,sx,sy,nx,ny,hx,hy};});
 const start=a.filter(x=>x.t<=top.t+c.pathWindowMs),bot=a.filter(x=>Math.abs(x.t-bottom.t)<=c.pathWindowMs/2);
 const desc=a.filter(x=>x.t<=bottom.t),asc=a.filter(x=>x.t>=bottom.t);
 // Select the furthest extension reached during the brief post-count window,
 // not a subsequent descent. Count timestamps and boundaries stay unchanged.
 const endRow=asc.reduce((best,x)=>x.elbowDeg>best.elbowDeg?x:best,asc[0]??a.at(-1));
 const end=a.filter(x=>x.t<=endRow.t&&x.t>=endRow.t-c.pathWindowMs);
 const sx0=avg(start,'sx'),sy0=avg(start,'sy'),nx0=avg(start,'nx'),ny0=avg(start,'ny'),hy0=avg(start,'hy');
 const sxb=avg(bot,'sx'),syb=avg(bot,'sy'),nxb=avg(bot,'nx'),nyb=avg(bot,'ny'),hyb=avg(bot,'hy');
 const sxe=avg(end,'sx'),sye=avg(end,'sy'),hye=avg(end,'hy');
 const sDrop=sy0-syb,sForward=sxb-sx0,nDrop=ny0===null||nyb===null?null:ny0-nyb,nForward=nx0===null||nxb===null?null:nxb-nx0;
 const headRatio=nDrop>c.minPathDrop?nForward/nDrop:null;
 const bottomHead=avg(bot,'headForward'),coverage=desc.filter(x=>x.nx!==null).length/Math.max(1,desc.length);
 const headKnown=desc.length>=c.minPathSamples&&coverage>=.6&&headRatio!==null&&bottomHead!==null;
 const bottomForearm=avg(bot,'forearmTiltDeg');
 const headBad=headKnown&&((headRatio<c.headTravelRatioMin&&bottomForearm>c.headForearmTiltMinDeg)||(bottomHead<c.headForwardMin&&headRatio<c.headTravelRatioNearHandsMin));
 const shoulderRise=sye-syb,hipRise=hye-hyb,backward=sxb-sxe;
 const riseRatio=shoulderRise>c.returnShoulderRiseMin?hipRise/shoulderRise:null;
 const backwardRatio=shoulderRise>c.returnShoulderRiseMin?backward/shoulderRise:null;
 const endOverhead=avg(end,'overheadDeg');
 // A vertical/incorrect descent changes the subsequent rise geometry too.
 // Do not count that same evidence as a separate failed press-return item.
 const outKnown=settled&&asc.length>=c.minPathSamples&&riseRatio!==null&&backwardRatio!==null&&!headBad;
 // A chest-first rise / poor pelvis recovery is a trajectory error, even if
 // the final shoulder angle happens to look acceptable for a single frame.
 const recoveryRows=asc.map(x=>({...x,rise:x.sy-syb,hipRise:x.hy-hyb}));
 const weakRecovery=x=>x.rise>c.returnShoulderRiseMin&&x.hipRise/x.rise<c.returnHipRiseRatioMin&&x.overheadDeg<c.pikeRecoveryOverheadMinDeg;
 const returnBad=outKnown&&(sustained(recoveryRows,weakRecovery,c.pathDwellMs)||(riseRatio<c.returnHipRiseRatioMin&&endOverhead<c.pikeRecoveryOverheadMinDeg)||(backwardRatio<c.returnBackwardRatioMin&&endOverhead<c.returnOverheadMinDeg));
 // Hip opening at the bottom is not itself a failure. Require a low/open
 // pike plus incomplete recovery after extension, instead of max(angle).
 const opened=sustained(a,x=>x.hipDeg>c.hipMaxDeg,c.warningDwellMs);
 const startHip=avg(start,'hipDeg'),endHip=avg(end,'hipDeg');
 const hipKnown=settled&&end.length>0;
 const lowRecovery=x=>(x.elbowDeg-bottom.elbowDeg)/Math.max(1,top.elbowDeg-bottom.elbowDeg)>=c.lateAscentFraction&&x.rise>c.returnShoulderRiseMin&&x.hipRise/x.rise<c.hipRecoveryRiseRatioMin&&x.overheadDeg<c.pikeRecoveryOverheadMinDeg;
 const hipBad=hipKnown&&((opened&&(sustained(recoveryRows,lowRecovery,c.pathDwellMs)||(riseRatio<c.hipRecoveryRiseRatioMin&&endOverhead<c.pikeRecoveryOverheadMinDeg)))||(startHip>c.hipMaxDeg&&endHip>c.hipMaxDeg));
 return {currentItems:{pike_shape:opened&&sustained(recoveryRows,lowRecovery,c.pathDwellMs)?'warning':'pending_feedback',head_path:headKnown?(headBad?'warning':'within_reference'):'pending_feedback',press_return:!headBad&&sustained(recoveryRows,weakRecovery,c.pathDwellMs)?'warning':'pending_feedback'},
  items:{pike_shape:hipKnown?(hipBad?'warning':'within_reference'):'unknown',head_path:headKnown?(headBad?'warning':'within_reference'):'unknown',press_return:outKnown?(returnBad?'warning':'within_reference'):'unknown'},
  metrics:{pathAssessmentComplete:settled,pathAssessmentEndMs:endRow.t,pathBasis:'wrist_relative_fixed_start_axis_and_torso_length',
   headTravelForward:nForward,headTravelDown:nDrop,headTravelRatio:headRatio,headPathCoverage:coverage,bottomForearmTiltDeg:bottomForearm,
   shoulderTravelForward:sForward,shoulderTravelDown:sDrop,returnShoulderRise:shoulderRise,returnHipRise:hipRise,
   returnHipRiseRatio:riseRatio,returnBackwardDistance:backward,returnBackwardRatio:backwardRatio,
   startHipDeg:startHip,settledHipDeg:endHip,settledOverheadDeg:endOverhead,
   startHipHeight:hy0,bottomHipHeight:hyb,settledHipHeight:hye,hipOpenedDuringMovement:opened,
   pressReturnAssessmentReason:headBad?'head_path_confound':!settled?'awaiting_return':riseRatio===null?'insufficient_visible_rise':'evaluated'}};
}
