import {PushupAnalyzer,PlankAnalyzer,BirdDogAnalyzer} from '../runtime/index.js';

export const createAnalyzer=exercise=>{
  const C={pushup:PushupAnalyzer,plank:PlankAnalyzer,bird_dog:BirdDogAnalyzer}[exercise];
  if(!C)throw new Error(`Unsupported exercise: ${exercise}`);
  return new C();
};

/** Framework-independent example. UI functions are supplied by React/React Native. */
export function displayFrame(analyzer,frame,ui){
  const result=analyzer.pushFrame(frame);
  if(result.ignored)return result;
  ui.progress({count:result.count,holdSeconds:result.holdSeconds,basis:result.measurementBasis});
  ui.tracking(result.tracking);
  ui.currentItems(result.items); // replace, not merge stale items
  ui.lastRepetition(result.lastRepetition); // null clears previous repetition card
  if(result.exercise==='bird_dog')ui.birdDog({phase:result.phase,sideCounts:result.details.sideCounts});
  // Enqueue through the existing cooldown/deduplication policy; do not speak on every frame.
  ui.feedbackCandidates(result.codes);
  // Events are produced once per accepted frame; raw event t/*_s are seconds.
  for(const event of result.events)ui.event(event);
  return result;
}
