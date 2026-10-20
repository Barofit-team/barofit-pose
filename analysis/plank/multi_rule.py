"""Experimental side-view standard forearm-plank metrics; thresholds are engineering defaults."""
from collections import deque
from statistics import median
import math
import numpy as np
from .hip_rule import HipRule
from .metrics import metric

CONFIG=dict(shoulder_enter_deg=20.,shoulder_exit_deg=15.,knee_enter_deg=160.,knee_exit_deg=165.,
            window_s=.3,warmup_s=.4,enter_s=.6,release_s=.4,min_quality=.5)
IDS={'left':(11,13,15,23,25,27),'right':(12,14,16,24,26,28)}

def angle(a,b,c):
    u=a-b;v=c-b;den=np.linalg.norm(u)*np.linalg.norm(v)
    return float(np.degrees(np.arccos(np.clip(np.dot(u,v)/den,-1,1)))) if den>1e-8 else None

def extra_metrics(pose,dims,side):
    s,e,w,h,k,a=IDS[side]; p=pose[:,:2]*np.asarray(dims)
    def valid(ids):
        q=pose[list(ids)]
        return bool(np.isfinite(q).all() and (q[:,3:]>=CONFIG['min_quality']).all() and ((q[:,:2]>=0)&(q[:,:2]<=1)).all())
    shoulder=valid((s,e)) and bool(np.linalg.norm(p[e]-p[s])>1e-8)
    knee=valid((h,k,a));elbow=valid((s,e,w))
    # Screen-vertical reference assumes a level side camera. This is not gravity calibration.
    deviation=float(np.degrees(np.arctan2(abs(p[e,0]-p[s,0]),p[e,1]-p[s,1]))) if shoulder else None
    knee_angle=angle(p[h],p[k],p[a]) if knee else None
    elbow_angle=angle(p[s],p[e],p[w]) if elbow else None
    return dict(shoulder_deviation_deg=deviation,knee_deg=knee_angle,elbow_deg=elbow_angle,
        shoulder_valid=shoulder,knee_valid=knee and knee_angle is not None,elbow_valid=elbow and elbow_angle is not None,
        shoulder_elbow_dx_px=float(p[e,0]-p[s,0]) if shoulder else None)

class SustainedRule:
    def __init__(self,code,enter,release,low=False):
        self.code=code;self.enter=enter;self.release=release;self.low=low;self.reset()
    def reset(self):
        self.q=deque();self.since=None;self.pending=None;self.pending_since=None;self.state='WARMUP'
    def step(self,t,value):
        if value is None or not math.isfinite(value):
            self.reset();return 'UNOBSERVABLE',None
        if self.since is None:self.since=t
        self.q.append((t,value))
        while self.q and t-self.q[0][0]>CONFIG['window_s']:self.q.popleft()
        value=median(v for _,v in self.q)
        if t-self.since<CONFIG['warmup_s']:return 'WARMUP',value
        if self.state=='WARMUP':self.state='NO_WARNING'
        threshold=self.release if self.state==self.code else self.enter
        bad=value<threshold if self.low else value>threshold
        target=self.code if bad else 'NO_WARNING'
        if target==self.state:self.pending=None;self.pending_since=None
        else:
            if target!=self.pending:self.pending=target;self.pending_since=t
            delay=CONFIG['enter_s'] if bad else CONFIG['release_s']
            if t-self.pending_since>=delay:self.state=target;self.pending=None;self.pending_since=None
        return self.state,value

class PlankRule:
    def __init__(self):
        self.hip=HipRule();self.last_side=None;self.last_t=None
        self.shoulder=SustainedRule('SHOULDER_ELBOW_OFFSET',CONFIG['shoulder_enter_deg'],CONFIG['shoulder_exit_deg'])
        self.knee=SustainedRule('KNEE_BENT',CONFIG['knee_enter_deg'],CONFIG['knee_exit_deg'],True)
    def step(self,t,pose,dims):
        hip=self.hip.step(t,{s:metric(pose,dims,s) for s in IDS})
        if hip['side']!=self.last_side or (self.last_t is not None and t-self.last_t>.25):
            self.shoulder.reset();self.knee.reset()
        self.last_side=hip['side'];self.last_t=t
        m=extra_metrics(pose,dims,hip['side']) if hip['side'] else dict(shoulder_deviation_deg=None,knee_deg=None,elbow_deg=None,shoulder_valid=False,knee_valid=False,elbow_valid=False,shoulder_elbow_dx_px=None)
        ss,sv=self.shoulder.step(t,m['shoulder_deviation_deg'])
        ks,kv=self.knee.step(t,m['knee_deg'])
        codes=[v for v in [hip['state'],ss,ks] if v in ('HIP_DROP','HIP_HIGH','SHOULDER_ELBOW_OFFSET','KNEE_BENT')]
        return dict(time_s=t,side=hip['side'],hip_state=hip['state'],hip_offset_pct=hip['offset_pct'],hip_angle_deg=hip['angle_deg'],
            shoulder_state=ss,knee_state=ks,shoulder_filtered_deg=sv,knee_filtered_deg=kv,warning_codes='|'.join(codes),**m)
