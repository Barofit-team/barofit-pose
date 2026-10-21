import unittest
import numpy as np
from analysis.bird_dog.adapter import leg_alignment

class AlignmentTests(unittest.TestCase):
    def test_roll_translation_scale_invariance(self):
        pts=np.array([[300.,200.],[200.,200.],[100.,180.]])
        expected=leg_alignment(*pts)[0]
        for deg in [-25,0,25]:
            a=np.radians(deg)
            rot=np.array([[np.cos(a),-np.sin(a)],[np.sin(a),np.cos(a)]])
            moved=pts@rot.T*1.8+[50,120]
            self.assertAlmostEqual(leg_alignment(*moved)[0],expected)
    def test_mirror_and_direction(self):
        for sign in [-1,1]:
            s=np.array([300.*sign,200]);h=np.array([200.*sign,200])
            self.assertAlmostEqual(leg_alignment(s,h,[100*sign,200])[0],0)
            self.assertGreater(leg_alignment(s,h,[100*sign,150])[0],20)
            self.assertLess(leg_alignment(s,h,[100*sign,250])[0],-20)
    def test_degenerate_unknown(self):
        self.assertEqual(leg_alignment([0,0],[0,0],[100,0]),(None,None))
