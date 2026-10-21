import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {BirdDogAnalyzer, legAlignment} from '../../runtime/bird_dog/legacy-v05.js';

function frame(t, extent = 0, high = false, shift = 0) {
  const landmarks = Array.from({length: 33}, () => Array(5).fill(null));
  for (const [s, e, w, h, k, a, dy] of [[11, 13, 15, 23, 25, 27, 0], [12, 14, 16, 24, 26, 28, 10]]) {
    for (const [i, x, y] of [[s, 600, 200 + dy], [e, 600, 300 + dy], [w, 600, 400 + dy],
      [h, 400, 200 + dy], [k, 400, 400 + dy], [a, 250, 400 + dy]]) {
      landmarks[i] = [x / 1000, y / 600, 0, 1, 1];
    }
  }
  for (const [i, [x, y]] of [[13, [700, 200]], [15, [800, 200]], [26, [260, high ? 130 : 210]], [28, [120, high ? 50 : 210]]]) {
    landmarks[i][0] += (x / 1000 - landmarks[i][0]) * extent;
    landmarks[i][1] += (y / 600 - landmarks[i][1]) * extent;
  }
  for (const i of [11, 12, 23, 24]) landmarks[i][0] += shift / 1000;
  return {timestampMs: t, width: 1000, height: 600, landmarks};
}

test('bird-dog high-leg feedback only during holding; no count or lumbar claim', () => {
  const e = new BirdDogAnalyzer(), phases = new Set();
  let r;
  for (let t = 0; t <= 3500; t += 50) {
    let extent = Math.min(1, Math.max(0, (t - 1000) / 600));
    if (t > 2500) extent = Math.max(0, 1 - (t - 2500) / 600);
    r = e.pushFrame(frame(t, extent, true));
    phases.add(r.metrics.right.phase);
    if (r.items.right_leg_high === 'warning') assert.equal(r.metrics.right.phase, 'holding');
    if (t === 2450) assert.equal(r.items.right_leg_high, 'warning');
    assert.equal(r.count, null);
    assert.equal(r.holdSeconds, null);
    assert.equal(r.items.right_knee_extension, 'disabled');
    assert.equal(r.items.lumbar_neutral, 'not_supported');
    assert.equal(r.experimental, true);
  }
  for (const phase of ['preparation', 'reaching', 'holding', 'returning']) assert(phases.has(phase));
});

test('body movement, missing data, pauses and gaps preserve observation accounting', () => {
  const e = new BirdDogAnalyzer();
  let r;
  for (let t = 0; t <= 1000; t += 50) r = e.pushFrame(frame(t));
  assert.equal(r.body.reference_ready, true);
  for (let t = 1050; t <= 2000; t += 50) r = e.pushFrame(frame(t, 0, false, 40));
  assert.equal(r.items.body_movement, 'not_applicable');
  r = e.pushFrame({...frame(2050), landmarks: []});
  assert.equal(r.phase, 'not_ready');
  assert.equal(r.items.body_movement, 'unknown');
  assert.deepEqual(r.codes, []);
  const before = e.observedSeconds;
  e.breakContinuity();
  r = e.pushFrame(frame(5000));
  assert.equal(e.observedSeconds, before);
  assert.equal(r.body.reference_ready, false);
  r = e.pushFrame(frame(6000));
  assert.equal(e.gapSeconds, 1);
  assert.equal(r.body.reference_ready, false);
  for (const item of Object.values(e.summary().items)) {
    assert(Math.abs(item.compliant_s + item.warning_s + item.unknown_s + item.not_applicable_s - e.observedSeconds) < 1e-9);
  }
  assert.equal(e.pushFrame(frame(6000)).ignored, true);
  assert.equal(e.finish().length, 1);
  assert.deepEqual(e.finish(), []);
  assert.equal(e.pushFrame(frame(7000)).ignored, true);
});

test('trunk-relative leg angle survives image mirroring and uniform scaling', () => {
  const base = [[600, 200], [400, 200], [180, 100]];
  const expected = legAlignment(...base);
  for (const points of [base.map(([x, y]) => [1000 - x, y]), base.map(([x, y]) => [x * .5, y * .5])]) {
    const result = legAlignment(...points);
    assert(Math.abs(result[0] - expected[0]) < 1e-9);
    assert(Math.abs(result[1] - expected[1]) < 1e-9);
  }
});

test('partial return can recover holding without a full reset', () => {
  const e = new BirdDogAnalyzer();
  const phases = [0,.35,.6,.6,.6,.4,.5,.65,.65,.65].map((p,i) => e.phase('right',p,i*.2,.2)[0]);
  assert.equal(phases[4], 'holding');
  assert.equal(phases[5], 'returning');
  assert.equal(phases.at(-1), 'holding');
});

test('body rule ignores forward transfer but detects perpendicular drop', () => {
  for (const mode of ['forward', 'drop', 'camera_translation', 'hidden_wrist']) {
    const e = new BirdDogAnalyzer(); let r;
    for (let t=0; t<=3000; t+=50) {
      const f=frame(t, Math.min(1,Math.max(0,(t-1000)/600)));
      if(t>=1700) {
        if(mode==='forward') for(const i of [11,12,23,24]) f.landmarks[i][0]+=.04;
        if(mode==='drop') for(const i of [11,12,23,24]) f.landmarks[i][1]+=.06;
        if(mode==='camera_translation') for(const p of f.landmarks) if(p[0]!==null){p[0]+=.04;p[1]+=.06;}
        if(mode==='hidden_wrist') f.landmarks[16]=Array(5).fill(null);
      }
      r=e.pushFrame(f);
    }
    assert.equal(r.items.body_movement, mode==='drop'?'warning':mode==='hidden_wrist'?'unknown':'within_reference',mode);
  }
});

test('frozen Python v0.5 parity: phases, feedback, geometry and reference across 798 synthetic frames', () => {
  const path=new URL('./fixtures/bird-dog-python-parity.json.gz',import.meta.url);
  const fixture=JSON.parse(gunzipSync(readFileSync(path)).toString('utf8'));
  const engines=new Map();let count=0,maxError=0;
  function compare(actual,expected,path){
    if(typeof expected==='number'){
      assert.equal(typeof actual,'number',`${path}: expected numeric`);
      const error=Math.abs(actual-expected);maxError=Math.max(maxError,error);
      assert(error<=1e-8*Math.max(1,Math.abs(expected)),`${path}: ${actual} != ${expected}`);
    }else if(Array.isArray(expected)){
      assert(Array.isArray(actual),path);assert.equal(actual.length,expected.length,path);
      expected.forEach((value,index)=>compare(actual[index],value,`${path}[${index}]`));
    }else if(expected&&typeof expected==='object'){
      assert(actual&&typeof actual==='object',path);
      for(const [key,value] of Object.entries(expected))compare(actual[key],value,`${path}.${key}`);
    }else assert.equal(actual,expected,path);
  }
  for(const row of fixture.rows){
    if(!engines.has(row.case))engines.set(row.case,new BirdDogAnalyzer(row.config));
    const actual=engines.get(row.case).pushFrame(row.frame);
    for(const [key,value] of Object.entries(row.expected))compare(actual[key],value,`${row.case}@${row.frame.timestampMs}.${key}`);
    count++;
  }
  assert.equal(count,fixture.reference.frames);assert.equal(count,798);
  console.log(`Bird-dog frozen Python/JS parity: ${engines.size} sequences, ${count} frames, max numeric error ${maxError}`);
});

test('thigh elevation and knee flexion are independent; hidden ankle remains unknown', () => {
  for (const [knee, ankle, high, bent] of [
    [[260,210],[150,100],'within_reference','warning'],
    [[260,130],[120,50],'warning','within_reference'],
    [[260,130],[260,20],'warning','warning'],
    [[260,130],null,'warning','unknown'],
    [[260,130],[260,130],'warning','unknown']]) {
    const e = new BirdDogAnalyzer(); let r;
    for(let t=0;t<=1000;t+=50)e.pushFrame(frame(t));
    for(let t=1050;t<=2600;t+=50){
      const f=frame(t,1);
      for(const [i,p] of [[26,knee],[28,ankle]])f.landmarks[i]=p?[p[0]/1000,p[1]/600,0,1,1]:Array(5).fill(null);
      r=e.pushFrame(f);
    }
    assert.equal(r.items.right_leg_high,high);
    assert.equal(r.items.right_knee_bent,bent);
    assert.equal(r.items.left_knee_bent,'not_applicable');
  }
});
