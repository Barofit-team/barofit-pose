import {jsonSafe} from './frame.js';

// Serialization only: consume existing accumulators, never classify or gate a motion.
export const SET_RESULT_VERSION = '2.0';
export function itemResult(basis, compliant, warning, unknown = 0, notApplicable = 0) {
  if (!['repetition', 'time'].includes(basis)) throw new Error(`Unknown aggregation basis: ${basis}`);
  for (const n of [compliant, warning, unknown, notApplicable]) {
    if (!Number.isFinite(n) || n < 0) throw new Error('Item totals must be finite nonnegative values');
    if (basis === 'repetition' && !Number.isInteger(n)) throw new Error('Repetition totals must be integers');
  }
  const evaluated = compliant + warning;
  return {aggregationBasis: basis, unit: basis === 'time' ? 'seconds' : 'repetitions',
    compliant, warning, unknown, notApplicable, evaluated,
    compliancePct: evaluated ? 100 * compliant / evaluated : null};
}
export function setSummary({exercise, engineVersion, count = null, holdSeconds = null,
  observedSeconds = null, gapSeconds = null, items, details = {}}) {
  return jsonSafe({schemaVersion: SET_RESULT_VERSION, exercise, engineVersion, count, holdSeconds,
    observedSeconds, gapSeconds, items, details});
}
export function setCompleted(summary, timestampMs = null) {
  return jsonSafe({schemaVersion: SET_RESULT_VERSION, type: 'set.completed',
    exercise: summary.exercise, engineVersion: summary.engineVersion, timestampMs, summary});
}
export function pushupSummary(raw, engineVersion = 'pushup-apk-1.3') {
  return setSummary({exercise: 'pushup', engineVersion, count: raw.count,
    items: Object.fromEntries(Object.entries(raw.items).map(([k, v]) =>
      [k, itemResult('repetition', v.compliant, v.warning, v.unknown)]))});
}
export function timeSummary(raw) {
  const {sideCounts, repetitions, configuration} = raw;
  const details = raw.exercise === 'bird_dog' ? {sideCounts, repetitions, configuration} : {};
  return setSummary({...raw, details,
    items: Object.fromEntries(Object.entries(raw.items).map(([k, v]) =>
      [k, itemResult('time', v.compliant_s, v.warning_s, v.unknown_s, v.not_applicable_s ?? 0)]))});
}
