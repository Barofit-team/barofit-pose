"""Literature-informed items, engineering thresholds: not clinically validated.

Side-view, level fixed camera, one person. Frame results are item-specific.
No lumbar landmark exists: trunk movement is never named lumbar flexion.
"""
from dataclasses import dataclass, asdict
import math
import numpy as np
from ..common.contract import unpack_frame, json_safe

VERSION = "bird-dog-experimental-0.1"
JOINTS = {"left": [11, 13, 15, 23, 25, 27],
          "right": [12, 14, 16, 24, 26, 28]}


@dataclass(frozen=True)
class BirdDogConfig:
    # All numeric cutoffs below are engineering candidates, NOT paper cutoffs.
    confidence: float = 0.5
    support_offset_ratio: float = 0.25
    extended_joint_min_deg: float = 155.0
    limb_high_deg: float = 20.0
    movement_ratio: float = 0.30
    warning_seconds: float = 0.4
    endpoint_delay_seconds: float = 0.35
    max_gap_seconds: float = 0.4
    trunk_change_deg: float = 12.0
    # Caller must supply camera roll if known; a sloping camera invalidates
    # floor-relative rules. No claim of automatic floor/camera calibration.
    camera_roll_deg: float = 0.0


def angle(a, b, c):
    u, v = a - b, c - b
    den = np.linalg.norm(u) * np.linalg.norm(v)
    return math.degrees(math.acos(float(np.clip(u @ v / den, -1, 1)))) if den > 1e-6 else None


class BirdDogAnalyzer:
    def __init__(self, config=None, reference=None):
        self.config = config or BirdDogConfig()
        # Optional explicitly reviewed reference {side: {length, trunk_deg}}.
        # Never assume the first frame is normal; no automatic calibration.
        self.reference = reference or {}
        self.last_t = None
        self.since = {}
        self.active_since = {}

    def break_continuity(self):
        self.since.clear()
        self.active_since.clear()

    def _state(self, key, raw, t):
        if raw is None:
            self.since.pop(key, None)
            return "unknown"
        if not raw:
            self.since.pop(key, None)
            return "within_reference"
        start = self.since.setdefault(key, t)
        return "warning" if t - start >= self.config.warning_seconds else "pending_feedback"

    def push_frame(self, frame):
        t, p, dims = unpack_frame(frame)
        if self.last_t is not None and t <= self.last_t:
            raise ValueError("Timestamps must increase")
        if self.last_t is not None and t - self.last_t > self.config.max_gap_seconds:
            self.break_continuity()
        self.last_t = t
        cfg = self.config
        xy = p[:, :2] * dims
        # Pixel aspect correction BEFORE rotation/angles.
        roll = math.radians(-cfg.camera_roll_deg)
        rotation = np.array([[math.cos(roll), -math.sin(roll)],
                             [math.sin(roll), math.cos(roll)]])
        xy = xy @ rotation.T
        good = np.isfinite(p[:, [0, 1, 3, 4]]).all(axis=1)
        good &= (p[:, 3] >= cfg.confidence) & (p[:, 4] >= cfg.confidence)
        good &= (p[:, :2] >= 0).all(axis=1) & (p[:, :2] <= 1).all(axis=1)
        metrics, raw_items, sides = {}, {}, {}
        for side, ids in JOINTS.items():
            s, e, w, h, k, a = ids
            m = dict(length=None, trunk_deg=None, arm_active=None, leg_active=None,
                     quadruped=False, hand_offset_ratio=None, knee_offset_ratio=None,
                     elbow_deg=None, knee_deg=None, arm_elevation_deg=None,
                     leg_elevation_deg=None, trunk_change_deg=None)
            keys = ["hand_alignment", "support_knee_alignment", "elbow_extension",
                    "knee_extension", "arm_high", "leg_high", "trunk_change"]
            for key in keys:
                raw_items[f"{side}_{key}"] = None
            if not (good[s] and good[h]):
                metrics[side], sides[side] = m, ids
                self.active_since.pop((side, "arm"), None)
                self.active_since.pop((side, "leg"), None)
                continue
            S, H = xy[s], xy[h]
            L = float(np.linalg.norm(S-H))
            if L < 15:
                metrics[side], sides[side] = m, ids
                continue
            length = float(self.reference.get(side, {}).get("length", L))
            forward = 1 if S[0] > H[0] else -1
            m["length"] = length
            m["trunk_deg"] = math.degrees(math.atan2(S[1]-H[1], abs(S[0]-H[0])))
            # Conservative posture gate prevents seated/talking scenes warning.
            support_arm = bool(good[w] and xy[w, 1]-S[1] > .35*length)
            support_leg = bool(good[k] and xy[k, 1]-H[1] > .30*length)
            # The supporting arm and leg can be on opposite sides.
            m["support_arm"] = support_arm
            m["support_leg"] = support_leg
            m["arm_active"] = (bool((xy[w, 0]-S[0])*forward > cfg.movement_ratio*length
                                    and xy[w,1]-S[1] < math.sqrt(3)*abs(xy[w,0]-S[0]))
                               if good[w] else None)
            m["leg_active"] = (bool((xy[k, 0]-H[0])*(-forward) > cfg.movement_ratio*length)
                               if good[k] else None)
            m["hand_offset_ratio"] = abs(float(xy[w, 0]-S[0]))/length if good[w] else None
            m["knee_offset_ratio"] = abs(float(xy[k, 0]-H[0]))/length if good[k] else None
            m["elbow_deg"] = angle(xy[s], xy[e], xy[w]) if good[[s,e,w]].all() else None
            m["knee_deg"] = angle(xy[h], xy[k], xy[a]) if good[[h,k,a]].all() else None
            for limb, origin, end in [("arm", s, w), ("leg", h, a)]:
                if good[[origin,end]].all():
                    delta = xy[end]-xy[origin]
                    m[f"{limb}_elevation_deg"] = math.degrees(
                        math.atan2(-delta[1], abs(delta[0])))
            ref = self.reference.get(side)
            if ref is not None:
                m["trunk_change_deg"] = abs(m["trunk_deg"]-ref["trunk_deg"])
            metrics[side], sides[side] = m, ids
        observable = [m for m in metrics.values() if m["length"] is not None]
        quadruped = (any(m.get("support_arm", False) for m in observable)
                     and any(m.get("support_leg", False) for m in observable)
                     and any(abs(m["trunk_deg"]) < 40 for m in observable))
        for side, m in metrics.items():
            m["quadruped"] = quadruped
            if not quadruped or m["length"] is None:
                self.active_since.pop((side, "arm"), None)
                self.active_since.pop((side, "leg"), None)
                continue
            for limb in ["arm", "leg"]:
                key = (side, limb)
                if m[f"{limb}_active"] is True:
                    self.active_since.setdefault(key, t)
                else:
                    self.active_since.pop(key, None)
            if m.get("support_arm") and m["arm_active"] is False:
                raw_items[f"{side}_hand_alignment"] = m["hand_offset_ratio"] > cfg.support_offset_ratio
            if m.get("support_leg") and m["leg_active"] is False:
                raw_items[f"{side}_support_knee_alignment"] = m["knee_offset_ratio"] > cfg.support_offset_ratio
            for limb, joint in [("arm", "elbow"), ("leg", "knee")]:
                start = self.active_since.get((side, limb))
                if start is not None and t-start >= cfg.endpoint_delay_seconds:
                    v = m[f"{joint}_deg"]
                    raw_items[f"{side}_{joint}_extension"] = None if v is None else v < cfg.extended_joint_min_deg
                    v = m[f"{limb}_elevation_deg"]
                    raw_items[f"{side}_{limb}_high"] = None if v is None else v > cfg.limb_high_deg
            if m["trunk_change_deg"] is not None:
                raw_items[f"{side}_trunk_change"] = m["trunk_change_deg"] > cfg.trunk_change_deg
        arms = [s for s,m in metrics.items() if m["arm_active"] is True]
        legs = [s for s,m in metrics.items() if m["leg_active"] is True]
        all_known = all(m["arm_active"] is not None and m["leg_active"] is not None for m in metrics.values())
        pair = None
        if quadruped and all_known and len(arms)==len(legs)==1:
            pair = arms[0] == legs[0]
        raw_items["same_side_pair"] = pair
        items = {k:self._state(k,v,t) for k,v in raw_items.items()}
        items["lumbar_neutral"] = "not_supported"
        items["axial_rotation"] = "not_supported"
        phase = ("not_ready" if not quadruped else "reaching" if arms or legs else "quadruped")
        return json_safe(dict(schemaVersion="1.0", exercise="bird_dog", engineVersion=VERSION,
            timestampMs=frame["timestampMs"], ignored=False,
            tracking="tracking" if quadruped else "tracking_unavailable",
            side=None, count=None, holdSeconds=None, phase=phase,
            codes=[k.upper() for k,v in items.items() if v=="warning"],
            items=items, metrics=metrics, events=[], experimental=True,
            thresholdBasis="engineering_candidates_not_clinically_validated"))

    def configuration(self):
        return {"version": VERSION, "parameters": asdict(self.config), "reference": self.reference}
