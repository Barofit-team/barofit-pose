// Reporting is new JS-only metadata; legacy rule parity still compares the original measurements.
export function withoutReport(summary) {
 const copy=structuredClone(summary);delete copy.details.report;return copy;
}
export function legacySummary(summary) {
 const copy=withoutReport(summary);
 for(const key of ['itemLabels','repetitions','sideCounts','sideHoldSeconds'])delete copy.details[key];
 return copy;
}
export function withoutReportEvents(events) {
 return events.map(e=>e.type==='set.completed'?{...e,summary:withoutReport(e.summary)}:e);
}
