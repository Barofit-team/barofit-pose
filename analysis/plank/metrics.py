import numpy as np

JOINTS = {"left": [11,23,27], "right": [12,24,28]}

def metric(pose, dims, side):
    q=pose[JOINTS[side]]
    result=dict(hip_offset_pct=None, hip_angle_deg=None, min_visibility=None,
                min_presence=None, reliable=False)
    if np.isfinite(q[:,3:]).all():
        result.update(min_visibility=float(q[:,3].min()), min_presence=float(q[:,4].min()))
    if not np.isfinite(q[:,:2]).all(): return result
    s,h,a=q[:,:2]*np.asarray(dims);v=a-s;length=np.linalg.norm(v)
    if length<1e-6: return result
    if abs(v[0])/length>=.1:
        normal=np.array([-v[1],v[0]])/length
        if normal[1]<0: normal=-normal
        result['hip_offset_pct']=float(np.dot(h-s,normal)/length*100)
    u=s-h;w=a-h;den=np.linalg.norm(u)*np.linalg.norm(w)
    if den>1e-6: result['hip_angle_deg']=float(np.degrees(np.arccos(np.clip(np.dot(u,w)/den,-1,1))))
    result['reliable']=bool(np.isfinite(q[:,3:]).all() and (q[:,3:]>=.5).all()
                            and ((q[:,:2]>=0)&(q[:,:2]<=1)).all())
    return result
