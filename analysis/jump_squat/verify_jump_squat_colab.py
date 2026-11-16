# Google Drive MyDrive에 barofit_jump_squat_pilot_v1.zip을 올린 뒤
# 이 파일의 전체 내용을 Colab 코드 셀 하나에 붙여 넣어 실행합니다.
import base64
import csv
import hashlib
import json
import subprocess
import sys
import time
import urllib.request
import zipfile
from pathlib import Path

try:
    import cv2
    import mediapipe as mp
    import numpy as np
    from PIL import Image, ImageDraw
except ImportError:
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', '-q',
                           'mediapipe==0.10.32', 'opencv-python-headless',
                           'numpy', 'pillow'])
    import cv2
    import mediapipe as mp
    import numpy as np
    from PIL import Image, ImageDraw

try:
    from google.colab import drive
    drive.mount('/content/drive')
    BASE = Path('/content/drive/MyDrive')
except ImportError:
    BASE = Path.cwd()

ZIP_NAME = 'barofit_jump_squat_pilot_v1.zip'
found = list(BASE.rglob(ZIP_NAME))
if len(found) != 1:
    raise FileNotFoundError(f'MyDrive에서 ZIP을 정확히 하나 찾을 수 있어야 합니다: {found}')

ROOT = BASE / 'BarofitResults' / 'jump_squat'
RUN = ROOT / time.strftime('run_%Y%m%d_%H%M%S')
suffix = 2
while RUN.exists():
    RUN = ROOT / (time.strftime('run_%Y%m%d_%H%M%S') + f'_{suffix}')
    suffix += 1
RUN.mkdir(parents=True)
INPUT = RUN / 'input'
INPUT.mkdir()

with zipfile.ZipFile(found[0]) as archive:
    bad = archive.testzip()
    if bad:
        raise ValueError(f'ZIP 무결성 검사 실패: {bad}')
    for entry in archive.infolist():
        target = (INPUT / entry.filename).resolve()
        if not target.is_relative_to(INPUT.resolve()):
            raise ValueError(f'허용되지 않는 압축 경로: {entry.filename}')
        archive.extract(entry, INPUT)

manifest = json.loads((INPUT / 'manifest.json').read_text(encoding='utf-8'))
if not manifest or any(row['exercise'] != 'jump_squat' or
                       row['posture_label'] != 'unreviewed' for row in manifest):
    raise ValueError('예상한 점프 스쿼트 파일이 아닙니다.')

def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()

for row in manifest:
    path = INPUT / row['file']
    if not path.is_file() or sha256(path) != row['sha256']:
        raise ValueError(f'영상 파일이 없거나 해시가 다릅니다: {path}')

MODEL = Path('/content/models/pose_landmarker_full.task')
MODEL.parent.mkdir(parents=True, exist_ok=True)
if not MODEL.is_file() or MODEL.stat().st_size < 1000000:
    urllib.request.urlretrieve(
        'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
        MODEL)

options = mp.tasks.vision.PoseLandmarkerOptions(
    base_options=mp.tasks.BaseOptions(model_asset_path=str(MODEL)),
    running_mode=mp.tasks.vision.RunningMode.VIDEO,
    num_poses=1,
    min_pose_detection_confidence=0.5,
    min_pose_presence_confidence=0.5,
    min_tracking_confidence=0.5)
EDGES = [(11,12),(11,23),(12,24),(23,24),(23,25),(25,27),
         (24,26),(26,28),(27,31),(28,32)]

def angle(p, a, b, c):
    if not np.isfinite(p[[a,b,c],:]).all() or min(p[[a,b,c],2]) < 0.5:
        return np.nan
    u = p[a,:2] - p[b,:2]
    v = p[c,:2] - p[b,:2]
    den = np.linalg.norm(u) * np.linalg.norm(v)
    if den < 1e-8:
        return np.nan
    return float(np.degrees(np.arccos(np.clip(np.dot(u,v)/den,-1,1))))

def mean_y(p, ids):
    valid = [i for i in ids if np.isfinite(p[i,:]).all() and p[i,2] >= 0.5]
    return float(np.mean(p[valid,1])) if valid else np.nan

def extract(path):
    cap = cv2.VideoCapture(str(path))
    fps = cap.get(cv2.CAP_PROP_FPS)
    if not cap.isOpened() or fps <= 0:
        cap.release()
        raise RuntimeError(f'영상 열기 실패: {path}')
    frames, poses, times = [], [], []
    index, last_ms = 0, -1
    try:
        with mp.tasks.vision.PoseLandmarker.create_from_options(options) as detector:
            while True:
                ok, bgr = cap.read()
                if not ok:
                    break
                rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
                t = index / fps
                ms = max(last_ms + 1, round(t * 1000))
                result = detector.detect_for_video(
                    mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), ms)
                p = np.full((33,3), np.nan)
                if result.pose_landmarks:
                    p = np.array([[q.x,q.y,q.visibility]
                                  for q in result.pose_landmarks[0]], dtype=float)
                frames.append(rgb)
                poses.append(p)
                times.append(t)
                index += 1
                last_ms = ms
    finally:
        cap.release()
    if not poses:
        raise RuntimeError(f'분석 가능한 프레임이 없습니다: {path}')
    poses = np.asarray(poses)
    knees = np.array([np.nanmin([angle(p,23,25,27),angle(p,24,26,28)])
                      if np.isfinite([angle(p,23,25,27),angle(p,24,26,28)]).any()
                      else np.nan for p in poses])
    ankles = np.array([mean_y(p,[27,28]) for p in poses])
    return frames,poses,np.asarray(times),knees,ankles

def median_three(values):
    padded = np.pad(values,(1,1),mode='edge')
    return np.array([np.median(padded[i:i+3]) for i in range(len(values))])

def count_jumps(times,knees,ankles):
    count = np.zeros(len(times),dtype=int)
    phases = ['tracking_unavailable'] * len(times)
    valid = np.isfinite(knees) & np.isfinite(ankles)
    if valid.mean() < 0.65:
        return count,phases,[],np.nan,'tracking_unavailable'
    k = np.interp(np.arange(len(knees)),np.flatnonzero(valid),knees[valid])
    a = np.interp(np.arange(len(ankles)),np.flatnonzero(valid),ankles[valid])
    k,a = median_three(k),median_three(a)
    first = a[:min(25,len(a))]
    floor = float(np.median(first))
    if not np.isfinite(floor):
        return count,phases,[],np.nan,'tracking_unavailable'
    state,last,events = 'ready',-100.0,[]
    for i,(t,knee,ankle) in enumerate(zip(times,k,a)):
        if not valid[i]:
            if i >= 5 and not valid[i-5:i+1].any():
                state = 'ready'
            count[i] = len(events)
            continue
        if state == 'ready' and knee < 130:
            state = 'crouched'
        elif state == 'crouched' and ankle < floor - 0.065 and knee > 145:
            state = 'airborne_candidate'
        elif state == 'airborne_candidate' and ankle > floor - 0.025 and t-last > 0.45:
            events.append(round(float(t),2))
            last = t
            state = 'ready'
        phases[i] = state
        count[i] = len(events)
    return count,phases,events,floor,'candidate_only'

def make_gif(frames,poses,times,knees,counts,path):
    images = []
    for i in range(0,len(frames),3):
        im = Image.fromarray(frames[i].copy())
        draw = ImageDraw.Draw(im)
        w,h = im.size
        for x,y in EDGES:
            p = poses[i]
            if np.isfinite(p[[x,y],:]).all() and min(p[x,2],p[y,2]) >= .5:
                draw.line((int(p[x,0]*w),int(p[x,1]*h),
                           int(p[y,0]*w),int(p[y,1]*h)),fill='#00f0c6',width=4)
        knee = f'{knees[i]:.0f} deg' if np.isfinite(knees[i]) else 'unavailable'
        draw.rectangle((0,0,w,42),fill='#102130')
        draw.text((8,8),f'COUNT {counts[i]} | KNEE {knee} | {times[i]:.1f}s',fill='white')
        images.append(im)
    duration = int(round(3000 / (len(times)/times[-1]))) if times[-1] > 0 else 200
    images[0].save(path,save_all=True,append_images=images[1:],
                   duration=max(100,duration),loop=0,optimize=False)

def make_video(source,poses,times,knees,counts,path):
    cap = cv2.VideoCapture(str(source))
    fps = cap.get(cv2.CAP_PROP_FPS)
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    if not cap.isOpened() or fps <= 0 or w <= 0 or h <= 0:
        cap.release()
        raise RuntimeError('MP4 출력을 위한 영상 열기 실패')
    temporary = path.with_suffix('.temporary.avi')
    writer = cv2.VideoWriter(str(temporary),cv2.VideoWriter_fourcc(*'MJPG'),fps,(w,h))
    if not writer.isOpened():
        cap.release()
        raise RuntimeError('중간 영상 생성 실패')
    index = 0
    try:
        while True:
            ok,frame = cap.read()
            if not ok:
                break
            i = min(index,len(poses)-1)
            p = poses[i]
            for x,y in EDGES:
                if np.isfinite(p[[x,y],:]).all() and min(p[x,2],p[y,2]) >= .5:
                    pt1 = (int(p[x,0]*w),int(p[x,1]*h))
                    pt2 = (int(p[y,0]*w),int(p[y,1]*h))
                    cv2.line(frame,pt1,pt2,(198,240,0),3,cv2.LINE_AA)
            cv2.rectangle(frame,(0,0),(w,85),(15,32,48),-1)
            cv2.putText(frame,f'REP COUNT: {int(counts[i])}',(14,39),
                        cv2.FONT_HERSHEY_SIMPLEX,1.1,(255,255,255),3,cv2.LINE_AA)
            knee = f'{knees[i]:.0f} deg' if np.isfinite(knees[i]) else 'unavailable'
            cv2.putText(frame,f'KNEE: {knee}   TIME: {index/fps:.1f}s',
                        (15,68),cv2.FONT_HERSHEY_SIMPLEX,.52,(240,240,240),1,cv2.LINE_AA)
            cv2.rectangle(frame,(0,h-28),(w,h),(15,32,48),-1)
            cv2.putText(frame,'JUMP SQUAT DEMO | FORM LABEL: UNREVIEWED',
                        (10,h-9),cv2.FONT_HERSHEY_SIMPLEX,.43,
                        (255,255,255),1,cv2.LINE_AA)
            writer.write(frame)
            index += 1
    finally:
        cap.release()
        writer.release()
    try:
        subprocess.run(['ffmpeg','-y','-loglevel','error','-i',str(temporary),
                        '-an','-c:v','libx264','-pix_fmt','yuv420p',
                        '-movflags','+faststart',str(path)],check=True)
    finally:
        temporary.unlink(missing_ok=True)
    if not path.is_file() or path.stat().st_size == 0:
        raise RuntimeError('MP4 인코딩 실패')
    return index

reports = []
for row in manifest:
    source = INPUT / row['file']
    name = Path(row['file']).stem
    frames,poses,times,knees,ankles = extract(source)
    counts,phases,events,floor,status = count_jumps(times,knees,ankles)
    csv_path = RUN / f'{name}_angles.csv'
    with csv_path.open('w',encoding='utf-8',newline='') as f:
        writer = csv.writer(f)
        writer.writerow(['time_s','knee_min_deg','ankle_y_normalized','phase','count_candidate'])
        for t,k,a,phase,count in zip(times,knees,ankles,phases,counts):
            writer.writerow([round(float(t),3),round(float(k),2) if np.isfinite(k) else '',
                             round(float(a),4) if np.isfinite(a) else '',phase,int(count)])
    gif_path = RUN / f'{name}_skeleton.gif'
    make_gif(frames,poses,times,knees,counts,gif_path)
    mp4_path = RUN / f'{name}_counted.mp4'
    rendered = make_video(source,poses,times,knees,counts,mp4_path)
    report = {'file':row['file'],'posture_label':'unreviewed',
              'tracking_coverage':round(float((np.isfinite(knees)&np.isfinite(ankles)).mean()),3),
              'count_candidate':len(events),'candidate_times_s':events,
              'floor_ankle_y':round(floor,4) if np.isfinite(floor) else None,
              'status':status,'rendered_frames':rendered,
              'mp4':mp4_path.name,'gif':gif_path.name,'csv':csv_path.name}
    reports.append(report)
    print(json.dumps(report,ensure_ascii=False,indent=2))
    try:
        from IPython.display import HTML,display
        encoded = base64.b64encode(mp4_path.read_bytes()).decode('ascii')
        display(HTML('<video width="800" controls preload="metadata" '
                     'style="max-width:100%;display:block">'
                     f'<source src="data:video/mp4;base64,{encoded}" type="video/mp4">'
                     '</video>'))
    except Exception as exc:
        print('셀에서 영상이 보이지 않으면 저장된 MP4를 여세요:',mp4_path)
        print('표시 오류:',type(exc).__name__,str(exc))

(RUN / 'summary.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2),encoding='utf-8')
print('결과 저장:',RUN)
print('횟수는 자동 감지 후보입니다. 정자세/오류 자세 판정은 하지 않았습니다.')
