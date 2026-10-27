const deg=x=>x*180/Math.PI;
export function angle(a,b,c){const u=[a[0]-b[0],a[1]-b[1]],v=[c[0]-b[0],c[1]-b[1]],d=Math.hypot(...u)*Math.hypot(...v);return d>1e-6?deg(Math.acos(Math.max(-1,Math.min(1,(u[0]*v[0]+u[1]*v[1])/d)))):null;}
export function supermanMetrics(frame,side,visibility=.5){
 const ids=side==='left'?{s:11,e:13,w:15,h:23,k:25,a:27,ear:7,nose:0}:{s:12,e:14,w:16,h:24,k:26,a:28,ear:8,nose:0};
 const p={},quality={};for(const [key,id]of Object.entries(ids)){const q=frame.landmarks[id];if(q&&[q[0],q[1],q[3],q[4]].every(Number.isFinite)&&Math.min(q[3],q[4])>=visibility&&q[0]>=0&&q[0]<=1&&q[1]>=0&&q[1]<=1){p[key]=[q[0]*frame.width,q[1]*frame.height];quality[key]=Math.min(q[3],q[4]);}}
 if(!p.s||!p.h||!p.k||!p.a)return null;
 const {s,h,k,a,e,w,ear,nose}=p,torso=Math.hypot(s[0]-h[0],s[1]-h[1]),thigh=Math.hypot(k[0]-h[0],k[1]-h[1]);
 if(torso<20||thigh<15)return null;
 const dir=Math.sign(s[0]-h[0]);
 const trunkTiltDeg=deg(Math.atan2(h[1]-s[1],Math.abs(s[0]-h[0]))),thighTiltDeg=deg(Math.atan2(h[1]-k[1],Math.abs(k[0]-h[0])));
 const kneeDeg=angle(h,k,a),elbowDeg=e&&w?angle(s,e,w):null,armBodyDeg=e?angle(h,s,e):null;
 // Sum of opposite-facing segment tilts cancels camera roll. This is not spinal curvature.
 const extensionDeg=trunkTiltDeg+thighTiltDeg;
 const armOut=e?(e[0]-s[0])*dir>-.10*torso:false;
 const legOut=(k[0]-h[0])*dir<-.30*thigh;
 const bodyReady=Math.abs(s[0]-h[0])>.70*torso&&legOut&&Math.abs(trunkTiltDeg)<40&&Math.abs(thighTiltDeg)<45&&kneeDeg>35;
 // Displacement below the trunk axis, in torso lengths; invariant to mirror/roll.
 // This identifies a support-like configuration, not actual ground contact.
 const below=q=>q?((q[1]-s[1])*(s[0]-h[0])-(q[0]-s[0])*(s[1]-h[1]))*dir/(torso*torso):null;
 const wristBelowTrunk=below(w),elbowBelowTrunk=below(e);
 let headTiltDeg=null;
 if(ear&&nose){const u=[(s[0]-h[0])/torso,(s[1]-h[1])/torso],n=[-u[1]*dir,u[0]*dir],f=[nose[0]-ear[0],nose[1]-ear[1]];if(Math.hypot(...f)>.035*torso)headTiltDeg=deg(Math.atan2(f[0]*u[0]+f[1]*u[1],f[0]*n[0]+f[1]*n[1]));}
 return {extensionDeg,trunkTiltDeg,thighTiltDeg,kneeDeg,elbowDeg,armBodyDeg,headTiltDeg,armOut,bodyReady,wristBelowTrunk,elbowBelowTrunk,quality:Math.min(quality.s,quality.h,quality.k,quality.a),torsoLengthPx:torso,landmarkIds:Object.values(ids),points:p};
}
