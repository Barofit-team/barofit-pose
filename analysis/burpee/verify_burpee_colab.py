# ZIP을 Google Drive MyDrive에 올린 뒤 이 파일 전체를 Colab 셀 하나에서 실행합니다.
import os
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
    from PIL import Image
except ImportError:
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', '-q',
                           'mediapipe==0.10.32', 'opencv-python-headless',
                           'numpy', 'pillow'])
    import cv2
    import mediapipe as mp
    import numpy as np
    from PIL import Image

try:
    from google.colab import drive
    drive.mount('/content/drive')
    BASE = Path('/content/drive/MyDrive')
except ImportError:
    BASE = Path.cwd()

ZIP_NAME = 'barofit_burpee_pilot_v1.zip'
override = os.environ.get('BAROFIT_ZIP')
matches = [Path(override)] if override else sorted(BASE.rglob(ZIP_NAME))
if len(matches) != 1:
    raise FileNotFoundError(f'MyDrive에서 ZIP을 정확히 하나 찾을 수 있어야 합니다: {matches}')

ROOT = BASE / 'BarofitResults' / 'burpee'
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
if not manifest or any(row['exercise'] != 'burpee' or
                       row['posture_label'] != 'unreviewed' for row in manifest):
    raise ValueError('예상한 버피 데이터가 아닙니다.')

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

MODEL = Path(os.environ.get('BAROFIT_MODEL', '/content/models/pose_landmarker_full.task'))
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
         (24,26),(26,28),(27,31),(28,32),(11,13),(13,15),(12,14),(14,16)]

# 처음 0.3초는 서 있는 기준 구간으로 사용합니다.
JOINT_QUALITY = 0.45
FLOOR_DROP = 0.58
STAND_DROP = 0.23
MIN_FLOOR_SEC = 0.15
MIN_STAND_SEC = 0.10
MAX_TRACK_GAP = 0.40

def measure(p):
    def center_y(ids):
        points = [p[i, 1] for i in ids if np.isfinite(p[i]).all() and p[i, 2] >= JOINT_QUALITY]
        return float(np.mean(points)) if points else float('nan')
    return dict(shoulder_y=center_y((11, 12)), hip_y=center_y((23, 24)),
                ankle_y=center_y((27, 28)), wrist_y=center_y((15, 16)))

def count_frames(rows):
    start = [r for r in rows if r['time_s'] <= 0.30 and
             all(np.isfinite(r[k]) for k in ('shoulder_y','hip_y','ankle_y'))]
    shoulder = float(np.median([r['shoulder_y'] for r in start])) if len(start) >= 4 else np.nan
    height = float(np.median([r['ankle_y'] - r['shoulder_y'] for r in start])) if len(start) >= 4 else np.nan
    if not np.isfinite(height) or height < .10:
        raise RuntimeError('초기 기준 자세를 계산할 수 없습니다. 영상 시작에 서 있는 구간이 필요합니다.')
    state = 'WAIT_STAND'
    held_since = last_valid = None
    events = []
    for row in rows:
        t, s, hip, wrist = (row[k] for k in ('time_s','shoulder_y','hip_y','wrist_y'))
        valid = np.isfinite(s) and np.isfinite(hip)
        drop = (s - shoulder) / height if valid else np.nan
        row.update(shoulder_drop_ratio=drop, phase='UNAVAILABLE', event='', count_candidate=len(events))
        if not valid:
            held_since = None
            continue
        if last_valid is not None and t - last_valid > MAX_TRACK_GAP:
            state, held_since = 'WAIT_STAND', None
        last_valid = t
        upright = drop < STAND_DROP and (hip-s) / height > .26
        low = drop > FLOOR_DROP and np.isfinite(wrist) and wrist > s - .02
        condition = low if state == 'READY' else upright
        if condition:
            held_since = t if held_since is None else held_since
            required = MIN_FLOOR_SEC if state == 'READY' else MIN_STAND_SEC
            if t - held_since >= required:
                if state == 'FLOOR':
                    events.append(round(t, 3))
                    row['event'] = 'rep'
                elif state == 'READY':
                    row['event'] = 'floor'
                state = 'FLOOR' if state == 'READY' else 'READY'
                held_since = None
        else:
            held_since = None
        row.update(phase=state, count_candidate=len(events))
    return events

def extract(source):
    cap = cv2.VideoCapture(str(source))
    fps = cap.get(cv2.CAP_PROP_FPS)
    rows, poses = [], []
    try:
        if not cap.isOpened() or not np.isfinite(fps) or fps <= 0:
            raise RuntimeError(f'영상을 열 수 없습니다: {source}')
        with mp.tasks.vision.PoseLandmarker.create_from_options(options) as model:
            last_ms = -1
            while True:
                ok, frame = cap.read()
                if not ok:
                    break
                t = len(rows) / fps
                last_ms = max(last_ms + 1, round(t * 1000))
                h, w = frame.shape[:2]
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                r = model.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), last_ms)
                p = np.array([[q.x, q.y, q.visibility] for q in r.pose_landmarks[0]]) if r.pose_landmarks else np.full((33, 3), np.nan)
                rows.append(dict(time_s=t, **measure(p)))
                poses.append(p)
    finally:
        cap.release()
    if not rows:
        raise RuntimeError(f'영상 프레임이 없습니다: {source}')
    return fps, rows, poses

def render(source, target, gif_path, fps, rows, poses):
    cap = cv2.VideoCapture(str(source))
    proc = None
    images = []
    step = max(1, round(fps / 10))
    try:
        for i, (row, p) in enumerate(zip(rows, poses)):
            ok, frame = cap.read()
            if not ok:
                raise RuntimeError('렌더링 중 프레임을 읽을 수 없습니다.')
            h, w = frame.shape[:2]
            canvas = cv2.copyMakeBorder(frame, 71, 22, 0, 0, cv2.BORDER_CONSTANT, value=(22, 30, 45))
            for a, b in EDGES:
                if np.isfinite(p[[a, b]]).all() and min(p[a, 2], p[b, 2]) >= JOINT_QUALITY:
                    pts = [(int(p[j, 0] * w), 71 + int(p[j, 1] * h)) for j in (a, b)]
                    cv2.line(canvas, *pts, (215, 239, 38), 2, cv2.LINE_AA)
            def label(y, msg, size, thickness):
                cv2.putText(canvas, msg, (12, y), cv2.FONT_HERSHEY_SIMPLEX, size,
                            (248, 250, 255), thickness, cv2.LINE_AA)
            label(30, f"REP COUNT: {row['count_candidate']}", 0.91, 2)
            drop = row['shoulder_drop_ratio']
            status = f"{row['phase']} | DROP {drop:.2f}" if np.isfinite(drop) else 'TRACKING UNAVAILABLE'
            label(57, f"{status}   TIME {row['time_s']:.1f}s", 0.47, 1)
            label(canvas.shape[0] - 7, 'BURPEE | AUTO COUNT CANDIDATES | UNREVIEWED', 0.36, 1)
            if proc is None:
                hh, ww = canvas.shape[:2]
                proc = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo',
                    '-pix_fmt', 'bgr24', '-s', f'{ww}x{hh}', '-r', str(fps), '-i', '-',
                    '-an', '-c:v', 'libx264', '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2',
                    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(target)], stdin=subprocess.PIPE)
            proc.stdin.write(canvas.tobytes())
            if i % step == 0:
                small = cv2.resize(canvas, (400, round(canvas.shape[0] * 400 / w)))
                images.append(Image.fromarray(cv2.cvtColor(small, cv2.COLOR_BGR2RGB)))
    finally:
        cap.release()
        if proc is not None:
            try:
                proc.stdin.close()
            finally:
                if proc.wait() != 0:
                    raise RuntimeError('FFmpeg MP4 저장 실패')
    images[0].save(gif_path, save_all=True, append_images=images[1:],
                   duration=round(1000 * step / fps), loop=0)

reports = []
for clip in manifest:
    source = INPUT / clip['file']
    fps, rows, poses = extract(source)
    events = count_frames(rows)
    stem = source.stem
    video_path = RUN / f'{stem}_counted.mp4'
    render(source, video_path, RUN / f'{stem}_skeleton.gif', fps, rows, poses)
    with (RUN / f'{stem}_metrics.csv').open('w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        for row in rows:
            writer.writerow({k: (round(v, 4) if np.isfinite(v) else '') if isinstance(v, (float, np.floating)) else v for k, v in row.items()})
    report = dict(clip=clip['file'], view=clip['view'], take_id=clip['take_id'],
                  posture_label='unreviewed', frames=len(rows),
                  tracking_coverage=round(sum(np.isfinite(row['shoulder_drop_ratio']) for row in rows) / len(rows), 4),
                  count_candidate=len(events), candidate_times_s=events)
    reports.append(report)
    print(json.dumps(report, ensure_ascii=False))
    if 'google.colab' in sys.modules:
        from IPython.display import HTML, display
        data = base64.b64encode(video_path.read_bytes()).decode('ascii')
        display(HTML(f'<video controls width="650" src="data:video/mp4;base64,{data}"></video>'))

(RUN / 'summary.json').write_text(json.dumps(reports, ensure_ascii=False, indent=2), encoding='utf-8')
print('결과 저장:', RUN)
print('각 클립의 후보 수를 별도로 검수하세요.')
