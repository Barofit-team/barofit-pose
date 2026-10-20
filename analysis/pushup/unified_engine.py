import json,hashlib
import numpy as np
import pandas as pd
CFG=dict(target_fps=15,max_width=960,visibility_min=.5,presence_min=.5,ema_tau_s=.08,missing_reset_s=.4,feedback_hold_s=.25,release_ratio=.6)
COMMON_CFG=dict(coverage=.8,bottom_window_s=.15)
MULTI_CFG=dict(result_hold_s=2.5)
V3_CFG=dict(exit_knee_deg=120.,exit_hold_s=.25,exit_resume_knee_deg=150.,exit_resume_horizontal=.5)
ITEMS=['hip','elbow','chest','hand']
ITEM_NAMES={'hip':'골반 정렬','elbow':'팔꿈치 굽힘','chest':'가슴 이동 대리값','hand':'손 위치 대리값'}
JOINTS={'left':{'S':11,'E':13,'W':15,'H':23,'A':27},'right':{'S':12,'E':14,'W':16,'H':24,'A':28}}

def feature(p, dims, side):
    w,h=dims; ids=JOINTS[side]; xy={k:p[j,:2]*[w,h] for k,j in ids.items()}
    good={k:bool(np.isfinite(p[j]).all() and p[j,3]>=CFG['visibility_min'] and
                  p[j,4]>=CFG['presence_min'] and np.all((p[j,:2]>=0)&(p[j,:2]<=1))) for k,j in ids.items()}
    out=dict(elbow_deg=np.nan,ratio=np.nan,hip_signed=np.nan,quality=0.)
    conf=p[list(ids.values()),3:5]; out['quality']=float(np.nan_to_num(conf,nan=0).mean())
    if all(good[k] for k in ['S','E','W']):
        u=xy['S']-xy['E']; v=xy['W']-xy['E']; denom=np.linalg.norm(u)*np.linalg.norm(v)
        if denom>9: out['elbow_deg']=float(np.degrees(np.arccos(np.clip(np.dot(u,v)/denom,-1,1))))
    if all(good[k] for k in ['S','W','H']):
        length=np.linalg.norm(xy['S']-xy['H'])
        if length>.02*max(w,h): out['ratio']=float(np.linalg.norm(xy['S']-xy['W'])/length)
    if all(good[k] for k in ['S','H','A']):
        line=xy['A']-xy['S']; hip=xy['H']-xy['S']; length=np.linalg.norm(line)
        if length>.15*max(w,h) and abs(line[0])/length>.25:
            out['hip_signed']=float(100*(line[0]*hip[1]-line[1]*hip[0])*np.sign(line[0])/length**2)
    return out

def smooth(values,times):
    previous=np.nan; last=None; result=[]
    for value,t in zip(values,times):
        if not np.isfinite(value): previous=np.nan
        elif not np.isfinite(previous) or last is None or t-last>CFG['missing_reset_s']: previous=value
        else:
            a=1-np.exp(-(t-last)/CFG['ema_tau_s']); previous=a*value+(1-a)*previous
        result.append(previous); last=t
    return result
BASE_FEATURE=feature
def feature(p,dims,side):
    out=BASE_FEATURE(p,dims,side)
    out.update(torso_scale=np.nan,chest_height_raw=np.nan,hand_along=np.nan)
    ids=JOINTS[side]; w,h=dims
    def point(name):
        q=p[ids[name]]
        if not (np.isfinite(q).all() and q[3]>=CFG['visibility_min'] and q[4]>=CFG['presence_min']
                and np.all((q[:2]>=0)&(q[:2]<=1))): return None
        return q[:2]*[w,h]
    s,hip,wrist=point('S'),point('H'),point('W')
    if s is not None and hip is not None:
        axis=hip-s; length=np.linalg.norm(axis)
        if length>.08*max(w,h):
            out['torso_scale']=length/max(w,h)
            if wrist is not None and abs(axis[0])/length>.25:
                # Positive = from shoulder towards hip. This is not the anatomical chest center.
                out['hand_along']=float(np.dot(wrist-s,axis)/length**2)
    if s is not None and wrist is not None:
        # Screen vertical displacement relative to the planted wrist; fixed reference scale is used later.
        out['chest_height_raw']=float((wrist[1]-s[1])/max(w,h))
    return out

def make_features(arrays,side):
    df=pd.DataFrame([feature(p,d,side) for p,d in zip(arrays['poses'],arrays['dims'])])
    df['time_s']=arrays['times']; df['frame_index']=arrays['indices']
    for key in ['elbow_deg','ratio','hip_signed','chest_height_raw','hand_along']:
        df[key+'_smooth']=smooth(df[key],df.time_s)
    return df

def item_summary(reps):
    rows=[]
    for item in ITEMS:
        status=reps[item+'_status']; evaluated=status.isin(['within_reference','warning'])
        eligible=~reps.uses_calibration.astype(bool)
        n=int(evaluated.sum());warn=int(status.eq('warning').sum())
        rows.append(dict(item=item,item_name=ITEM_NAMES[item],completed_reps=len(reps),
                         calibration_reps=int(reps.uses_calibration.sum()),evaluable_reps=n,warning_reps=warn,
                         unknown_reps=int((eligible&~evaluated).sum()),warning_pct=100*warn/n if n else np.nan))
    return pd.DataFrame(rows)
V2_FEATURE=feature
def feature(p, dims, side):
    out = V2_FEATURE(p, dims, side)
    ids = {**JOINTS[side], 'K':25 if side=='left' else 26}
    points = {}
    for name, j in ids.items():
        q = p[j]
        if (np.isfinite(q).all() and q[3]>=CFG['visibility_min'] and
            q[4]>=CFG['presence_min'] and np.all((q[:2]>=0)&(q[:2]<=1))):
            points[name] = q[:2]*dims/max(dims)
    for name in ['S','H','W']:
        for axis, k in enumerate(['x','y']):
            out[name+'_'+k] = points[name][axis] if name in points else np.nan
    out['knee_deg'] = np.nan
    out['body_horizontal'] = np.nan
    if all(k in points for k in ['S','A']):
        axis=points['A']-points['S'];length=np.linalg.norm(axis)
        if length>.15:out['body_horizontal']=abs(axis[0])/length
    if all(k in points for k in ['H','K','A']):
        u, v = points['H']-points['K'], points['A']-points['K']
        denom = np.linalg.norm(u)*np.linalg.norm(v)
        if denom>1e-5:
            out['knee_deg'] = float(np.degrees(np.arccos(np.clip(np.dot(u,v)/denom,-1,1))))
    return out

def exit_candidates(knee, times, horizontal):
    # Standard toes-supported push-ups only. Deep, sustained knee folding is a candidate,
    # not an anatomical error or a ground-truth end label. Missing knees never imply exit.
    since = last = resume_since = None
    active=False
    result = []
    for x,t,axis in zip(knee,times,horizontal):
        if last is not None and t-last>CFG['missing_reset_s']: since=None;resume_since=None
        if np.isfinite(x) and x<V3_CFG['exit_knee_deg']:
            if since is None: since=t
            if t-since+1e-9>=V3_CFG['exit_hold_s']:active=True
        else: since=None
        ready=np.isfinite(x) and x>=V3_CFG['exit_resume_knee_deg'] and np.isfinite(axis) and axis>=V3_CFG['exit_resume_horizontal']
        if active and ready:
            if resume_since is None:resume_since=t
            if t-resume_since+1e-9>=V3_CFG['exit_hold_s']:active=False;resume_since=None
        else:resume_since=None
        result.append(active)
        last=t
    return np.array(result,bool)
def common_features(arrays,side):
    g=make_features(arrays,side)
    body=[];hand=[];height=[]
    for p,dims in zip(arrays['poses'],arrays['dims']):
        pts={}
        for k in ['S','W','A']:
            q=p[JOINTS[side][k]]
            if np.isfinite(q).all() and q[3]>=CFG['visibility_min'] and q[4]>=CFG['presence_min'] and np.all((q[:2]>=0)&(q[:2]<=1)):
                pts[k]=q[:2]*dims/max(dims)
        length=np.nan;along=vertical=np.nan
        if 'S' in pts and 'A' in pts:
            axis=pts['A']-pts['S'];length=np.linalg.norm(axis)
            if length>.15 and abs(axis[0])/length>.5 and 'W' in pts:
                along=np.dot(pts['W']-pts['S'],axis)/length**2
                vertical=pts['W'][1]-pts['S'][1]
        body.append(length);hand.append(along);height.append(vertical)
    g['body_length']=body
    # Pure size normalization, not a normal-pose baseline. Each selected/evaluated interval
    # supplies its own median body length. No test normal movement amplitude is used.
    g['chest_vertical']=smooth(height,g.time_s)
    g['hand_body']=smooth(hand,g.time_s)
    return g

def interval_metrics(g,start,bottom,end):
    p=g.loc[g.time_s.between(start,end)]
    w=p.loc[(p.time_s-bottom).abs()<=COMMON_CFG['bottom_window_s']]
    def sufficient(s,n):return s.notna().sum()>=3 and s.notna().mean()>=COMMON_CFG['coverage'] if n else False
    scale=float(p.body_length.median()) if len(p) else np.nan
    hip=p.hip_signed_smooth;elbow=w.elbow_deg_smooth;hand=w.hand_body;chest=p.chest_vertical
    vals=dict(body_scale=scale,hip_low=np.nan,hip_high=np.nan,elbow_bottom=np.nan,chest_range=np.nan,hand_bottom=np.nan)
    coverage=dict(hip=float(hip.notna().mean()) if len(p) else 0.,
                  elbow=float(elbow.notna().mean()) if len(w) else 0.,
                  chest=float(chest.notna().mean()) if len(p) else 0.,
                  hand=float(hand.notna().mean()) if len(w) else 0.)
    if sufficient(hip,len(p)):vals.update(hip_low=float(hip.quantile(.05)),hip_high=float(hip.quantile(.95)))
    if sufficient(elbow,len(w)):vals['elbow_bottom']=float(elbow.median())
    if sufficient(hand,len(w)):vals['hand_bottom']=float(hand.median())
    if sufficient(chest,len(p)) and np.isfinite(scale) and scale>.15:
        vals['chest_range']=float((chest.quantile(.95)-chest.quantile(.05))/scale)
    return vals,coverage

def weighted_quantile(values,weights,q):
    values=np.asarray(values,float);weights=np.asarray(weights,float)
    # Combine identical values so splitting one observation's weight cannot move a boundary.
    unique,inverse=np.unique(values,return_inverse=True)
    combined=np.zeros(len(unique));np.add.at(combined,inverse,weights)
    values,weights=unique,combined
    return float(np.interp(q,(np.cumsum(weights)-.5*weights)/weights.sum(),values))

def shared_hip_states(g,limits):
    states=[];direction=0;since=None;active=False;last=None
    low,high=limits['hip_low'],limits['hip_high'];center=(low+high)/2
    for r in g.itertuples():
        if last is not None and r.time_s-last>CFG['missing_reset_s']:direction=0;since=None;active=False
        if r.calibration:status='calibration'
        elif r.exit_candidate:status='exit_candidate'
        elif not np.isfinite(r.hip_signed_smooth):status='tracking_unavailable'
        else:
            x=r.hip_signed_smooth;sign=1 if x>high else -1 if x<low else 0
            if sign:
                if sign!=direction:direction=sign;since=r.time_s;active=False
                if since is None:since=r.time_s
                if r.time_s-since+1e-9>=CFG['feedback_hold_s']:active=True
            elif center+(low-center)*CFG['release_ratio']<=x<=center+(high-center)*CFG['release_ratio']:
                direction=0;since=None;active=False
            elif not active:since=None
            status=('hip_drop' if direction==1 else 'hip_raise') if active else 'candidate' if since is not None else 'within_reference'
        if status in ['calibration','exit_candidate','tracking_unavailable']:direction=0;since=None;active=False
        states.append(status);last=r.time_s
    return states

def apply_pool(features,personal_frames,personal_reps,pool):
    # The baseline count and intervals are unchanged; only posture decisions differ.
    g=personal_frames.copy();reps=personal_reps.copy();limits=pool['limits']
    for key in ['hand_body','body_length','chest_vertical']:g[key]=features[key].to_numpy()
    g['hip_status']=shared_hip_states(g,limits)
    reps['hand_suppression_reason']=''
    for key in ['body_scale','hip_low','hip_high','elbow_bottom','chest_range','hand_bottom']:reps['common_'+key]=np.nan
    for i,r in reps.iterrows():
        p=g.loc[g.time_s.between(r.start_s,r.end_s)]
        w=p.loc[(p.time_s-r.bottom_s).abs()<=COMMON_CFG['bottom_window_s']]
        values,cov=interval_metrics(g,r.start_s,r.bottom_s,r.end_s)
        for key,value in values.items():reps.at[i,'common_'+key]=value
        for item in ITEMS:reps.at[i,item+'_status']='tracking_unavailable'
        available=p.hip_status.isin(['within_reference','candidate','hip_drop','hip_raise'])
        drop=p.hip_status.eq('hip_drop').any();rise=p.hip_status.eq('hip_raise').any()
        reps.at[i,'hip_drop_observed']=bool(drop);reps.at[i,'hip_raise_observed']=bool(rise)
        if drop or rise:reps.at[i,'hip_status']='warning'
        elif available.mean()>=COMMON_CFG['coverage']:reps.at[i,'hip_status']='within_reference'
        if np.isfinite(values['elbow_bottom']):reps.at[i,'elbow_status']='warning' if values['elbow_bottom']>limits['elbow_max'] else 'within_reference'
        if np.isfinite(values['chest_range']):reps.at[i,'chest_status']='warning' if values['chest_range']<limits['chest_min'] else 'within_reference'
        if np.isfinite(values['hand_bottom']):
            if w.hip_signed_smooth.notna().mean()<COMMON_CFG['coverage']:
                reps.at[i,'hand_status']='body_unavailable'
            elif ((w.hip_signed_smooth<limits['hip_low'])|(w.hip_signed_smooth>limits['hip_high'])).any():
                reps.at[i,'hand_status']='body_deviation';reps.at[i,'hand_suppression_reason']='공통 골반 범위를 벗어나 손 판정 보류'
            else:reps.at[i,'hand_status']='within_reference' if limits['hand_low']<=values['hand_bottom']<=limits['hand_high'] else 'warning'
        if r.exit_candidate:
            for item in ITEMS:reps.at[i,item+'_status']='exit_candidate'
        if r.uses_calibration:
            for item in ITEMS:reps.at[i,item+'_status']='calibration'
    g['last_rep']=0;g['rep_feedback_codes']='';g['rep_feedback_text']=''
    for item in ['elbow','chest','hand']:g[item+'_status']='pending_rep'
    for r in reps.itertuples():
        mask=g.time_s.between(r.end_s,r.end_s+MULTI_CFG['result_hold_s'])
        g.loc[mask,'last_rep']=r.rep;codes=[]
        for item in ['elbow','chest','hand']:g.loc[mask,item+'_status']=getattr(r,item+'_status')
        if r.elbow_status=='warning':codes.append('ELBOW_SHALLOW')
        if r.chest_status=='warning':codes.append('CHEST_RANGE_LOW')
        if r.hand_status=='warning':codes.append('HAND_TOWARD_HEAD' if r.common_hand_bottom<limits['hand_low'] else 'HAND_TOWARD_HIP')
        g.loc[mask,'rep_feedback_codes']='|'.join(codes)
    g.loc[g.exit_candidate,'rep_feedback_codes']=''
    for item in ['elbow','chest','hand']:g.loc[g.exit_candidate&~g.calibration,item+'_status']='exit_candidate'
    g['feedback_status']=g.hip_status
    g['feedback_codes']=['|'.join(filter(None,[{'hip_drop':'HIP_DROP','hip_raise':'HIP_RAISE'}.get(h,''),c])) for h,c in zip(g.hip_status,g.rep_feedback_codes)]
    return g,reps
# Shared counter and inference. No normal clip or test-person calibration argument.
COUNT_CFG = dict(top_fraction=.75, down_fraction=.60, min_amplitude_fraction=.25,
                 min_amplitude_floor=8., dwell_s=.08, min_rep_s=.65,
                 max_rep_s=20., missing_reset_s=.4)

def build_counter_model(posture_pool, training_loader):
    """Read ONLY the already selected training repetitions; never evaluation clips."""
    rows=[]
    for selection in posture_pool['selections']:
        if not selection['include']: continue
        arrays,info=training_loader(selection)
        if info['source_sha256']!=selection['source_sha256']:
            raise ValueError('기준 원본 해시 불일치: '+selection['relative_path'])
        g=common_features(arrays,selection['side'])
        p=g.loc[g.time_s.between(selection['start_s'],selection['end_s'])]
        vals=p.elbow_deg_smooth.dropna()
        w=p.loc[(p.time_s-selection['bottom_s']).abs()<=COMMON_CFG['bottom_window_s'],'elbow_deg_smooth'].dropna()
        if len(vals)<6 or len(vals)/max(1,len(p))<.8 or len(w)<3:
            raise ValueError('선정 반복의 카운트 좌표 부족: '+selection['selection_id'])
        top=float(vals.quantile(.9));bottom=float(w.median())
        if top-bottom<20:
            raise ValueError('선정 반복의 상하 움직임 부족: '+selection['selection_id'])
        rows.append(dict(selection_id=selection['selection_id'],subject_id=selection['subject_id'],
                         top_deg=top,bottom_deg=bottom,source_sha256=info['source_sha256']))
    table=pd.DataFrame(rows)
    sizes=table.subject_id.value_counts() if len(table) else pd.Series(dtype=int)
    if len(sizes)<3 or (sizes<2).any():raise ValueError('기준용 사람 최소 3명, 각 2회가 필요합니다.')
    weights=np.array([1/sizes[s] for s in table.subject_id])
    high=weighted_quantile(table.top_deg,weights,.5)
    low=weighted_quantile(table.bottom_deg,weights,.5)
    span=high-low
    if span<20:raise ValueError('공통 카운트의 상하 범위를 구성하지 못했습니다.')
    count=dict(COUNT_CFG,signal='elbow_deg_smooth',reference_top_deg=high,reference_bottom_deg=low,
               top_enter_deg=low+COUNT_CFG['top_fraction']*span,
               down_enter_deg=low+COUNT_CFG['down_fraction']*span,
               min_amplitude_deg=max(COUNT_CFG['min_amplitude_floor'],COUNT_CFG['min_amplitude_fraction']*span))
    result=json.loads(json.dumps(posture_pool))
    result.update(version='pushup-common-2.0',counter=count,counter_training=rows,
                  pipeline_config=dict(cfg=CFG.copy(),common=COMMON_CFG.copy(),multi=MULTI_CFG.copy(),v3=V3_CFG.copy()),
                  inference_contract='Single side-view clip. No personal normal clip, label or calibration interval.',
                  counter_note='Weighted median training upper/lower positions; movement gates are separate from form compliance. All gates are frozen.')
    result['model_id']=hashlib.sha256(json.dumps(result,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
    return result,table

def validate_model(model):
    if model.get('version')!='pushup-common-2.0' or 'counter' not in model:
        raise ValueError('카운트까지 포함한 v2 모델이 필요합니다. 4번에서 한 번 생성하세요.')
    content={k:v for k,v in model.items() if k!='model_id'}
    digest=hashlib.sha256(json.dumps(content,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
    if digest!=model.get('model_id'):raise ValueError('모델 파일 내용/해시가 일치하지 않습니다.')
    c=model['counter']
    if not (0<c['down_enter_deg']<c['top_enter_deg']<=180 and c['min_amplitude_deg']>0):
        raise ValueError('공통 카운트 경계가 잘못되었습니다.')

def activate_model(model):
    validate_model(model)
    for current,key in [(CFG,'cfg'),(COMMON_CFG,'common'),(MULTI_CFG,'multi'),(V3_CFG,'v3')]:
        current.clear();current.update(model['pipeline_config'][key])

def common_cycles(values,times,exit_mask,c):
    """TOP -> descent with common depth+amplitude -> TOP. Missing/exit resets cycle."""
    state='waiting_top';n=0;last=None;since=None;start=bottom=None;peak=trough=np.nan
    counts=[];events=[];phases=[];intervals=[]
    for i,(x,t,stop) in enumerate(zip(values,times,exit_mask)):
        event=0
        gap=last is not None and t-last>c['missing_reset_s']
        timed_out=start is not None and t-times[start]>c['max_rep_s']
        if stop or gap or timed_out:
            state='waiting_top';since=None;start=bottom=None;peak=trough=np.nan
        if stop:
            phase='exit_candidate';last=None
        elif not np.isfinite(x):
            phase='tracking_unavailable';since=None
        else:
            last=t
            if state=='waiting_top':
                if x>=c['top_enter_deg']:
                    if since is None:since=t
                    if t-since+1e-9>=c['dwell_s']:
                        state='top';start=i;peak=x;since=None
                else:since=None
            elif state=='top':
                peak=max(peak,x)
                if peak-x>=c['min_amplitude_deg'] and x<=c['down_enter_deg']:
                    if since is None:since=t;bottom=i;trough=x
                    if x<trough:trough=x;bottom=i
                    if t-since+1e-9>=c['dwell_s']:state='down';since=None
                else:
                    since=None
                    if x>=peak-c['min_amplitude_deg']*.15:start=i
            elif state=='down':
                if x<trough:trough=x;bottom=i
                if x>=c['top_enter_deg']:
                    if since is None:since=t
                    if t-since+1e-9>=c['dwell_s'] and t-times[start]>=c['min_rep_s']:
                        n+=1;event=n;intervals.append((n,start,bottom,i))
                        state='top';start=i;peak=x;since=None
                else:since=None
            phase=state
        counts.append(n);events.append(event);phases.append(phase)
    return counts,events,phases,intervals

def predict_common(arrays,model,side='auto'):
    activate_model(model)
    times=np.asarray(arrays['times'],float)
    if len(times)==0 or not np.isfinite(times).all() or np.any(np.diff(times)<=0):
        raise ValueError('프레임 시각은 유한하고 증가해야 합니다.')
    # Auto selects the visible anatomical side by tracking quality only. It fits no pose thresholds.
    if side=='auto':
        candidates={s:common_features(arrays,s) for s in ['left','right']}
        scores={s:float(g.elbow_deg.notna().mean()+g.hip_signed.notna().mean()+g.quality.mean()) for s,g in candidates.items()}
        side=max(scores,key=scores.get);g=candidates[side]
    elif side in ['left','right']:g=common_features(arrays,side)
    else:raise ValueError('side는 auto/left/right 중 하나입니다.')
    g['calibration']=False
    g['exit_candidate']=exit_candidates(smooth(g.knee_deg,g.time_s),g.time_s,g.body_horizontal)
    signal=g.elbow_deg_smooth.to_numpy().copy()
    # Side-view push-up scope: an upright body must not accumulate arm-flexion counts.
    signal[~(g.body_horizontal.ge(.5)&g.body_length.gt(.15)).to_numpy()]=np.nan
    counts,events,phases,intervals=common_cycles(signal,times,g.exit_candidate.to_numpy(),model['counter'])
    g['rep_count']=counts;g['rep_event']=events;g['count_phase']=phases;g['phase']=phases
    records=[dict(rep=n,start_s=float(times[a]),bottom_s=float(times[b]),end_s=float(times[e]),
                  uses_calibration=False,exit_candidate=False) for n,a,b,e in intervals]
    reps=pd.DataFrame(records,columns=['rep','start_s','bottom_s','end_s','uses_calibration','exit_candidate'])
    for item in ITEMS:reps[item+'_status']='tracking_unavailable'
    frames,reps=apply_pool(g,g,reps,model)
    frames['method']='common_v2'
    return frames,reps,side

UNIFIED_VERSION = 'attempt-count-3.0'
UNIFIED_CFG = dict(elbow_noise_deg=6., shoulder_noise_body=.025,
                   return_fraction=.70, min_s=.50, max_s=12., gap_s=.25,
                   merge_bottom_s=.45, feedback_wait_s=.60, hold_s=2.5)
FEEDBACK_TEXT = {
    'HIP_DROP':'골반이 아래로 처지지 않게 유지해 보세요.',
    'HIP_RAISE':'골반이 너무 높게 올라가지 않게 유지해 보세요.',
    'ELBOW_SHALLOW':'팔꿈치를 조금 더 굽혀 내려가 보세요.',
    'CHEST_RANGE_LOW':'상체의 위아래 이동 범위를 조금 더 늘려 보세요.',
    'RETURN_INCOMPLETE':'올라올 때 팔을 조금 더 펴 보세요.',
    'HAND_TOWARD_HEAD':'손 위치가 머리 쪽으로 치우쳤는지 확인해 보세요.',
    'HAND_TOWARD_HIP':'손 위치가 몸 아래쪽으로 치우쳤는지 확인해 보세요.'}


def motion_cycles(values, times, valid, noise, source, cfg):
    """Relative peak -> valley -> rebound. No absolute posture threshold."""
    result=[]; phase='seek'; peak=bottom=None; last=None
    for i,(x,t,ok) in enumerate(zip(values,times,valid)):
        if not ok or not np.isfinite(x):
            phase='seek'; peak=bottom=None; last=None; continue
        if last is not None and t-last>cfg['gap_s']:
            phase='seek'; peak=bottom=None
        last=t
        if peak is None: peak=i; continue
        if t-times[peak]>cfg['max_s']:
            phase='seek'; peak=i; bottom=None; continue
        if phase=='seek':
            if x>=values[peak]: peak=i
            elif values[peak]-x>=noise: phase='down'; bottom=i
        else:
            if x<values[bottom]: bottom=i
            drop=values[peak]-values[bottom]
            if x-values[bottom]>=max(noise,cfg['return_fraction']*drop):
                if t-times[peak]>=cfg['min_s'] and times[bottom]>times[peak]:
                    result.append(dict(start_s=float(times[peak]),bottom_s=float(times[bottom]),
                        end_s=float(t),detected_s=float(t),signal=source,amplitude=float(drop)))
                phase='seek'; peak=i; bottom=None
    return result


def same_motion(a,b,cfg):
    overlap=max(0.,min(a['end_s'],b['end_s'])-max(a['start_s'],b['start_s']))
    shorter=min(a['end_s']-a['start_s'],b['end_s']-b['start_s'])
    # Bottom proximity alone must not merge two non-overlapping fast repetitions.
    return overlap>0 and (abs(a['bottom_s']-b['bottom_s'])<=cfg['merge_bottom_s']
                          or (shorter>0 and overlap/shorter>=.65))


def unified_events(g,cfg):
    times=g.time_s.to_numpy(float)
    valid=(g.body_horizontal.ge(.5)&g.body_length.gt(.15)).to_numpy()
    shoulder=(g.chest_vertical/g.body_length).to_numpy(float)
    candidates=motion_cycles(g.elbow_deg_smooth.to_numpy(float),times,valid,
                             cfg['elbow_noise_deg'],'elbow',cfg)
    candidates+=motion_cycles(shoulder,times,valid,cfg['shoulder_noise_body'],'shoulder',cfg)
    candidates.sort(key=lambda r:(r['detected_s'],r['signal']))
    rows=[]; audit=[]
    for c in candidates:
        duplicate=next((r for r in reversed(rows) if same_motion(r,c,cfg)),None)
        if duplicate is not None:
            duplicate['signals']='|'.join(sorted(set(duplicate['signals'].split('|')+[c['signal']])))
            audit.append(dict(**c,matched_rep=duplicate['rep'],new_count=False))
            continue
        # The first confirmed signal defines the immutable count event and interval.
        r=dict(c,rep=len(rows)+1,signals=c['signal'],uses_calibration=False,exit_candidate=False)
        rows.append(r); audit.append(dict(**c,matched_rep=r['rep'],new_count=True))
    cols=['rep','start_s','bottom_s','end_s','detected_s','signal','amplitude','signals','uses_calibration','exit_candidate']
    return pd.DataFrame(rows,columns=cols),pd.DataFrame(audit,columns=list(cols[1:7])+['matched_rep','new_count'])


def predict_unified_features(g,model,cfg=None):
    cfg=dict(UNIFIED_CFG if cfg is None else cfg)
    g=g.copy().reset_index(drop=True)
    times=g.time_s.to_numpy(float)
    if not len(times) or not np.isfinite(times).all() or np.any(np.diff(times)<=0):
        raise ValueError('프레임 시각은 유한하고 증가해야 합니다.')
    if not (0<cfg['return_fraction']<=1 and 0<cfg['min_s']<cfg['max_s']
            and cfg['elbow_noise_deg']>0 and cfg['shoulder_noise_body']>0):
        raise ValueError('움직임 감지 설정을 확인하세요.')
    g['calibration']=False
    # Knee bending or an alignment warning must not veto the movement count.
    g['exit_candidate']=False
    reps,audit=unified_events(g,cfg)
    events=np.zeros(len(g),int)
    for r in reps.itertuples(): events[np.searchsorted(times,r.detected_s)]+=1
    g['rep_event']=events; g['rep_count']=np.cumsum(events)
    valid=(g.body_horizontal.ge(.5)&g.body_length.gt(.15)&
           (g.elbow_deg_smooth.notna()|g.chest_vertical.notna()))
    g['motion_status']=np.where(valid,'tracking','tracking_unavailable')
    g['hip_status']=shared_hip_states(g,model['limits'])
    g['last_rep']=0;g['rep_feedback_codes']='';g['return_status']='no_recent_feedback'
    for item in ['elbow','chest','hand']:g[item+'_status']='no_recent_feedback'
    for item in ITEMS+['return']: reps[item+'_status']='pending_feedback'
    reps['codes']='';reps['text']='';reps['feedback_s']=np.nan;reps['feedback_end_s']=np.nan
    reps['hand_suppression_reason']=''
    for idx,r in reps.iterrows():
        # Posture evaluation is downstream of count. Allow time to finish the rebound.
        pub_idx=int(np.searchsorted(times,r.detected_s+cfg['feedback_wait_s']-1e-9))
        if pub_idx>=len(g): continue  # Do not invent future samples at a clipped EOF.
        pub=float(times[pub_idx]);end=pub
        known_next=reps[(reps.rep>r.rep)&(reps.detected_s<=pub)]
        if len(known_next):end=max(float(r.end_s),min(pub,float(known_next.iloc[0].start_s)))
        dummy=pd.DataFrame([dict(rep=int(r.rep),start_s=r.start_s,bottom_s=r.bottom_s,
                                 end_s=end,uses_calibration=False,exit_candidate=False)])
        for item in ITEMS:dummy[item+'_status']='tracking_unavailable'
        history=g.iloc[:pub_idx+1].copy()
        _,rated=apply_pool(history,history,dummy,model)
        result=rated.iloc[0].to_dict();codes=[]
        if result['hip_drop_observed']:codes.append('HIP_DROP')
        if result['hip_raise_observed']:codes.append('HIP_RAISE')
        if result['elbow_status']=='warning':codes.append('ELBOW_SHALLOW')
        if result['chest_status']=='warning':codes.append('CHEST_RANGE_LOW')
        if result['hand_status']=='warning':
            codes.append('HAND_TOWARD_HEAD' if result['common_hand_bottom']<model['limits']['hand_low'] else 'HAND_TOWARD_HIP')
        # Only rebound-side samples determine extension feedback (not the starting edge).
        rebound=history.loc[history.time_s.between(float(r.end_s),end),'elbow_deg_smooth']
        ret='tracking_unavailable'
        if len(rebound)>=3 and rebound.notna().mean()>=COMMON_CFG['coverage']:
            ret='warning' if rebound.quantile(.9)<model['counter']['top_enter_deg'] else 'within_reference'
            if ret=='warning':codes.append('RETURN_INCOMPLETE')
        for key,value in result.items():
            if key not in ['rep','start_s','bottom_s','end_s','uses_calibration','exit_candidate']:
                reps.at[idx,key]=value
        reps.at[idx,'return_status']=ret;reps.at[idx,'feedback_s']=pub;reps.at[idx,'feedback_end_s']=end
        reps.at[idx,'codes']='|'.join(codes);reps.at[idx,'text']=' '.join(FEEDBACK_TEXT[c] for c in codes)
        mask=g.time_s.between(pub,pub+cfg['hold_s'])
        g.loc[g.time_s>=pub,'last_rep']=r.rep
        g.loc[mask,'rep_feedback_codes']='|'.join(codes)
        for item in ['elbow','chest','hand']:g.loc[mask,item+'_status']=result[item+'_status']
        g.loc[mask,'return_status']=ret
    # A newer count should not be labelled with the previous repetition's item results.
    newer=g.rep_count>g.last_rep
    g.loc[newer,'rep_feedback_codes']=''
    for item in ['elbow','chest','hand','return']:g.loc[newer,item+'_status']='pending_feedback'
    g['feedback_codes']=['|'.join(dict.fromkeys(filter(None,[{'hip_drop':'HIP_DROP','hip_raise':'HIP_RAISE'}.get(h,''),*c.split('|')])))
                         for h,c in zip(g.hip_status,g.rep_feedback_codes)]
    g['feedback_text']=g.feedback_codes.map(lambda s:' '.join(FEEDBACK_TEXT[c] for c in s.split('|') if c))
    g['method']=UNIFIED_VERSION
    return g,reps,audit


def predict_unified(arrays,model,side='auto',cfg=None):
    activate_model(model)
    if side=='auto':
        candidates={s:common_features(arrays,s) for s in ['left','right']}
        scores={s:float(g.elbow_deg.notna().mean()+g.hip_signed.notna().mean()+g.quality.mean()) for s,g in candidates.items()}
        side=max(scores,key=scores.get);g=candidates[side]
    elif side in ['left','right']:g=common_features(arrays,side)
    else:raise ValueError('side는 auto/left/right 중 하나입니다.')
    frames,reps,audit=predict_unified_features(g,model,cfg)
    return frames,reps,audit,side


def unified_item_summary(reps):
    rows=[]
    for item in ITEMS+['return']:
        s=reps[item+'_status'];n=int(s.isin(['within_reference','warning']).sum());passed=int(s.eq('within_reference').sum())
        rows.append(dict(item=item,counted_movements=len(reps),evaluable=n,compliant=passed,
                         warnings=int(s.eq('warning').sum()),unknown=len(reps)-n,
                         compliance_pct=100*passed/n if n else np.nan))
    return pd.DataFrame(rows)
