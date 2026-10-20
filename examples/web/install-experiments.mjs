// Add the experimental exercise pages to an existing Barofit replay Site.
// Model and licensed sample/demo media are kept outside this source repository.
import {access,copyFile,mkdir,cp} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../..');
const target=process.argv[2];
if(!target)throw new Error('Usage: node examples/web/install-experiments.mjs <existing-site/dist>');
const dest=resolve(target);
for(const file of [
  'index.html','plank.html','plank.css','pose-worker.js','report.js','recording.js','style.css',
  'assets/mp/vision_bundle.mjs','assets/mp/wasm','assets/pose_landmarker_full.task',
])await access(resolve(dest,file));
for(const file of ['experiment.html','experiment-app.js','sample-loader.js','guide.html']){
  await copyFile(resolve(here,'experiments',file),resolve(dest,file));
}
await mkdir(resolve(dest,'exercise-modules'),{recursive:true});
for(const directory of ['common','squat','bird_dog']){
  await cp(resolve(root,'runtime',directory),resolve(dest,'exercise-modules',directory),{
    recursive:true,filter:source=>!source.endsWith('.md')&&!source.endsWith('.ts'),
  });
}
const optional=[
  'samples/pushup-good.mp4','samples/pushup-bad.mp4',
  'samples/squat-good.mp4','samples/squat-bad.mp4',
  'demos/pushup-feedback.mp4','demos/squat-initial.mp4',
];
const missing=[];
for(const file of optional){try{await access(resolve(dest,file));}catch{missing.push(file);}}
console.log('Experimental squat/bird-dog pages and canonical runtimes installed.');
console.log('Open experiment.html?exercise=squat or experiment.html?exercise=bird_dog.');
console.log('Existing push-up/plank engines and navigation were not changed.');
if(missing.length)console.log(`Optional media absent (own-video analysis still works): ${missing.join(', ')}`);
