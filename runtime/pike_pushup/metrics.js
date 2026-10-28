function angle(a,b,c){const u=[a[0]-b[0],a[1]-b[1]],v=[c[0]-b[0],c[1]-b[1]],d=Math.hypot(...u)*Math.hypot(...v);return d>1e-6?Math.acos(Math.max(-1,Math.min(1,(u[0]*v[0]+u[1]*v[1])/d)))*180/Math.PI:null;}
export function pikeMetrics(frame,side,visibility=.5){
 const ids=side==='left'?{s:11,e:13,w:15,h:23,k:25,a:27,n:0}:{s:12,e:14,w:16,h:24,k:26,a:28,n:0};
 const p={},qs=[];
 for(const [key,id]of Object.entries(ids)){const q=frame.landmarks[id];if(q&&[q[0],q[1],q[3],q[4]].every(Number.isFinite)&&Math.min(q[3],q[4])>=visibility&&q[0]>=0&&q[0]<=1&&q[1]>=0&&q[1]<=1){p[key]=[q[0]*frame.width,q[1]*frame.height];if(key!=='n')qs.push(Math.min(q[3],q[4]));}}
 if(!['s','e','w','h','k','a'].every(k=>p[k]))return null;
 const {s,e,w,h,k,a,n}=p,torso=Math.hypot(s[0]-h[0],s[1]-h[1]),span=Math.hypot(a[0]-w[0],a[1]-w[1]);
 if(torso<20||span<torso)return null;
 const u=[(a[0]-w[0])/span,(a[1]-w[1])/span],v=u[0]>0?[u[1],-u[0]]:[-u[1],u[0]];
 const project=(q,axis)=>((q[0]-w[0])*axis[0]+(q[1]-w[1])*axis[1])/torso;
 const hipHeight=project(h,v),shoulderHeight=project(s,v),hipDeg=angle(s,h,k),hipAnkleDeg=angle(s,h,a),elbowDeg=angle(s,e,w),overheadDeg=angle(h,s,w);
 const headForward=n?-project(n,u):null,forearmTiltDeg=Math.atan2(Math.abs(project(e,u)),Math.abs(project(e,v)))*180/Math.PI;
 const wristBelowShoulder=shoulderHeight>.15,hipAboveShoulder=hipHeight-shoulderHeight;
 const bodyReady=wristBelowShoulder&&hipHeight>.35&&hipAboveShoulder>-.15&&hipAnkleDeg<165&&project(h,u)>.05&&Math.abs(u[1])<.45;
 return {elbowDeg,hipDeg,hipAnkleDeg,overheadDeg,headForward,forearmTiltDeg,hipHeight,shoulderHeight,hipAboveShoulder,bodyReady,torsoLengthPx:torso,quality:Math.min(...qs),points:p,landmarkIds:Object.values(ids)};
}
