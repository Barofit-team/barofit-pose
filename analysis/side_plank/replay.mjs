/** node analysis/side_plank/replay.mjs frames.jsonl output-directory */
import fs from 'node:fs';import path from 'node:path';
import {SidePlankAnalyzer} from '../../runtime/index.js';
const [input,out]=process.argv.slice(2);
if(!input||!out)throw new Error('Usage: node replay.mjs frames.jsonl output-directory');
fs.mkdirSync(out,{recursive:true});const engine=new SidePlankAnalyzer();
const results=fs.readFileSync(input,'utf8').trim().split(/\r?\n/).filter(Boolean).map(s=>engine.pushFrame(JSON.parse(s)));
fs.writeFileSync(path.join(out,'frames.json'),JSON.stringify(results));
fs.writeFileSync(path.join(out,'set.json'),JSON.stringify(engine.finish()[0],null,2));
