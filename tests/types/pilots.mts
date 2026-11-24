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
