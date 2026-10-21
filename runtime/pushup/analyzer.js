import {pushRealtime} from '../common/realtime.js';
import {LivePushupEngine} from './liveEngine.js';
import {validateFrame, jsonSafe} from '../common/frame.js';
import {pushupSummary, setCompleted} from '../common/result.js';

/** Shared envelope around the unchanged APK v1.3 engine. */
export class PushupAnalyzer {
  constructor(settings) {
    this.engine = new LivePushupEngine(settings);
    this.lastTimestampMs = null;
  }
  pushFrame(frame) { return pushRealtime(this,frame,'pushup','pushup-apk-1.3'); }
  _pushFrameLegacy(frame) {
    validateFrame(frame);
    const result = this.engine.pushFrame(frame);
    if (!result.ignored) this.lastTimestampMs = frame.timestampMs;
    return jsonSafe({schemaVersion: '1.0', exercise: 'pushup', engineVersion: 'pushup-apk-1.3',
      timestampMs: frame.timestampMs, ignored: result.ignored ?? false,
      tracking: result.tracking ?? 'tracking_unavailable', side: result.side ?? this.engine.side,
      count: result.count, holdSeconds: null, codes: result.codes ?? [],
      items: result.items ?? null, events: result.events ?? [],
      metrics: result.usedFeatures ?? null, diagnostics: result.diagnostics ?? null,
      hipStatus: result.hipStatus ?? null});
  }
  breakContinuity(reason = 'pause') {
    return jsonSafe(this.engine.breakContinuity(reason));
  }
  summary() {
    return pushupSummary({count:this.engine.count,items:this.engine.core.totals});
  }
  finish() {
    return jsonSafe(this.engine.finish().map(event => event.type === 'set.completed'
      ? setCompleted(pushupSummary(event), this.lastTimestampMs)
      : {...event, schemaVersion:'1.0', exercise:'pushup', engineVersion:'pushup-apk-1.3'}));
  }
}
