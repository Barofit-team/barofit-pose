import test from 'node:test';
import assert from 'node:assert/strict';
import {moveNetLandmarks,MOVENET_TO_MEDIAPIPE} from '../../runtime/adapters/movenet.js';
import {PushupAnalyzer,PlankAnalyzer,BirdDogAnalyzer,JumpingJackAnalyzer} from '../../runtime/index.js';
test('MoveNet coordinate ordering and anatomical side are preserved',()=>{
 const p=Array.from({length:17},(_,i)=>[i/20,(i+1)/20,.8]);const m=moveNetLandmarks(p);
 for(let i=0;i<17;i++)assert.deepEqual(m[MOVENET_TO_MEDIAPIPE[i]],[p[i][1],p[i][0],0,.8,.8]);
 assert.deepEqual(m[31],[null,null,null,0,0]);assert.deepEqual(m[19],[null,null,null,0,0]);
});
test('missing and low-quality joints are not invented or boosted',()=>{
 const p=Array.from({length:17},()=>[.2,.3,.1]);p[9]=[null,null,null];const m=moveNetLandmarks(p);
 assert.deepEqual(m[15],[null,null,null,0,0]);assert.equal(m[16][3],.1);
 const f={timestampMs:0,width:640,height:480,landmarks:m};
 for(const C of [PushupAnalyzer,PlankAnalyzer,BirdDogAnalyzer,JumpingJackAnalyzer])assert.doesNotThrow(()=>new C().pushFrame(f));
 assert.throws(()=>moveNetLandmarks([]));p[0]=[.1,.2,2];assert.throws(()=>moveNetLandmarks(p));
});
