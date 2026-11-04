import fs from 'node:fs';import path from 'node:path';
import {MountainClimberReviewAnalyzer} from '../../runtime/mountain_climber/review.js';
const [input,out]=process.argv.slice(2);fs.mkdirSync(out,{recursive:true});const engine=new MountainClimberReviewAnalyzer();
const rows=fs.readFileSync(input,'utf8').trim().split(/\r?\n/).map(l=>engine.pushFrame(JSON.parse(l)));
fs.writeFileSync(path.join(out,'frames.jsonl'),rows.map(JSON.stringify.bind(JSON)).join('\n')+'\n');
fs.writeFileSync(path.join(out,'set.json'),JSON.stringify(engine.finish().at(-1),null,2));
