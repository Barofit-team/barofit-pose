"""Causal hip-only rule for an already selected side-view forearm plank clip.
Experimental thresholds, tuned on the four development clips; not validated clinically.
Input rows: per-side metric dictionaries and monotonically increasing seconds.
No person-specific calibration, no future frames, no requirement for both sides.
"""
from collections import deque
from statistics import median

CONFIG = dict(drop_enter_pct=4.0, drop_exit_pct=3.0,
              high_enter_pct=-12.0, high_exit_pct=-10.0,
              median_window_s=0.3, warmup_s=0.4, enter_s=0.6,
              release_s=0.4, reselect_after_s=0.4, max_gap_s=0.25)

class HipRule:
    def __init__(self, config=None):
        self.c = dict(CONFIG if config is None else config)
        self.side = None; self.last_t = None; self.bad_since = None
        self.history = deque(); self.state = 'WARMUP'
        self.pending = None; self.pending_since = None; self.valid_since = None
        self.switches = 0

    def reset_motion(self):
        self.history.clear(); self.state = 'WARMUP'
        self.pending = None; self.pending_since = None; self.valid_since = None

    @staticmethod
    def valid(row):
        import math
        value = row.get('hip_offset_pct')
        return bool(row.get('reliable')) and value is not None and math.isfinite(value)

    def step(self, t, rows):
        if self.last_t is not None:
            if t <= self.last_t: raise ValueError('Timestamps must increase')
            if t-self.last_t > self.c['max_gap_s']: self.reset_motion()
        self.last_t = t
        ok = [s for s,r in rows.items() if self.valid(r)]
        if self.side is None and ok:
            self.side = max(ok,key=lambda s: min(rows[s]['min_visibility'],rows[s]['min_presence']))
            self.reset_motion()
        if self.side not in ok:
            if self.bad_since is None: self.bad_since = t
            self.reset_motion()
            if ok and t-self.bad_since >= self.c['reselect_after_s']:
                self.side = max(ok,key=lambda s:min(rows[s]['min_visibility'],rows[s]['min_presence']))
                self.switches += 1; self.bad_since = None
            else:
                return dict(side=self.side,state='UNOBSERVABLE',offset_pct=None,angle_deg=None,
                            pending=None,warning=False,side_switches=self.switches)
        self.bad_since = None
        row = rows[self.side]
        if self.valid_since is None: self.valid_since = t
        self.history.append((t,row['hip_offset_pct']))
        while self.history and t-self.history[0][0] > self.c['median_window_s']:
            self.history.popleft()
        v = median(x[1] for x in self.history)
        if t-self.valid_since >= self.c['warmup_s']:
            if self.state == 'WARMUP': self.state='NO_HIP_WARNING'
            if v > self.c['drop_enter_pct']: target='HIP_DROP'
            elif v < self.c['high_enter_pct']: target='HIP_HIGH'
            elif self.state=='HIP_DROP' and v>self.c['drop_exit_pct']: target='HIP_DROP'
            elif self.state=='HIP_HIGH' and v<self.c['high_exit_pct']: target='HIP_HIGH'
            else: target='NO_HIP_WARNING'
            if target==self.state:
                self.pending=None;self.pending_since=None
            else:
                if target!=self.pending: self.pending=target;self.pending_since=t
                delay=self.c['release_s'] if target=='NO_HIP_WARNING' else self.c['enter_s']
                if t-self.pending_since>=delay:
                    self.state=target;self.pending=None;self.pending_since=None
        return dict(side=self.side,state=self.state,offset_pct=v,angle_deg=row['hip_angle_deg'],
                    pending=self.pending,warning=self.state in ('HIP_DROP','HIP_HIGH'),side_switches=self.switches)
