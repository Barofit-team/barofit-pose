import fs from 'node:fs';import path from 'node:path';
import assert from 'node:assert/strict';
import {PlankRule} from '../runtime/plank/engine.js';
const [directory,output]=process.argv.slice(2);if(!directory)throw Error('Supply a fixture directory');
const report=[];
for(const file of fs.readdirSync(directory).filter(x=>x.endsWith('.json'))){
 const rows=JSON.parse(fs.readFileSync(path.join(directory,file),'utf8')),rule=new PlankRule();let maxError=0;
 for(const {frame,expected} of rows){
  const actual=rule.step(frame.timestampMs/1000,frame.landmarks,[frame.width,frame.height]);
  for(const [key,want] of Object.entries(expected)){
   const got=actual[key];
   if(typeof want==='number') {const error=Math.abs(got-want);assert(got!==null&&error<1e-8,`${file} ${frame.timestampMs} ${key} ${got} != ${want}`);maxError=Math.max(error,maxError);}
   else assert.deepEqual(got,want,`${file} ${frame.timestampMs} ${key}`);
  }
 }
 report.push({case:file,frames:rows.length,statesMatch:true,maxNumericError:maxError});
}
if(!report.length)throw Error('No cases found');
if(output)fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
