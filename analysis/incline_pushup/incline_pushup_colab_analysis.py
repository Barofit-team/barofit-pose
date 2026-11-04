# Colab에서 이 파일의 전체 내용을 하나의 코드 셀에 붙여 넣고 실행하세요.
import sys, subprocess, json, csv, shutil, zipfile, urllib.request
from pathlib import Path
from datetime import datetime

try:
    import cv2, mediapipe as mp, numpy as np
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', '-q',
                           'mediapipe>=0.10.20', 'opencv-python-headless', 'pillow', 'numpy'])
    import cv2, mediapipe as mp, numpy as np
    from PIL import Image, ImageDraw, ImageFont
from IPython.display import display, Image as IPyImage
from google.colab import drive

drive.mount('/content/drive')
BASE = Path('/content/drive/MyDrive')
ZIP_NAME = 'incline_pushup_REHAB24_6_Ex3_1plus4.zip'
ZIP_PATH = BASE / ZIP_NAME
if not ZIP_PATH.is_file():
    matches = list(BASE.rglob(ZIP_NAME))
    if len(matches) != 1:
        raise FileNotFoundError(f'MyDrive에서 {ZIP_NAME} 파일을 찾지 못했습니다. 발견: {matches}')
    ZIP_PATH = matches[0]
RUN = BASE / 'Barofit_Results' / ('incline_pushup_' + datetime.now().strftime('%Y%m%d_%H%M%S'))
DATA = RUN / 'input'
DATA.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(ZIP_PATH) as z:
    if z.testzip() is not None:
        raise RuntimeError('ZIP 손상: 다시 다운로드해 주세요.')
    for info in z.infolist():
        destination = (DATA / info.filename).resolve()
        if not destination.is_relative_to(DATA.resolve()):
            raise ValueError('ZIP 안에 잘못된 경로가 있습니다.')
        z.extract(info, DATA)
manifest = json.loads((DATA / 'manifest.json').read_text(encoding='utf8'))
reference = [r for r in manifest if r['correctness'] == 1]
errors = [r for r in manifest if r['correctness'] == 0]
if len(reference) != 1 or len(errors) != 4:
    raise ValueError(f'라벨 개수 오류: 정자세={len(reference)}, 오류={len(errors)}')
print('ZIP:', ZIP_PATH)
print('결과 저장:', RUN)
print('원본 라벨: 정자세 1회, 오류 자세 4회')

MODEL = Path('/content/pose_landmarker_full.task')
if not MODEL.is_file():
    urllib.request.urlretrieve(
        'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
        MODEL)
options = mp.tasks.vision.PoseLandmarkerOptions(
    base_options=mp.tasks.BaseOptions(model_asset_path=str(MODEL)),
    running_mode=mp.tasks.vision.RunningMode.VIDEO, num_poses=1,
    min_pose_detection_confidence=0.5, min_pose_presence_confidence=0.5,
    min_tracking_confidence=0.5)
# MediaPipe Pose Landmarker 좌우 어깨/팔꿈치/손목/골반/무릎/발목.
SIDES = {'left': (11, 13, 15, 23, 25, 27),
         'right': (12, 14, 16, 24, 26, 28)}
CONNECTIONS = [(11, 13), (13, 15), (12, 14), (14, 16),
               (11, 12), (11, 23), (12, 24), (23, 24),
               (23, 25), (25, 27), (24, 26), (26, 28)]

def angle(a, b, c):
    a, b, c = np.asarray(a), np.asarray(b), np.asarray(c)
    u, v = a - b, c - b
    if np.linalg.norm(u) < 1e-6 or np.linalg.norm(v) < 1e-6:
        return float('nan')
    return float(np.degrees(np.arccos(np.clip(np.dot(u, v) / (
        np.linalg.norm(u) * np.linalg.norm(v)), -1, 1))))

def read_pose(row):
    cap = cv2.VideoCapture(str(DATA / row['filename']))
    if not cap.isOpened():
        raise RuntimeError(f"동영상 열기 실패: {row['filename']}")
    fps = cap.get(cv2.CAP_PROP_FPS)
    if fps <= 0:
        cap.release()
        raise ValueError('FPS 정보를 읽지 못했습니다.')
    frames, poses = [], []
    try:
        with mp.tasks.vision.PoseLandmarker.create_from_options(options) as detector:
            idx = 0
            while True:
                ok, bgr = cap.read()
                if not ok:
                    break
                h, w = bgr.shape[:2]
                if w > 960:
                    bgr = cv2.resize(bgr, (960, round(h * 960 / w)))
                rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
                ts = max(idx, round(idx * 1000 / fps))
                result = detector.detect_for_video(
                    mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), ts)
                if result.pose_landmarks:
                    p = np.array([[q.x, q.y, q.visibility] for q in result.pose_landmarks[0]])
                else:
                    p = np.full((33, 3), np.nan)
                frames.append(rgb)
                poses.append(p)
                idx += 1
    finally:
        cap.release()
    if not frames:
        raise RuntimeError(f"빈 동영상: {row['filename']}")
    poses = np.stack(poses)
    quality = {side: float(np.nanmean(poses[:, list(ids), 2]))
               for side, ids in SIDES.items()}
    side = max(quality, key=lambda key: -1 if np.isnan(quality[key]) else quality[key])
    vals = []
    for p in poses:
        shoulder, elbow, wrist, hip, knee, ankle = SIDES[side]
        needed = p[[shoulder, elbow, wrist, hip, ankle]]
        if not np.isfinite(needed).all() or np.min(needed[:, 2]) < 0.5:
            vals.append((float('nan'), float('nan')))
        else:
            vals.append((angle(p[shoulder, :2], p[elbow, :2], p[wrist, :2]),
                         angle(p[shoulder, :2], p[hip, :2], p[ankle, :2])))
    vals = np.asarray(vals)
    return {'row': row, 'frames': frames, 'poses': poses, 'side': side,
            'elbows': vals[:, 0], 'bodies': vals[:, 1]}

records = [read_pose(row) for row in manifest]
ref = next(rec for rec in records if rec['row']['correctness'] == 1)
bads = [rec for rec in records if rec['row']['correctness'] == 0]

def count_reps(elbow_angles, fps):
    """팔꿈치 굽힘 후 복귀가 관측된 시점에 1회를 더합니다."""
    angles = np.asarray(elbow_angles, dtype=float)
    n = len(angles)
    counts = np.zeros(n, dtype=int)
    phases = ['관절 미인식'] * n
    valid = np.isfinite(angles)
    if valid.sum() < max(6, int(n * 0.5)):
        return counts, phases, [], 'tracking_unavailable'

    interpolated = np.interp(np.arange(n), np.flatnonzero(valid), angles[valid])
    padded = np.pad(interpolated, (2, 2), mode='edge')
    smooth = np.array([np.median(padded[i:i+5]) for i in range(n)])
    low, high = np.percentile(smooth, [15, 85])
    amplitude = high - low
    if amplitude < 18:
        phases = ['움직임 부족' if valid[i] else '관절 미인식' for i in range(n)]
        return counts, phases, [], 'insufficient_motion'

    down_threshold = low + 0.40 * amplitude
    up_threshold = low + 0.70 * amplitude
    ready = descending = False
    low_streak = high_streak = 0
    completed = []
    for i, value in enumerate(smooth):
        if not valid[i]:
            counts[i] = len(completed)
            continue
        if not ready:
            phases[i] = '시작 자세'
            if value >= up_threshold:
                ready = True
        elif not descending:
            phases[i] = '상체 내리기'
            low_streak = low_streak + 1 if value <= down_threshold else 0
            if low_streak >= 2:
                descending = True
                high_streak = 0
        else:
            phases[i] = '밀어 올리기'
            high_streak = high_streak + 1 if value >= up_threshold else 0
            if high_streak >= 2 and (not completed or i - completed[-1] >= round(0.6 * fps)):
                completed.append(i)
                descending = False
                low_streak = 0
                phases[i] = '1회 완료'
        counts[i] = len(completed)
    return counts, phases, completed, 'ok'

for record in records:
    row_fps = record['row'].get('fps_output', 15)
    counts, phases, events, status = count_reps(record['elbows'], row_fps)
    record.update(counts=counts, phases=phases, count_events=events, count_status=status)

def median(v):
    v = v[np.isfinite(v)]
    return float(np.median(v)) if len(v) else float('nan')

def minimum(v):
    v = v[np.isfinite(v)]
    return float(np.percentile(v, 10)) if len(v) >= 5 else (float(np.min(v)) if len(v) else float('nan'))

def coverage(rec):
    return float(np.mean(np.isfinite(rec['elbows']) & np.isfinite(rec['bodies'])))

def feedback(rec):
    if coverage(rec) < 0.50 or coverage(ref) < 0.50:
        return '관절 인식이 불안정합니다. 측면에서 전신이 보이게 촬영하세요.'
    e, er = minimum(rec['elbows']), minimum(ref['elbows'])
    b = float(np.nanpercentile(rec['bodies'], 10))
    br = float(np.nanpercentile(ref['bodies'], 10))
    messages = []
    if np.isfinite(e) and np.isfinite(er) and e > er + 7:
        messages.append('기준보다 팔꿈치가 덜 굽혀졌습니다. 몸을 조금 더 낮춰보세요.')
    if np.isfinite(b) and np.isfinite(br) and b < br - 12:
        messages.append('몸통 정렬이 흔들립니다. 복부에 힘을 주고 몸을 곧게 유지하세요.')
    if messages:
        return ' '.join(messages)
    jumps = np.abs(np.diff(rec['elbows']))
    if np.isfinite(jumps).any() and np.nanmax(jumps) > 45:
        return '팔꿈치 추정값이 급격히 바뀝니다. 팔과 손이 가려지지 않게 촬영하세요.'
    return '원본 오류 라벨입니다. 손 위치와 몸통 정렬을 확인하며 천천히 반복하세요.'

def live_guidance(rec, idx):
    phase = rec['phases'][min(idx, len(rec['phases']) - 1)]
    if phase == '관절 미인식':
        return '전신과 양팔이 화면에 보이도록 위치를 조정하세요.'
    if phase == '움직임 부족':
        return '팔꿈치를 굽혀 상체를 내린 뒤 다시 밀어 올리세요.'
    if phase == '상체 내리기':
        return '팔꿈치를 굽혀 가슴을 테이블 쪽으로 천천히 내리세요.'
    if phase == '밀어 올리기':
        return '몸통을 곧게 유지하며 팔로 다시 밀어 올리세요.'
    if phase == '1회 완료':
        return '1회 완료했습니다. 시작 자세로 돌아오세요.'
    return '손을 테이블에 짚고 몸통을 곧게 편 상태에서 시작하세요.'

font_path = next((p for p in [
    '/usr/share/fonts/truetype/nanum/NanumGothic.ttf',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'] if Path(p).exists()), None)
if font_path is None:
    subprocess.run(['apt-get', 'update', '-qq'], check=True, stdout=subprocess.DEVNULL)
    subprocess.run(['apt-get', 'install', '-y', '-qq', 'fonts-nanum'],
                   check=True, stdout=subprocess.DEVNULL)
    font_path = '/usr/share/fonts/truetype/nanum/NanumGothic.ttf'
FONT = ImageFont.truetype(font_path, 22)
SMALL = ImageFont.truetype(font_path, 17)

def panel(rec, idx, title, note):
    frame = rec['frames'][min(idx, len(rec['frames']) - 1)]
    pose = rec['poses'][min(idx, len(rec['poses']) - 1)]
    img = Image.fromarray(frame).resize((640, 360))
    canvas = Image.new('RGB', (640, 600), '#102030')
    canvas.paste(img, (0, 38))
    draw = ImageDraw.Draw(canvas)
    def point(j):
        x, y, v = pose[j]
        return (int(x * 640), int(y * 360 + 38)) if np.isfinite([x, y, v]).all() and v >= 0.5 else None
    for a, b in CONNECTIONS:
        aa, bb = point(a), point(b)
        if aa is not None and bb is not None:
            draw.line([aa, bb], fill='#36e0bd', width=4)
            draw.ellipse((aa[0]-3, aa[1]-3, aa[0]+3, aa[1]+3), fill='#ffd35c')
    draw.text((15, 5), title, font=FONT, fill='white')
    count = int(rec['counts'][idx])
    phase = rec['phases'][idx]
    draw.text((15, 404), f"운동 횟수: {count}회  |  단계: {phase}  |  {idx/rec['row'].get('fps_output', 15):.1f}초", font=SMALL, fill='white')
    draw.text((15, 429), f"원본 라벨: {'정자세' if rec['row']['correctness'] else '오류'} (주석 회차 1개)", font=SMALL, fill='white')
    current = '현재 안내: ' + live_guidance(rec, idx)
    for line_no, line in enumerate([current[i:i+34] for i in range(0, len(current), 34)][:2]):
        draw.text((15, 460 + line_no * 23), line, font=SMALL, fill='#ffcc77')
    recent = '최근 회차: ' + (('기준 동작 1회 완료.' if rec['row']['correctness'] else note)
                             if count else '아직 완료된 동작이 없습니다.')
    for line_no, line in enumerate([recent[i:i+34] for i in range(0, len(recent), 34)][:3]):
        draw.text((15, 517 + line_no * 23), line, font=SMALL, fill='#b5e8e1')
    return canvas

out_rows = []
for bad in bads:
    name = Path(bad['row']['filename']).stem
    note = feedback(bad)
    out_rows.append({'source_video': bad['row']['source_video'],
        'reference_rep': ref['row']['repetition_number'],
        'error_rep': bad['row']['repetition_number'],
        'source_correctness': bad['row']['correctness'],
        'annotated_repetitions': 1,
        'reference_detected_count': int(ref['counts'][-1]),
        'error_detected_count': int(bad['counts'][-1]),
        'reference_count_status': ref['count_status'],
        'error_count_status': bad['count_status'],
        'reference_elbow_low_deg': round(minimum(ref['elbows']), 1),
        'error_elbow_low_deg': round(minimum(bad['elbows']), 1),
        'reference_body_median_deg': round(median(ref['bodies']), 1),
        'error_body_median_deg': round(median(bad['bodies']), 1),
        'reference_body_low_deg': round(float(np.nanpercentile(ref['bodies'], 10)), 1),
        'error_body_low_deg': round(float(np.nanpercentile(bad['bodies'], 10)), 1),
        'tracking_fraction': round(coverage(bad), 2), 'suggested_feedback': note})
    gifs = []
    n = max(len(ref['frames']), len(bad['frames']))
    for step in range(0, n, 2):
        ia = min(len(ref['frames']) - 1, round(step * len(ref['frames']) / n))
        ib = min(len(bad['frames']) - 1, round(step * len(bad['frames']) / n))
        left = panel(ref, ia, '정자세 주석 구간', '기준 영상')
        right = panel(bad, ib, f"오류 주석 구간 {bad['row']['repetition_number']}", note)
        combined = Image.new('RGB', (1280, 600), '#102030')
        combined.paste(left, (0, 0)); combined.paste(right, (640, 0))
        gifs.append(combined)
    output = RUN / f'compare_{name}.gif'
    gifs[0].save(output, save_all=True, append_images=gifs[1:], duration=133, loop=0, optimize=False)
    print('\n생성:', output.name, '| 자동 감지', int(bad['counts'][-1]), '회 |', note)
    display(IPyImage(filename=str(output)))
with open(RUN / 'analysis.csv', 'w', encoding='utf-8-sig', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=out_rows[0].keys())
    writer.writeheader(); writer.writerows(out_rows)
shutil.copy2(DATA / 'manifest.json', RUN / 'source_manifest.json')
print('\n완료: 운동 횟수와 피드백을 표시한 비교 GIF 4개, analysis.csv, source_manifest.json')
print('원본 주석상 각 영상은 1회입니다. 자동 감지 횟수는 팔꿈치 굽힘과 복귀로 계산했습니다.')
print('피드백은 관절 각도의 탐색적 규칙이며, 원본 데이터의 오류 유형 주석이 아닙니다.')
print('결과 폴더:', RUN)
