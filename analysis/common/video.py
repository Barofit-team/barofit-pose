from pathlib import Path
import json,math,hashlib,time,subprocess,shutil,csv,datetime
import numpy as np
import cv2

def save_json(path,data):
    Path(path).write_text(json.dumps(data,ensure_ascii=False,indent=2,allow_nan=False),encoding='utf-8')

def extract_video(path,model_path,cache_dir,target_fps=15,max_width=960):
    import cv2,mediapipe as mp
    path=Path(path);model_path=Path(model_path);cache_dir=Path(cache_dir);cache_dir.mkdir(parents=True,exist_ok=True)
    source_sha=hashlib.sha256(path.read_bytes()).hexdigest();model_sha=hashlib.sha256(model_path.read_bytes()).hexdigest()
    spec={'version':1,'target_fps':target_fps,'max_width':max_width,'mediapipe':mp.__version__,'source_sha256':source_sha,'model_sha256':model_sha}
    sig=hashlib.sha256(json.dumps(spec,sort_keys=True).encode()).hexdigest();cache=cache_dir/(sig+'.npz');meta=cache.with_suffix('.json')
    if cache.exists() and meta.exists():
        with np.load(cache,allow_pickle=False) as f:arrays={k:f[k] for k in f.files}
        return arrays,json.loads(meta.read_text(encoding='utf-8'))
    cap=cv2.VideoCapture(str(path));fps=cap.get(cv2.CAP_PROP_FPS);expected=int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if not cap.isOpened() or not math.isfinite(fps) or fps<=0:cap.release();raise ValueError(f'Cannot read video: {path}')
    options=mp.tasks.vision.PoseLandmarkerOptions(base_options=mp.tasks.BaseOptions(model_asset_buffer=model_path.read_bytes()),
        running_mode=mp.tasks.vision.RunningMode.VIDEO,num_poses=1,min_pose_detection_confidence=.5,min_pose_presence_confidence=.5,min_tracking_confidence=.5)
    poses=[];times=[];indices=[];dims=[];i=0;next_t=0.;last_t=-1.;fallback=0;begin=time.perf_counter()
    try:
        with mp.tasks.vision.PoseLandmarker.create_from_options(options) as detector:
            while True:
                ok,frame=cap.read()
                if not ok:break
                t=cap.get(cv2.CAP_PROP_POS_MSEC)/1000
                if not math.isfinite(t) or t<=last_t:t=max(i/fps,last_t+1/fps);fallback+=1
                last_t=t
                if t+1e-6>=next_t:
                    h,w=frame.shape[:2];scale=min(1,max_width/w)
                    frame=cv2.resize(frame,(round(w*scale),round(h*scale)))
                    rgb=np.ascontiguousarray(cv2.cvtColor(frame,cv2.COLOR_BGR2RGB))
                    timestamp=max(round(t*1000),round(times[-1]*1000)+1 if times else 0)
                    result=detector.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB,data=rgb),timestamp)
                    p=np.full((33,5),np.nan)
                    if result.pose_landmarks:p=np.array([[q.x,q.y,q.z,q.visibility,q.presence] for q in result.pose_landmarks[0]])
                    poses.append(p);times.append(timestamp/1000);indices.append(i);dims.append([frame.shape[1],frame.shape[0]])
                    next_t=t+1/target_fps
                i+=1
    finally:cap.release()
    if not poses or (expected>0 and i<expected*.95):raise ValueError(f'Incomplete decoding: {i}/{expected}')
    arrays={'poses':np.stack(poses),'times':np.array(times),'indices':np.array(indices),'dims':np.array(dims)}
    info={**spec,'source_path':str(path.resolve()),'fps':fps,'decoded_frames':i,'expected_frames':expected,
          'duration_s':last_t+1/fps,'sampled_frames':len(poses),'timestamp_fallbacks':fallback,'inference_wall_s':time.perf_counter()-begin}
    np.savez_compressed(cache,**arrays);save_json(meta,info)
    return arrays,info
