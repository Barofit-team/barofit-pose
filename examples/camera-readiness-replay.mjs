import fs from 'node:fs';
import {CameraReadiness} from '../runtime/index.js';
// node examples/camera-readiness-replay.mjs exercise landmarks.jsonl output.jsonl
const [exercise,input,output]=process.argv.slice(2);
if(!exercise||!input||!output)throw new Error('Expected exercise input.jsonl output.jsonl');
const gate=new CameraReadiness({exercise});
const rows=fs.readFileSync(input,'utf8').replace(/^\uFEFF/,'').trim().split(/\r?\n/).map(JSON.parse).map(f=>gate.pushFrame(f));
fs.writeFileSync(output,rows.map(x=>JSON.stringify(x)).join('\n')+'\n');
console.log(JSON.stringify({exercise,frames:rows.length,readyFrames:rows.filter(x=>x.ready).length,firstReadyMs:rows.find(x=>x.ready)?.timestampMs??null,statuses:rows.reduce((a,r)=>(a[r.status]=(a[r.status]??0)+1,a),{})}));
