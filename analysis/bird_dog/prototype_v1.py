"""Side-view bird dog: count excursions independently of posture quality.

Unknown joints suppress only dependent items. Thresholds are engineering
parameters; neither torso alignment nor torso movement measures lumbar shape.
"""
from collections import deque
from dataclasses import dataclass, asdict
import math
import numpy as np
from ..common.contract import unpack_frame, json_safe
from ..common.result import time_summary, set_completed
from .legacy_v01 import JOINTS, angle
from .legacy_v05 import leg_alignment

VERSION = 'bird-dog-prototype-1.0'
SIDES = ('left', 'right')
OPPOSITE = {'left': 'right', 'right': 'left'}
SIDE_ITEMS = ('leg_high', 'knee_bent', 'arm_high', 'arm_low', 'elbow_bent', 'hand_alignment', 'support_knee_alignment')
ITEMS = [f'{s}_{k}' for s in SIDES for k in SIDE_ITEMS] + ['same_side_pair', 'body_movement']

@dataclass(frozen=True)
class BirdDogConfig:
    confidence: float = .5
    camera_roll_deg: float = 0.
    max_gap_seconds: float = .4
    joint_grace_seconds: float = .20
    smooth_seconds: float = .12
    prepare_seconds: float = .25
    reach_enter_ratio: float = .40
    reach_exit_ratio: float = .30
    endpoint_ratio: float = .45
    plateau_speed_ratio_s: float = .35
    plateau_seconds: float = .12
    return_speed_ratio_s: float = .45
    return_drop_ratio: float = .12
    min_excursion_seconds: float = .45
    min_observed_hold_seconds: float = .25
    return_confirm_seconds: float = .10
    thigh_high_deg: float = 20.
    knee_min_deg: float = 155.
    arm_high_deg: float = 20.
    arm_low_deg: float = -25.
    elbow_min_deg: float = 155.
    support_offset_ratio: float = .30
    arm_settle_seconds: float = .35
    arm_motion_ratio_s: float = .45
    joint_angle_speed_deg_s: float = 35.
    body_window_seconds: float = .8
    body_settle_seconds: float = .3
    body_shift_ratio: float = .12
    trunk_change_deg: float = 12.
    warning_seconds: float = .35

class BirdDogAnalyzer:
    def __init__(self, config=None):
        self.config = config or BirdDogConfig()
        if not all(math.isfinite(v) for v in asdict(self.config).values()):
            raise ValueError('Config must be finite')
        if self.config.smooth_seconds <= 0 or self.config.max_gap_seconds <= 0:
            raise ValueError('Time intervals must be positive')
        self.last_t = self.dims = self.previous = None
        self.count = 0
        self.hold_seconds = self.observed_seconds = self.gap_seconds = 0.
        self.side_counts = dict(left=0, right=0)
        self.repetitions = []
        self.closed = False
        self.totals = {k: dict(compliant_s=0., warning_s=0., unknown_s=0., not_applicable_s=0.) for k in ITEMS}
        self._reset_motion()

    def _reset_motion(self):
        self.filtered = self.previous_good = None
        self.motion = {s: dict(phase='unknown', progress=None, peak=0., stable=None,
            base=None, armed=False, cycle=None, returned=None, held_since=None, last_valid=None) for s in SIDES}
        self.since, self.arm_since = {}, {}
        self.limb_previous = {}
        self.body_history, self.body_key = deque(), None
        self.global_base = None
        self.context_seen = False

    def _interrupt(self, reason, t):
        return [dict(type='rep.interrupted', t=t, side=s, reason=reason,
                     start_s=m['cycle']['start_s'], hold_s=m['cycle']['hold_s'])
                for s,m in self.motion.items() if m['cycle']]

    def break_continuity(self, reason='pause'):
        events = self._interrupt(reason, self.last_t)
        self._reset_motion()
        self.previous = None
        return events

    def _state(self, key, raw, t, unavailable='unknown'):
        if raw is None:
            self.since.pop(key, None)
            return unavailable
        if not raw:
            self.since.pop(key, None)
            return 'within_reference'
        start = self.since.setdefault(key, t)
        return 'warning' if t-start >= self.config.warning_seconds-1e-8 else 'pending_feedback'

    def _phase(self, side, progress, t, dt, events):
        m, cfg = self.motion[side], self.config
        if progress is None:
            if m['last_valid'] is not None and t-m['last_valid']<=cfg.joint_grace_seconds:
                m.update(phase='unknown',progress=None,held_since=None,stable=None)
                return 'unknown',None
            if m['cycle']:
                events.append(dict(type='rep.interrupted', t=t, side=side, reason='leg_tracking_lost',
                                   start_s=m['cycle']['start_s'], hold_s=m['cycle']['hold_s']))
            was_armed=m['armed'] and m['cycle'] is None
            m.update(phase='unknown', progress=None, peak=0., stable=None, base=None,
                     armed=was_armed, cycle=None, returned=None, held_since=None)
            return 'unknown', None
        m['last_valid']=t
        speed = (progress-m['progress'])/dt if dt and m['progress'] is not None else 0.
        m['progress'] = progress
        if progress < cfg.reach_exit_ratio:
            m['base'] = t if m['base'] is None else m['base']
            if m['cycle']:
                m['returned'] = t if m['returned'] is None else m['returned']
                if t-m['returned'] >= cfg.return_confirm_seconds-1e-8:
                    c = m['cycle']
                    if (c['peak'] >= cfg.endpoint_ratio and t-c['start_s'] >= cfg.min_excursion_seconds
                            and c['hold_s']>=cfg.min_observed_hold_seconds-1e-8):
                        self.count += 1
                        self.side_counts[side] += 1
                        rep = dict(index=self.count, side=side, start_s=c['start_s'],
                                   end_s=t, hold_s=c['hold_s'], codes=sorted(c['codes']))
                        self.repetitions.append(rep)
                        events.append(dict(type='rep.completed', t=t, **rep))
                    m['cycle'] = None
            m.update(phase='preparation', peak=0., stable=None, held_since=None)
            if t-m['base'] >= cfg.prepare_seconds-1e-8:
                m['armed'] = True
        else:
            m['base'] = m['returned'] = None
            if progress >= cfg.reach_enter_ratio:
                if m['armed'] and m['cycle'] is None:
                    m['cycle'] = dict(start_s=t, peak=progress, hold_s=0., codes=set())
                    m['armed'] = False
                    events.append(dict(type='rep.started', t=t, side=side))
                if m['phase'] in ('preparation', 'unknown'):
                    m.update(phase='reaching', peak=progress, stable=None)
                m['peak'] = max(m['peak'], progress)
                if m['cycle']:
                    m['cycle']['peak'] = max(m['cycle']['peak'], progress)
                if speed < -cfg.return_speed_ratio_s and m['peak']-progress >= cfg.return_drop_ratio:
                    m.update(phase='returning', stable=None, held_since=None)
                elif m['phase']=='holding' and progress>=cfg.endpoint_ratio:
                    # Once settled, small landmark velocity changes must not
                    # repeatedly erase the holding phase and warning timer.
                    pass
                elif progress >= cfg.endpoint_ratio and abs(speed) < cfg.plateau_speed_ratio_s:
                    m['stable'] = t if m['stable'] is None else m['stable']
                    if t-m['stable'] >= cfg.plateau_seconds-1e-8:
                        m['phase'] = 'holding'
                        m['held_since'] = t if m['held_since'] is None else m['held_since']
                elif m['phase'] != 'returning' or speed > cfg.return_speed_ratio_s:
                    m.update(phase='reaching', stable=None, held_since=None)
            elif m['phase'] not in ('preparation', 'unknown'):
                m.update(phase='returning', stable=None, held_since=None)
        return m['phase'], speed

    def push_frame(self, frame):
        if self.closed:
            raise ValueError('Analyzer already finished')
        t,p,dims = unpack_frame(frame)
        if self.last_t is not None and t <= self.last_t:
            raise ValueError('Timestamps must increase')
        dt = t-self.last_t if self.last_t is not None else 0.
        events = []
        if dt > self.config.max_gap_seconds or (self.dims is not None and not np.array_equal(dims,self.dims)):
            self.gap_seconds += dt
            events += self.break_continuity('frame_gap_or_dimensions')
            events.append(dict(type='frame.gap',t=t,duration_s=dt))
            dt = 0.
        cfg = self.config
        self.last_t,self.dims = t,dims.copy()
        good = np.isfinite(p[:,[0,1,3,4]]).all(axis=1)
        good &= (p[:,3]>=cfg.confidence)&(p[:,4]>=cfg.confidence)
        good &= (p[:,:2]>=0).all(axis=1)&(p[:,:2]<=1).all(axis=1)
        xy = p[:,:2]*dims
        r = math.radians(-cfg.camera_roll_deg)
        xy = xy @ np.array([[math.cos(r),math.sin(r)],[-math.sin(r),math.cos(r)]])
        if self.filtered is None:
            self.filtered = xy.copy()
        alpha = 1-math.exp(-dt/cfg.smooth_seconds) if dt else 1.
        for i in range(33):
            if good[i]:
                if self.previous_good is not None and self.previous_good[i]:
                    self.filtered[i] += alpha*(xy[i]-self.filtered[i])
                else:
                    self.filtered[i] = xy[i]
        self.previous_good = good.copy()
        q = self.filtered
        metrics = {}
        for side,(s,e,w,h,k,a) in JOINTS.items():
            m = dict(length=None,trunk_deg=None,reach_ratio=None,arm_active=None,
                support_arm=False,support_leg=False,thigh_alignment_deg=None,leg_alignment_deg=None,
                knee_angle_filtered_deg=None,arm_alignment_deg=None,arm_floor_deg=None,elbow_angle_filtered_deg=None,
                hand_offset_ratio=None,knee_offset_ratio=None)
            metrics[side] = m
            if not good[[s,h]].all():
                continue
            u = q[s]-q[h]
            L = float(np.linalg.norm(u))
            if L <= 15:
                continue
            u /= L
            m.update(length=L,trunk_deg=math.degrees(math.atan2(u[1],abs(u[0]))))
            if good[k]:
                m['reach_ratio'] = float((q[h]-q[k])@u/L)
                m['support_leg'] = bool(q[k,1]-q[h,1]>.30*L and m['reach_ratio']<.60)
                m['knee_offset_ratio'] = float(abs(q[k,0]-q[h,0])/L)
                m['thigh_alignment_deg'],_ = leg_alignment(q[s],q[h],q[k])
            if good[w]:
                m['hand_offset_ratio'] = float(abs(q[w,0]-q[s,0])/L)
                m['arm_active'] = bool((q[w]-q[s])@u/L>.30 and q[w,1]-q[s,1]<math.sqrt(3)*abs(q[w,0]-q[s,0]))
                m['support_arm'] = bool(q[w,1]-q[s,1]>.35*L and not m['arm_active'])
            elif good[e]:
                m['arm_active'] = bool((q[e]-q[s])@u/L>.20 and q[e,1]-q[s,1]<math.sqrt(3)*abs(q[e,0]-q[s,0]))
            if good[e]:
                m['arm_alignment_deg'],_ = leg_alignment(q[h],q[s],q[e])
                m['arm_floor_deg']=math.degrees(math.atan2(q[s,1]-q[e,1],abs(q[e,0]-q[s,0])))
            if good[a]:
                m['leg_alignment_deg'],_ = leg_alignment(q[s],q[h],q[a])
            for ids,key in [([h,k,a],'knee_angle_filtered_deg'),([s,e,w],'elbow_angle_filtered_deg')]:
                if good[ids].all() and min(np.linalg.norm(q[ids[0]]-q[ids[1]]),np.linalg.norm(q[ids[2]]-q[ids[1]]))>15:
                    m[key] = angle(*q[ids])
            prev=self.limb_previous.get(side)
            arm_vector=(q[e]-q[s])/L if good[e] else None
            m['arm_speed_ratio_s']=float(np.linalg.norm(arm_vector-prev['arm'])/dt) if dt and arm_vector is not None and prev and prev['arm'] is not None else None
            knee=m['knee_angle_filtered_deg']
            m['knee_speed_deg_s']=abs(knee-prev['knee'])/dt if dt and knee is not None and prev and prev['knee'] is not None else None
            self.limb_previous[side]=dict(arm=arm_vector,knee=knee)
        # A supporting knee and horizontal torso suffice; no global wrist gate.
        horizontal=any(m['trunk_deg'] is not None and abs(m['trunk_deg'])<40 for m in metrics.values())
        context=horizontal and (any(m['support_leg'] for m in metrics.values()) or
            (self.context_seen and any(m['support_arm'] for m in metrics.values())))
        self.context_seen=context
        base=context and any(m['support_leg'] for m in metrics.values()) and all(
            m['reach_ratio'] is None or m['reach_ratio']<.32 for m in metrics.values()) and not any(
            m['arm_active'] is True for m in metrics.values())
        self.global_base=(t if self.global_base is None else self.global_base) if base else None
        if self.global_base is not None and t-self.global_base>=cfg.prepare_seconds:
            for m in self.motion.values():
                if m['cycle'] is None:m['armed']=True
        phases = {}
        for side,m in metrics.items():
            phases[side],speed = self._phase(side,m['reach_ratio'] if context else None,t,dt,events)
            m.update(phase=phases[side],reach_speed_ratio_s=speed,quadruped=context)
            if not context:self.motion[side]['armed']=False
        holding = [s for s in SIDES if phases[s]=='holding']
        prev_holding = self.previous.get('holdingSides',[]) if self.previous else []
        valid_holds = set(holding)&set(prev_holding)
        if valid_holds:
            self.hold_seconds += dt
            for side in valid_holds:
                c = self.motion[side]['cycle']
                if c:
                    c['hold_s'] += dt
        items = {}
        for side,m in metrics.items():
            eligible = side in holding
            for name,key,test in [('leg_high','thigh_alignment_deg',lambda x:x>cfg.thigh_high_deg),
                                   ('knee_bent','knee_angle_filtered_deg',lambda x:x<cfg.knee_min_deg)]:
                val = m[key]
                settled=name!='knee_bent' or (m.get('knee_speed_deg_s') is not None and m['knee_speed_deg_s']<cfg.joint_angle_speed_deg_s)
                items[f'{side}_{name}'] = self._state(f'{side}_{name}',test(val) if eligible and settled and val is not None else None,t,
                    'not_applicable' if context and not eligible and phases[side]!='unknown' else 'unknown')
            active = (context and bool(holding) and m['arm_active'] is True and
                      m.get('arm_speed_ratio_s') is not None and m['arm_speed_ratio_s']<cfg.arm_motion_ratio_s)
            if active:
                self.arm_since.setdefault(side,t)
            else:
                self.arm_since.pop(side,None)
            arm_eligible = active and t-self.arm_since[side]>=cfg.arm_settle_seconds-1e-8
            for name,key,test in [('arm_high','arm_alignment_deg',lambda x:x>cfg.arm_high_deg and m['arm_floor_deg']>cfg.arm_high_deg),
                ('arm_low','arm_alignment_deg',lambda x:x<cfg.arm_low_deg and m['arm_floor_deg']<cfg.arm_low_deg),
                ('elbow_bent','elbow_angle_filtered_deg',lambda x:x<cfg.elbow_min_deg)]:
                val=m[key]
                items[f'{side}_{name}']=self._state(f'{side}_{name}',test(val) if arm_eligible and val is not None else None,t,
                    'not_applicable' if context and m['arm_active'] is False else 'unknown')
            stable=context and all(v in ('preparation','unknown','holding') for v in phases.values())
            for name,key,support in [('hand_alignment','hand_offset_ratio','support_arm'),('support_knee_alignment','knee_offset_ratio','support_leg')]:
                val=m[key]
                items[f'{side}_{name}']=self._state(f'{side}_{name}',val>cfg.support_offset_ratio if stable and m[support] and val is not None else None,t,
                    'not_applicable' if context and val is not None and not m[support] else 'unknown')
        arms=[s for s in SIDES if metrics[s]['arm_active'] is True]
        all_arms_known=all(metrics[s]['arm_active'] is not None for s in SIDES)
        pair=(arms[0]==holding[0]) if len(arms)==len(holding)==1 and all_arms_known else None
        items['same_side_pair']=self._state('same_side_pair',pair,t,'not_applicable' if not holding and context else 'unknown')
        body=dict(reference_ready=False,reference_kind='within_hold_window',side=None,anchor=None,
                  perpendicular_shift_ratio=None,trunk_change_deg=None)
        candidates=[]
        for side in holding:
            s,e,w,h,k,a=JOINTS[side]
            other_k=JOINTS[OPPOSITE[side]][4]
            anchor=w if metrics[side]['support_arm'] and good[w] else other_k if good[other_k] and metrics[OPPOSITE[side]]['support_leg'] else None
            if anchor is not None and good[[s,h]].all():
                candidates.append((side,anchor))
        selected=max(candidates,key=lambda x:float(np.min(p[[JOINTS[x[0]][0],JOINTS[x[0]][3],x[1]],3:5]))) if candidates else None
        if selected!=self.body_key:
            self.body_history.clear()
            self.since.pop('body_movement',None)
        self.body_key=selected
        body_bad=None
        if selected:
            side,anchor=selected
            s,_,_,h,_,_=JOINTS[side]
            held_since=self.motion[side]['held_since']
            if held_since is not None and t-held_since>=cfg.body_settle_seconds:
                self.body_history.append((t,(q[[s,h]]-q[anchor])/metrics[side]['length'],metrics[side]['trunk_deg']))
                while self.body_history and t-self.body_history[0][0]>cfg.body_window_seconds:
                    self.body_history.popleft()
                if len(self.body_history)>2 and t-self.body_history[0][0]>=cfg.body_window_seconds*.65:
                    points=np.stack([v[1] for v in self.body_history])
                    shift=float(np.max(np.ptp(points[:,:,1],axis=0)))
                    tilt=float(np.ptp([v[2] for v in self.body_history]))
                    body.update(reference_ready=True,side=side,anchor=anchor,perpendicular_shift_ratio=shift,trunk_change_deg=tilt)
                    body_bad=shift>cfg.body_shift_ratio or tilt>cfg.trunk_change_deg
        items['body_movement']=self._state('body_movement',body_bad,t,'not_applicable' if context and not holding else 'unknown')
        items.update(lumbar_neutral='not_supported',axial_rotation='not_supported')
        codes=[k.upper() for k,v in items.items() if v=='warning']
        for m in self.motion.values():
            if m['cycle']:
                m['cycle']['codes'].update(codes)
        movement='not_ready' if not context else next((v for v in ('returning','reaching','holding') if v in phases.values()),'preparation')
        phase='bird_dog' if movement in ('reaching','holding') else movement
        if self.previous and dt:
            self.observed_seconds+=dt
            for k in ITEMS:
                state=items[k] if items[k]==self.previous['items'][k] else 'unknown'
                bucket={'within_reference':'compliant_s','warning':'warning_s','not_applicable':'not_applicable_s'}.get(state,'unknown_s')
                self.totals[k][bucket]+=dt
        if self.previous is None or phase!=self.previous['phase']:
            events.append(dict(type='phase.changed',t=t,phase=phase,movementPhase=movement))
        if self.previous is None or codes!=self.previous['codes']:
            events.append(dict(type='feedback.changed',t=t,codes=codes))
        row=json_safe(dict(schemaVersion='1.0',exercise='bird_dog',engineVersion=VERSION,
            timestampMs=frame['timestampMs'],ignored=False,tracking='tracking' if context else 'tracking_unavailable',
            side=holding[0] if len(holding)==1 else None,count=self.count,holdSeconds=self.hold_seconds,
            observedSeconds=self.observed_seconds,sideCounts=self.side_counts.copy(),phase=phase,movementPhase=movement,
            holdingSides=holding,codes=codes,items=items,metrics=metrics,body=body,events=events,
            referenceStatus='not_required',experimental=True,thresholdBasis='engineering_candidates_not_clinically_validated'))
        self.previous=row
        return row

    def summary(self):
        items={}
        for k,v in self.totals.items():
            denom=v['compliant_s']+v['warning_s']
            items[k]=dict(v,assessed_s=denom,compliance=v['compliant_s']/denom if denom else None)
        return time_summary(dict(schemaVersion='1.0',exercise='bird_dog',engineVersion=VERSION,
            count=self.count,holdSeconds=self.hold_seconds,sideCounts=self.side_counts.copy(),
            observedSeconds=self.observed_seconds,gapSeconds=self.gap_seconds,
            repetitions=self.repetitions,items=items,configuration=self.configuration()))

    def finish(self):
        if self.closed:
            return []
        events=self._interrupt('set_finished',self.last_t)
        self.closed=True
        return events+[set_completed(self.summary(),self.last_t*1000 if self.last_t is not None else None)]

    def configuration(self):
        return dict(version=VERSION,parameters=asdict(self.config),enabled_items=ITEMS,
            repetition_unit='One leg out-and-back = one; left+right = two; quality does not gate count',
            hold_policy='Observed holding time, not necessarily correct posture; gaps excluded',
            body_policy='Within-hold movement only, not lumbar curvature',
            unsupported=['lumbar_neutral','axial_rotation'])
