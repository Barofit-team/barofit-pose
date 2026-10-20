import config from './config.js';
const IDS={left:{S:11,E:13,W:15,H:23,A:27},right:{S:12,E:14,W:16,H:24,A:28}};
const finite=Number.isFinite;
export const TEXT={HIP_DROP:'골반이 아래로 처지지 않게 유지해 보세요.',HIP_RAISE:'골반이 너무 높게 올라가지 않게 유지해 보세요.',ELBOW_SHALLOW:'팔꿈치를 조금 더 굽혀 내려가 보세요.',CHEST_RANGE_LOW:'상체의 위아래 이동 범위를 조금 더 늘려 보세요.',RETURN_INCOMPLETE:'올라올 때 팔을 조금 더 펴 보세요.',HAND_TOWARD_HEAD:'손 위치가 머리 쪽으로 치우쳤는지 확인해 보세요.',HAND_TOWARD_HIP:'손 위치가 몸 아래쪽으로 치우쳤는지 확인해 보세요.'};
export function quantile(values,q){const a=values.filter(finite).sort((a,b)=>a-b);if(!a.length)return NaN;const pos=(a.length-1)*q,i=Math.floor(pos);return a[i]+(a[Math.min(i+1,a.length-1)]-a[i])*(pos-i);}
const norm=a=>Math.hypot(...a),sub=(a,b)=>a.map((v,i)=>v-b[i]),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
export function features(points,width,height,side,cfg=config){
  const xy={},good={},max=Math.max(width,height),vis=cfg.pipeline.cfg;
  for(const [k,j] of Object.entries(IDS[side])){
    const q=points?.[j];good[k]=!!q&&q.slice(0,5).every(finite)&&q[3]>=vis.visibility_min&&q[4]>=vis.presence_min&&q[0]>=0&&q[0]<=1&&q[1]>=0&&q[1]<=1;
    if(good[k])xy[k]=[q[0]*width,q[1]*height];
  }
  const f={elbow:NaN,hip:NaN,chest:NaN,hand:NaN,body:NaN,horizontal:NaN};
  if(good.S&&good.E&&good.W){const u=sub(xy.S,xy.E),v=sub(xy.W,xy.E),d=norm(u)*norm(v);if(d>9)f.elbow=Math.acos(Math.max(-1,Math.min(1,dot(u,v)/d)))*180/Math.PI;}
  if(good.S&&good.A){const a=sub(xy.A,xy.S),l=norm(a);f.body=l/max;
    if(l>.15*max){f.horizontal=Math.abs(a[0])/l;
      if(good.H&&f.horizontal>.25){const h=sub(xy.H,xy.S);f.hip=100*(a[0]*h[1]-a[1]*h[0])*Math.sign(a[0])/(l*l);}
      if(good.W&&f.horizontal>.5){f.chest=(xy.W[1]-xy.S[1])/max;f.hand=dot(sub(xy.W,xy.S),a)/(l*l);}
    }
  }
  const quality=Object.values(IDS[side]).flatMap(j=>[points?.[j]?.[3]??0,points?.[j]?.[4]??0]).map(x=>finite(x)?x:0);
  f.quality=quality.reduce((s,v)=>s+v,0)/quality.length;
  f.score=(finite(f.elbow)?1:0)+(finite(f.hip)?1:0)+f.quality;
  return f;
}
class Cycle{
  constructor(noise,source,cfg){Object.assign(this,{noise,source,cfg});this.reset();}
  reset(){this.peak=null;this.bottom=null;this.last=null;}
  update(x,t,valid){
    if(!valid||!finite(x)){this.reset();return null;}
    if(this.last!==null&&t-this.last>this.cfg.gap_s)this.reset();this.last=t;
    if(!this.peak){this.peak={x,t};return null;}
    if(t-this.peak.t>this.cfg.max_s){this.peak={x,t};this.bottom=null;return null;}
    if(!this.bottom){if(x>=this.peak.x)this.peak={x,t};else if(this.peak.x-x>=this.noise)this.bottom={x,t};}
    else{
      if(x<this.bottom.x)this.bottom={x,t};const drop=this.peak.x-this.bottom.x;
      if(x-this.bottom.x>=Math.max(this.noise,this.cfg.return_fraction*drop)){
        let r=null;if(t-this.peak.t>=this.cfg.min_s&&this.bottom.t>this.peak.t)r={start_s:this.peak.t,bottom_s:this.bottom.t,end_s:t,detected_s:t,signal:this.source,amplitude:drop};
        this.peak={x,t};this.bottom=null;return r;
      }
    }return null;
  }
}
function same(a,b,c){const overlap=Math.max(0,Math.min(a.end_s,b.end_s)-Math.max(a.start_s,b.start_s)),shorter=Math.min(a.end_s-a.start_s,b.end_s-b.start_s);return overlap>0&&(Math.abs(a.bottom_s-b.bottom_s)<=c.merge_bottom_s||(shorter>0&&overlap/shorter>=.65));}

export class PushupEngine{
  constructor({side='auto',settings=config}={}){
    this.cfg=structuredCloneSafe(settings);this.side=side==='auto'?null:side;if(this.side&&!IDS[this.side])throw Error('Invalid side');
    this.warmStart=null;this.scores={left:[],right:[]};this.count=0;this.lastTime=null;this.rows=[];this.recent=[];this.smoothState={};
    this.cycles=[new Cycle(settings.motion.elbow_noise_deg,'elbow',settings.motion),new Cycle(settings.motion.shoulder_noise_body,'shoulder',settings.motion)];
    this.hipDir=0;this.hipSince=null;this.hipActive=false;this.tracking=null;this.lastFeedback=[];this.hipCode='';
    this.totals=Object.fromEntries(['hip','elbow','chest','hand','return'].map(k=>[k,{evaluable:0,compliant:0,warning:0,unknown:0}]));
    this.closed=false;this.lastRated=null;
  }
  smooth(k,x,t){const old=this.smoothState[k];let v=x;if(!finite(x))v=NaN;else if(old&&finite(old.v)&&t-old.t<=this.cfg.pipeline.cfg.missing_reset_s){const a=1-Math.exp(-(t-old.t)/this.cfg.pipeline.cfg.ema_tau_s);v=old.v+a*(x-old.v);}this.smoothState[k]={v,t};return v;}
  hipState(x,t,gap=false){
    if(gap){this.hipDir=0;this.hipSince=null;this.hipActive=false;}
    if(!finite(x)){this.hipDir=0;this.hipSince=null;this.hipActive=false;return 'tracking_unavailable';}
    const {hip_low:lo,hip_high:hi}=this.cfg.limits,mid=(lo+hi)/2,sign=x>hi?1:x<lo?-1:0;
    if(sign){if(sign!==this.hipDir){this.hipDir=sign;this.hipSince=t;this.hipActive=false;}if(this.hipSince===null)this.hipSince=t;if(t-this.hipSince>=this.cfg.pipeline.cfg.feedback_hold_s)this.hipActive=true;}
    else if(x>=mid+(lo-mid)*this.cfg.pipeline.cfg.release_ratio&&x<=mid+(hi-mid)*this.cfg.pipeline.cfg.release_ratio){this.hipDir=0;this.hipSince=null;this.hipActive=false;}
    else if(!this.hipActive)this.hipSince=null;
    return this.hipActive?(this.hipDir===1?'hip_drop':'hip_raise'):this.hipSince!==null?'candidate':'within_reference';
  }
  pushFrame({landmarks,width,height,timestampMs}){
    const t=timestampMs/1000;if(!finite(t)||width<=0||height<=0)throw Error('Invalid frame');
    if(this.closed||this.lastTime!==null&&t<=this.lastTime)return {ignored:true,events:[],count:this.count};
    if(!this.side){
      if(this.warmStart===null)this.warmStart=t;
      for(const s of ['left','right'])this.scores[s].push(features(landmarks,width,height,s,this.cfg).score);
      if(t-this.warmStart<this.cfg.side_warmup_s)return {events:[],count:this.count,tracking:'selecting_side',side:null,codes:[]};
      const mean=s=>this.scores[s].reduce((a,b)=>a+b,0)/this.scores[s].length;
      if(Math.max(mean('left'),mean('right'))<1){this.scores={left:[],right:[]};this.warmStart=t;return {events:[],count:this.count,tracking:'tracking_unavailable',codes:[]};}
      this.side=mean('left')>=mean('right')?'left':'right';this.scores={left:[],right:[]};
    }
    return this.pushFeatures({...features(landmarks,width,height,this.side,this.cfg),t});
  }
  pushFeatures(f){
    const t=f.t,events=[];if(!finite(t))throw Error('Invalid timestamp');
    if(this.closed||this.lastTime!==null&&t<=this.lastTime)return {ignored:true,events:[],count:this.count};
    const gap=this.lastTime!==null&&t-this.lastTime>this.cfg.pipeline.cfg.missing_reset_s;
    this.lastTime=t;
    for(const k of ['elbow','hip','chest','hand'])f[k]=this.smooth(k,f[k],t);
    f.hipStatus=this.hipState(f.hip,t,gap);const valid=f.horizontal>=.5&&f.body>.15;
    f.valid=valid&&(finite(f.elbow)||finite(f.chest));this.rows.push(f);
    const tracking=f.valid?'tracking':'tracking_unavailable';
    if(tracking!==this.tracking){events.push({type:'tracking.changed',t,status:tracking});this.tracking=tracking;}
    const hipCode={hip_drop:'HIP_DROP',hip_raise:'HIP_RAISE'}[f.hipStatus]??'';
    if(hipCode!==this.hipCode){this.hipCode=hipCode;events.push({type:'feedback.changed',t,scope:'current_hip',codes:hipCode?[hipCode]:[]});}
    const candidates=[this.cycles[0].update(f.elbow,t,valid),this.cycles[1].update(f.chest/f.body,t,valid)].filter(Boolean);
    for(const c of candidates){
      const dup=[...this.recent].reverse().find(r=>same(r,c,this.cfg.motion));
      if(dup){if(!dup.signals.includes(c.signal))dup.signals.push(c.signal);continue;}
      const r={...c,rep:++this.count,signals:[c.signal],rated:false};this.recent.push(r);
      events.push({type:'rep.completed',t,rep:r.rep,start_s:r.start_s,bottom_s:r.bottom_s,end_s:r.end_s,signal:r.signal});
    }
    for(const r of this.recent){
      if(r.rated||t+1e-9<r.detected_s+this.cfg.motion.feedback_wait_s)continue;
      const next=this.recent.find(n=>n.rep>r.rep&&n.detected_s<=t);const end=next?Math.max(r.end_s,Math.min(t,next.start_s)):t;
      const rating=this.rate(r,end);r.rated=true;r.rating=rating;this.lastRated={rep:r.rep,t,...rating};this.recordRating(rating);
      events.push({type:'rep.feedback',t,rep:r.rep,...rating,feedback_end_s:end});
    }
    const hold=this.cfg.motion.hold_s;const active=this.lastRated&&this.lastRated.rep===this.count&&t-this.lastRated.t<=hold?this.lastRated:null;
    const codes=[...new Set([...(hipCode?[hipCode]:[]),...(active?.codes??[])])];
    this.rows=this.rows.filter(r=>t-r.t<=this.cfg.motion.max_s+this.cfg.motion.feedback_wait_s+2);
    this.recent=this.recent.filter(r=>!r.rated||t-r.end_s<=this.cfg.motion.max_s+1);
    return {events,count:this.count,side:this.side,tracking,codes,items:active?.items??null,hipStatus:f.hipStatus,t};
  }
  rate(rep,end){
    const p=this.rows.filter(r=>r.t>=rep.start_s&&r.t<=end),w=p.filter(r=>Math.abs(r.t-rep.bottom_s)<=this.cfg.pipeline.common.bottom_window_s);
    const cov=(a,k)=>a.length?a.filter(r=>finite(r[k])).length/a.length:0;
    const enough=(a,k)=>a.filter(r=>finite(r[k])).length>=3&&cov(a,k)>=this.cfg.pipeline.common.coverage;
    const vals=(a,k)=>a.map(r=>r[k]);const lim=this.cfg.limits;
    const scale=quantile(vals(p,'body'),.5),elbow=enough(w,'elbow')?quantile(vals(w,'elbow'),.5):NaN;
    const chest=enough(p,'chest')&&scale>.15?(quantile(vals(p,'chest'),.95)-quantile(vals(p,'chest'),.05))/scale:NaN;
    const hand=enough(w,'hand')?quantile(vals(w,'hand'),.5):NaN;
    const drop=p.some(r=>r.hipStatus==='hip_drop'),rise=p.some(r=>r.hipStatus==='hip_raise');
    const items={hip:drop||rise?'warning':p.length&&p.filter(r=>r.hipStatus!=='tracking_unavailable').length/p.length>=this.cfg.pipeline.common.coverage?'within_reference':'tracking_unavailable',
      elbow:finite(elbow)?elbow>lim.elbow_max?'warning':'within_reference':'tracking_unavailable',
      chest:finite(chest)?chest<lim.chest_min?'warning':'within_reference':'tracking_unavailable',hand:'tracking_unavailable',return:'tracking_unavailable'};
    if(finite(hand))items.hand=cov(w,'hip')<this.cfg.pipeline.common.coverage?'body_unavailable':w.some(r=>r.hip<lim.hip_low||r.hip>lim.hip_high)?'body_deviation':hand>=lim.hand_low&&hand<=lim.hand_high?'within_reference':'warning';
    const rebound=p.filter(r=>r.t>=rep.end_s);if(enough(rebound,'elbow'))items.return=quantile(vals(rebound,'elbow'),.9)<this.cfg.return_elbow_deg?'warning':'within_reference';
    const codes=[];if(drop)codes.push('HIP_DROP');if(rise)codes.push('HIP_RAISE');
    if(items.elbow==='warning')codes.push('ELBOW_SHALLOW');if(items.chest==='warning')codes.push('CHEST_RANGE_LOW');
    if(items.hand==='warning')codes.push(hand<lim.hand_low?'HAND_TOWARD_HEAD':'HAND_TOWARD_HIP');if(items.return==='warning')codes.push('RETURN_INCOMPLETE');
    return {items,codes,metrics:{elbow_bottom_deg:finite(elbow)?elbow:null,chest_range:finite(chest)?chest:null,hand_position:finite(hand)?hand:null}};
  }
  recordRating(r){for(const [k,s] of Object.entries(r.items)){const a=this.totals[k];if(['within_reference','warning'].includes(s)){a.evaluable++;a[s==='warning'?'warning':'compliant']++;}else a.unknown++;}}
  breakContinuity(){
    const events=[];for(const r of this.recent)if(!r.rated){const items=Object.fromEntries(Object.keys(this.totals).map(k=>[k,'interrupted']));r.rated=true;this.recordRating({items});events.push({type:'rep.feedback',t:this.lastTime??0,rep:r.rep,items,codes:[],reason:'interrupted'});}
    this.rows=[];this.recent=[];this.smoothState={};this.cycles.forEach(c=>c.reset());this.hipDir=0;this.hipSince=null;this.hipActive=false;this.hipCode='';this.lastRated=null;
    return events;
  }
  finish(){if(this.closed)return [];const events=this.breakContinuity();this.closed=true;
    const items=Object.fromEntries(Object.entries(this.totals).map(([k,v])=>[k,{...v,compliance_pct:v.evaluable?100*v.compliant/v.evaluable:null}]));
    return [...events,{type:'set.completed',t:this.lastTime??0,count:this.count,items}];
  }
}
function structuredCloneSafe(x){return JSON.parse(JSON.stringify(x));}
