import {installReport} from '../common/report.js';
import {validateFrame} from '../common/frame.js';
import {frameResult} from '../common/realtime.js';
import {itemResult,setSummary,setCompleted} from '../common/result.js';
import {measure} from './measurements.js';

export const PILOT_VERSION='five-exercise-pilot-0.1';
const EXERCISES=['jump_squat','reverse_crunch','flutter_kicks','burpee','situp'];

/** Experimental motion counters. Form scoring and frontend session lifecycle are not inferred. */
class PilotAnalyzer {
  constructor(exercise,{side=null}={}) {installReport(this);
    if(!EXERCISES.includes(exercise) || ![null,'left','right'].includes(side) ||
       (exercise==='flutter_kicks' && side!==null)) throw new RangeError('Invalid exercise or side');
    Object.assign(this,{exercise,fixedSide:side,version:PILOT_VERSION,count:0,
      observedSeconds:0,gapSeconds:0,lastTime:null,closed:false,reps:[]});
    this.resetMotion();
  }
  resetMotion() {
    this.side=null;this.phase='positioning';this.pending=null;this.since=null;
    this.cycleStart=null;this.phaseTime=null;this.previousValid=false;
    this.baseline=null;this.calibration=[];this.swaps=0;this.latest=null;this.measurementMode=null;
  }
  breakContinuity(reason='pause') {
    if(this.closed) return [];
    this.resetMotion();this.resumePending=true;
    return [{type:'tracking.interrupted',t:this.lastTime===null?null:this.lastTime/1000,reason}];
  }
  held(token,t,ms) {
    if(token===null) {this.pending=null;this.since=null;return false;}
    if(token!==this.pending) {this.pending=token;this.since=t;return false;}
    if(t-this.since<ms) return false;
    this.pending=null;this.since=null;return true;
  }
  complete(t,metrics,events) {
    this.latest={number:++this.count,timestampMs:t,items:{form:'unknown'},codes:[],metrics:{...metrics}};
    this.reps.push(this.latest);
    events.push({type:'rep.completed',t:t/1000,rep:this.count,side:this.side});
    this.cycleStart=null;
  }
  calibrate(m,t) {
    const jump=this.exercise==='jump_squat';
    const standing=jump?m.kneeDeg>=155 && m.torsoDeg>=55:
      m.kneeDeg>=150 && m.torsoDeg>=55 && m.ankleY-m.shoulderY>.15;
    if(!standing) {this.calibration=[];return false;}
    this.calibration.push({t,...m});
    if(t-this.calibration[0].t<300) return false;
    const median=key=>{
      const v=this.calibration.map(x=>x[key]).sort((a,b)=>a-b);
      return v[Math.floor(v.length/2)];
    };
    this.baseline=jump?{floor:median('ankleY')}:
      {shoulder:median('shoulderY'),height:median('ankleY')-median('shoulderY')};
    this.calibration=[];this.phase='ready';
    return true;
  }
  advance(m,t,events) {
    const id=this.exercise;
    if((id==='jump_squat'||id==='burpee') && !this.baseline) {this.calibrate(m,t);return;}
    if(this.cycleStart!==null && t-this.cycleStart>10000) {
      const side=this.side;
      this.resetMotion();this.side=side;
      events.push({type:'tracking.interrupted',t:t/1000,reason:'cycle_timeout'});
      return;
    }
    if(id==='jump_squat') {
      const lift=this.baseline.floor-m.ankleY;
      m.ankleLift=lift;
      const token=this.phase==='ready'?(m.kneeDeg<130?'crouched':null):
        this.phase==='crouched'?(m.kneeDeg>145 && lift>.065?'airborne':null):
        lift<.025?'landed':null;
      if(this.held(token,t,60)) {
        if(token==='landed'){this.complete(t,m,events);this.phase='ready';}
        else {this.phase=token;if(token==='crouched')this.cycleStart=t;}
      }
    } else if(id==='burpee') {
      const drop=(m.shoulderY-this.baseline.shoulder)/this.baseline.height;
      m.shoulderDropRatio=drop;
      const upright=drop<.23 && (m.hipY-m.shoulderY)/this.baseline.height>.26;
      // Require an extended floor position as well as shoulder descent, rejecting a crouch-only cycle.
      const floor=drop>.58 && m.wristY>m.shoulderY-.02 &&
        Math.abs(m.torsoDeg)<40 && m.kneeDeg>140;
      const token=this.phase==='ready'?(floor?'floor':null):(upright?'returned':null);
      if(this.held(token,t,token==='floor'?150:100)) {
        if(token==='returned'){this.complete(t,m,events);this.phase='ready';}
        else {this.phase='floor';this.cycleStart=t;}
      }
    } else if(id==='flutter_kicks') {
      if(this.phaseTime!==null && t-this.phaseTime>1500) {
        this.phase='positioning';this.swaps=0;this.pending=null;this.phaseTime=null;this.cycleStart=null;
      }
      const d=m.leftDeg-m.rightDeg;
      m.separationDeg=d;
      const token=Math.max(m.leftDeg,m.rightDeg)>=8 && Math.abs(d)>=12?(d>0?'left_up':'right_up'):null;
      if(token===this.phase) {this.pending=null;return;}
      if(this.held(token,t,70)) {
        if(this.phase!=='positioning') {
          if(t-this.phaseTime<160) return;
          if(++this.swaps===2) {this.complete(t,m,events);this.swaps=0;}
        }
        this.phase=token;this.phaseTime=t;this.cycleStart??=t;
      }
    } else {
      const sit=id==='situp', value=sit?m.torsoDeg:m.kneeDistanceRatio;
      const rest=sit?value<=24:value>=1.63, active=sit?value>=48:value<=1.49;
      const token=this.phase==='positioning'?(rest?'ready':null):
        this.phase==='ready'?(active?'active':null):(rest?'returned':null);
      if(this.held(token,t,sit?90:160)) {
        if(token==='returned'){this.complete(t,m,events);this.phase='ready';}
        else {this.phase=token;if(token==='active')this.cycleStart=t;}
      }
    }
  }
  pushFrame(frame) {
    validateFrame(frame);
    const t=frame.timestampMs;
    const ignoredReason=this.closed?'finished':this.lastTime!==null&&t<=this.lastTime?'non_monotonic_timestamp':null;
    const context={exercise:this.exercise,engineVersion:this.version,ignoredReason};
    const snapshot=()=>({count:this.count,observedSeconds:this.observedSeconds});
    if(ignoredReason) return frameResult(snapshot(),frame,context);
    const events=[],dimensions=frame.width+'x'+frame.height;
    const dt=this.lastTime===null||this.resumePending?0:t-this.lastTime;
    if(dt>350 || (this.dimensions && this.dimensions!==dimensions)) {
      const reason=dt>350?'frame_gap':'dimensions_changed';
      this.resetMotion();
      if(dt>350)this.gapSeconds+=dt/1000;
      events.push({type:'tracking.interrupted',t:t/1000,reason});
    }
    this.dimensions=dimensions;this.lastTime=t;this.resumePending=false;
    const candidates=this.fixedSide?[this.fixedSide]:['left','right'];
    let side=this.side,metrics=side?measure(this.exercise,frame,side):null;
    if(!metrics) {
      if(this.side!==null) {
        this.resetMotion();
        events.push({type:'tracking.interrupted',t:t/1000,reason:'tracking_lost'});
      }
      const quality=s=>{
        const ids=this.exercise==='burpee'?[11,15,23,25,27]:[11,23,25,27];
        return Math.min(...ids.map(i=>Math.min(...frame.landmarks[i+(s==='right'?1:0)].slice(3))));
      };
      side=candidates.filter(s=>measure(this.exercise,frame,s)!==null)
        .sort((a,b)=>quality(b)-quality(a))[0]??null;
      metrics=side?measure(this.exercise,frame,side):null;
    }
    if(metrics && this.exercise==='jump_squat' && this.fixedSide===null) {
      const other=measure(this.exercise,frame,side==='left'?'right':'left');
      const mode=other?'both':side;
      if(this.measurementMode!==null && this.measurementMode!==mode) {
        this.resetMotion();
        events.push({type:'tracking.interrupted',t:t/1000,reason:'measurement_side_changed'});
      }
      this.measurementMode=mode;
      if(other)metrics={...metrics,kneeDeg:Math.min(metrics.kneeDeg,other.kneeDeg),
        ankleY:(metrics.ankleY+other.ankleY)/2,measurementSides:'both'};
    }
    if(metrics) {
      // A change of working side cannot bridge an unfinished repetition.
      if(this.previousValid && side===this.side)this.observedSeconds+=dt/1000;
      this.side=side;this.previousValid=true;
      this.advance(metrics,t,events);
    } else {this.resetMotion();}
    const result=frameResult({...snapshot(),side:this.exercise==='flutter_kicks'?null:this.side,
      tracking:metrics?'tracking':'tracking_unavailable',
      movementPhase:metrics?this.phase:'unobservable',items:{form:'unknown'},codes:[],metrics:metrics??{},events,
      experimental:true,postureAssessment:'unreviewed'},frame,context);
    if(this.latest && t-this.latest.timestampMs<=1000) result.lastRepetition=structuredClone(this.latest);
    return result;
  }
  summary() {
    return setSummary({exercise:this.exercise,engineVersion:this.version,count:this.count,
      observedSeconds:this.observedSeconds,gapSeconds:this.gapSeconds,
      items:{form:itemResult('repetition',0,0,this.count)},
      details:{experimental:true,postureAssessment:'unreviewed',repetitions:this.reps}});
  }
  finish() {
    if(this.closed)return [];
    this.closed=true;
    this.resetMotion();
    return [setCompleted(this.summary(),this.lastTime)];
  }
}
export class JumpSquatAnalyzer extends PilotAnalyzer {constructor(options){super('jump_squat',options);}}
export class ReverseCrunchAnalyzer extends PilotAnalyzer {constructor(options){super('reverse_crunch',options);}}
export class FlutterKicksAnalyzer extends PilotAnalyzer {constructor(options){super('flutter_kicks',options);}}
export class BurpeeAnalyzer extends PilotAnalyzer {constructor(options){super('burpee',options);}}
export class SitupAnalyzer extends PilotAnalyzer {constructor(options){super('situp',options);}}
