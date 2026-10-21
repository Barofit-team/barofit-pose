import unittest
from analysis.plank.adapter import PlankAnalyzer
from analysis.plank.hold import HoldTimer

def frame(t,kind='normal'):
    p=[[0.,0.,0.,0.,0.] for _ in range(33)]
    for ids,c in [([11,13,15,23,25,27],.9),([12,14,16,24,26,28],.8)]:
        xy=[[.2,.3],[.2,.5],[.1,.5],[.5,.3],[.7,.3],[.9,.3]]
        if kind=='drop':xy[3][1]=.38
        if kind=='high':xy[3][1]=.18
        if kind=='knee':xy[4][1]=.42
        if kind=='standing':xy=[[.5,.2],[.5,.35],[.5,.5],[.5,.5],[.5,.7],[.5,.9]]
        for i,point in zip(ids,xy):p[i]=point+[0.,c,c]
    return dict(timestampMs=t*1000,width=1000,height=1000,landmarks=p)

class PlankHoldTests(unittest.TestCase):
    def test_quality_gates_valid_time(self):
        for kind in ['normal','drop','high','knee']:
            e=PlankAnalyzer()
            for i in range(21):e.push_frame(frame(i/10,kind))
            self.assertLess(e.summary()['holdSeconds'],2)
            before=e.summary()['holdSeconds']
            for i in range(21,31):e.push_frame(frame(i/10,kind))
            if kind=='normal':self.assertGreater(e.summary()['holdSeconds'],before)
            else:self.assertEqual(e.summary()['holdSeconds'],before)
            if kind!='normal':self.assertTrue(any(v['warning']>0 for v in e.summary()['items'].values()))

    def test_standing_loss_pause_and_gap_do_not_count(self):
        e=PlankAnalyzer()
        for i in range(20):e.push_frame(frame(i/10,'standing'))
        self.assertEqual(e.summary()['holdSeconds'],0)
        for i in range(11):e.push_frame(frame(2+i/10))
        before=e.summary()['holdSeconds'];self.assertGreater(before,0)
        f=frame(3.1);f['landmarks']=[];e.push_frame(f)
        self.assertEqual(e.summary()['holdSeconds'],before)
        e.push_frame(frame(10));self.assertEqual(e.summary()['holdSeconds'],before)
        for i in range(1,11):e.push_frame(frame(10+i/10))
        after=e.summary()['holdSeconds'];self.assertGreater(after,before)
        e.break_continuity();e.push_frame(frame(20))
        self.assertEqual(e.finish()[-1]['summary']['holdSeconds'],after)

    def test_side_change_does_not_join_intervals_or_reset_total(self):
        timer=HoldTimer()
        for i in range(11):timer.step(frame(i/10),'left')
        self.assertAlmostEqual(timer.seconds,1)
        timer.step(frame(1.1),'right');self.assertAlmostEqual(timer.seconds,1)
        for i in range(1,5):timer.step(frame(1.1+i/10),'right')
        self.assertAlmostEqual(timer.seconds,1.4)

if __name__=='__main__':unittest.main()
