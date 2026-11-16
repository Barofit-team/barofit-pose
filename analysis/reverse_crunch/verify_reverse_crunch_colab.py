# ZIP을 Google Drive MyDrive에 올린 뒤 이 파일 전체를 Colab 셀 하나에서 실행합니다.
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

ZIP_NAME = 'barofit_reverse_crunch_pilot_v1.zip'
matches = list(BASE.rglob(ZIP_NAME))
if len(matches) != 1:
    raise FileNotFoundError(f'MyDrive에서 ZIP을 정확히 하나 찾을 수 있어야 합니다: {matches}')

ROOT = BASE / 'BarofitResults' / 'reverse_crunch'
RUN = ROOT / time.strftime('run_%Y%m%d_%H%M%S')
suffix = 2
while RUN.exists():
    RUN = ROOT / (time.strftime('run_%Y%m%d_%H%M%S') + f'_{suffix}')
    suffix += 1
RUN.mkdir(parents=True)
INPUT = RUN / 'input'
INPUT.mkdir()

with zipfile.ZipFile(matches[0]) as archive:
    bad = archive.testzip()
    if bad:
        raise ValueError(f'ZIP 무결성 검사 실패: {bad}')
    for entry in archive.infolist():
        target = (INPUT / entry.filename).resolve()
        if not target.is_relative_to(INPUT.resolve()):
            raise ValueError(f'잘못된 압축 경로: {entry.filename}')
        archive.extract(entry, INPUT)

manifest = json.loads((INPUT / 'manifest.json').read_text(encoding='utf-8'))
if not manifest or any(row['exercise'] != 'reverse_crunch' or
                       row['posture_label'] != 'unreviewed' for row in manifest):
    raise ValueError('예상한 리버스 크런치 데이터가 아닙니다.')

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
if not MODEL.is_file() or MODEL.stat().st_size < 1_000_000:
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

def distance_measure(p):
    # 교차 다리 변형에서 어깨와 가까워지는 무릎의 거리를 몸통 길이로 나눕니다.
    needed = (11,12,23,24)
    if not np.isfinite(p[list(needed),:]).all() or min(p[list(needed),2]) < 0.5:
        return np.nan
    shoulder = (p[11,:2] + p[12,:2]) / 2
    hip = (p[23,:2] + p[24,:2]) / 2
    torso = np.linalg.norm(shoulder - hip)
    if torso < 0.04:
        return np.nan
    distances = [np.linalg.norm(p[k,:2] - shoulder) / torso
                 for k in (25,26) if np.isfinite(p[k,:]).all() and p[k,2] >= 0.35]
    return float(min(distances)) if distances else np.nan

def extract(path):
    cap = cv2.VideoCapture(str(path))
    fps = cap.get(cv2.CAP_PROP_FPS)
    if not cap.isOpened() or fps <= 0:
        cap.release()
        raise RuntimeError(f'영상 열기 실패: {path}')
    poses, times = [], []
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
                poses.append(p)
                times.append(t)
                index, last_ms = index + 1, ms
    finally:
        cap.release()
    if not poses:
        raise RuntimeError(f'분석 가능한 프레임이 없습니다: {path}')
    poses = np.asarray(poses)
    distances = np.array([distance_measure(p) for p in poses])
    return poses, np.asarray(times), distances, fps

def count_reps(times, distances):
    valid = np.isfinite(distances)
    counts = np.zeros(len(times), dtype=int)
    phases = ['tracking_unavailable'] * len(times)
    if valid.mean() < 0.65:
        return counts, phases, [], 'tracking_unavailable'
    signal = np.interp(np.arange(len(distances)), np.flatnonzero(valid), distances[valid])
    signal = np.convolve(np.pad(signal,(2,2),mode='edge'),
                         np.ones(5) / 5, mode='valid')
    state, entered, events = 'extended', -100.0, []
    for i, (t, value) in enumerate(zip(times, signal)):
        if not valid[i]:
            counts[i] = len(events)
            continue
        # 이 영상의 측면 교차 다리 동작에 맞춘 시작/복귀 임계값입니다.
        if state == 'extended' and value < 1.49 and t - entered > 0.55:
            state, entered = 'curled', t
        elif state == 'curled' and value > 1.63 and t - entered > 0.16:
            state = 'extended'
            events.append(round(float(t), 2))
        phases[i] = state
        counts[i] = len(events)
    return counts, phases, events, 'candidate_only'

def draw_frame(frame, p, count, measure, t, gif=False):
    h, w = frame.shape[:2]
    for a, b in EDGES:
        if np.isfinite(p[[a,b],:]).all() and min(p[a,2],p[b,2]) >= 0.5:
            start = (int(p[a,0]*w),int(p[a,1]*h))
            end = (int(p[b,0]*w),int(p[b,1]*h))
            cv2.line(frame, start, end, (204,240,0), 3, cv2.LINE_AA)
    cv2.rectangle(frame,(0,0),(w,86),(15,32,48),-1)
    cv2.putText(frame,f'REP COUNT: {count}',(15,40),
                cv2.FONT_HERSHEY_SIMPLEX,1.1,(255,255,255),3,cv2.LINE_AA)
    label = f'{measure:.2f}' if np.isfinite(measure) else 'unavailable'
    cv2.putText(frame,f'KNEE DIST / TORSO: {label}   TIME: {t:.1f}s',(15,70),
                cv2.FONT_HERSHEY_SIMPLEX,0.56,(240,240,240),1,cv2.LINE_AA)
    cv2.rectangle(frame,(0,h-28),(w,h),(15,32,48),-1)
    cv2.putText(frame,'CROSS-LEG REVERSE CRUNCH | FORM: UNREVIEWED',
                (10,h-9),cv2.FONT_HERSHEY_SIMPLEX,0.48,
                (255,255,255),1,cv2.LINE_AA)
    return frame

def make_video(source, poses, times, distances, counts, target):
    cap = cv2.VideoCapture(str(source))
    fps = cap.get(cv2.CAP_PROP_FPS)
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    temporary = target.with_suffix('.temporary.avi')
    writer = cv2.VideoWriter(str(temporary),cv2.VideoWriter_fourcc(*'MJPG'),fps,(w,h))
    if not writer.isOpened():
        cap.release()
        raise RuntimeError('영상 출력기를 열 수 없습니다.')
    n = 0
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            if n >= len(poses):
                break
            writer.write(draw_frame(frame,poses[n],int(counts[n]),distances[n],times[n]))
            n += 1
    finally:
        cap.release()
        writer.release()
    try:
        subprocess.run(['ffmpeg','-y','-loglevel','error','-i',str(temporary),
                        '-an','-c:v','libx264','-pix_fmt','yuv420p',
                        '-movflags','+faststart',str(target)],check=True)
    finally:
        temporary.unlink(missing_ok=True)
    if not target.is_file() or not target.stat().st_size:
        raise RuntimeError('MP4 인코딩 실패')
    return n

def make_gif(source, poses, times, distances, counts, target):
    cap = cv2.VideoCapture(str(source))
    images = []
    try:
        for i in range(len(poses)):
            ok, frame = cap.read()
            if not ok:
                break
            if i % 3 == 0:
                annotated = draw_frame(frame,poses[i],int(counts[i]),distances[i],times[i])
                images.append(Image.fromarray(cv2.cvtColor(annotated,cv2.COLOR_BGR2RGB)))
    finally:
        cap.release()
    if not images:
        raise RuntimeError('GIF 프레임이 없습니다.')
    duration = int(round(3000 / (len(times)/(times[-1]+1e-8))))
    images[0].save(target,save_all=True,append_images=images[1:],
                   duration=max(100,duration),loop=0,optimize=False)

reports = []
for row in manifest:
    source = INPUT / row['file']
    stem = source.stem
    poses,times,distances,fps = extract(source)
    counts,phases,events,status = count_reps(times,distances)
    csv_path = RUN / f'{stem}_metrics.csv'
    with csv_path.open('w',newline='',encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(['time_s','knee_to_shoulder_over_torso','phase','count_candidate'])
        for t,d,phase,count in zip(times,distances,phases,counts):
            writer.writerow([round(float(t),3),round(float(d),4)
                             if np.isfinite(d) else '',phase,int(count)])
    gif_path = RUN / f'{stem}_skeleton.gif'
    make_gif(source,poses,times,distances,counts,gif_path)
    mp4_path = RUN / f'{stem}_counted.mp4'
    rendered = make_video(source,poses,times,distances,counts,mp4_path)
    report = {'file':row['file'],'variation':row['variation'],
              'posture_label':'unreviewed',
              'tracking_coverage':round(float(np.isfinite(distances).mean()),3),
              'count_candidate':len(events),'candidate_times_s':events,
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
        print('영상 표시 오류:',type(exc).__name__,str(exc))
        print('저장된 MP4를 직접 여세요:',mp4_path)

(RUN / 'summary.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2),
                                  encoding='utf-8')
print('결과 저장:',RUN)
print('횟수는 자동 감지 후보이며 정자세/오류 자세 판정이 아닙니다.')
