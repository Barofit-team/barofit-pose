// Install v2 result serialization in an existing replay site. Does not change pose rules.
import {readFile,writeFile,cp,copyFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../..');
if(!process.argv[2])throw new Error('Usage: node examples/web/install-result-contract.mjs <site/dist>');
const dest=resolve(process.argv[2]);
let app=await readFile(resolve(dest,'app.js'),'utf8');
if(!app.includes("from './result-modules/result.js'")){
  const changes=[
    ['session.events.push(...engine.finish());',"session.events.push(...engine.finish().map(e=>e.type==='set.completed'?setCompleted(pushupSummary(e),session.frames.length?session.frames.at(-1).time*1000:null):e));"],
    ["session.summary=session.events.findLast(e=>e.type==='set.completed');","session.summary=session.events.findLast(e=>e.type==='set.completed')?.summary;"],
    ['count:session.summary?.count??engine.count,elapsed_video_ms:offset(session.to),items:session.summary?.items??{},','summary:session.summary,elapsed_video_ms:offset(session.to),'],
    ['item.evaluable','item.evaluated'],['item.compliance_pct','item.compliancePct'],
    ["const files=[{name:'set_result.json'", "const files=[{name:'set.completed.json',blob:jsonBlob(session.events.findLast(e=>e.type==='set.completed'))},{name:'set_result.json'"],
  ];
  for(const [from,to] of changes){if(!app.includes(from))throw new Error(`Unsupported replay source: ${from}`);app=app.replaceAll(from,to);}
  app="import {pushupSummary,setCompleted} from './result-modules/result.js';\n"+app;
}
await mkdir(resolve(dest,'result-modules'),{recursive:true});
await cp(resolve(root,'runtime/common'),resolve(dest,'result-modules'),{recursive:true});
await writeFile(resolve(dest,'app.js'),app);
for(const [target,modules] of [['plank-modules',['common','plank']],['exercise-modules',['common','bird_dog']]]){
  for(const module of modules)await cp(resolve(root,'runtime',module),resolve(dest,target,module),{recursive:true});
}
await copyFile(resolve(here,'plank/plank-app.js'),resolve(dest,'plank-app.js'));
await copyFile(resolve(here,'experiments/experiment-app.js'),resolve(dest,'experiment-app.js'));
console.log('Local replay set summaries/events now use v2; push-up core and all frame rules unchanged.');
