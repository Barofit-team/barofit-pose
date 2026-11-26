import {validateFrame,jsonSafe} from './frame.js';
import {CameraReadiness} from './readiness.js';
import {observeSessionTracking} from './report.js';

export const SESSION_CONFIG=Object.freeze({
  lossMs:2000,countdownMs:5000,stabilizeMs:300,maxFrameGapMs:400,
});

/** One controller owns one analyzer; camera observations continue while measurement is suspended. */
export class ExerciseSessionController {
  constructor({analyzer,exercise,side,lossMs=SESSION_CONFIG.lossMs,
    countdownMs=SESSION_CONFIG.countdownMs,stabilizeMs=SESSION_CONFIG.stabilizeMs,
    maxFrameGapMs=SESSION_CONFIG.maxFrameGapMs}={}) {
    if(!analyzer || !['pushFrame','breakContinuity','summary','finish'].every(k=>typeof analyzer[k]==='function'))
      throw new TypeError('Expected an exercise analyzer');
    const summary=analyzer.summary();
    exercise??=summary.exercise;
    if(exercise!==summary.exercise)throw new RangeError('Analyzer exercise does not match');
    const fixed=analyzer.fixedSide??analyzer.selector?.fixed??null;
    side??=fixed;
    if(fixed!==null&&side!==fixed)throw new RangeError('Session side must match fixed analyzer side');
    if(![lossMs,stabilizeMs,maxFrameGapMs].every(n=>Number.isFinite(n)&&n>0)||
       !Number.isFinite(countdownMs)||countdownMs<0)throw new RangeError('Invalid session durations');
    Object.assign(this,{analyzer,exercise,lossMs,countdownMs,stabilizeMs,maxFrameGapMs});
    this.readiness=new CameraReadiness({exercise,side,stableMs:stabilizeMs,
      maxGapMs:maxFrameGapMs,switchToVisibleSide:true});
    this.phase='waiting_for_pose';this.lastTime=null;this.lastFrameTime=null;
    this.lossSince=null;this.countdownSince=null;this.needsCountdown=false;
    this.started=false;this.measurementActive=false;this.closed=false;this.dimensions=null;
    this.recognition={observable:false,stable:false,side:null,reasonCode:'NO_PERSON',observedAtMs:null};
  }
  summary(){return this.analyzer.summary();}
  getState(){return this.snapshot(this.lastTime);}
  snapshot(t,events=[],frameResult=null,ignoredReason=null) {
    if(ignoredReason===null&&Number.isFinite(t))observeSessionTracking(this.analyzer,t,this.recognition.observable,
      this.started&&!['manually_paused','countdown','finished'].includes(this.phase));
    return jsonSafe({schemaVersion:'1.0',type:'session.state',exercise:this.exercise,
      timestampMs:t,phase:this.phase,ignored:ignoredReason!==null,ignoredReason,
      measurementEnabled:ignoredReason===null&&this.phase==='active'&&!this.closed,
      recognition:this.recognition,
      lossDurationMs:this.lossSince===null?0:Math.max(0,(t??0)-this.lossSince),
      countdownRemainingMs:this.countdownSince===null?null:Math.max(0,this.countdownMs-(t-this.countdownSince)),
      frameResult,events,summary:this.summary()});
  }
  reject(t,isFrame) {
    if(!Number.isFinite(t)||t<0)throw new TypeError('Expected a nonnegative timestampMs');
    return this.closed?'finished':
      this.lastTime!==null&&t<this.lastTime || isFrame&&this.lastFrameTime!==null&&t<=this.lastFrameTime?
        'non_monotonic_timestamp':null;
  }
  setPhase(phase,t,events) {
    if(this.phase===phase)return;
    events.push({type:'session.phase_changed',timestampMs:t,from:this.phase,to:phase});
    this.phase=phase;
  }
  suspend(reason,t,events) {
    if(!this.measurementActive)return;
    events.push(...this.analyzer.breakContinuity(reason));
    events.push({type:'session.measurement_suspended',timestampMs:t,reason});
    this.measurementActive=false;
  }
  cancelCountdown(reason,t,events) {
    if(this.countdownSince===null)return;
    this.countdownSince=null;
    events.push({type:'session.countdown_cancelled',timestampMs:t,reason});
  }
  unavailable(t,since,reason,events) {
    this.recognition={...this.recognition,observable:false,stable:false,side:null,reasonCode:reason};
    if(this.phase==='manually_paused')return;
    this.suspend('measurement_unavailable',t,events);
    if(this.countdownSince!==null)this.readiness.breakContinuity();
    this.cancelCountdown(reason,t,events);
    if(!this.started&&!this.needsCountdown){
      this.setPhase('waiting_for_pose',t,events);return;
    }
    this.lossSince??=since;
    if(this.needsCountdown || t-this.lossSince>=this.lossMs) {
      if(!this.needsCountdown)events.push({type:'session.auto_paused',timestampMs:t,reason:'measurement_unavailable'});
      this.needsCountdown=true;this.setPhase('auto_paused',t,events);
    } else this.setPhase('recognition_lost',t,events);
  }
  checkSilence(t,events) {
    if(this.lastFrameTime===null||t-this.lastFrameTime<=this.maxFrameGapMs)return;
    this.readiness.breakContinuity();
    this.unavailable(t,this.lastFrameTime,'CAMERA_FRAME_TIMEOUT',events);
  }
  pushFrame(frame) {
    validateFrame(frame);
    const t=frame.timestampMs,reason=this.reject(t,true);
    if(reason)return this.snapshot(t,[],null,reason);
    const events=[];
    this.checkSilence(t,events);
    this.lastTime=t;
    const dimensions=frame.width+'x'+frame.height;
    if(this.dimensions!==null&&dimensions!==this.dimensions) {
      this.readiness.breakContinuity();
      this.suspend('dimensions_changed',t,events);
      this.cancelCountdown('dimensions_changed',t,events);
    }
    this.dimensions=dimensions;this.lastFrameTime=t;
    const observation=this.readiness.pushFrame(frame);
    const candidate=observation.selectedSide??observation.candidateSide;
    this.recognition={observable:observation.observable,stable:observation.ready&&observation.observable,
      side:observation.observable?candidate:null,reasonCode:observation.reasonCode,observedAtMs:t};
    if(this.phase==='manually_paused')return this.snapshot(t,events);
    // Recovery at the threshold still confirms the preceding continuous loss.
    if(this.lossSince!==null&&this.started&&t-this.lossSince>=this.lossMs&&!this.needsCountdown)
      this.unavailable(t,this.lossSince,this.recognition.reasonCode,events);
    if(!observation.observable) {
      this.unavailable(t,t,observation.reasonCode,events);
      return this.snapshot(t,events);
    }
    this.recognition={observable:observation.observable,stable:observation.ready&&observation.observable,
      side:observation.observable?candidate:null,reasonCode:observation.reasonCode,observedAtMs:t};
    this.lossSince=null;
    if(!this.recognition.stable) {
      this.suspend('recognition_stabilizing',t,events);
      this.cancelCountdown('recognition_stabilizing',t,events);
      this.setPhase(this.needsCountdown?'auto_paused':'waiting_for_pose',t,events);
      return this.snapshot(t,events);
    }
    if(this.needsCountdown) {
      if(this.countdownSince===null) {
        this.countdownSince=t;
        events.push({type:'session.countdown_started',timestampMs:t,durationMs:this.countdownMs});
      }
      if(t-this.countdownSince<this.countdownMs) {
        this.setPhase('countdown',t,events);return this.snapshot(t,events);
      }
      this.countdownSince=null;this.needsCountdown=false;
      events.push({type:'session.resumed',timestampMs:t});
    }
    this.setPhase('active',t,events);
    const result=this.analyzer.pushFrame(frame);
    this.measurementActive=true;this.started=true;
    return this.snapshot(t,events,result);
  }
  /** Same monotonic time origin as camera packets; never feeds a synthetic analyzer frame. */
  tick(timestampMs) {
    const reason=this.reject(timestampMs,false);
    if(reason)return this.snapshot(timestampMs,[],null,reason);
    const events=[];this.lastTime=timestampMs;
    this.checkSilence(timestampMs,events);
    if(this.lossSince!==null&&!this.recognition.observable&&this.phase!=='manually_paused')
      this.unavailable(timestampMs,this.lossSince,this.recognition.reasonCode,events);
    return this.snapshot(timestampMs,events);
  }
  pause(reason='manual_pause') {
    if(this.closed)return this.snapshot(this.lastTime,[],null,'finished');
    const events=[];
    this.suspend(reason,this.lastTime,events);this.cancelCountdown(reason,this.lastTime,events);
    this.lossSince=null;this.needsCountdown=true;
    this.readiness.breakContinuity();
    this.setPhase('manually_paused',this.lastTime,events);
    return this.snapshot(this.lastTime,events);
  }
  resume() {
    if(this.closed)return this.snapshot(this.lastTime,[],null,'finished');
    if(this.phase!=='manually_paused')return this.snapshot(this.lastTime);
    this.readiness.breakContinuity();this.lossSince=null;this.needsCountdown=true;
    this.recognition={...this.recognition,stable:false,side:null,reasonCode:'STABILIZING'};
    const events=[];this.setPhase('auto_paused',this.lastTime,events);
    return this.snapshot(this.lastTime,events);
  }
  finish() {
    if(this.closed)return [];
    const events=this.analyzer.finish();
    this.closed=true;this.phase='finished';this.countdownSince=null;
    this.measurementActive=false;return events;
  }
}
