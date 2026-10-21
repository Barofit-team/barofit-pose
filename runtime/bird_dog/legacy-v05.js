import {validateFrame, jsonSafe} from '../common/frame.js';

/** Causal port of analysis/bird_dog/adapter.py v0.5.
 * Experimental engineering thresholds; no repetition count or lumbar diagnosis.
 */
export const BIRD_DOG_VERSION = 'bird-dog-experimental-0.5-js-1.0';
export const JOINTS = Object.freeze({
  left: Object.freeze([11, 13, 15, 23, 25, 27]),
  right: Object.freeze([12, 14, 16, 24, 26, 28]),
});
export const BIRD_DOG_CONFIG = Object.freeze({
  confidence: .5, camera_roll_deg: 0, max_gap_seconds: .4, smooth_seconds: .12,
  prepare_seconds: .4, prepare_jitter_ratio: .05, reach_enter_ratio: .30,
  reach_exit_ratio: .18, endpoint_ratio: .45, plateau_speed_ratio_s: .35,
  plateau_seconds: .12, return_speed_ratio_s: .45, return_drop_ratio: .12,
  leg_height_ratio: .08, thigh_high_deg: 20, knee_min_deg: 155, body_shift_ratio: .12,
  trunk_change_deg: 12, warning_seconds: .25,
});
const SIDES = Object.keys(JOINTS);
const ITEM_NAMES = ['left_leg_high', 'right_leg_high', 'left_knee_bent', 'right_knee_bent', 'body_movement'];
const LEGACY_ITEMS = ['hand_alignment', 'support_knee_alignment', 'elbow_extension',
  'knee_extension', 'arm_high', 'leg_high', 'trunk_change'];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const norm = a => Math.hypot(a[0], a[1]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const degrees = value => value * 180 / Math.PI;
const assessed = s => s === 'within_reference' || s === 'warning';
const finite = Number.isFinite;
const median = values => {
  if (values.some(v => !finite(v))) return NaN;
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
function angle(a, b, c) {
  const u = sub(a, b), v = sub(c, b), den = norm(u) * norm(v);
  return den > 1e-6 ? degrees(Math.acos(Math.max(-1, Math.min(1, dot(u, v) / den)))) : null;
}
function bestQuality(candidates, quality) {
  return candidates.reduce((best, value) => best === null || quality(value) > quality(best) ? value : best, null);
}

/** Positive means above the trunk extension in the image. This is not floor level. */
export function legAlignment(shoulder, hip, ankle) {
  let u = sub(hip, shoulder), v = sub(ankle, hip);
  const length = norm(u);
  if (length <= 15 || norm(v) <= 15) return [null, null];
  u = u.map(x => x / length);
  let n = [-u[1], u[0]];
  if (n[1] > 0) n = n.map(x => -x);
  return [degrees(Math.atan2(dot(v, n), dot(v, u))), dot(v, n) / length];
}

function geometry(xy, good) {
  const metrics = {};
  for (const [side, [s, e, w, h, k, a]] of Object.entries(JOINTS)) {
    const m = {length: null, trunk_deg: null, arm_active: null, leg_active: null,
      quadruped: false, hand_offset_ratio: null, knee_offset_ratio: null,
      elbow_deg: null, knee_deg: null, arm_elevation_deg: null,
      leg_elevation_deg: null, trunk_change_deg: null};
    metrics[side] = m;
    if (!good[s] || !good[h]) continue;
    const S = xy[s], H = xy[h], length = norm(sub(S, H));
    if (length < 15) continue;
    const forward = S[0] > H[0] ? 1 : -1;
    m.length = length;
    m.trunk_deg = degrees(Math.atan2(S[1] - H[1], Math.abs(S[0] - H[0])));
    m.support_arm = good[w] && xy[w][1] - S[1] > .35 * length;
    m.support_leg = good[k] && xy[k][1] - H[1] > .30 * length;
    m.arm_active = good[w] ? (xy[w][0] - S[0]) * forward > .30 * length &&
      xy[w][1] - S[1] < Math.sqrt(3) * Math.abs(xy[w][0] - S[0]) : null;
    m.leg_active = good[k] ? (xy[k][0] - H[0]) * (-forward) > .30 * length : null;
    m.hand_offset_ratio = good[w] ? Math.abs(xy[w][0] - S[0]) / length : null;
    m.knee_offset_ratio = good[k] ? Math.abs(xy[k][0] - H[0]) / length : null;
    m.elbow_deg = [s, e, w].every(i => good[i]) ? angle(xy[s], xy[e], xy[w]) : null;
    m.knee_deg = [h, k, a].every(i => good[i]) ? angle(xy[h], xy[k], xy[a]) : null;
    for (const [limb, origin, end] of [['arm', s, w], ['leg', h, a]]) {
      if (good[origin] && good[end]) {
        const delta = sub(xy[end], xy[origin]);
        m[`${limb}_elevation_deg`] = degrees(Math.atan2(-delta[1], Math.abs(delta[0])));
      }
    }
  }
  const observable = Object.values(metrics).filter(m => m.length !== null);
  const quadruped = observable.some(m => m.support_arm) && observable.some(m => m.support_leg) &&
    observable.some(m => Math.abs(m.trunk_deg) < 40);
  for (const m of Object.values(metrics)) m.quadruped = quadruped;
  return {metrics, quadruped};
}

export class BirdDogAnalyzer {
  constructor(config = {}) {
    this.config = {...BIRD_DOG_CONFIG, ...config};
    for (const [key, value] of Object.entries(this.config)) {
      if (!finite(value)) throw new TypeError(`Non-finite bird-dog config: ${key}`);
    }
    if (this.config.smooth_seconds <= 0 || this.config.max_gap_seconds <= 0) {
      throw new TypeError('Smoothing and gap intervals must be positive');
    }
    this.lastTime = null;
    this.dims = null;
    this.closed = false;
    this.previous = null;
    this.observedSeconds = 0;
    this.gapSeconds = 0;
    this.totals = Object.fromEntries(ITEM_NAMES.map(key => [key,
      {compliant_s: 0, warning_s: 0, unknown_s: 0, not_applicable_s: 0}]));
    this.resetMotion();
  }

  resetMotion() {
    this.reference = null;
    this.preparation = [];
    this.filtered = null;
    this.previousGood = null;
    this.previousProgress = {};
    this.motion = Object.fromEntries(SIDES.map(side => [side,
      {phase: 'preparation', peak: 0, stable_since: null}]));
    this.since = {};
    this.bodySide = null;
  }

  breakContinuity(reason = 'pause') {
    if (this.closed) return [];
    this.resetMotion();
    this.previous = null;
    return [{type: 'tracking.interrupted', t: this.lastTime, reason}];
  }

  state(key, raw, t, unavailable = 'unknown') {
    if (raw === null) {
      delete this.since[key];
      return unavailable;
    }
    if (!raw) {
      delete this.since[key];
      return 'within_reference';
    }
    if (!(key in this.since)) this.since[key] = t;
    return t - this.since[key] >= this.config.warning_seconds ? 'warning' : 'pending_feedback';
  }

  phase(side, progress, t, dt) {
    const state = this.motion[side], cfg = this.config;
    if (progress === null) {
      this.motion[side] = {phase: 'unknown', peak: 0, stable_since: null};
      delete this.previousProgress[side];
      return ['unknown', null];
    }
    const prev = this.previousProgress[side] ?? progress;
    this.previousProgress[side] = progress;
    const speed = dt ? (progress - prev) / dt : 0;
    if (progress < cfg.reach_exit_ratio) {
      Object.assign(state, {phase: 'preparation', peak: 0, stable_since: null});
    } else if (['preparation', 'unknown'].includes(state.phase)) {
      if (progress >= cfg.reach_enter_ratio) {
        Object.assign(state, {phase: 'reaching', peak: progress, stable_since: null});
      }
    } else if (state.phase === 'returning') {
      if (progress >= cfg.endpoint_ratio && speed > cfg.return_speed_ratio_s)
        Object.assign(state, {phase: 'reaching', peak: progress, stable_since: null});
    } else if (state.phase !== 'returning') {
      state.peak = Math.max(state.peak, progress);
      if (speed < -cfg.return_speed_ratio_s && state.peak - progress >= cfg.return_drop_ratio) {
        Object.assign(state, {phase: 'returning', stable_since: null});
      } else if (progress >= cfg.endpoint_ratio && Math.abs(speed) < cfg.plateau_speed_ratio_s) {
        if (state.stable_since === null) state.stable_since = t;
        if (t - state.stable_since >= cfg.plateau_seconds) state.phase = 'holding';
      } else {
        Object.assign(state, {phase: 'reaching', stable_since: null});
      }
    }
    return [state.phase, speed];
  }

  pushFrame(frame) {
    validateFrame(frame);
    const t = frame.timestampMs / 1000, cfg = this.config;
    if (this.closed || this.lastTime !== null && t <= this.lastTime) return {ignored: true, events: []};
    let dt = this.lastTime === null ? 0 : t - this.lastTime;
    const dims = [frame.width, frame.height];
    const changedSize = this.dims && dims.some((v, i) => v !== this.dims[i]);
    if (dt > cfg.max_gap_seconds || changedSize) {
      this.resetMotion();
      dt = 0;
    }
    this.lastTime = t;
    this.dims = dims;
    const p = frame.landmarks.length ? frame.landmarks : Array.from({length: 33}, () => Array(5).fill(null));
    const good = p.map(row => [0, 1, 3, 4].every(i => finite(row[i])) &&
      row[3] >= cfg.confidence && row[4] >= cfg.confidence &&
      row[0] >= 0 && row[0] <= 1 && row[1] >= 0 && row[1] <= 1);
    const roll = -cfg.camera_roll_deg * Math.PI / 180, cos = Math.cos(roll), sin = Math.sin(roll);
    const xy = p.map(row => {
      const x = row[0] === null ? NaN : row[0] * dims[0];
      const y = row[1] === null ? NaN : row[1] * dims[1];
      return [x * cos - y * sin, x * sin + y * cos];
    });
    const {metrics, quadruped} = geometry(xy, good);
    if (this.filtered === null) this.filtered = xy.map(row => [...row]);
    const alpha = dt ? 1 - Math.exp(-dt / cfg.smooth_seconds) : 1;
    for (let i = 0; i < 33; i++) {
      if (!good[i]) continue;
      if (this.previousGood?.[i]) {
        for (let j = 0; j < 2; j++) this.filtered[i][j] += alpha * (xy[i][j] - this.filtered[i][j]);
      } else {
        this.filtered[i] = [...xy[i]];
      }
    }
    this.previousGood = [...good];
    const q = this.filtered, phases = {};
    for (const [side, [s, e, w, h, k, a]] of Object.entries(JOINTS)) {
      const m = metrics[side], length = this.reference?.length ?? m.length;
      let progress = null;
      if (quadruped && length && [s, h, k].every(i => good[i])) {
        const forward = q[s][0] > q[h][0] ? 1 : -1;
        progress = (q[h][0] - q[k][0]) * forward / length;
      }
      const [phase, speed] = this.phase(side, progress, t, dt);
      phases[side] = phase;
      Object.assign(m, {phase, reach_ratio: progress, reach_speed_ratio_s: speed,
        leg_height_ratio: length && good[h] && good[a] ? (q[h][1] - q[a][1]) / length : null,
        leg_alignment_deg: null, leg_alignment_distance_ratio: null, thigh_alignment_deg: null, knee_angle_filtered_deg: null});
      if ([s, h, a].every(i => good[i])) {
        [m.leg_alignment_deg, m.leg_alignment_distance_ratio] = legAlignment(q[s], q[h], q[a]);
      }
      if ([s, h, k].every(i => good[i])) [m.thigh_alignment_deg] = legAlignment(q[s], q[h], q[k]);
      if ([h,k,a].every(i=>good[i]) && Math.min(norm(sub(q[h],q[k])),norm(sub(q[a],q[k])))>15)
        m.knee_angle_filtered_deg=angle(q[h],q[k],q[a]);
    }
    const phaseValues = Object.values(phases);
    const anyReach = phaseValues.some(v => ['reaching', 'holding', 'returning'].includes(v));
    const atBase = quadruped && phaseValues.includes('preparation') &&
      phaseValues.every(v => ['preparation', 'unknown'].includes(v)) &&
      !Object.values(metrics).some(m => m.arm_active);
    if (!quadruped) {
      this.reference = null;
      this.preparation = [];
    } else if (atBase && this.reference === null) {
      const candidates = SIDES.filter(side => [JOINTS[side][0], JOINTS[side][3], JOINTS[side][4]].every(i => good[i]));
      if (candidates.length) {
        const side = bestQuality(candidates, side =>
          Math.min(...[JOINTS[side][0], JOINTS[side][3]].flatMap(i => p[i].slice(3, 5))));
        this.preparation.push({t, q: q.map(row => [...row]), good: [...good], side});
        while (this.preparation.length && t - this.preparation[0].t > cfg.prepare_seconds + .15) this.preparation.shift();
        if (this.preparation.length >= 4 && t - this.preparation[0].t >= cfg.prepare_seconds - 1e-6) {
          const [s, , , h] = JOINTS[side];
          const base = q.map((_, i) => [0, 1].map(j => median(this.preparation.map(row => row.q[i][j]))));
          const length = norm(sub(base[s], base[h]));
          const valid = good.map((_, i) => this.preparation.every(row => row.good[i]));
          const spread = Math.max(...[s, h].flatMap(i => [0, 1].map(j => {
            const samples = this.preparation.map(row => row.q[i][j]);
            return Math.max(...samples) - Math.min(...samples);
          })));
          if (valid[s] && valid[h] && length > 15 && spread / length <= cfg.prepare_jitter_ratio) {
            this.reference = {points: base, good: valid, side, length, timestampMs: t * 1000,
              trunk_deg: degrees(Math.atan2(base[s][1] - base[h][1], Math.abs(base[s][0] - base[h][0])))};
          }
        }
      } else {
        this.preparation = [];
      }
    } else if (!atBase) {
      this.preparation = [];
    }
    const items = Object.fromEntries(SIDES.flatMap(side => LEGACY_ITEMS.map(key => [`${side}_${key}`, 'disabled'])));
    items.same_side_pair = 'disabled';
    for (const [side, m] of Object.entries(metrics)) {
      const value = m.thigh_alignment_deg;
      const eligible = phases[side] === 'holding' && value !== null && quadruped;
      items[`${side}_leg_high`] = this.state(`${side}_leg_high`,
        eligible ? value > cfg.thigh_high_deg : null, t,
        value !== null && phases[side] !== 'unknown' ? 'not_applicable' : 'unknown');
      const knee=m.knee_angle_filtered_deg;
      items[`${side}_knee_bent`]=this.state(`${side}_knee_bent`,
        phases[side]==='holding' && knee!==null && quadruped ? knee<cfg.knee_min_deg : null,t,
        knee!==null && phases[side]!=='unknown' ? 'not_applicable' : 'unknown');
    }
    const body = {reference_ready: this.reference !== null, reference_kind: 'stable_preparation_not_verified_normal',
      side: null, anchor: null, shift_ratio: null, trunk_change_deg: null,
      perpendicular_shift_ratio: null, along_shift_ratio: null};
    let bodyBad = null, bodyUnavailable = 'unknown', selected = null;
    if (quadruped && this.reference !== null) {
      const ref = this.reference, candidates = [];
      for (const [side, ids] of Object.entries(JOINTS)) {
        const [s, , w, h] = ids;
        if (phases[side] === 'holding' && metrics[side].arm_active === false &&
          [s, h, w].every(i => good[i] && ref.good[i]) && norm(sub(ref.points[s], ref.points[h])) > 15) {
          candidates.push(side);
        }
      }
      if (!Object.values(phases).includes('holding')) bodyUnavailable = 'not_applicable';
      if (candidates.length) {
        selected = bestQuality(candidates, side => Math.min(...[0, 2, 3].flatMap(j => p[JOINTS[side][j]].slice(3, 5))));
        const [s, , anchor, h] = JOINTS[selected];
        let u = sub(ref.points[s], ref.points[h]);
        const length = norm(u); u = u.map(v => v / length);
        const n = [-u[1], u[0]];
        const shifts = [s, h].map(i => sub(sub(q[i], q[anchor]), sub(ref.points[i], ref.points[anchor])));
        const shift = Math.max(...shifts.map(norm)) / length;
        const perpendicular = Math.max(...shifts.map(v => Math.abs(dot(v, n)))) / length;
        const along = Math.max(...shifts.map(v => Math.abs(dot(v, u)))) / length;
        const trunk = degrees(Math.atan2(q[s][1] - q[h][1], Math.abs(q[s][0] - q[h][0])));
        const baseTrunk = degrees(Math.atan2(u[1], Math.abs(u[0])));
        const change = Math.abs(trunk - baseTrunk);
        Object.assign(body, {side: selected, anchor, shift_ratio: shift, trunk_change_deg: change,
          perpendicular_shift_ratio: perpendicular, along_shift_ratio: along});
        bodyBad = perpendicular > cfg.body_shift_ratio || change > cfg.trunk_change_deg;
      }
    }
    if (selected !== this.bodySide) delete this.since.body_movement;
    this.bodySide = selected;
    items.body_movement = this.state('body_movement', bodyBad, t, bodyUnavailable);
    items.lumbar_neutral = 'not_supported';
    items.axial_rotation = 'not_supported';
    const phase = !quadruped ? 'not_ready' : anyReach ?
      ['returning', 'reaching', 'holding'].find(v => phaseValues.includes(v)) : 'preparation';
    const codes = Object.entries(items).filter(([, status]) => status === 'warning').map(([key]) => key.toUpperCase());
    const events = [];
    if (this.previous) {
      const span = t - this.previous.t;
      if (span > cfg.max_gap_seconds || changedSize) {
        this.gapSeconds += span;
        events.push({type: 'frame.gap', t, gap_s: span, reason: changedSize ? 'dimensions_changed' : 'time_gap'});
      } else {
        this.observedSeconds += span;
        for (const key of ITEM_NAMES) {
          const before = this.previous.items[key], now = items[key];
          const bucket = assessed(before) && assessed(now) ?
            (before === 'warning' ? 'warning_s' : 'compliant_s') :
            before === 'not_applicable' && now === 'not_applicable' ? 'not_applicable_s' : 'unknown_s';
          this.totals[key][bucket] += span;
        }
      }
      if (this.previous.codes.join('|') !== codes.join('|')) events.push({type: 'feedback.changed', t, codes});
      if (this.previous.phase !== phase) events.push({type: 'phase.changed', t, from: this.previous.phase, to: phase});
    } else if (codes.length) {
      events.push({type: 'feedback.changed', t, codes});
    }
    this.previous = {t, items, codes, phase};
    return jsonSafe({schemaVersion: '1.0', exercise: 'bird_dog', engineVersion: BIRD_DOG_VERSION,
      timestampMs: frame.timestampMs, ignored: false, tracking: quadruped ? 'tracking' : 'tracking_unavailable',
      side: null, count: null, holdSeconds: null, phase, codes, items, metrics, events, body,
      referenceStatus: this.reference ? 'ready' : 'needs_stable_preparation',
      observedSeconds: this.observedSeconds, experimental: true,
      thresholdBasis: 'engineering_candidates_not_clinically_validated'});
  }

  configuration() {
    return {version: BIRD_DOG_VERSION, parameters: {...this.config},
      reference_policy: 'Causal stable preparation; not a certified normal pose',
      enabled_items: ['leg_high', 'knee_bent', 'body_movement'],
      body_policy: 'Holding only; planted-arm shoulder/hip relative to same wrist; perpendicular displacement or trunk tilt; along-trunk shift diagnostic only',
      leg_policy: 'Holding only: LEG_HIGH uses signed trunk-extension to hip-knee angle; KNEE_BENT uses hip-knee-ankle inner angle. Ankle alignment retained as diagnostic; not floor or lumbar angle'};
  }

  summary() {
    return jsonSafe({schemaVersion: '1.0', exercise: 'bird_dog', engineVersion: BIRD_DOG_VERSION,
      count: null, holdSeconds: null, observedSeconds: this.observedSeconds, gapSeconds: this.gapSeconds,
      experimental: true, thresholdBasis: 'engineering_candidates_not_clinically_validated',
      items: Object.fromEntries(Object.entries(this.totals).map(([key, values]) => {
        const evaluable_s = values.compliant_s + values.warning_s;
        return [key, {...values, evaluable_s, compliance_pct: evaluable_s ? 100 * values.compliant_s / evaluable_s : null}];
      }))});
  }

  finish() {
    if (this.closed) return [];
    this.closed = true;
    return [{type: 'set.completed', t: this.lastTime, ...this.summary()}];
  }
}
