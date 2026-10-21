import {jsonSafe, validateFrame} from './frame.js';

export const MEASUREMENT_BASIS=Object.freeze({
  pushup:{count:'completed_attempt',holdSeconds:null,observedSeconds:null},
  plank:{count:null,holdSeconds:'all_required_items_compliant',observedSeconds:'continuous_sample_intervals'},
  bird_dog:{count:'one_leg_out_and_back',holdSeconds:'observed_holding',observedSeconds:'continuous_sample_intervals'}
});

/** Serialization only. Do not use this object as an engine's internal state. */
export function frameResult(raw, frame, {exercise,engineVersion,lastRated=null,ignoredReason=null}={}) {
  const pushup=exercise==='pushup', ignored=ignoredReason!==null;
  const {schemaVersion,type,exercise:oldExercise,engineVersion:oldVersion,timestampMs,ignored:oldIgnored,tracking,side,count,holdSeconds,
    observedSeconds,codes,items,events,metrics,phase,movementPhase,...details}=raw;
  if(phase!==undefined)details.enginePhase=phase;
  const hip=raw.hipStatus;
  const hipStatus={hip_drop:'warning',hip_raise:'warning',candidate:'pending_feedback'}[hip]??hip??'tracking_unavailable';
  const currentItems=ignored?{}:pushup?{hip:hipStatus}:(items??{});
  const currentCodes=ignored?[]:pushup?({hip_drop:['HIP_DROP'],hip_raise:['HIP_RAISE']}[hip]??[]):(codes??[]);
  const repetition=!ignored&&pushup&&items?{
    number:lastRated?.rep??null,timestampMs:lastRated?lastRated.t*1000:null,
    items,codes:lastRated?.codes??[],metrics:lastRated?.metrics??{}
  }:null;
  return jsonSafe({schemaVersion:'2.0',type:'frame.result',exercise,engineVersion,
    timestampMs:frame.timestampMs,ignored,ignoredReason,
    tracking:ignored?'tracking_unavailable':tracking??'tracking_unavailable',
    side:side??null,count:count??null,holdSeconds:holdSeconds??null,
    observedSeconds:observedSeconds??null,measurementBasis:MEASUREMENT_BASIS[exercise],phase:ignored?null:movementPhase??phase??null,
    items:currentItems,codes:ignored?[]:codes??[],currentCodes,
    lastRepetition:repetition,metrics:ignored?{}:metrics??{},events:ignored?[]:events??[],
    details:ignored?{}:details});
}

/** Same lifecycle contract for all public runtime analyzers; leaves rule methods unchanged. */
export function pushRealtime(analyzer,frame,exercise,engineVersion) {
  validateFrame(frame);
  const closed=analyzer.closed??analyzer.engine?.closed??false;
  const last=analyzer._acceptedTimestampMs;
  const reason=closed?'finished':last!==undefined&&frame.timestampMs<=last?'non_monotonic_timestamp':null;
  const raw=reason?{
    count:analyzer.summary().count,holdSeconds:analyzer.summary().holdSeconds,
    observedSeconds:analyzer.summary().observedSeconds,side:null
  }:analyzer._pushFrameLegacy(frame);
  if(!reason)analyzer._acceptedTimestampMs=frame.timestampMs;
  return frameResult(raw,frame,{exercise,engineVersion,ignoredReason:reason,
    lastRated:analyzer.engine?.core?.lastRated});
}
