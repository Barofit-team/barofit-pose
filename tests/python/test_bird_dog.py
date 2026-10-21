import unittest
from analysis.bird_dog.legacy_v01 import BirdDogAnalyzer, BirdDogConfig


def frame(t, reach=False, same_side=False, bad_hand=False):
    p = [[None]*5 for _ in range(33)]
    def put(i,x,y):
        p[i] = [x/1000,y/600,0.,1.,1.]
    # Facing right; shoulders, hips, supporting joints.
    for s,e,w,h,k,a,dy in [(11,13,15,23,25,27,0),(12,14,16,24,26,28,10)]:
        for i,x,y in [(s,600,200+dy),(e,600,300+dy),(w,600,400+dy),
                      (h,400,200+dy),(k,400,400+dy),(a,250,400+dy)]:
            put(i,x,y)
    if bad_hand:
        put(15,680,400)
    if reach:
        put(13,700,200);put(15,800,200)
        k,a = (25,27) if same_side else (26,28)
        put(k,300,200);put(a,200,200)
    return dict(timestampMs=t,width=1000,height=600,landmarks=p)


class BirdDogTests(unittest.TestCase):
    def test_neutral_setup_no_warning(self):
        a=BirdDogAnalyzer()
        for t in range(0,1001,100):
            r=a.push_frame(frame(t))
        self.assertEqual(r["codes"],[])
        self.assertIsNone(r["count"])
        self.assertEqual(r["items"]["lumbar_neutral"],"not_supported")

    def test_contralateral_and_ipsilateral(self):
        for same in (False,True):
            a=BirdDogAnalyzer()
            for t in range(0,1001,100):
                r=a.push_frame(frame(t,True,same))
            self.assertEqual("SAME_SIDE_PAIR" in r["codes"],same)

    def test_persistence_gap_and_loss(self):
        a=BirdDogAnalyzer()
        r=a.push_frame(frame(0,bad_hand=True))
        self.assertNotIn("LEFT_HAND_ALIGNMENT",r["codes"])
        for t in (100,200,300,500):
            r=a.push_frame(frame(t,bad_hand=True))
        self.assertIn("LEFT_HAND_ALIGNMENT",r["codes"])
        r=a.push_frame(frame(1500,bad_hand=True))
        self.assertNotIn("LEFT_HAND_ALIGNMENT",r["codes"])
        f=frame(1600);f["landmarks"]=[]
        r=a.push_frame(f)
        self.assertEqual(r["codes"],[])
        self.assertEqual(r["items"]["left_hand_alignment"],"unknown")

    def test_missing_far_side_pair_unknown(self):
        a=BirdDogAnalyzer()
        f=frame(0,True)
        for i in [12,14,16,24,26,28]:f["landmarks"][i]=[None]*5
        r=a.push_frame(f)
        self.assertEqual(r["items"]["same_side_pair"],"unknown")

    def test_time_order(self):
        a=BirdDogAnalyzer();a.push_frame(frame(100))
        with self.assertRaises(ValueError):a.push_frame(frame(100))

    def test_pixel_geometry_independent_of_resolution(self):
        f=frame(0,True)
        first=BirdDogAnalyzer().push_frame(f)
        f["width"]=500;f["height"]=300
        second=BirdDogAnalyzer().push_frame(f)
        self.assertAlmostEqual(first["metrics"]["left"]["elbow_deg"],
                               second["metrics"]["left"]["elbow_deg"])
        self.assertAlmostEqual(first["metrics"]["right"]["leg_elevation_deg"],
                               second["metrics"]["right"]["leg_elevation_deg"])


if __name__=="__main__":
    unittest.main()
