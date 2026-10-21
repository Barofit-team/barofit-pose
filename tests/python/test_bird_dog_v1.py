import unittest
import math
from analysis.bird_dog import BirdDogAnalyzer, BirdDogConfig
from test_bird_dog_v02 import sample

def sequence(modify=None, mirror=False):
    frames=[]
    for t in range(0,5001,50):
        ext=min(1.,max(0.,(t-1000)/600))
        if t>3500:ext=max(0.,1-(t-3500)/600)
        f=sample(t,ext)
        if modify:modify(f,t,ext)
        if mirror:
            for p in f['landmarks']:
                if p[0] is not None:p[0]=1-p[0]
        frames.append(f)
    return frames

def put(f,i,x,y):f['landmarks'][i]=[x/1000,y/600,0,1,1]

class BirdDogV1Tests(unittest.TestCase):
    def run_seq(self,frames):
        e=BirdDogAnalyzer();rows=[e.push_frame(f) for f in frames]
        return e,rows

    def test_full_cycle_count_and_timer_quality_independent(self):
        def bend(f,t,x):
            if x==1:put(f,28,260,80)
        for modify in [None,bend]:
            e,rows=self.run_seq(sequence(modify))
            self.assertEqual(e.count,1)
            self.assertGreater(e.hold_seconds,1)
            self.assertEqual(e.side_counts,{'left':0,'right':1})
            self.assertEqual(sum(ev['type']=='rep.completed' for r in rows for ev in r['events']),1)
            self.assertEqual(rows[-1]['items']['lumbar_neutral'],'not_supported')
            if modify:self.assertTrue(any('RIGHT_KNEE_BENT' in r['codes'] for r in rows))
            else:self.assertFalse(any(r['codes'] for r in rows))

    def test_prepare_arm_occlusion_does_not_block_extension(self):
        def hide(f,t,x):
            if x<.8:
                for i in [13,15]:f['landmarks'][i]=[None]*5
        e,rows=self.run_seq(sequence(hide))
        self.assertEqual(e.count,1)
        self.assertTrue(any(r['items']['left_elbow_bent']=='within_reference' for r in rows))

    def test_planted_wrist_occlusion_does_not_block_leg(self):
        def hide(f,t,x):f['landmarks'][16]=[None]*5
        e,rows=self.run_seq(sequence(hide))
        self.assertEqual(e.count,1)
        self.assertTrue(any(r['items']['right_knee_bent']=='within_reference' for r in rows))
        self.assertFalse(any(r['items']['right_hand_alignment']=='within_reference' for r in rows))

    def test_arms_high_low_bent_and_same_side(self):
        for kind,code in [('high','LEFT_ARM_HIGH'),('low','LEFT_ARM_LOW'),('bent','LEFT_ELBOW_BENT'),('pair','SAME_SIDE_PAIR')]:
            def change(f,t,x):
                if x!=1:return
                if kind=='high':put(f,13,700,130);put(f,15,800,60)
                if kind=='low':put(f,13,700,260);put(f,15,800,320)
                if kind=='bent':put(f,13,700,200);put(f,15,750,280)
                if kind=='pair':
                    for a,b in [(11,12),(13,14),(15,16)]:f['landmarks'][a],f['landmarks'][b]=f['landmarks'][b],f['landmarks'][a]
            e,rows=self.run_seq(sequence(change))
            self.assertEqual(e.count,1,kind)
            self.assertTrue(any(code in r['codes'] for r in rows),kind)

    def test_start_at_hold_and_gap_never_invent_reps(self):
        for frames in [sequence()[40:],sequence(lambda f,t,x:None)]:
            if frames[0]['timestampMs']==0:
                frames=[f for f in frames if not 2000<=f['timestampMs']<3000]
            e,rows=self.run_seq(frames)
            self.assertEqual(e.count,0)
        e,rows=self.run_seq(sequence(lambda f,t,x:f.update(landmarks=[]) if 2000<=t<2600 else None))
        self.assertEqual(e.count,0)
        self.assertTrue(any(ev['type']=='rep.interrupted' for r in rows for ev in r['events']))

    def test_short_joint_loss_does_not_count_unknown_time(self):
        e0,_=self.run_seq(sequence())
        e,_=self.run_seq(sequence(lambda f,t,x:f['landmarks'].__setitem__(26,[None]*5) if t==2500 else None))
        self.assertEqual(e.count,1)
        self.assertLess(e.hold_seconds,e0.hold_seconds)

    def test_mirror_and_scale_invariant(self):
        e,r=self.run_seq(sequence());em,rm=self.run_seq(sequence(mirror=True))
        self.assertEqual(e.count,em.count)
        for a,b in zip(r,rm):self.assertEqual(a['codes'],b['codes'])
        fs=sequence()
        for f in fs:f['width']*=2;f['height']*=2
        es,rs=self.run_seq(fs)
        self.assertEqual(es.count,e.count)
        for a,b in zip(r,rs):self.assertEqual(a['codes'],b['codes'])

    def test_body_stability_and_no_preparation_reference(self):
        def move(f,t,x):
            if x==1:
                dy=35*math.sin((t-1600)/200)
                for i in [11,12,23,24]:f['landmarks'][i][1]+=dy/600
        e,rows=self.run_seq(sequence(move))
        self.assertTrue(any('BODY_MOVEMENT' in r['codes'] for r in rows))
        e,rows=self.run_seq(sequence()[40:])
        self.assertFalse(any('BODY_MOVEMENT' in r['codes'] for r in rows))
        self.assertTrue(any(r['body']['reference_ready'] for r in rows))

    def test_support_offsets_and_hidden_pair(self):
        def offsets(f,t,x):
            if x==0:
                put(f,16,680,410)
                put(f,25,330,400)
        e,rows=self.run_seq(sequence(offsets))
        self.assertTrue(any('RIGHT_HAND_ALIGNMENT' in r['codes'] for r in rows))
        self.assertTrue(any('LEFT_SUPPORT_KNEE_ALIGNMENT' in r['codes'] for r in rows))
        def hide_arm(f,t,x):
            for i in [14,16]:f['landmarks'][i]=[None]*5
        e,rows=self.run_seq(sequence(hide_arm))
        self.assertFalse(any('SAME_SIDE_PAIR' in r['codes'] for r in rows))
        self.assertTrue(any(r['items']['same_side_pair']=='unknown' and r['movementPhase']=='holding' for r in rows))

    def test_summary_accounting_pause_finish(self):
        e,rows=self.run_seq(sequence())
        summary=e.summary()
        for v in summary['items'].values():
            self.assertAlmostEqual(sum(v[k] for k in ['compliant','warning','unknown','notApplicable']),summary['observedSeconds'])
        self.assertEqual(e.finish()[-1]['type'],'set.completed')
        self.assertEqual(e.finish(),[])
        with self.assertRaises(ValueError):e.push_frame(sample(6000))

if __name__=='__main__':unittest.main()
