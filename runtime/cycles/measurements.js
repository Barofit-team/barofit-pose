// Measurements use image pixels to preserve the camera aspect ratio.
function point(frame, index) {
  const p = frame.landmarks[index];
  if (!p || ![0,1,3,4].every(i => Number.isFinite(p[i])) || Math.min(p[3],p[4]) < 0.5) return null;
  return [p[0]*frame.width, p[1]*frame.height];
}
function angle(a,b,c) {
  if (!a || !b || !c) return null;
  const x=a[0]-b[0], y=a[1]-b[1], u=c[0]-b[0], v=c[1]-b[1];
  const length=Math.hypot(x,y)*Math.hypot(u,v);
  return length ? Math.acos(Math.max(-1,Math.min(1,(x*u+y*v)/length)))*180/Math.PI : null;
}
export function measure(id, frame, side) {
  const offset=side==='right'?1:0;
  const joint=i=>point(frame,i+offset);
  const shoulder=joint(11), hip=joint(23), knee=joint(25), ankle=joint(27);
  const kneeAngle=angle(hip,knee,ankle);
  if (id==='standing_calf_raise') {
    const toe=joint(31), heel=joint(29);
    if (!toe || !heel || !hip || !shoulder) return null;
    const scale=toe[1]-shoulder[1];
    if (scale < 0.15*frame.height || hip[1]<=shoulder[1]) return null;
    return {signal:(toe[1]-heel[1])/scale, quality:kneeAngle};
  }
  if (id==='incline_pushup') {
    const elbow=angle(shoulder,joint(13),joint(15));
    if (elbow===null || !hip || Math.abs(hip[0]-shoulder[0]) < 0.2*Math.hypot(hip[0]-shoulder[0],hip[1]-shoulder[1])) return null;
    return {signal:180-elbow, quality:angle(shoulder,hip,ankle)};
  }
  if (id==='side_lying_leg_raise' || id==='dead_bug') {
    const hipAngle=angle(shoulder,hip,knee);
    if (hipAngle===null || Math.abs(hip[0]-shoulder[0]) < Math.abs(hip[1]-shoulder[1])) return null;
    if (id==='side_lying_leg_raise') return {signal:180-hipAngle, quality:kneeAngle};
    const opposite=i=>point(frame,i+1-offset);
    return {signal:hipAngle, quality:angle(opposite(23),opposite(11),opposite(15))};
  }
  if (kneeAngle===null || !shoulder || hip[1]<=shoulder[1]) return null;
  return {signal:180-kneeAngle, quality:Math.atan2(Math.abs(hip[0]-shoulder[0]),Math.abs(hip[1]-shoulder[1]))*180/Math.PI};
}

// Working-leg knee flexion for lunges/split squats; angles in degrees.
// Calf excursion is heel-to-toe height normalized by projected body height.
export const profiles = {
  lunge: {ready:30, active:55, target:70, quality:'trunk', max:35},
  split_squat: {ready:30, active:55, target:70, quality:'trunk', max:35},
  bulgarian_split_squat: {ready:30, active:55, target:70, quality:'trunk', max:35},
  incline_pushup: {ready:25, active:50, target:75, quality:'body_line', min:150},
  side_lying_leg_raise: {ready:15, active:20, target:35, quality:'knee_extension', min:155},
  standing_calf_raise: {ready:0.02, active:0.045, target:0.055, quality:'knee_extension', min:150},
  dead_bug: {ready:110, active:130, target:150, quality:'opposite_arm', min:125},
};
