import test from 'node:test';
import assert from 'node:assert/strict';
import {MountainClimberAnalyzer} from '../../runtime/index.js';
function packet(t, knee=.74, high=false){
  const landmarks=Array.from({length:33},()=>[null,null,null,null,null]);
  const place=(i,x,y)=>landmarks[i]=[x,y,0,1,1];
  for(const j of [0,1]){place(11+j,.3,.43);place(15+j,.31,.76);place(23+j,.6,high?.32:.45);
    place(25+j,j?.75:knee,.55);place(27+j,.9,.69);}
  return {timestampMs:t,width:800,height:600,landmarks};
}
test('one knee out and back counts once, high hip is independent of count',()=>{
 for(const high of [false,true]){
  const a=new MountainClimberAnalyzer();let r;
  for(const [i,knee] of [.75,.7,.49,.47,.48,.72].entries())r=a.pushFrame(packet(i*75,knee,high));
  assert.equal(r.count,1);assert.equal(r.lastRepetition.metrics.side,'left');
  assert.equal(a.summary().items.hip_height.warning,Number(high));assert.equal(r.schemaVersion,'2.0');
  const end=a.finish()[0];assert.equal(end.timestampMs,375);assert.equal(end.summary.items.hip_height.compliancePct,high?0:100);
  assert.deepEqual(a.finish(),[]);assert.equal(a.pushFrame(packet(500)).ignoredReason,'finished');
 }
});
test('loss, pause, gap and missing beginning cannot complete a spurious rep',()=>{
 for(const why of ['loss','pause','gap','partial']){
  const a=new MountainClimberAnalyzer();if(why!=='partial')a.pushFrame(packet(0));a.pushFrame(packet(100,.46));
  assert.equal(a.pushFrame(packet(100)).ignoredReason,'non_monotonic_timestamp');
  if(why==='pause')a.breakContinuity();if(why==='loss')a.pushFrame({...packet(160),landmarks:[]});
  a.pushFrame(packet(why==='gap'?900:210));assert.equal(a.summary().count,0);assert.equal(a.summary().items.hip_height.compliancePct,null);
 }
});
test('losing only support feet does not interrupt the knee cycle or certify good hips',()=>{
 for(const recovery of [200,320]){
  const a=new MountainClimberAnalyzer();
  a.pushFrame(packet(0));a.pushFrame(packet(100,.48));
  const hidden=packet(150,.48);hidden.landmarks[27]=hidden.landmarks[28]=[null,null,null,null,null];
  const r=a.pushFrame(hidden);assert.equal(r.tracking,'tracking');assert.equal(r.items.hip_height,'tracking_unavailable');assert.equal(r.count,0);
  const result=a.pushFrame(packet(recovery));assert.equal(result.count,1);
  assert.equal(result.lastRepetition.items.hip_height,'unknown');
  assert.equal(a.summary().items.hip_height.unknown,1);
  assert.equal(a.summary().items.hip_height.compliancePct,null);
 }
});
test('tilted torso and bent support legs: a visible horizontal knee cycle counts once',()=>{
 const a=new MountainClimberAnalyzer();
 for(const [i,x] of [.67,.67,.57,.46,.48,.58,.67,.67].entries()){
  const f=packet(i*60,x,true);
  for(const j of [0,1]){f.landmarks[27+j][0]=.70;f.landmarks[25+j][1]=.62;}
  const r=a.pushFrame(f);assert.equal(r.items.hip_height,'tracking_unavailable');
 }
 assert.equal(a.summary().count,1);assert.equal(a.summary().items.hip_height.unknown,1);
});
test('a clear horizontal excursion counts on an inclined torso, but a stationary knee does not',()=>{
 for(const [trace,count] of [[[.8,.65,.53,.53,.8],1],[[.59,.565,.58,.57,.59],0]]){
  const a=new MountainClimberAnalyzer();
  for(const [i,k] of trace.entries()){
   const f=packet(i*70,k);
   for(const j of [0,1]){f.landmarks[11+j][1]=.32;f.landmarks[23+j][1]=.52;f.landmarks[25+j][1]=.70;}
   a.pushFrame(f);
  }
  assert.equal(a.summary().count,count);
 }
});
test('a camera cut between the drive and the return cannot complete a rep',()=>{
 const a=new MountainClimberAnalyzer();
 a.pushFrame(packet(0));a.pushFrame(packet(90,.48));
 const cut=packet(180);for(const j of [0,1])cut.landmarks[15+j][0]+=.26;
 assert.equal(a.pushFrame(cut).count,0);
});

test('short knee and foot excursion counts once without reaching the form target',()=>{
 function run(mode){
  const a=new MountainClimberAnalyzer();
  for(const [i,d] of [0,0,.45,.9,1,1,.4,0,0].entries()){
   const f=packet(i*55);
   f.landmarks[25][0]=.76-(mode==='jitter'?.015:.10)*d;
   if(mode!=='foot still')f.landmarks[27][0]=.90-.08*d;
   if(mode==='both feet')f.landmarks[28][0]=f.landmarks[27][0];
   if(mode==='support rebound')f.landmarks[28][0]+=.18*d;
   if(mode==='cut' && i>=6)f.landmarks[15][0]+=.25;
   a.pushFrame(f);
  }
  return a.summary();
 }
 const s=run('short');assert.equal(s.count,1);
 assert.ok(s.details.repetitions[0].metrics.peakKneeForward<0);
 for(const mode of ['jitter','foot still','both feet','support rebound','cut'])assert.equal(run(mode).count,0,mode);
});
