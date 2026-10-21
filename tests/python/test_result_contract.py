import unittest
import json
from analysis.common.result import item_result, set_summary, set_completed
from analysis.plank.adapter import PlankAnalyzer
from analysis.bird_dog import BirdDogAnalyzer


class ResultContractTests(unittest.TestCase):
    def test_units_and_denominators(self):
        for basis in ['time','repetition']:
            self.assertEqual(item_result(basis,3,1,9,8)['compliancePct'],75)
            self.assertIsNone(item_result(basis,0,0,10)['compliancePct'])
            self.assertEqual(item_result(basis,0,1)['compliancePct'],0)
            self.assertEqual(item_result(basis,1,0)['compliancePct'],100)
        with self.assertRaises(ValueError):item_result('repetition',.1,0)
        with self.assertRaises(ValueError):item_result('time',float('nan'),0)

    def test_empty_results_share_keys_and_finish_once(self):
        pushup=set_summary(exercise='pushup',engineVersion='batch',count=0,
            items={'hip':item_result('repetition',0,0)})
        for e in [PlankAnalyzer(),BirdDogAnalyzer()]:
            self.assertEqual(set(e.summary()),set(pushup))
            event=e.finish()[-1]
            self.assertEqual(set(event),set(set_completed(pushup)))
            self.assertEqual(event['summary'],e.summary())
            self.assertIsNone(event['timestampMs'])
            self.assertEqual(e.finish(),[])
            self.assertEqual(json.loads(json.dumps(event,allow_nan=False)),event)

    def test_plank_unknown_time_and_pause(self):
        e=PlankAnalyzer()
        for t in [0,100,200]:e.push_frame(dict(timestampMs=t,width=1000,height=1000,landmarks=[]))
        s=e.summary()
        for v in s['items'].values():
            self.assertAlmostEqual(v['unknown'],.2)
            self.assertEqual(v['evaluated'],0)
            self.assertIsNone(v['compliancePct'])
        e.break_continuity()
        e.push_frame(dict(timestampMs=10000,width=1000,height=1000,landmarks=[]))
        self.assertAlmostEqual(e.summary()['observedSeconds'],.2)
        self.assertEqual(e.finish()[-1]['timestampMs'],10000)

if __name__=='__main__':unittest.main()
