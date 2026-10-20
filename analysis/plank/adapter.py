"""Frame interface for the frozen v0.2 Python reference, not an app port."""
from ..common.contract import unpack_frame, json_safe
from .multi_rule import PlankRule

VERSION = 'plank-multi-0.2'


class PlankAnalyzer:
    def __init__(self):
        self.rule = PlankRule()
        self.last_timestamp_ms = None

    def break_continuity(self):
        # Caller uses this when pausing; timestamps must still increase on resume.
        self.rule = PlankRule()

    def push_frame(self, frame):
        t, points, dims = unpack_frame(frame)
        if self.last_timestamp_ms is not None and frame['timestampMs'] <= self.last_timestamp_ms:
            raise ValueError('Timestamps must increase; create a new analyzer for a new clip')
        raw = self.rule.step(t, points, dims)
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
        tracking = ('tracking' if any(v in ('within_reference', 'warning') for v in items.values())
                    else 'selecting_side' if 'pending_feedback' in items.values()
                    else 'tracking_unavailable')
        codes = [s.replace('HIP_HIGH', 'HIP_RAISE') for s in raw['warning_codes'].split('|') if s]
        return json_safe(dict(schemaVersion='1.0', exercise='plank', engineVersion=VERSION,
            timestampMs=frame['timestampMs'], ignored=False, tracking=tracking,
            side=raw['side'], count=None, holdSeconds=None, codes=codes, items=items, events=[],
            metrics={k: raw[k] for k in ['hip_offset_pct', 'hip_angle_deg', 'shoulder_deviation_deg',
                                        'knee_deg', 'elbow_deg']}, raw=raw))
