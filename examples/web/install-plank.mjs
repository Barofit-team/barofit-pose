// Add the canonical plank demo to the existing replay Site; preserve push-up files.
import {cp,mkdir,readFile,writeFile,access} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../..');
const target=process.argv[2];if(!target)throw new Error('Usage: node examples/web/install-plank.mjs <existing-site/dist>');
const dest=resolve(target);for(const f of ['pose-worker.js','report.js','recording.js','speech.js','style.css'])await access(resolve(dest,f));
await cp(resolve(here,'plank'),dest,{recursive:true});
await mkdir(resolve(dest,'plank-modules'),{recursive:true});
for(const dir of ['plank','common'])await cp(resolve(root,'runtime',dir),resolve(dest,'plank-modules',dir),{recursive:true,filter:p=>!p.endsWith('.md')&&!p.endsWith('.ts')});
let html=await readFile(resolve(dest,'index.html'),'utf8');
if(!html.includes('id="exercise-nav"'))html=html.replace('<span class="private">','<label style="font-size:13px">운동 선택 <select id="exercise-nav" aria-label="운동 선택" style="padding:8px;border:1px solid #cbd6cc;border-radius:8px;background:white"><option value="pushup" selected>푸시업</option><option value="plank">플랭크</option></select></label><span class="private">').replace('</body>','<script type="module" src="exercise-nav.js"></script></body>');
await writeFile(resolve(dest,'index.html'),html);
await writeFile(resolve(dest,'exercise-nav.js'),`document.getElementById('exercise-nav').addEventListener('change',e=>{if(e.target.value==='plank'){if(document.getElementById('finish')?.disabled===false&&!confirm('진행 중인 분석이 종료됩니다. 플랭크로 이동할까요?')){e.target.value='pushup';return;}location.href='./plank.html';}});\n`);
console.log('Plank demo installed; existing push-up engine unchanged.');
