import test from 'node:test';import assert from 'node:assert/strict';
import {PushupEngine} from '../../runtime/pushup/engine.js';import config from '../../runtime/pushup/config.js';
function run(mode,settings=config){const e=new PushupEngine({side:'left',settings});let events=[];
 for(let i=0;i<=140;i++){const t=i/20,w=(1+Math.cos(2*Math.PI*Math.min(t,6)/2))/2;
 let f={t,elbow:115+15*w,chest:(.2+.04*w)*.6,hip:0,hand:.1,body:.6,horizontal:1};
 if(mode==='still'){f.elbow=130;f.chest=.15;}if(mode==='jitter'){f.elbow=130+Math.sin(t*10);f.chest=.15+.001*Math.sin(t*10);}
 if(mode==='missing'){f.elbow=NaN;f.chest=NaN;}if(mode==='upright')f.horizontal=.2;
 if(mode==='hip_drop')f.hip=20;if(mode==='shoulder')f.elbow=NaN;if(mode==='elbow')f.chest=NaN;
 events.push(...e.pushFeatures(f).events);
 }return {e,events};}
test('count all three shallow cycles once, independent of posture quality',()=>{for(const mode of ['normal','hip_drop','shoulder','elbow']){const {e,events}=run(mode);assert.equal(e.count,3);assert.equal(events.filter(r=>r.type==='rep.completed').length,3);}assert(run('normal').events.some(r=>r.codes?.includes('ELBOW_SHALLOW')));});
test('ignore stationary, small jitter, invalid scope, missing signals',()=>{for(const mode of ['still','jitter','upright','missing'])assert.equal(run(mode).e.count,0);});
test('posture limits do not affect counts',()=>{const changed=JSON.parse(JSON.stringify(config));changed.limits.elbow_max=180;changed.limits.chest_min=100;changed.return_elbow_deg=180;assert.equal(run('normal',changed).e.count,3);});
test('finish summaries count unknown separately; finish idempotent',()=>{const {e}=run('normal');const events=e.finish(),s=events.at(-1);assert.equal(s.type,'set.completed');assert.equal(s.count,3);for(const v of Object.values(s.items))assert.equal(v.evaluable+v.unknown,3);assert.deepEqual(e.finish(),[]);assert.equal(e.pushFeatures({t:8}).ignored,true);});
test('out of order frames ignored, pause retains count but resets partial movements',()=>{const {e}=run('normal');assert(e.pushFeatures({t:1}).ignored);const n=e.count;e.breakContinuity();assert.equal(e.count,n);assert.equal(e.rows.length,0);});
test('memory bounded for long streams',()=>{const e=new PushupEngine({side:'left'});for(let i=0;i<6000;i++)e.pushFeatures({t:i/15,elbow:160,chest:.2,hip:0,hand:.1,body:.6,horizontal:1});assert(e.rows.length<250);assert.equal(e.count,0);});
