/** Experimental 2D bridge, not a replacement for the default MediaPipe extractor.
 * Input: 17 [y, x, score] tuples in ORIGINAL-frame normalized coordinates.
 * Score is copied, not calibrated, to both legacy quality slots. z=0 is a
 * compatibility placeholder; MoveNet has no depth output. Missing joints stay
 * null/zero quality. Never substitute wrist for fingers or ankle for toes.
 */
export const MOVENET_TO_MEDIAPIPE = Object.freeze([0,2,5,7,8,11,12,13,14,15,16,23,24,25,26,27,28]);
export function moveNetLandmarks(keypoints) {
  if (!Array.isArray(keypoints) || keypoints.length!==17) throw new TypeError('Expected 17 [y,x,score] keypoints');
  const landmarks=Array.from({length:33},()=>[null,null,null,0,0]);
  keypoints.forEach((q,i)=>{
    if(!Array.isArray(q)||q.length!==3)throw new TypeError('Expected [y,x,score]');
    if(!q.every(Number.isFinite))return;
    const [y,x,score]=q;
    if(score<0||score>1)throw new RangeError('Score must be in [0,1]');
    landmarks[MOVENET_TO_MEDIAPIPE[i]]=[x,y,0,score,score];
  });
  return landmarks;
}
