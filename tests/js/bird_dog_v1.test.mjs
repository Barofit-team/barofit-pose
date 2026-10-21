import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {BirdDogAnalyzer} from '../../runtime/bird_dog/analyzer.js';
import {frameResult} from '../../runtime/common/realtime.js';
import {timeSummary,setCompleted} from '../../runtime/common/result.js';

function equivalent(actual,expected,path='result'){
  if(typeof expected==='number'){
    assert.equal(typeof actual,'number',path);
    assert(Math.abs(actual-expected)<=1e-5*Math.max(1,Math.abs(expected)),`${path}: ${actual} != ${expected}`);
  }else if(expected&&typeof expected==='object'){
    assert(actual&&typeof actual==='object',path);
    assert.deepEqual(Object.keys(actual).sort(),Object.keys(expected).sort(),path);
    for(const key of Object.keys(expected))equivalent(actual[key],expected[key],`${path}.${key}`);
  }else assert.equal(actual,expected,path);
}
test('v1 Python/JavaScript parity: states, every item, events, counts, timers and summaries',()=>{
  const fixture=process.env.BIRD_DOG_V1_PARITY??new URL('./fixtures/bird-dog-v1-parity.json.gz',import.meta.url);
  const rows=gunzipSync(readFileSync(fixture)).toString('utf8').trim().split('\n');
  let engine,name,frames=0;
  for(const line of rows){
    const row=JSON.parse(line);
    if(row.case!==name){name=row.case;engine=new BirdDogAnalyzer();}
    const actual=row.finish?engine.finish():engine.pushFrame(row.frame);
    const expected=row.finish?row.finish.map(e=>e.type==='set.completed'&&e.schemaVersion!=='2.0'?setCompleted(timeSummary(e.summary),e.t===null?null:e.t*1000):e):frameResult(row.expected,row.frame,{exercise:'bird_dog',engineVersion:row.expected.engineVersion});
    equivalent(actual,expected,`${name}/${row.frame?.timestampMs??'finish'}`);
    if(row.frame)frames++;
  }
  console.log(`v1 parity checked ${frames} frames`);
});
test('duplicate timestamps, pause and finish are safe for a live client',()=>{
  const e=new BirdDogAnalyzer(),f={timestampMs:0,width:1000,height:600,landmarks:[]};
  e.pushFrame(f);assert.equal(e.pushFrame(f).ignored,true);
  e.breakContinuity();assert.equal(e.pushFrame({...f,timestampMs:1000}).count,0);
  assert.equal(e.finish().at(-1).type,'set.completed');assert.deepEqual(e.finish(),[]);
  assert.equal(e.pushFrame({...f,timestampMs:2000}).ignoredReason,'finished');
});
