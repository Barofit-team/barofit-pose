import unittest
from analysis.bird_dog.legacy_v05 import BirdDogAnalyzer
from test_bird_dog import frame


def sample(t, extension=0., high=False, body_shift=0.):
    f=frame(t)
    p=f["landmarks"]
    # Left arm and right leg extend, right arm and left knee stay planted.
    for i,end in [(13,(700,200)),(15,(800,200)),
                  # Straight raised thigh versus straight level leg.
                  (26,(260,130 if high else 210)),(28,(120,50 if high else 210))]:
        x,y=p[i][0]*1000,p[i][1]*600
        p[i][0]=(x+(end[0]-x)*extension)/1000
        p[i][1]=(y+(end[1]-y)*extension)/600
    for i in [11,12,23,24]:
        p[i][0]+=body_shift/1000
    return f


class BirdDogV02Tests(unittest.TestCase):
    def test_neutral_and_disabled_knee(self):
        a=BirdDogAnalyzer()
        for t in range(0,1001,50):
            r=a.push_frame(sample(t))
        self.assertEqual(r["codes"],[])
        self.assertTrue(r["body"]["reference_ready"])
        self.assertEqual(r["items"]["right_knee_extension"],"disabled")

    def test_phase_cycle_and_high_leg(self):
        a=BirdDogAnalyzer();seen=set()
        for t in range(0,1001,50):
            a.push_frame(sample(t))
        for t in range(1050,3501,50):
            ext=min(1.,(t-1000)/600)
            if t>2500:ext=max(0.,1-(t-2500)/600)
            r=a.push_frame(sample(t,ext,True))
            phase=r["metrics"]["right"]["phase"];seen.add(phase)
            if r["items"]["right_leg_high"]=="warning":
                self.assertEqual(phase,"holding")
            if t==2450:self.assertEqual(r["items"]["right_leg_high"],"warning")
        self.assertTrue({"reaching","holding","returning","preparation"}.issubset(seen))

    def test_body_shift_and_whole_frame_translation(self):
        for shift_all in (False,True):
            a=BirdDogAnalyzer()
            for t in range(0,1001,50):a.push_frame(sample(t))
            for t in range(1050,2001,50):
                f=sample(t,body_shift=40)
                if shift_all:
                    for i,p in enumerate(f["landmarks"]):
                        if p[0] is not None and i not in [11,12,23,24]:p[0]+=.04
                r=a.push_frame(f)
            self.assertEqual(r["items"]["body_movement"],"not_applicable")

    def test_visible_side_can_calibrate_with_hidden_far_knee(self):
        a=BirdDogAnalyzer()
        for t in range(0,1001,50):
            f=sample(t);f["landmarks"][25]=[None]*5
            r=a.push_frame(f)
        self.assertTrue(r["body"]["reference_ready"])

    def test_gap_and_missing_data_do_not_mean_normal(self):
        a=BirdDogAnalyzer()
        for t in range(0,1001,50):a.push_frame(sample(t))
        r=a.push_frame(sample(2000))
        self.assertFalse(r["body"]["reference_ready"])
        self.assertEqual(r["items"]["body_movement"],"unknown")
        f=sample(2050);f["landmarks"]=[]
        r=a.push_frame(f)
        self.assertEqual(r["codes"],[])
        self.assertEqual(r["phase"],"not_ready")


if __name__=="__main__":unittest.main()
