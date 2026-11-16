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

ZIP_NAME = 'barofit_pullup_pilot_v1.zip'
override = os.environ.get('BAROFIT_ZIP')
matches = [Path(override)] if override else sorted(BASE.rglob(ZIP_NAME))
if len(matches) != 1:
    raise FileNotFoundError(f'MyDrive에서 ZIP을 정확히 하나 찾을 수 있어야 합니다: {matches}')

ROOT = BASE / 'BarofitResults' / 'pullup'
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
if not manifest or any(row['exercise'] != 'pullup' or
                       row['posture_label'] != 'unreviewed' for row in manifest):
    raise ValueError('예상한 풀업 데이터가 아닙니다.')

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

# 동일한 팔에서 펴기 → 굽히기 → 펴기를 확인하면 1회 후보입니다.
JOINT_QUALITY = .50
EXTEND_DEG = 150.0
BEND_DEG = 105.0
MIN_HOLD_SEC = .08
MAX_TRACK_GAP = .35
MAX_CYCLE_SEC = 8.0

def measure(p, w, h):
    values = {}
    for side, ids in [('left', [11, 13, 15]), ('right', [12, 14, 16])]:
        points = p[ids]
        angle, overhead = np.nan, False
        if np.isfinite(points).all() and min(points[:, 2]) >= JOINT_QUALITY:
            shoulder, elbow, wrist = points[:, :2] * [w, h]
            u, v = shoulder - elbow, wrist - elbow
            lengths = np.linalg.norm(u), np.linalg.norm(v)
            if min(lengths) >= 4:
                angle = float(np.degrees(np.arccos(np.clip(np.dot(u, v) / np.prod(lengths), -1, 1))))
                overhead = (shoulder[1] - wrist[1]) > .40 * sum(lengths)
        values.update({f'{side}_elbow_deg': angle, f'{side}_overhead': overhead})
    return values

def count_frames(rows):
    state, side = 'WAIT_HANG', None
    pending, since, last_valid, cycle_start = None, None, None, None
    events = []
    for row in rows:
        t = row['time_s']
        angles = {s: row[f'{s}_elbow_deg'] for s in ('left', 'right')}
        if ((last_valid is not None and t-last_valid > MAX_TRACK_GAP)
                or (cycle_start is not None and t-cycle_start > MAX_CYCLE_SEC)):
            state, side, pending, since, cycle_start = 'WAIT_HANG', None, None, None, None
        valid = np.isfinite(angles[side]) if side else any(np.isfinite(v) for v in angles.values())
        row.update(phase='UNAVAILABLE', tracked_arm=side or '', event='', count_candidate=len(events))
        if not valid:
            pending = since = None
            continue
        last_valid = t
        hang = [s for s, a in angles.items() if a >= EXTEND_DEG and row[f'{s}_overhead']]
        token = None
        if state == 'WAIT_HANG' and hang:
            token = pending if pending in hang else max(hang, key=angles.get)
        elif state == 'HANG' and angles[side] <= BEND_DEG:
            token = 'flex'
        elif state == 'FLEXED' and side in hang:
            token = 'return'
        if token is None:
            pending = since = None
        elif token != pending:
            pending, since = token, t
        elif t - since >= MIN_HOLD_SEC:
            if state == 'WAIT_HANG':
                state, side, cycle_start = 'HANG', token, t
            elif state == 'HANG':
                state = 'FLEXED'
                row['event'] = 'flex'
            else:
                state, cycle_start = 'HANG', t
                events.append(round(t, 3))
                row['event'] = 'rep'
            pending = since = None
        elif state == 'HANG' and side in hang:
            cycle_start = t
        if state == 'HANG' and side in hang:
            cycle_start = t
        row.update(phase=state, tracked_arm=side or '', count_candidate=len(events))
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
                rows.append(dict(time_s=t, **measure(p, w, h)))
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
            angles = [row[f'{s}_elbow_deg'] for s in ('left', 'right')]
            a, b = [f'{x:.0f}' if np.isfinite(x) else '--' for x in angles]
            label(57, f"{row['phase']} | ELBOW L {a} R {b} deg | {row['time_s']:.1f}s", .47, 1)
            label(canvas.shape[0] - 7, 'PULL-UP | AUTO COUNT CANDIDATES | UNREVIEWED', 0.36, 1)
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
                  tracking_coverage=round(sum(any(np.isfinite(row[f'{s}_elbow_deg']) for s in ('left', 'right')) for row in rows) / len(rows), 4),
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
