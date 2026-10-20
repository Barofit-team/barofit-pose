/** Input validation only; no filtering, mirroring or interpolation. */
export function validateFrame(frame) {
  if (!frame || !Number.isFinite(frame.timestampMs) || frame.timestampMs < 0 ||
      !Number.isInteger(frame.width) || frame.width <= 0 ||
      !Number.isInteger(frame.height) || frame.height <= 0) {
    throw new TypeError('Expected nonnegative timestampMs and positive integer width/height');
  }
  if (!Array.isArray(frame.landmarks) || ![0, 33].includes(frame.landmarks.length) ||
      frame.landmarks.some(p => !Array.isArray(p) || p.length !== 5 ||
        p.some(v => v !== null && typeof v !== 'number'))) {
    throw new TypeError('Expected 33 landmarks, each [x,y,z,visibility,presence]; missing = null');
  }
}

export function jsonSafe(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]));
  return value;
}
