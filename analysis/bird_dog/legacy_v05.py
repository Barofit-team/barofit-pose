"""Phase-aware bird-dog. Engineering candidates, not lumbar curvature."""
from collections import deque
from dataclasses import dataclass, asdict
import math
import numpy as np
from ..common.contract import unpack_frame, json_safe
from .legacy_v01 import BirdDogAnalyzer as Geometry, BirdDogConfig as GeometryConfig, JOINTS, angle
VERSION = 'bird-dog-experimental-0.5'

def leg_alignment(shoulder, hip, ankle):
    """Signed 2D angle from posterior trunk extension; positive is dorsal.

    The upward-facing normal assumes a side/oblique upright camera (not
    inverted). This is trunk-relative alignment, NOT measured floor level.
    """
    u = np.asarray(hip)-np.asarray(shoulder)
    v = np.asarray(ankle)-np.asarray(hip)
    length = float(np.linalg.norm(u))
    if length <= 15 or np.linalg.norm(v) <= 15:
        return None, None
    u = u/length
    n = np.array([-u[1], u[0]])
    if n[1] > 0:
        n = -n
    return (math.degrees(math.atan2(float(v@n),float(v@u))),
            float(v@n)/length)

@dataclass(frozen=True)
class BirdDogConfig:
    confidence: float = 0.5
    camera_roll_deg: float = 0.0
    max_gap_seconds: float = 0.4
    smooth_seconds: float = 0.12
    prepare_seconds: float = 0.4
    prepare_jitter_ratio: float = 0.05
    reach_enter_ratio: float = 0.30
    reach_exit_ratio: float = 0.18
    endpoint_ratio: float = 0.45
    plateau_speed_ratio_s: float = 0.35
    plateau_seconds: float = 0.12
    return_speed_ratio_s: float = 0.45
    return_drop_ratio: float = 0.12
    leg_height_ratio: float = 0.08
    # Separate thigh direction and knee extension; engineering candidates.
    thigh_high_deg: float = 20.0
    knee_min_deg: float = 155.0
    body_shift_ratio: float = 0.12
    trunk_change_deg: float = 12.0
    warning_seconds: float = 0.25

class BirdDogAnalyzer:
    def __init__(self, config=None):
        self.config = config or BirdDogConfig()
        self.geometry = Geometry(GeometryConfig(confidence=self.config.confidence,
                                  camera_roll_deg=self.config.camera_roll_deg))
        self.last_t = None
        self.dims = None
        self.break_continuity()

    def break_continuity(self):
        self.reference = None
        self.preparation = deque()
        self.filtered = None
        self.previous_good = None
        self.previous_progress = {}
        self.motion = {s: dict(phase='preparation', peak=0., stable_since=None) for s in JOINTS}
        self.since = {}
        self.body_side = None
        self.geometry.break_continuity()

    def _state(self, key, raw, t, unavailable='unknown'):
        if raw is None:
            self.since.pop(key, None)
            return unavailable
        if not raw:
            self.since.pop(key, None)
            return 'within_reference'
        begin = self.since.setdefault(key, t)
        return 'warning' if t-begin >= self.config.warning_seconds else 'pending_feedback'

    def _phase(self, side, progress, t, dt):
        state = self.motion[side]
        if progress is None:
            self.motion[side] = dict(phase='unknown', peak=0., stable_since=None)
            self.previous_progress.pop(side, None)
            return 'unknown', None
        prev = self.previous_progress.get(side, progress)
        self.previous_progress[side] = progress
        speed = (progress-prev)/dt if dt else 0.
        cfg = self.config
        if progress < cfg.reach_exit_ratio:
            state.update(phase='preparation', peak=0., stable_since=None)
        elif state['phase'] in ('preparation', 'unknown'):
            if progress >= cfg.reach_enter_ratio:
                state.update(phase='reaching', peak=progress, stable_since=None)
        elif state['phase'] == 'returning':
            # A fresh outward motion can follow a partial return or a brief
            # landmark reversal. Do not latch returning until full preparation.
            if progress >= cfg.endpoint_ratio and speed > cfg.return_speed_ratio_s:
                state.update(phase='reaching', peak=progress, stable_since=None)
        elif state['phase'] != 'returning':
            state['peak'] = max(state['peak'], progress)
            if speed < -cfg.return_speed_ratio_s and state['peak']-progress >= cfg.return_drop_ratio:
                state.update(phase='returning', stable_since=None)
            elif progress >= cfg.endpoint_ratio and abs(speed) < cfg.plateau_speed_ratio_s:
                if state['stable_since'] is None:
                    state['stable_since'] = t
                if t-state['stable_since'] >= cfg.plateau_seconds:
                    state['phase'] = 'holding'
            else:
                state.update(phase='reaching', stable_since=None)
        return state['phase'], speed

    def push_frame(self, frame):
        t,p,dims = unpack_frame(frame)
        if self.last_t is not None and t <= self.last_t:
            raise ValueError('Timestamps must increase')
        dt = t-self.last_t if self.last_t is not None else 0.
        if dt > self.config.max_gap_seconds or (self.dims is not None and not np.array_equal(dims,self.dims)):
            self.break_continuity()
            dt = 0.
        self.last_t, self.dims = t, dims.copy()
        raw = self.geometry.push_frame(frame)
        cfg = self.config
        good = np.isfinite(p[:,[0,1,3,4]]).all(axis=1)
        good &= (p[:,3]>=cfg.confidence)&(p[:,4]>=cfg.confidence)
        good &= (p[:,:2]>=0).all(axis=1)&(p[:,:2]<=1).all(axis=1)
        xy = p[:,:2]*dims
        roll = math.radians(-cfg.camera_roll_deg)
        xy = xy @ np.array([[math.cos(roll),math.sin(roll)],[-math.sin(roll),math.cos(roll)]])
        if self.filtered is None:
            self.filtered=xy.copy()
        alpha=1-math.exp(-dt/cfg.smooth_seconds) if dt else 1.
        for i in range(33):
            if good[i]:
                if self.previous_good is not None and self.previous_good[i]:
                    self.filtered[i] += alpha*(xy[i]-self.filtered[i])
                else:
                    self.filtered[i] = xy[i]
        self.previous_good=good.copy()
        q=self.filtered
        quadruped=any(m['quadruped'] for m in raw['metrics'].values())
        phases,progresses = {},{}
        for side,(s,e,w,h,k,a) in JOINTS.items():
            m=raw['metrics'][side]
            length=self.reference['length'] if self.reference else m['length']
            prog=None
            if quadruped and length and good[[s,h,k]].all():
                forward=1 if q[s,0]>q[h,0] else -1
                prog=float((q[h,0]-q[k,0])*forward/length)
            phase,speed=self._phase(side,prog,t,dt)
            phases[side],progresses[side]=phase,prog
            m.update(phase=phase,reach_ratio=prog,reach_speed_ratio_s=speed,
                     leg_height_ratio=None)
            if length and good[[h,a]].all():
                m['leg_height_ratio']=float((q[h,1]-q[a,1])/length)
            m['leg_alignment_deg']=None
            m['leg_alignment_distance_ratio']=None
            m['thigh_alignment_deg']=None
            m['knee_angle_filtered_deg']=None
            if good[[s,h,a]].all():
                m['leg_alignment_deg'],m['leg_alignment_distance_ratio']=leg_alignment(q[s],q[h],q[a])
            if good[[s,h,k]].all():
                m['thigh_alignment_deg'],_=leg_alignment(q[s],q[h],q[k])
            if good[[h,k,a]].all() and min(np.linalg.norm(q[h]-q[k]),np.linalg.norm(q[a]-q[k]))>15:
                m['knee_angle_filtered_deg']=angle(q[h],q[k],q[a])
        any_reach=any(v in ('reaching','holding','returning') for v in phases.values())
        # A hidden far-side knee must not block a visible, stable preparation.
        # This is an observational reference, not certification of correct posture.
        at_base=(quadruped and any(v=='preparation' for v in phases.values())
                 and all(v in ('preparation','unknown') for v in phases.values())
                 and not any(m['arm_active'] for m in raw['metrics'].values()))
        if not quadruped:
            self.reference=None
            self.preparation.clear()
        elif at_base and self.reference is None:
            candidates=[s for s,ids in JOINTS.items() if good[[ids[0],ids[3],ids[4]]].all()]
            if candidates:
                side=max(candidates,key=lambda s:float(np.min(p[[JOINTS[s][0],JOINTS[s][3]],3:5])))
                self.preparation.append((t,q.copy(),good.copy(),side))
                while self.preparation and t-self.preparation[0][0] > cfg.prepare_seconds+.15:
                    self.preparation.popleft()
                if len(self.preparation)>=4 and t-self.preparation[0][0]>=cfg.prepare_seconds-1e-6:
                    s,_,_,h,_,_=JOINTS[side]
                    samples=np.stack([r[1] for r in self.preparation])
                    base=np.median(samples,axis=0)
                    L=float(np.linalg.norm(base[s]-base[h]))
                    valid=np.stack([r[2] for r in self.preparation]).all(axis=0)
                    if valid[[s,h]].all() and L>15 and np.max(np.ptp(samples[:,[s,h]],axis=0)) / L <= cfg.prepare_jitter_ratio:
                        self.reference=dict(points=base,good=valid,side=side,length=L,
                            timestampMs=t*1000,trunk_deg=math.degrees(math.atan2(
                                base[s,1]-base[h,1],abs(base[s,0]-base[h,0]))))
            else:
                self.preparation.clear()
        elif not at_base:
            self.preparation.clear()
        items={k:'disabled' for k in raw['items'] if k not in ('lumbar_neutral','axial_rotation')}
        for side,m in raw['metrics'].items():
            value=m['thigh_alignment_deg']
            eligible=phases[side]=='holding' and value is not None and quadruped
            items[f'{side}_leg_high']=self._state(f'{side}_leg_high',
                value>cfg.thigh_high_deg if eligible else None,t,
                unavailable='not_applicable' if value is not None and phases[side]!='unknown' else 'unknown')
            knee=m['knee_angle_filtered_deg']
            knee_eligible=phases[side]=='holding' and knee is not None and quadruped
            items[f'{side}_knee_bent']=self._state(f'{side}_knee_bent',
                knee<cfg.knee_min_deg if knee_eligible else None,t,
                unavailable='not_applicable' if knee is not None and phases[side]!='unknown' else 'unknown')
        body=dict(reference_ready=self.reference is not None,reference_kind='stable_preparation_not_verified_normal',
                  side=None,anchor=None,shift_ratio=None,trunk_change_deg=None,
                  perpendicular_shift_ratio=None,along_shift_ratio=None)
        body_bad=None
        body_unavailable='unknown'
        selected=None
        if quadruped and self.reference is not None:
            ref=self.reference
            candidates=[]
            for side,ids in JOINTS.items():
                s,_,w,h,_,_=ids
                # Use the planted-arm torso, not the reaching shoulder. Keep
                # the same wrist anchor throughout a hold; never swap knee/wrist.
                if (phases[side]=='holding' and raw['metrics'][side]['arm_active'] is False
                        and good[[s,h,w]].all() and ref['good'][[s,h,w]].all()
                        and np.linalg.norm(ref['points'][s]-ref['points'][h])>15):
                    candidates.append(side)
            if not any(v=='holding' for v in phases.values()):
                body_unavailable='not_applicable'
            if candidates:
                selected=max(candidates,key=lambda side:float(np.min(p[[JOINTS[side][i] for i in [0,2,3]],3:5])))
                s,_,anchor,h,_,_=JOINTS[selected]
                u=ref['points'][s]-ref['points'][h]
                length=float(np.linalg.norm(u))
                u=u/length
                n=np.array([-u[1],u[0]])
                shifts=(q[[s,h]]-q[anchor])-(ref['points'][[s,h]]-ref['points'][anchor])
                shift=float(np.max(np.linalg.norm(shifts,axis=1))/length)
                perpendicular=float(np.max(np.abs(shifts@n))/length)
                along=float(np.max(np.abs(shifts@u))/length)
                trunk=math.degrees(math.atan2(q[s,1]-q[h,1],abs(q[s,0]-q[h,0])))
                base_trunk=math.degrees(math.atan2(u[1],abs(u[0])))
                change=abs(trunk-base_trunk)
                body.update(side=selected,anchor=anchor,shift_ratio=shift,trunk_change_deg=change,
                            perpendicular_shift_ratio=perpendicular,along_shift_ratio=along)
                # Forward/back weight transfer is diagnostic only. This is a
                # hold-phase stability measure, not spinal curvature or rotation.
                body_bad=perpendicular>cfg.body_shift_ratio or change>cfg.trunk_change_deg
        if selected!=self.body_side:
            self.since.pop('body_movement',None)
        self.body_side=selected
        items['body_movement']=self._state('body_movement',body_bad,t,unavailable=body_unavailable)
        items['lumbar_neutral']='not_supported'
        items['axial_rotation']='not_supported'
        if not quadruped:
            phase='not_ready'
        elif any_reach:
            phase=next(v for v in ('returning','reaching','holding') if v in phases.values())
        else:
            phase='preparation'
        raw.update(engineVersion=VERSION,phase=phase,items=items,
                   codes=[k.upper() for k,v in items.items() if v=='warning'],body=body,
                   referenceStatus='ready' if self.reference else 'needs_stable_preparation')
        return json_safe(raw)

    def configuration(self):
        return dict(version=VERSION,parameters=asdict(self.config),
                    reference_policy='Causal stable preparation; not a certified normal pose',
                    enabled_items=['leg_high','knee_bent','body_movement'],
                    body_policy='Holding only; planted-arm shoulder/hip relative to same wrist; perpendicular displacement or trunk tilt; along-trunk shift diagnostic only',
                    leg_policy='Holding only: LEG_HIGH uses signed trunk-extension to hip-knee angle; KNEE_BENT uses hip-knee-ankle inner angle. Ankle alignment retained as diagnostic; not floor or lumbar angle')
