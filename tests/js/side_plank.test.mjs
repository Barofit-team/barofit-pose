import test from 'node:test';import assert from 'node:assert/strict';
import {SidePlankAnalyzer} from '../../runtime/index.js';
import {HOLD_CONFIG} from '../../runtime/plank/hold.js';
import {SIDE_PLANK_CONFIG} from '../../runtime/side_plank/analyzer.js';
function frame(t,kind='normal',mirror=false){
 const p=Array.from({length:33},()=>[0,0,0,0,0]);
 const coords={11:[.2,.20],12:[.2,.35],14:[.2,.55],16:[.1,.55],24:[.5,.4],26:[.7,.43333],28:[.9,.46667]};
 if(kind==='drop')coords[24][1]+=.06;
 if(kind==='raise')coords[24][1]-=.08;
 if(kind==='shoulder')coords[14][0]+=.15;
 if(kind==='knee')coords[26][1]+=.10;
 if(kind==='straight_arm'){coords[14]=[.2,.45];coords[16]=[.2,.55];}
 for(const [i,xy] of Object.entries(coords))p[i]=[mirror?1-xy[0]:xy[0],xy[1],0,.99,.99];
 return {timestampMs:t,width:1000,height:1000,landmarks:p};
}
test('side plank normal holds and each error pauses valid hold',()=>{
 for(const [kind,code] of [['normal',null],['drop','HIP_DROP'],['raise','HIP_RAISE'],['shoulder','SHOULDER_ELBOW_OFFSET'],['knee','KNEE_BENT']]){
  const e=new SidePlankAnalyzer();let r;for(let t=0;t<=2000;t+=100)r=e.pushFrame(frame(t,kind));
  assert.equal(r.count,null);assert.equal(r.phase,'holding');assert(code?r.codes.includes(code):r.codes.length===0,kind);
  if(code)assert.equal(r.holdSeconds,0);else assert(r.holdSeconds>1.4);
 }
});
test('mirror and aspect-ratio changes preserve physical geometry',()=>{
 const engines=[new SidePlankAnalyzer(),new SidePlankAnalyzer(),new SidePlankAnalyzer()];let results;
 for(let t=0;t<=1000;t+=100){const a=frame(t),b=frame(t,'normal',true),c=frame(t);c.width=2000;c.landmarks=c.landmarks.map(p=>[p[0]/2,...p.slice(1)]);results=[a,b,c].map((f,i)=>engines[i].pushFrame(f));}
 assert(Math.abs(results[0].metrics.hipOffsetPct-results[1].metrics.hipOffsetPct)<1e-8);
 assert.deepEqual(results[0].codes,results[2].codes);
});
test('missing data, side switch, pause and gaps never bridge valid time',()=>{
 const e=new SidePlankAnalyzer();for(let t=0;t<=1000;t+=100)e.pushFrame(frame(t));const h=e.summary().holdSeconds;
 e.pushFrame({...frame(1100),landmarks:[]});assert.equal(e.summary().holdSeconds,h);
 e.pushFrame(frame(5000));assert.equal(e.summary().holdSeconds,h);assert(e.summary().gapSeconds>3);
 e.breakContinuity();e.pushFrame(frame(20000));assert.equal(e.summary().holdSeconds,h);
 assert(e.pushFrame(frame(19900)).ignored);assert.equal(e.finish().length,1);assert.equal(e.finish().length,0);assert(e.pushFrame(frame(20100)).ignored);
 const s=e.summary();for(const v of Object.values(s.items))assert(Math.abs(v.compliant+v.warning+v.unknown+v.notApplicable-s.observedSeconds)<1e-8);
});
test('upright exit does not accumulate or issue exercise warnings',()=>{
 const e=new SidePlankAnalyzer();let r;for(let t=0;t<=2000;t+=100){const f=frame(t);for(const p of f.landmarks){const x=p[0];p[0]=p[1];p[1]=x;}r=e.pushFrame(f);}
 assert.equal(r.phase,'unobservable');assert.equal(r.holdSeconds,0);assert.deepEqual(r.codes,[]);
});
test('support-side changes restart confirmation without bridging time',()=>{
 const e=new SidePlankAnalyzer();for(let t=0;t<=1000;t+=100)e.pushFrame(frame(t));const before=e.summary().holdSeconds;
 const swapped=t=>{const f=frame(t);for(const j of [11,13,15,23,25,27]){const a=f.landmarks[j];f.landmarks[j]=f.landmarks[j+1];f.landmarks[j+1]=a;}return f;};
 assert.equal(e.pushFrame(swapped(1100)).phase,'stabilizing');assert.equal(e.summary().holdSeconds,before);
 for(let t=1200;t<=2100;t+=100)e.pushFrame(swapped(t));assert(e.summary().details.sideHoldSeconds.left>0);
});
test('overlapping raised-hip range is unknown, never compliant time',()=>{
 const e=new SidePlankAnalyzer();let r;for(let t=0;t<=1500;t+=100){const f=frame(t);f.landmarks[24][1]-=.042;r=e.pushFrame(f);}
 assert.equal(r.items.hip,'unknown');assert.equal(r.holdSeconds,0);assert.equal(e.summary().items.hip.compliancePct,null);
});
test('degenerate knee geometry is not normal',()=>{
 const e=new SidePlankAnalyzer();let r;for(let t=0;t<=1000;t+=100){const f=frame(t);f.landmarks[26]=[...f.landmarks[24]];r=e.pushFrame(f);}
 assert.equal(r.items.knee,'tracking_unavailable');assert.equal(r.holdSeconds,0);
});

test('valid hold uses plank timing and never backfills warmup or warnings',()=>{
 assert.equal(SIDE_PLANK_CONFIG.confirmationMs,HOLD_CONFIG.confirmationSeconds*1000);
 assert.equal(SIDE_PLANK_CONFIG.maxGapMs,HOLD_CONFIG.maxGapSeconds*1000);
 const e=new SidePlankAnalyzer();let r;
 for(let t=0;t<=1000;t+=100)r=e.pushFrame(frame(t));
 assert(Math.abs(r.holdSeconds-.7)<1e-9);
 const before=r.holdSeconds;
 for(let t=1100;t<=2000;t+=100){r=e.pushFrame(frame(t,'drop'));assert.equal(r.holdSeconds,before);}
 r=e.pushFrame(frame(2100));assert.equal(r.holdSeconds,before);
 r=e.pushFrame(frame(2200));assert(Math.abs(r.holdSeconds-before-.1)<1e-9);
 const hold=r.holdSeconds;
 r=e.pushFrame(frame(2460));assert.equal(r.holdSeconds,hold);assert.equal(r.phase,'stabilizing');
 assert(Math.abs(e.summary().gapSeconds-.26)<1e-9);
 assert.equal(r.schemaVersion,'2.0');assert.equal(r.type,'frame.result');
 assert.equal(r.measurementBasis.holdSeconds,'all_required_items_compliant');
 const s=e.finish()[0];assert.equal(s.type,'set.completed');assert.equal(s.summary.count,null);
 assert.equal(s.summary.holdSeconds,r.holdSeconds);
 assert(Math.abs(Object.values(s.summary.details.sideHoldSeconds).reduce((a,b)=>a+b,0)-s.summary.holdSeconds)<1e-9);
 for(const item of Object.values(s.summary.items)){assert.equal(item.aggregationBasis,'time');assert.equal(item.unit,'seconds');}
});
