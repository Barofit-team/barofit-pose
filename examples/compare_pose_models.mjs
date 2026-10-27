import fs from 'node:fs';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {PushupAnalyzer,PlankAnalyzer,BirdDogAnalyzer,JumpingJackAnalyzer} from '../runtime/index.js';
import {moveNetLandmarks} from '../runtime/adapters/movenet.js';
const [manifest,root]=process.argv.slice(2);if(!manifest||!root)throw Error('node examples/compare_pose_models.mjs manifest.json output-directory');
const constructors={pushup:PushupAnalyzer,plank:PlankAnalyzer,bird_dog:BirdDogAnalyzer,jumping_jack:JumpingJackAnalyzer};
// Export only: remove floating point overshoot such as 100.00000000000001.
// Preserve the raw engine result alongside it; never change rule state/counts.
function exportSet(event){
 const copy=structuredClone(event);
 for(const item of Object.values(copy.summary.items)){
  const p=item.compliancePct;
  if(typeof p==='number'&&p>100&&p<100+1e-9)item.compliancePct=100;
  if(typeof p==='number'&&p<0&&p>-1e-9)item.compliancePct=0;
 }
 return copy;
}
for(const c of JSON.parse(fs.readFileSync(manifest,'utf8'))){
 for(const variant of ['mediapipe','movenet','movenet_crop',...(process.argv.includes('--sensitivity')?['movenet_crop_q30']:[])]){
  const dir=path.join(root,c.id),input=path.join(dir,(variant==='movenet_crop_q30'?'movenet_crop':variant)+'_input.jsonl');if(!fs.existsSync(input))continue;
  const analyzer=new constructors[c.exercise](),rows=fs.readFileSync(input,'utf8').trim().split('\n').map(JSON.parse),times=[];
  const results=rows.map(r=>{
   // Diagnostic sensitivity only: map raw .3 to legacy gate .5. Not calibrated,
   // not a production change, and not evidence of improved correctness.
   const kp=variant==='movenet_crop_q30'?r.keypoints.map(([y,x,s])=>[y,x,s<.3?s*.5/.3:.5+(s-.3)*.5/.7]):r.keypoints;
   const f={timestampMs:r.timestampMs,width:r.width,height:r.height,landmarks:r.landmarks??moveNetLandmarks(kp)};const st=performance.now();const result=analyzer.pushFrame(f);times.push(performance.now()-st);return result;
  });
  fs.writeFileSync(path.join(dir,variant+'_results.jsonl'),results.map(r=>JSON.stringify(r)).join('\n'));
  const event=analyzer.finish().find(x=>x.type==='set.completed');
  fs.writeFileSync(path.join(dir,variant+'_set_raw.json'),JSON.stringify(event,null,2));
  fs.writeFileSync(path.join(dir,variant+'_set.json'),JSON.stringify(exportSet(event),null,2));
  fs.writeFileSync(path.join(dir,variant+'_engine_ms.json'),JSON.stringify(times));
  console.log(c.id,variant,'count',analyzer.summary().count,'hold',analyzer.summary().holdSeconds);
 }
}
