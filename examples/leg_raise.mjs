/** Usage: node examples/leg_raise.mjs frames.jsonl output-directory */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {LegRaiseAnalyzer} from '../runtime/index.js';
const [input,output='results/leg_raise']=process.argv.slice(2);
if(!input)throw new Error('Provide a MediaPipe PoseFrame JSONL file');
fs.mkdirSync(output,{recursive:true});
const analyzer=new LegRaiseAnalyzer();
const stream=fs.createWriteStream(path.join(output,'frames.jsonl'));
for await(const line of readline.createInterface({input:fs.createReadStream(input),crlfDelay:Infinity})){
  if(line.trim())stream.write(JSON.stringify(analyzer.pushFrame(JSON.parse(line)))+'\n');
}
await new Promise(resolve=>stream.end(resolve));
fs.writeFileSync(path.join(output,'set_completed.json'),JSON.stringify(analyzer.finish()[0],null,2));
console.log(`Saved ${analyzer.count} completed attempts to ${output}`);
