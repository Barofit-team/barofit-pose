import unittest
from analysis.bird_dog.legacy_v05 import BirdDogAnalyzer
from test_bird_dog_v02 import sample

class BodyRevisionTests(unittest.TestCase):
 def test_partial_return_then_extension_recovers_holding(self):
  a=BirdDogAnalyzer()
  values=[0,.35,.6,.6,.6,.4,.5,.65,.65,.65]
  phases=[a._phase('right',p,i*.2,.2)[0] for i,p in enumerate(values)]
  self.assertEqual(phases[4],'holding')
  self.assertEqual(phases[5],'returning')
  self.assertEqual(phases[-1],'holding')
 def test_continued_return_does_not_reenter_holding(self):
  a=BirdDogAnalyzer()
  values=[0,.35,.6,.6,.6,.4,.35,.3,.2,.1]
  phases=[a._phase('right',p,i*.2,.2)[0] for i,p in enumerate(values)]
  self.assertTrue(all(p=='returning' for p in phases[5:-1]))
  self.assertEqual(phases[-1],'preparation')
 def run_hold(self,kind):
  a=BirdDogAnalyzer()
  for t in range(0,3001,50):
   extent=min(1,max(0,(t-1000)/600));f=sample(t,extent)
   if t>=1700:
    if kind=='forward':
     for i in [11,12,23,24]:f['landmarks'][i][0]+=.04
    elif kind=='drop':
     for i in [11,12,23,24]:f['landmarks'][i][1]+=.06
    elif kind=='translation':
     for p in f['landmarks']:
      if p[0] is not None:p[0]+=.04;p[1]+=.06
    elif kind=='reaching_shoulder':f['landmarks'][11][1]+=.08
    elif kind=='hidden_support_wrist':f['landmarks'][16]=[None]*5
   r=a.push_frame(f)
  return a,r
 def test_normal_transfer_and_whole_camera_translation(self):
  for mode in ['neutral','forward','translation','reaching_shoulder']:
   a,r=self.run_hold(mode)
   self.assertEqual(r['items']['body_movement'],'within_reference',mode)
 def test_perpendicular_drop_still_warns(self):
  a,r=self.run_hold('drop')
  self.assertEqual(r['items']['body_movement'],'warning')
  self.assertEqual(r['body']['anchor'],16)
 def test_missing_support_is_unknown(self):
  a,r=self.run_hold('hidden_support_wrist')
  self.assertEqual(r['items']['body_movement'],'unknown')
 def test_pause_clears_hold_feedback(self):
  a,r=self.run_hold('drop');a.break_continuity();r=a.push_frame(sample(3050,1))
  self.assertEqual(r['items']['body_movement'],'unknown')
  self.assertNotIn('BODY_MOVEMENT',r['codes'])
