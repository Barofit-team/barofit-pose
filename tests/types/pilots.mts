import {JumpSquatAnalyzer,ReverseCrunchAnalyzer,FlutterKicksAnalyzer,BurpeeAnalyzer,SitupAnalyzer,
  CameraReadiness,PILOT_VERSION,type PoseFrame,type FrameResult,type BaseExerciseAnalyzer} from '../../runtime/index.js';
const frame:PoseFrame={width:640,height:480,timestampMs:0,landmarks:[]};
const analyzers:BaseExerciseAnalyzer[]=[new JumpSquatAnalyzer({side:'right'}),new ReverseCrunchAnalyzer(),
  new FlutterKicksAnalyzer(),new BurpeeAnalyzer(),new SitupAnalyzer()];
for(const a of analyzers) {
  const r:FrameResult=a.pushFrame(frame);
  if(r.exercise==='jump_squat') {
    const count:number=r.count;
    const experimental:true=r.details.experimental;
    void count;void experimental;
  }
  a.summary();a.breakContinuity();a.finish();
}
new SitupAnalyzer().breakContinuity('camera_lost');
new CameraReadiness({exercise:'flutter_kicks'});
const version:string=PILOT_VERSION;
void version;
// @ts-expect-error Flutter kicks requires both legs, not a fixed working side.
new FlutterKicksAnalyzer({side:'left'});

import {ExerciseSessionController,SESSION_CONFIG,type SessionState} from '../../runtime/index.js';
const session=new ExerciseSessionController({analyzer:new SitupAnalyzer()});
const state:SessionState=session.pushFrame(frame);
const countdown:number|null=state.countdownRemainingMs;
if(state.frameResult?.exercise==='situp') {
  const count:number=state.frameResult.count;
  void count;
}
session.tick(100);session.pause('auto_pause');session.resume();session.summary();session.finish();
new CameraReadiness({exercise:'side_plank',switchToVisibleSide:true});
void countdown;void SESSION_CONFIG;

import {workoutReportFields,ITEM_LABELS,type SetReport} from '../../runtime/index.js';
const report:SetReport=new SitupAnalyzer().summary().details.report;
const labels:Record<string,string>=new SitupAnalyzer().summary().details.itemLabels;
const upload=workoutReportFields(session.summary());
const trackingPct:number|null=upload.trackingAvailablePct;
void report;void labels;void trackingPct;void ITEM_LABELS;

const legacySummary:import('../../runtime/index.js').SetSummary={
 schemaVersion:'2.0',exercise:'plank',engineVersion:'legacy',count:null,holdSeconds:0,
 observedSeconds:0,gapSeconds:0,items:{},details:{},
};
void legacySummary;
