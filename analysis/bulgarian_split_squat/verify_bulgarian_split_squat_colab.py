# Colab의 새 코드 셀에 전체를 붙여 넣어 실행합니다.
# ZIP은 Google Drive의 MyDrive 최상단에 올려 두세요.
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
    from IPython.display import HTML, display
    drive.mount('/content/drive')
    BASE = Path('/content/drive/MyDrive')
except ImportError:
    BASE = Path.cwd()

ZIP_NAME = 'barofit_bulgarian_split_squat_pilot_v1.zip'
matches = list(BASE.rglob(ZIP_NAME))
if len(matches) != 1:
    raise FileNotFoundError(f'MyDrive에 {ZIP_NAME}을 하나만 두세요. 검색 결과: {matches}')
ZIP_PATH = matches[0]
ROOT = BASE / 'BarofitResults' / 'bulgarian_split_squat'
RUN = ROOT / time.strftime('run_%Y%m%d_%H%M%S')
n = 2
while RUN.exists():
    RUN = ROOT / (time.strftime('run_%Y%m%d_%H%M%S') + f'_{n}')
    n += 1
RUN.mkdir(parents=True)
INPUT = RUN / 'input'
INPUT.mkdir()

with zipfile.ZipFile(ZIP_PATH) as archive:
    bad = archive.testzip()
    if bad:
        raise ValueError(f'ZIP 오류: {bad}')
    for entry in archive.infolist():
        target = (INPUT / entry.filename).resolve()
        if not target.is_relative_to(INPUT.resolve()):
            raise ValueError(f'안전하지 않은 ZIP 경로: {entry.filename}')
        archive.extract(entry, INPUT)
manifest = json.loads((INPUT / 'manifest.json').read_text(encoding='utf-8'))
if not manifest or any(row['posture_label'] != 'unreviewed' for row in manifest):
    raise ValueError('이 검증용 ZIP은 자세 정답/오답 라벨이 없어야 합니다.')

def digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()

for row in manifest:
    path = INPUT / row['file']
    if not path.is_file() or digest(path) != row['sha256']:
        raise ValueError(f'영상 누락 또는 해시 불일치: {path}')

MODEL = Path('/content/models/pose_landmarker_full.task')
MODEL.parent.mkdir(parents=True, exist_ok=True)
if not MODEL.is_file() or MODEL.stat().st_size < 1_000_000:
    urllib.request.urlretrieve(
        'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
        MODEL)
opts = mp.tasks.vision.PoseLandmarkerOptions(
    base_options=mp.tasks.BaseOptions(model_asset_path=str(MODEL)),
    running_mode=mp.tasks.vision.RunningMode.VIDEO,
    num_poses=1,
    min_pose_detection_confidence=0.5,
    min_pose_presence_confidence=0.5,
    min_tracking_confidence=0.5,
)
SIDES = {'left': (23, 25, 27), 'right': (24, 26, 28)}
EDGES = [(11, 12), (11, 23), (12, 24), (23, 24),
         (23, 25), (25, 27), (24, 26), (26, 28)]
SAMPLE_FPS = 8

def joint_angle(a, b, c):
    u, v = a - b, c - b
    denom = np.linalg.norm(u) * np.linalg.norm(v)
    if denom < 1e-8:
        return np.nan
    return float(np.degrees(np.arccos(np.clip(np.dot(u, v) / denom, -1, 1))))

def extract(path):
    cap = cv2.VideoCapture(str(path))
    fps = cap.get(cv2.CAP_PROP_FPS)
    if not cap.isOpened() or fps <= 0:
        cap.release()
        raise RuntimeError(f'영상 열기 또는 FPS 오류: {path}')
    frames, poses, times = [], [], []
    index, next_t, previous_ms = 0, 0.0, -1
    try:
        with mp.tasks.vision.PoseLandmarker.create_from_options(opts) as detector:
            while True:
                ok, bgr = cap.read()
                if not ok:
                    break
                t = index / fps
                if t + 1e-6 >= next_t:
                    h, w = bgr.shape[:2]
                    if w > 960:
                        bgr = cv2.resize(bgr, (960, round(h * 960 / w)))
                    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
                    ms = max(previous_ms + 1, int(round(t * 1000)))
                    previous_ms = ms
                    result = detector.detect_for_video(
                        mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), ms)
                    p = np.full((33, 3), np.nan)
                    if result.pose_landmarks:
                        p = np.array([[q.x, q.y, q.visibility]
                                      for q in result.pose_landmarks[0]])
                    frames.append(rgb)
                    poses.append(p)
                    times.append(t)
                    next_t += 1.0 / SAMPLE_FPS
                index += 1
    finally:
        cap.release()
    if not poses:
        raise RuntimeError(f'추출 프레임이 없습니다: {path}')
    poses = np.asarray(poses)
    # 두 원본은 모두 화면 오른쪽 다리가 앞발인 측면 영상입니다.
    scores = {}
    for side, (_, _, ankle) in SIDES.items():
        xs = poses[:, ankle, 0]
        vis = poses[:, ankle, 2]
        valid = np.isfinite(xs) & (vis >= 0.5)
        scores[side] = float(np.median(xs[valid])) if valid.sum() >= 5 else -1
    front = max(scores, key=scores.get)
    if scores[front] < 0:
        angles = np.full(len(poses), np.nan)
    else:
        hip, knee, ankle = SIDES[front]
        angles = np.array([
            joint_angle(p[hip, :2], p[knee, :2], p[ankle, :2])
            if np.isfinite(p[[hip, knee, ankle], :]).all()
            and np.min(p[[hip, knee, ankle], 2]) >= 0.5 else np.nan
            for p in poses
        ])
    return frames, poses, np.asarray(times), front, angles

def count_candidates(angles, times):
    valid = np.isfinite(angles)
    counts = np.zeros(len(angles), dtype=int)
    if valid.sum() < max(10, int(len(angles) * 0.45)):
        return counts, [], 'tracking_unavailable'
    signal = np.interp(np.arange(len(angles)), np.flatnonzero(valid), angles[valid])
    padded = np.pad(signal, (2, 2), mode='edge')
    smooth = np.array([np.median(padded[i:i + 5]) for i in range(len(signal))])
    low, high = np.percentile(smooth, [15, 85])
    if high - low < 25:
        return counts, [], 'motion_too_small'
    down = low + 0.40 * (high - low)
    up = low + 0.72 * (high - low)
    phase, last_event, completed = 'await_top', -100.0, []
    for i, a in enumerate(smooth):
        if not valid[i]:
            # 큰 추적 공백을 건너뛰어 가짜 회차를 만들지 않습니다.
            if i >= 4 and not valid[max(0, i-4):i+1].any():
                phase = 'await_top'
            counts[i] = len(completed)
            continue
        if phase == 'await_top' and a > up:
            phase = 'await_down'
        elif phase == 'await_down' and a < down:
            phase = 'await_return'
        elif phase == 'await_return' and a > up and times[i] - last_event >= 0.6:
            completed.append(float(times[i]))
            last_event = float(times[i])
            phase = 'await_down'
        counts[i] = len(completed)
    return counts, completed, 'candidate_only'

def skeleton_gif(frames, poses, times, angles, counts, destination):
    images = []
    for j in range(0, len(frames), 2):
        canvas = Image.fromarray(frames[j].copy())
        draw = ImageDraw.Draw(canvas)
        w, h = canvas.size
        p = poses[j]
        for a, b in EDGES:
            if np.isfinite(p[[a,b],:]).all() and min(p[a,2], p[b,2]) >= .5:
                draw.line((int(p[a,0]*w),int(p[a,1]*h),
                           int(p[b,0]*w),int(p[b,1]*h)), fill='#00f0c6',width=4)
        angle_text = f'{angles[j]:.0f} deg' if np.isfinite(angles[j]) else 'unavailable'
        draw.rectangle((0,0,w,40), fill='#102130')
        draw.text((9,7),f'COUNT CANDIDATE {counts[j]} | FRONT KNEE {angle_text} | {times[j]:.1f}s',
                  fill='white')
        images.append(canvas)
    images[0].save(destination,save_all=True,append_images=images[1:],
                   duration=250,loop=0,optimize=False)

def counted_video(source, poses, times, angles, counts, destination):
    """원본 영상 전체에 스켈레톤과 누적 횟수를 그려 H.264 MP4로 저장합니다."""
    cap = cv2.VideoCapture(str(source))
    fps = cap.get(cv2.CAP_PROP_FPS)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    if not cap.isOpened() or fps <= 0 or width <= 0 or height <= 0:
        cap.release()
        raise RuntimeError(f'영상 인코딩을 위한 원본을 열 수 없습니다: {source}')
    intermediate = destination.with_suffix('.temporary.avi')
    writer = cv2.VideoWriter(str(intermediate),
                             cv2.VideoWriter_fourcc(*'MJPG'), fps, (width, height))
    if not writer.isOpened():
        cap.release()
        raise RuntimeError('중간 영상 파일을 생성하지 못했습니다.')
    frame_number = 0
    try:
        while True:
            ok, bgr = cap.read()
            if not ok:
                break
            t = frame_number / fps
            j = max(0, min(len(times) - 1, int(np.searchsorted(times, t, side='right') - 1)))
            p = poses[j]
            for a, b in EDGES:
                if np.isfinite(p[[a, b], :]).all() and min(p[a, 2], p[b, 2]) >= 0.5:
                    pa = (int(p[a, 0] * width), int(p[a, 1] * height))
                    pb = (int(p[b, 0] * width), int(p[b, 1] * height))
                    cv2.line(bgr, pa, pb, (198, 240, 0), 3, cv2.LINE_AA)
            cv2.rectangle(bgr, (0, 0), (width, 87), (15, 32, 48), -1)
            cv2.putText(bgr, f'REP COUNT: {int(counts[j])}', (14, 40),
                        cv2.FONT_HERSHEY_SIMPLEX, 1.10, (255, 255, 255), 3, cv2.LINE_AA)
            knee = f'{angles[j]:.0f} deg' if np.isfinite(angles[j]) else 'unavailable'
            cv2.putText(bgr, f'FRONT KNEE: {knee}    TIME: {t:.1f}s',
                        (15, 69), cv2.FONT_HERSHEY_SIMPLEX, 0.52,
                        (235, 235, 235), 1, cv2.LINE_AA)
            cv2.rectangle(bgr, (0, height - 27), (width, height), (15, 32, 48), -1)
            cv2.putText(bgr, 'DEMO VIDEO  |  FORM LABEL: UNREVIEWED',
                        (12, height - 9), cv2.FONT_HERSHEY_SIMPLEX, 0.48,
                        (255, 255, 255), 1, cv2.LINE_AA)
            writer.write(bgr)
            frame_number += 1
    finally:
        cap.release()
        writer.release()
    if frame_number == 0:
        raise RuntimeError('영상에 프레임이 없습니다.')
    try:
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(intermediate),
                        '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
                        '-movflags', '+faststart', str(destination)], check=True)
    finally:
        intermediate.unlink(missing_ok=True)
    if not destination.is_file() or destination.stat().st_size == 0:
        raise RuntimeError('MP4 저장에 실패했습니다.')
    return frame_number

summary = []
for row in manifest:
    frames, poses, times, side, angles = extract(INPUT / row['file'])
    counts, events, status = count_candidates(angles, times)
    coverage = round(float(np.isfinite(angles).mean()), 3)
    name = Path(row['file']).stem
    with (RUN / f'{name}_angles.csv').open('w',encoding='utf-8',newline='') as f:
        writer = csv.writer(f)
        writer.writerow(['time_s','front_knee_deg','count_candidate','tracking'])
        for t,a,c in zip(times,angles,counts):
            writer.writerow([round(float(t),3),round(float(a),2) if np.isfinite(a) else '',
                             int(c),'tracking' if np.isfinite(a) else 'tracking_unavailable'])
    gif_path = RUN / f'{name}_skeleton.gif'
    skeleton_gif(frames,poses,times,angles,counts,gif_path)
    video_path = RUN / f'{name}_counted.mp4'
    rendered_frames = counted_video(INPUT / row['file'], poses, times, angles,
                                    counts, video_path)
    report = {'file':row['file'],'posture_label':'unreviewed',
              'front_side':side,'tracking_coverage':coverage,
              'count_candidate':len(events),'candidate_times_s':events,
              'status':status,'mp4':video_path.name,'gif':gif_path.name,
              'rendered_frames':rendered_frames,'csv':f'{name}_angles.csv'}
    summary.append(report)
    print(json.dumps(report,ensure_ascii=False,indent=2))
    try:
        from IPython.display import HTML, display
        encoded = base64.b64encode(video_path.read_bytes()).decode('ascii')
        player = ('<video width="800" controls preload="metadata" '
                  'style="max-width:100%;display:block">'
                  f'<source src="data:video/mp4;base64,{encoded}" type="video/mp4">'
                  '</video>')
        print('아래 영상의 재생 버튼을 누르면 REP COUNT가 올라가는 모습이 보입니다.')
        display(HTML(player))
    except Exception as exc:
        print('셀 안 영상 표시가 지원되지 않습니다. 저장된 MP4를 열어 확인하세요:', video_path)
        print('표시 오류:', type(exc).__name__, str(exc))

(RUN / 'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
print('\n결과 저장:',RUN)
print('각 영상의 *_counted.mp4 파일을 열어 누적 횟수를 확인하세요.')
print('주의: 회차는 자동 감지 후보이며 정자세/오류 자세 분류 결과가 아닙니다.')
