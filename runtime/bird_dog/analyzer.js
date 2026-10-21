import {pushRealtime} from '../common/realtime.js';
import {validateFrame, jsonSafe} from '../common/frame.js';
import {timeSummary,setCompleted} from '../common/result.js';
import {legAlignment, JOINTS} from './legacy-v05.js';
export {legAlignment, JOINTS};
export const BIRD_DOG_VERSION='bird-dog-prototype-1.0';
export const BIRD_DOG_CONFIG=Object.freeze({confidence:.5,camera_roll_deg:0,max_gap_seconds:.4,
  joint_grace_seconds:.20,smooth_seconds:.12,prepare_seconds:.25,reach_enter_ratio:.40,reach_exit_ratio:.30,
  endpoint_ratio:.45,plateau_speed_ratio_s:.35,plateau_seconds:.12,return_speed_ratio_s:.45,
  return_drop_ratio:.12,min_excursion_seconds:.45,min_observed_hold_seconds:.25,return_confirm_seconds:.10,
  thigh_high_deg:20,knee_min_deg:155,arm_high_deg:20,arm_low_deg:-25,elbow_min_deg:155,
  support_offset_ratio:.30,arm_settle_seconds:.35,arm_motion_ratio_s:.45,joint_angle_speed_deg_s:35,body_window_seconds:.8,body_settle_seconds:.3,
  body_shift_ratio:.12,trunk_change_deg:12,warning_seconds:.35});
const SIDES=['left','right'],OTHER={left:'right',right:'left'};
const SIDE_ITEMS=['leg_high','knee_bent','arm_high','arm_low','elbow_bent','hand_alignment','support_knee_alignment'];
const ITEMS=[...SIDES.flatMap(s=>SIDE_ITEMS.map(k=>`${s}_${k}`)),'same_side_pair','body_movement'];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1]],norm=a=>Math.hypot(...a),dot=(a,b)=>a[0]*b[0]+a[1]*b[1];
const deg=x=>x*180/Math.PI,ptp=a=>Math.max(...a)-Math.min(...a);
function angle(a,b,c){const u=sub(a,b),v=sub(c,b),d=norm(u)*norm(v);return d>1e-6?deg(Math.acos(Math.max(-1,Math.min(1,dot(u,v)/d)))):null;}
/** Same causal rules as analysis/bird_dog/prototype_v1.py. No network required. */
export class BirdDogAnalyzer {
  constructor(config={}){
    this.config={...BIRD_DOG_CONFIG,...config};
    if(!Object.values(this.config).every(Number.isFinite))throw new TypeError('Config must be finite');
    if(this.config.smooth_seconds<=0||this.config.max_gap_seconds<=0)throw new TypeError('Time intervals must be positive');
    this.lastTime=null;this.dims=null;this.previous=null;this.count=0;
    this.holdSeconds=0;this.observedSeconds=0;this.gapSeconds=0;
    this.sideCounts={left:0,right:0};this.repetitions=[];this.closed=false;
    this.totals=Object.fromEntries(ITEMS.map(k=>[k,{compliant_s:0,warning_s:0,unknown_s:0,not_applicable_s:0}]));
    this.resetMotion();
  }
  resetMotion(){
    this.filtered=null;this.previousGood=null;
    this.motion=Object.fromEntries(SIDES.map(s=>[s,{phase:'unknown',progress:null,peak:0,stable:null,
      base:null,armed:false,cycle:null,returned:null,held_since:null,last_valid:null}]));
    this.since={};this.armSince={};this.limbPrevious={};this.bodyHistory=[];this.bodyKey=null;this.globalBase=null;this.contextSeen=false;
  }
  interrupt(reason,t){return SIDES.filter(s=>this.motion[s].cycle).map(side=>({type:'rep.interrupted',t,side,reason,
    start_s:this.motion[side].cycle.start_s,hold_s:this.motion[side].cycle.hold_s}));}
  breakContinuity(reason='pause'){
    if(this.closed)return [];
    const events=this.interrupt(reason,this.lastTime);this.resetMotion();this.previous=null;return events;
  }
  state(key,raw,t,unavailable='unknown'){
    if(raw===null){delete this.since[key];return unavailable;}
    if(!raw){delete this.since[key];return 'within_reference';}
    this.since[key]??=t;
    return t-this.since[key]>=this.config.warning_seconds-1e-8?'warning':'pending_feedback';
  }
  phase(side,progress,t,dt,events){
    const m=this.motion[side],c=this.config;
    if(progress===null){
      if(m.last_valid!==null&&t-m.last_valid<=c.joint_grace_seconds){
        Object.assign(m,{phase:'unknown',progress:null,held_since:null,stable:null});return ['unknown',null];
      }
      if(m.cycle)events.push({type:'rep.interrupted',t,side,reason:'leg_tracking_lost',start_s:m.cycle.start_s,hold_s:m.cycle.hold_s});
      const wasArmed=m.armed&&m.cycle===null;
      Object.assign(m,{phase:'unknown',progress:null,peak:0,stable:null,base:null,armed:wasArmed,cycle:null,returned:null,held_since:null});
      return ['unknown',null];
    }
    m.last_valid=t;
    const speed=dt&&m.progress!==null?(progress-m.progress)/dt:0;m.progress=progress;
    if(progress<c.reach_exit_ratio){
      m.base??=t;
      if(m.cycle){
        m.returned??=t;
        if(t-m.returned>=c.return_confirm_seconds-1e-8){
          const cy=m.cycle;
          if(cy.peak>=c.endpoint_ratio&&t-cy.start_s>=c.min_excursion_seconds&&cy.hold_s>=c.min_observed_hold_seconds-1e-8){
            this.count++;this.sideCounts[side]++;
            const rep={index:this.count,side,start_s:cy.start_s,end_s:t,hold_s:cy.hold_s,codes:[...cy.codes].sort()};
            this.repetitions.push(rep);events.push({type:'rep.completed',t,...rep});
          }
          m.cycle=null;
        }
      }
      Object.assign(m,{phase:'preparation',peak:0,stable:null,held_since:null});
      if(t-m.base>=c.prepare_seconds-1e-8)m.armed=true;
    }else{
      m.base=null;m.returned=null;
      if(progress>=c.reach_enter_ratio){
        if(m.armed&&m.cycle===null){m.cycle={start_s:t,peak:progress,hold_s:0,codes:new Set()};m.armed=false;events.push({type:'rep.started',t,side});}
        if(['preparation','unknown'].includes(m.phase))Object.assign(m,{phase:'reaching',peak:progress,stable:null});
        m.peak=Math.max(m.peak,progress);if(m.cycle)m.cycle.peak=Math.max(m.cycle.peak,progress);
        if(speed<-c.return_speed_ratio_s&&m.peak-progress>=c.return_drop_ratio)Object.assign(m,{phase:'returning',stable:null,held_since:null});
        else if(m.phase==='holding'&&progress>=c.endpoint_ratio){/* Keep established hold through small coordinate fluctuations. */}
        else if(progress>=c.endpoint_ratio&&Math.abs(speed)<c.plateau_speed_ratio_s){
          m.stable??=t;if(t-m.stable>=c.plateau_seconds-1e-8){m.phase='holding';m.held_since??=t;}
        }else if(m.phase!=='returning'||speed>c.return_speed_ratio_s)Object.assign(m,{phase:'reaching',stable:null,held_since:null});
      }else if(!['preparation','unknown'].includes(m.phase))Object.assign(m,{phase:'returning',stable:null,held_since:null});
    }
    return [m.phase,speed];
  }
  pushFrame(frame) { return pushRealtime(this,frame,'bird_dog',BIRD_DOG_VERSION); }
  _pushFrameLegacy(frame) {
    if(this.closed)throw new Error('Analyzer already finished');
    validateFrame(frame);
    const t=frame.timestampMs/1000,c=this.config,dims=[frame.width,frame.height];
    if(this.lastTime!==null&&t<=this.lastTime)return {...this.previous,ignored:true,events:[]};
    let dt=this.lastTime===null?0:t-this.lastTime,events=[];
    if(dt>c.max_gap_seconds||(this.dims&&dims.some((v,i)=>v!==this.dims[i]))){
      this.gapSeconds+=dt;events.push(...this.breakContinuity('frame_gap_or_dimensions'),{type:'frame.gap',t,duration_s:dt});dt=0;
    }
    this.lastTime=t;this.dims=dims;
    const p=frame.landmarks.length?frame.landmarks:Array.from({length:33},()=>Array(5).fill(null));
    const good=p.map(v=>[0,1,3,4].every(i=>Number.isFinite(v[i]))&&v[3]>=c.confidence&&v[4]>=c.confidence&&v[0]>=0&&v[0]<=1&&v[1]>=0&&v[1]<=1);
    const r=-c.camera_roll_deg*Math.PI/180,co=Math.cos(r),si=Math.sin(r);
    const xy=p.map(v=>{const x=v[0]===null?NaN:v[0]*dims[0],y=v[1]===null?NaN:v[1]*dims[1];return [x*co-y*si,x*si+y*co];});
    if(this.filtered===null)this.filtered=xy.map(v=>[...v]);
    const alpha=dt?1-Math.exp(-dt/c.smooth_seconds):1;
    for(let i=0;i<33;i++)if(good[i]){
      if(this.previousGood?.[i])for(let j=0;j<2;j++)this.filtered[i][j]+=alpha*(xy[i][j]-this.filtered[i][j]);
      else this.filtered[i]=[...xy[i]];
    }
    this.previousGood=[...good];const q=this.filtered,metrics={};
    for(const [side,[s,e,w,h,k,a]] of Object.entries(JOINTS)){
      const m={length:null,trunk_deg:null,reach_ratio:null,arm_active:null,support_arm:false,support_leg:false,
        thigh_alignment_deg:null,leg_alignment_deg:null,knee_angle_filtered_deg:null,arm_alignment_deg:null,
        arm_floor_deg:null,elbow_angle_filtered_deg:null,hand_offset_ratio:null,knee_offset_ratio:null};metrics[side]=m;
      if(!good[s]||!good[h])continue;
      const v=sub(q[s],q[h]),L=norm(v);if(L<=15)continue;const u=v.map(x=>x/L);
      m.length=L;m.trunk_deg=deg(Math.atan2(u[1],Math.abs(u[0])));
      if(good[k]){
        m.reach_ratio=dot(sub(q[h],q[k]),u)/L;m.support_leg=q[k][1]-q[h][1]>.30*L&&m.reach_ratio<.60;
        m.knee_offset_ratio=Math.abs(q[k][0]-q[h][0])/L;m.thigh_alignment_deg=legAlignment(q[s],q[h],q[k])[0];
      }
      if(good[w]){
        m.hand_offset_ratio=Math.abs(q[w][0]-q[s][0])/L;m.arm_active=dot(sub(q[w],q[s]),u)/L>.30&&q[w][1]-q[s][1]<Math.sqrt(3)*Math.abs(q[w][0]-q[s][0]);
        m.support_arm=q[w][1]-q[s][1]>.35*L&&!m.arm_active;
      }else if(good[e])m.arm_active=dot(sub(q[e],q[s]),u)/L>.20&&q[e][1]-q[s][1]<Math.sqrt(3)*Math.abs(q[e][0]-q[s][0]);
      if(good[e]){m.arm_alignment_deg=legAlignment(q[h],q[s],q[e])[0];m.arm_floor_deg=deg(Math.atan2(q[s][1]-q[e][1],Math.abs(q[e][0]-q[s][0])));}
      if(good[a])m.leg_alignment_deg=legAlignment(q[s],q[h],q[a])[0];
      for(const [ids,key] of [[[h,k,a],'knee_angle_filtered_deg'],[[s,e,w],'elbow_angle_filtered_deg']]){
        if(ids.every(i=>good[i])&&Math.min(norm(sub(q[ids[0]],q[ids[1]])),norm(sub(q[ids[2]],q[ids[1]])))>15)m[key]=angle(...ids.map(i=>q[i]));
      }
      const prev=this.limbPrevious[side],armVector=good[e]?sub(q[e],q[s]).map(x=>x/L):null,knee=m.knee_angle_filtered_deg;
      m.arm_speed_ratio_s=dt&&armVector!==null&&prev&&prev.arm!==null?norm(sub(armVector,prev.arm))/dt:null;
      m.knee_speed_deg_s=dt&&knee!==null&&prev&&prev.knee!==null?Math.abs(knee-prev.knee)/dt:null;
      this.limbPrevious[side]={arm:armVector,knee};
    }
    const ms=Object.values(metrics),horizontal=ms.some(m=>m.trunk_deg!==null&&Math.abs(m.trunk_deg)<40);
    const context=horizontal&&(ms.some(m=>m.support_leg)||(this.contextSeen&&ms.some(m=>m.support_arm)));this.contextSeen=context;
    const base=context&&ms.some(m=>m.support_leg)&&ms.every(m=>m.reach_ratio===null||m.reach_ratio<.32)&&!ms.some(m=>m.arm_active===true);
    this.globalBase=base?(this.globalBase??t):null;
    if(this.globalBase!==null&&t-this.globalBase>=c.prepare_seconds)for(const m of Object.values(this.motion))if(m.cycle===null)m.armed=true;
    const phases={};
    for(const side of SIDES){const m=metrics[side],[phase,speed]=this.phase(side,context?m.reach_ratio:null,t,dt,events);phases[side]=phase;Object.assign(m,{phase,reach_speed_ratio_s:speed,quadruped:context});if(!context)this.motion[side].armed=false;}
    const holding=SIDES.filter(s=>phases[s]==='holding'),prevHolding=this.previous?.holdingSides??[];
    const validHolds=holding.filter(s=>prevHolding.includes(s));
    if(validHolds.length){this.holdSeconds+=dt;for(const s of validHolds)if(this.motion[s].cycle)this.motion[s].cycle.hold_s+=dt;}
    const items={};
    for(const side of SIDES){
      const m=metrics[side],eligible=holding.includes(side);
      for(const [name,key,check] of [['leg_high','thigh_alignment_deg',x=>x>c.thigh_high_deg],['knee_bent','knee_angle_filtered_deg',x=>x<c.knee_min_deg]]){
        const val=m[key],keyName=`${side}_${name}`,settled=name!=='knee_bent'||(m.knee_speed_deg_s!==null&&m.knee_speed_deg_s!==undefined&&m.knee_speed_deg_s<c.joint_angle_speed_deg_s);items[keyName]=this.state(keyName,eligible&&settled&&val!==null?check(val):null,t,context&&!eligible&&phases[side]!=='unknown'?'not_applicable':'unknown');
      }
      const active=context&&holding.length>0&&m.arm_active===true&&m.arm_speed_ratio_s!==null&&m.arm_speed_ratio_s!==undefined&&m.arm_speed_ratio_s<c.arm_motion_ratio_s;
      if(active)this.armSince[side]??=t;else delete this.armSince[side];
      const armEligible=active&&t-this.armSince[side]>=c.arm_settle_seconds-1e-8;
      for(const [name,key,check] of [['arm_high','arm_alignment_deg',x=>x>c.arm_high_deg&&m.arm_floor_deg>c.arm_high_deg],
        ['arm_low','arm_alignment_deg',x=>x<c.arm_low_deg&&m.arm_floor_deg<c.arm_low_deg],['elbow_bent','elbow_angle_filtered_deg',x=>x<c.elbow_min_deg]]){
        const val=m[key],keyName=`${side}_${name}`;items[keyName]=this.state(keyName,armEligible&&val!==null?check(val):null,t,context&&m.arm_active===false?'not_applicable':'unknown');
      }
      const stable=context&&Object.values(phases).every(v=>['preparation','unknown','holding'].includes(v));
      for(const [name,key,support] of [['hand_alignment','hand_offset_ratio','support_arm'],['support_knee_alignment','knee_offset_ratio','support_leg']]){
        const val=m[key],keyName=`${side}_${name}`;items[keyName]=this.state(keyName,stable&&m[support]&&val!==null?val>c.support_offset_ratio:null,t,context&&val!==null&&!m[support]?'not_applicable':'unknown');
      }
    }
    const arms=SIDES.filter(s=>metrics[s].arm_active===true),known=SIDES.every(s=>metrics[s].arm_active!==null);
    const pair=arms.length===1&&holding.length===1&&known?arms[0]===holding[0]:null;
    items.same_side_pair=this.state('same_side_pair',pair,t,!holding.length&&context?'not_applicable':'unknown');
    const body={reference_ready:false,reference_kind:'within_hold_window',side:null,anchor:null,perpendicular_shift_ratio:null,trunk_change_deg:null};
    const candidates=[];
    for(const side of holding){
      const [s,e,w,h,k,a]=JOINTS[side],otherK=JOINTS[OTHER[side]][4];
      const anchor=metrics[side].support_arm&&good[w]?w:good[otherK]&&metrics[OTHER[side]].support_leg?otherK:null;
      if(anchor!==null&&good[s]&&good[h])candidates.push([side,anchor]);
    }
    const quality=x=>Math.min(...[JOINTS[x[0]][0],JOINTS[x[0]][3],x[1]].flatMap(i=>p[i].slice(3,5)));
    const selected=candidates.reduce((best,x)=>best===null||quality(x)>quality(best)?x:best,null);
    if(JSON.stringify(selected)!==JSON.stringify(this.bodyKey)){this.bodyHistory=[];delete this.since.body_movement;}
    this.bodyKey=selected;let bodyBad=null;
    if(selected){
      const [side,anchor]=selected,[s,,,h]=JOINTS[side],heldSince=this.motion[side].held_since,L=metrics[side].length;
      if(heldSince!==null&&t-heldSince>=c.body_settle_seconds){
        this.bodyHistory.push([t,[s,h].map(i=>sub(q[i],q[anchor]).map(x=>x/L)),metrics[side].trunk_deg]);
        while(this.bodyHistory.length&&t-this.bodyHistory[0][0]>c.body_window_seconds)this.bodyHistory.shift();
        if(this.bodyHistory.length>2&&t-this.bodyHistory[0][0]>=c.body_window_seconds*.65){
          const shift=Math.max(...[0,1].map(i=>ptp(this.bodyHistory.map(v=>v[1][i][1])))),tilt=ptp(this.bodyHistory.map(v=>v[2]));
          Object.assign(body,{reference_ready:true,side,anchor,perpendicular_shift_ratio:shift,trunk_change_deg:tilt});bodyBad=shift>c.body_shift_ratio||tilt>c.trunk_change_deg;
        }
      }
    }
    items.body_movement=this.state('body_movement',bodyBad,t,context&&!holding.length?'not_applicable':'unknown');
    items.lumbar_neutral='not_supported';items.axial_rotation='not_supported';
    const codes=Object.entries(items).filter(([,v])=>v==='warning').map(([k])=>k.toUpperCase());
    for(const m of Object.values(this.motion))if(m.cycle)for(const code of codes)m.cycle.codes.add(code);
    const movement=!context?'not_ready':['returning','reaching','holding'].find(v=>Object.values(phases).includes(v))??'preparation';
    const phase=['reaching','holding'].includes(movement)?'bird_dog':movement;
    if(this.previous&&dt){
      this.observedSeconds+=dt;
      for(const k of ITEMS){const state=items[k]===this.previous.items[k]?items[k]:'unknown';this.totals[k][{within_reference:'compliant_s',warning:'warning_s',not_applicable:'not_applicable_s'}[state]??'unknown_s']+=dt;}
    }
    if(!this.previous||phase!==this.previous.phase)events.push({type:'phase.changed',t,phase,movementPhase:movement});
    if(!this.previous||JSON.stringify(codes)!==JSON.stringify(this.previous.codes))events.push({type:'feedback.changed',t,codes});
    const row=jsonSafe({schemaVersion:'1.0',exercise:'bird_dog',engineVersion:BIRD_DOG_VERSION,timestampMs:frame.timestampMs,
      ignored:false,tracking:context?'tracking':'tracking_unavailable',side:holding.length===1?holding[0]:null,
      count:this.count,holdSeconds:this.holdSeconds,observedSeconds:this.observedSeconds,sideCounts:{...this.sideCounts},
      phase,movementPhase:movement,holdingSides:holding,codes,items,metrics,body,events,referenceStatus:'not_required',
      experimental:true,thresholdBasis:'engineering_candidates_not_clinically_validated'});
    this.previous=row;return row;
  }
  summary(){
    const items={};for(const [k,v] of Object.entries(this.totals)){const den=v.compliant_s+v.warning_s;items[k]={...v,assessed_s:den,compliance:den?v.compliant_s/den:null};}
    return timeSummary({schemaVersion:'1.0',exercise:'bird_dog',engineVersion:BIRD_DOG_VERSION,count:this.count,
      holdSeconds:this.holdSeconds,sideCounts:{...this.sideCounts},observedSeconds:this.observedSeconds,gapSeconds:this.gapSeconds,
      repetitions:this.repetitions,items,configuration:this.configuration()});
  }
  finish(){if(this.closed)return [];const events=this.interrupt('set_finished',this.lastTime);this.closed=true;return [...events,setCompleted(this.summary(),this.lastTime===null?null:this.lastTime*1000)];}
  configuration(){return {version:BIRD_DOG_VERSION,parameters:{...this.config},enabled_items:ITEMS,
    repetition_unit:'One leg out-and-back = one; left+right = two; quality does not gate count',
    hold_policy:'Observed holding time, not necessarily correct posture; gaps excluded',
    body_policy:'Within-hold movement only, not lumbar curvature',unsupported:['lumbar_neutral','axial_rotation']};}
}
