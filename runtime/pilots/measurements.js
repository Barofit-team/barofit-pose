// Pixel coordinates preserve aspect ratio. Missing or out-of-frame joints are never imputed.
export function point(frame, id) {
  const p=frame.landmarks[id];
  if (!p || ![0,1,3,4].every(i=>Number.isFinite(p[i])) ||
      Math.min(p[3],p[4])<.5 || p[0]<0 || p[0]>1 || p[1]<0 || p[1]>1) return null;
  return [p[0]*frame.width,p[1]*frame.height];
}
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
function angle(a,b,c) {
  const u=[a[0]-b[0],a[1]-b[1]],v=[c[0]-b[0],c[1]-b[1]];
  const n=Math.hypot(...u)*Math.hypot(...v);
  return n<1?null:Math.acos(Math.max(-1,Math.min(1,(u[0]*v[0]+u[1]*v[1])/n)))*180/Math.PI;
}
export function measure(exercise,frame,side) {
  if(exercise==='flutter_kicks') {
    const [leftHip,rightHip,leftAnkle,rightAnkle,leftShoulder,rightShoulder]=
      [23,24,27,28,11,12].map(i=>point(frame,i));
    if([leftHip,rightHip,leftAnkle,rightAnkle,leftShoulder,rightShoulder].some(p=>!p))return null;
    if(distance(leftHip,leftAnkle)<8 || distance(rightHip,rightAnkle)<8)return null;
    const horizontal=(h,s)=>Math.abs(h[1]-s[1])<=Math.abs(h[0]-s[0]);
    if(!horizontal(leftHip,leftShoulder) && !horizontal(rightHip,rightShoulder))return null;
    const elevation=(hip,ankle)=>Math.atan2(hip[1]-ankle[1],Math.abs(hip[0]-ankle[0]))*180/Math.PI;
    return {leftDeg:elevation(leftHip,leftAnkle),rightDeg:elevation(rightHip,rightAnkle)};
  }
  const o=side==='right'?1:0;
  const [s,h,k,a]=[11,23,25,27].map(i=>point(frame,i+o));
  if (!s || !h || !k || !a) return null;
  const torso=distance(s,h);
  if(torso<frame.height*.04) return null;
  const kneeDeg=angle(h,k,a);
  if(kneeDeg===null) return null;
  const torsoDeg=Math.atan2(h[1]-s[1],Math.abs(h[0]-s[0]))*180/Math.PI;
  if(exercise==='jump_squat') {
    if(h[1]<=s[1] || a[1]<=h[1]) return null;
    return {kneeDeg,ankleY:a[1]/frame.height,torsoDeg};
  }
  if(exercise==='burpee') {
    const wrist=point(frame,15+o);
    if(!wrist) return null;
    return {shoulderY:s[1]/frame.height,hipY:h[1]/frame.height,
      ankleY:a[1]/frame.height,wristY:wrist[1]/frame.height,kneeDeg,torsoDeg};
  }
  // Floor exercises require the hip near ankle height; this excludes an upright stance.
  if(Math.abs(a[1]-h[1])>1.2*torso) return null;
  if(exercise==='situp') return {torsoDeg,kneeDeg};
  if(Math.abs(torsoDeg)>40) return null;
  if(exercise==='reverse_crunch') return {kneeDistanceRatio:distance(k,s)/torso,kneeDeg};
  return null;
}
