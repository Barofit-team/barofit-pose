import unittest
from analysis.bird_dog.legacy_v05 import BirdDogAnalyzer
from test_bird_dog_v02 import sample

class BirdDogV05Tests(unittest.TestCase):
    def hold(self, knee, ankle):
        engine=BirdDogAnalyzer()
        for t in range(0,1001,50):engine.push_frame(sample(t))
        for t in range(1050,2601,50):
            f=sample(t,1)
            for i,p in [(26,knee),(28,ankle)]:
                f['landmarks'][i]=[p[0]/1000,p[1]/600,0,1,1] if p else [None]*5
            row=engine.push_frame(f)
        return row

    def test_ankle_high_with_level_thigh_is_knee_bend_only(self):
        r=self.hold((260,210),(150,100))
        self.assertEqual(r['items']['right_leg_high'],'within_reference')
        self.assertEqual(r['items']['right_knee_bent'],'warning')

    def test_high_straight_thigh_is_height_only(self):
        r=self.hold((260,130),(120,50))
        self.assertEqual(r['items']['right_leg_high'],'warning')
        self.assertEqual(r['items']['right_knee_bent'],'within_reference')

    def test_high_bent_leg_can_trigger_both(self):
        r=self.hold((260,130),(260,20))
        self.assertEqual(r['items']['right_leg_high'],'warning')
        self.assertEqual(r['items']['right_knee_bent'],'warning')

    def test_hidden_or_degenerate_ankle_keeps_knee_unknown(self):
        for ankle in [None,(260,130)]:
            r=self.hold((260,130),ankle)
            self.assertEqual(r['items']['right_leg_high'],'warning')
            self.assertEqual(r['items']['right_knee_bent'],'unknown')

    def test_support_knee_is_not_evaluated_as_extended_leg(self):
        r=self.hold((260,210),(120,210))
        self.assertEqual(r['items']['left_knee_bent'],'not_applicable')

if __name__=='__main__':unittest.main()
