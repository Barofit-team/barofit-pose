import test from 'node:test';
import assert from 'node:assert/strict';
import {PushupAnalyzer,PlankAnalyzer,BirdDogAnalyzer} from '../../runtime/index.js';
import {itemResult,pushupSummary} from '../../runtime/common/result.js';

test('all three analyzers share summary/item/end-event keys and serialize empty sets',()=>{
  const engines=[new PushupAnalyzer(),new PlankAnalyzer(),new BirdDogAnalyzer()];
  let keys,eventKeys,itemKeys;
  for(const e of engines){
    const s=e.summary(),end=e.finish().at(-1);
    assert.equal(s.schemaVersion,'2.0');assert.deepEqual(end.summary,e.summary());
    assert.equal(end.timestampMs,null);assert.deepEqual(e.finish(),[]);
    keys??=Object.keys(s).sort();eventKeys??=Object.keys(end).sort();
    assert.deepEqual(Object.keys(s).sort(),keys);assert.deepEqual(Object.keys(end).sort(),eventKeys);
    for(const v of Object.values(s.items)){
      itemKeys??=Object.keys(v).sort();assert.deepEqual(Object.keys(v).sort(),itemKeys);
      assert.equal(v.compliancePct,null);assert.equal(v.evaluated,0);
      assert.equal(v.aggregationBasis,s.exercise==='pushup'?'repetition':'time');
    }
    assert.deepEqual(JSON.parse(JSON.stringify(end)),end);
  }
});
test('unknown and nonapplicable do not dilute compliance; units, boundaries and invalid totals',()=>{
  for(const basis of ['time','repetition']){
    assert.equal(itemResult(basis,3,1,100,100).compliancePct,75);
    assert.equal(itemResult(basis,0,0,9,4).compliancePct,null);
    assert.equal(itemResult(basis,0,4).compliancePct,0);
    assert.equal(itemResult(basis,4,0).compliancePct,100);
  }
  assert.equal(itemResult('time',.75,.25).evaluated,1);
  assert.throws(()=>itemResult('repetition',.5,1));
  assert.throws(()=>itemResult('time',NaN,1));assert.throws(()=>itemResult('time',-1,2));
});
test('pushup finalizes pending feedback before serialization, preserving raw totals',()=>{
  const e=new PushupAnalyzer();
  for(let i=0;i<=140;i++){
    const t=i/20,w=(1+Math.cos(2*Math.PI*Math.min(t,6)/2))/2;
    e.engine.core.pushFeatures({t,elbow:115+15*w,chest:(.2+.04*w)*.6,hip:20,hand:.1,body:.6,horizontal:1});
  }
  const end=e.finish().at(-1);assert.equal(end.summary.count,3);
  assert.deepEqual(end.summary,pushupSummary({count:e.engine.count,items:e.engine.core.totals}));
  for(const [k,v] of Object.entries(end.summary.items)){
    const raw=e.engine.core.totals[k];
    assert.equal(v.compliant,raw.compliant);assert.equal(v.warning,raw.warning);
    assert.equal(v.unknown,raw.unknown);assert.equal(v.evaluated,raw.evaluable);
    assert.equal(v.evaluated+v.unknown,3);
  }
});
