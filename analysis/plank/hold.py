"""Observation timer independent of hip/shoulder/knee correctness; matches JS hold.js."""
import math

HOLD_CONFIG=dict(minQuality=.5,minHorizontal=.65,minShoulderClearance=.035,
    minBodyToUpperArm=2,maxForearmVertical=.65,confirmationSeconds=.3,maxGapSeconds=.25)

def inspect_hold(frame,side):
    ids={'left':[11,13,15,23,27],'right':[12,14,16,24,28]}.get(side)
    invalid=dict(state='unobservable',side=side,reasons=['required_joints_unavailable'],geometry=None)
    if not ids or len(frame['landmarks'])!=33:return invalid
    pts=[frame['landmarks'][i] for i in ids]
    if not all(all(isinstance(p[j],(int,float)) and math.isfinite(p[j]) for j in [0,1,3,4])
               and min(p[3:5])>=HOLD_CONFIG['minQuality'] and 0<=p[0]<=1 and 0<=p[1]<=1 for p in pts):return invalid
    s,e,w,h,a=[[p[0]*frame['width'],p[1]*frame['height']] for p in pts]
    sub=lambda a,b:[a[0]-b[0],a[1]-b[1]]
    body=sub(a,s);length=math.hypot(*body);upper=math.dist(e,s);fore=math.dist(w,e)
    if min(length,upper,fore)<1e-6:return invalid
    g=dict(horizontal=abs(body[0])/length,shoulderClearance=(e[1]-s[1])/length,
        bodyToUpperArm=length/upper,forearmVertical=abs(w[1]-e[1])/fore,
        hipProjection=((h[0]-s[0])*body[0]+(h[1]-s[1])*body[1])/(length*length))
    reasons=[]
    if g['horizontal']<HOLD_CONFIG['minHorizontal']:reasons.append('body_not_horizontal')
    if g['shoulderClearance']<HOLD_CONFIG['minShoulderClearance']:reasons.append('upper_body_not_supported')
    if g['bodyToUpperArm']<HOLD_CONFIG['minBodyToUpperArm']:reasons.append('body_not_extended')
    if g['forearmVertical']>HOLD_CONFIG['maxForearmVertical']:reasons.append('forearm_not_horizontal')
    if not 0<g['hipProjection']<1:reasons.append('body_order_unavailable')
    return dict(state='not_plank' if reasons else 'candidate',side=side,reasons=reasons,geometry=g)

class HoldTimer:
    def __init__(self):
        self.seconds=0.
        self.reset()

    def reset(self):
        self.previous=None;self.pending_seconds=0.;self.confirmed=False

    def step(self,frame,side):
        observation=inspect_hold(frame,side);t=frame['timestampMs']/1000
        if observation['state']!='candidate':
            self.reset();return observation
        dt=t-self.previous['t'] if self.previous else 0
        if not self.previous or self.previous['side']!=side or dt<=0 or dt>HOLD_CONFIG['maxGapSeconds']:
            self.pending_seconds=0.;self.confirmed=False
        elif self.confirmed:self.seconds+=dt
        else:
            self.pending_seconds+=dt
            if self.pending_seconds+1e-9>=HOLD_CONFIG['confirmationSeconds']:
                self.seconds+=self.pending_seconds;self.pending_seconds=0.;self.confirmed=True
        self.previous=dict(t=t,side=side)
        return dict(observation,state='holding' if self.confirmed else 'candidate')
