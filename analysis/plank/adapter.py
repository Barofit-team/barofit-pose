"""Frame interface for the frozen v0.2 Python reference, not an app port."""
from ..common.contract import unpack_frame, json_safe
from .multi_rule import PlankRule
from .hip_rule import CONFIG as HIP_CONFIG
from ..common.result import time_summary, set_completed
from .hold import HoldTimer

VERSION = 'plank-multi-0.2-valid-hold-2.0'


class PlankAnalyzer:
    def __init__(self):
        self.rule = PlankRule()
        self.hold_timer = HoldTimer()
        self.valid_hold_seconds = 0.
        self.last_timestamp_ms = None
        self.previous = None
        self.closed = False
        self.observed_seconds = self.gap_seconds = 0.
        self.totals = {k: dict(compliant_s=0., warning_s=0., unknown_s=0.) for k in ('hip','shoulder','knee')}

    def break_continuity(self):
        # Caller uses this when pausing; timestamps must still increase on resume.
        self.rule = PlankRule()
        self.previous = None
        self.hold_timer.reset()

    def push_frame(self, frame):
        if self.closed:
            raise ValueError('Set already finished')
        t, points, dims = unpack_frame(frame)
        if self.last_timestamp_ms is not None and frame['timestampMs'] <= self.last_timestamp_ms:
            raise ValueError('Timestamps must increase; create a new analyzer for a new clip')
        raw = self.rule.step(t, points, dims)
        observation = self.hold_timer.step(frame,raw['side'])
        self.last_timestamp_ms = frame['timestampMs']
        def state(value):
            if value in ('NO_WARNING', 'NO_HIP_WARNING'):
                return 'within_reference'
            if value == 'WARMUP':
                return 'pending_feedback'
            if value == 'UNOBSERVABLE':
                return 'tracking_unavailable'
            return 'warning'
        items = {k: state(raw[col]) for k, col in
                 [('hip', 'hip_state'), ('shoulder', 'shoulder_state'), ('knee', 'knee_state')]}
        hold_eligible = observation['state']=='holding' and all(s=='within_reference' for s in items.values())
        tracking = ('tracking' if any(v in ('within_reference', 'warning') for v in items.values())
                    else 'selecting_side' if 'pending_feedback' in items.values()
                    else 'tracking_unavailable')
        codes = [s.replace('HIP_HIGH', 'HIP_RAISE') for s in raw['warning_codes'].split('|') if s]
        # Same interval accounting as runtime/plank; the posture rule above is unchanged.
        if self.previous is not None:
            dt = t-self.previous['t']
            if dt > HIP_CONFIG['max_gap_s']:
                self.gap_seconds += dt
            else:
                self.observed_seconds += dt
                if self.previous['side']==raw['side'] and self.previous['hold_eligible'] and hold_eligible:
                    self.valid_hold_seconds += dt
                for key, totals in self.totals.items():
                    before, now = self.previous['items'][key], items[key]
                    eligible = (self.previous['side']==raw['side'] and
                        before in ('within_reference','warning') and now in ('within_reference','warning'))
                    bucket = ('warning_s' if before=='warning' else 'compliant_s') if eligible else 'unknown_s'
                    totals[bucket] += dt
        self.previous = dict(t=t, items=items, side=raw['side'],hold_eligible=hold_eligible)
        return json_safe(dict(schemaVersion='1.0', exercise='plank', engineVersion=VERSION,
            timestampMs=frame['timestampMs'], ignored=False, tracking=tracking,
            side=raw['side'], count=None, holdSeconds=self.valid_hold_seconds, codes=codes, items=items, events=[],
            metrics={k: raw[k] for k in ['hip_offset_pct', 'hip_angle_deg', 'shoulder_deviation_deg',
                                        'knee_deg', 'elbow_deg']}, raw=raw))

    def summary(self):
        return time_summary(dict(exercise='plank', engineVersion=VERSION, count=None,
            holdSeconds=self.valid_hold_seconds, observedSeconds=self.observed_seconds, gapSeconds=self.gap_seconds, items=self.totals))

    def finish(self):
        if self.closed:
            return []
        self.closed = True
        return [set_completed(self.summary(), self.last_timestamp_ms)]
