import fs from 'node:fs';
import path from 'node:path';
import {MountainClimberAnalyzer} from '../../runtime/index.js';
const [input,dir]=process.argv.slice(2);
const engine=new MountainClimberAnalyzer();
const frames=fs.readFileSync(input,'utf8').trim().split(/\r?\n/).map(line=>engine.pushFrame(JSON.parse(line)));
fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(path.join(dir,'frames.jsonl'),frames.map(x=>JSON.stringify(x)).join('\n')+'\n');
fs.writeFileSync(path.join(dir,'set_completed.json'),JSON.stringify(engine.finish().at(-1),null,2));
