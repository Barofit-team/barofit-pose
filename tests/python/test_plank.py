import json
import unittest
from pathlib import Path
import numpy as np
from analysis.plank.multi_rule import PlankRule
from analysis.plank.adapter import PlankAnalyzer
from analysis.common.contract import json_safe
from analysis.pushup.unified_engine import validate_model, predict_unified

ROOT=Path(__file__).resolve().parents[2]


def pose(kind='normal', left=.9, right=.8):
    p=np.zeros((33,5),float)
    for ids,c in [([11,13,15,23,25,27],left),([12,14,16,24,26,28],right)]:
        points=[[.2,.3],[.2,.5],[.1,.5],[.5,.3],[.7,.3],[.9,.3]]
        if kind=='drop':points[3][1]=.38;points[4][1]=.34
        if kind=='high':points[3][1]=.18;points[4][1]=.24
        if kind=='shoulder':points[1][0]=.35
        if kind=='knee':points[4][1]=.42
        for idx,xy in zip(ids,points):p[idx]=[*xy,0,c,c]
    return p


class Rules(unittest.TestCase):
    def test_normal_and_sustained_warnings(self):
        for kind,code in [('normal',''),('drop','HIP_DROP'),('high','HIP_HIGH'),
                          ('shoulder','SHOULDER_ELBOW_OFFSET'),('knee','KNEE_BENT')]:
            r=PlankRule()
            for i in range(40):last=r.step(i/15,pose(kind),[1000,1000])
            self.assertEqual(last['warning_codes'],code,kind)

    def test_single_spike_does_not_warn_and_recovery_clears(self):
        r=PlankRule()
        outputs=[r.step(i/15,pose('drop' if i==15 else 'normal'),[1000,1000]) for i in range(45)]
        self.assertFalse(any(x['warning_codes'] for x in outputs))
        for i in range(45,80):last=r.step(i/15,pose('knee'),[1000,1000])
        self.assertIn('KNEE_BENT',last['warning_codes'])
        for i in range(80,110):last=r.step(i/15,pose(),[1000,1000])
        self.assertEqual(last['warning_codes'],'')

    def test_missing_pose_is_unknown_not_normal(self):
        e=PlankAnalyzer()
        for i in range(30):e.push_frame(dict(timestampMs=i*100,width=1000,height=1000,landmarks=pose().tolist()))
        result=e.push_frame(dict(timestampMs=3000,width=1000,height=1000,landmarks=[]))
        self.assertEqual(result['tracking'],'tracking_unavailable')
        self.assertEqual(set(result['items'].values()),{'tracking_unavailable'})
        self.assertIsNone(result['holdSeconds'])
        json.dumps(result,allow_nan=False)

    def test_reselection_and_gap_reset(self):
        r=PlankRule()
        for i in range(20):r.step(i/10,pose(left=.95,right=.8),[1000,1000])
        for i in range(20,28):last=r.step(i/10,pose(left=0,right=.9),[1000,1000])
        self.assertEqual(last['side'],'right')
        last=r.step(4,pose(left=0,right=.9),[1000,1000])
        self.assertEqual(last['hip_state'],'WARMUP')

    def test_adapter_matches_raw_rules(self):
        a,b=PlankAnalyzer(),PlankRule()
        for i in range(150):
            p=pose(['normal','drop','high','shoulder','knee'][i//30]);t=i/15
            actual=a.push_frame(dict(timestampMs=t*1000,width=1000,height=1000,landmarks=p.tolist()))
            expected=b.step(t*1000/1000,p,[1000,1000])
            self.assertEqual(actual['raw'],json_safe(expected))
            self.assertEqual(actual['codes'],[v.replace('HIP_HIGH','HIP_RAISE') for v in expected['warning_codes'].split('|') if v])
        with self.assertRaises(ValueError):a.push_frame(dict(timestampMs=1,width=1000,height=1000,landmarks=pose().tolist()))

    def test_degenerate_shoulder_and_missing_elbow(self):
        r=PlankRule();p=pose();p[13]=p[11];p[14]=p[12]
        for i in range(30):last=r.step(i/15,p,[1000,1000])
        self.assertEqual(last['shoulder_state'],'UNOBSERVABLE')
        self.assertEqual(last['knee_state'],'NO_WARNING')

    def test_pushup_reference_integrity_and_stationary_batch(self):
        model=json.loads((ROOT/'analysis/pushup/reference.json').read_text(encoding='utf-8'))
        validate_model(model)
        arr=dict(poses=np.stack([pose() for _ in range(50)]),times=np.arange(50)/15,
                 dims=np.tile([1000,1000],(50,1)),indices=np.arange(50))
        frames,reps,audit,side=predict_unified(arr,model,'left')
        self.assertEqual(len(frames),50);self.assertEqual(len(reps),0);self.assertEqual(side,'left')


if __name__=='__main__':unittest.main()
