"""Colab: run `!pip -q install mediapipe==0.10.32 opencv-python-headless scipy pandas matplotlib imageio pillow` first, then paste this entire file into the next cell."""

from __future__ import annotations

import hashlib
import json
import time
import urllib.request
import zipfile
from pathlib import Path

import cv2
import imageio.v2 as imageio
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import mediapipe as mp
import numpy as np
import pandas as pd
from PIL import Image, ImageDraw
from scipy.ndimage import median_filter
from scipy.signal import find_peaks


# Colab에서는 ZIP을 먼저 Google Drive의 MyDrive 최상단에 업로드합니다.
try:
    from google.colab import drive
    drive.mount("/content/drive")
    DRIVE_ROOT = Path("/content/drive/MyDrive")
except ImportError:
    DRIVE_ROOT = Path.cwd()

ZIP_PATH = DRIVE_ROOT / "barofit_standing_calf_raise_videos_v1.zip"
RESULT_BASE = DRIVE_ROOT / "BarofitResults" / "standing_calf_raise"
MODEL_PATH = Path("/content/models/pose_landmarker_full.task")
WORK_DIR = Path("/content/calf_raise_work")
SAMPLE_FPS = 6
GIF_FPS = 4
MAX_GIF_SECONDS = 20
VISIBILITY_MIN = 0.45
MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task"
if not ZIP_PATH.is_file():
    raise FileNotFoundError(f"ZIP이 없습니다: {ZIP_PATH}. MyDrive 최상단에 업로드하거나 ZIP_PATH를 수정하세요.")

RESULT_BASE.mkdir(parents=True, exist_ok=True)
run_name = time.strftime("run_%Y%m%d_%H%M%S")
OUT = RESULT_BASE / run_name
suffix = 2
while OUT.exists():
    OUT = RESULT_BASE / f"{run_name}_{suffix}"
    suffix += 1
OUT.mkdir(parents=True)
(OUT / "plots").mkdir()
(OUT / "gifs").mkdir()
(OUT / "previews").mkdir()
CACHE = RESULT_BASE / "pose_cache"
CACHE.mkdir(exist_ok=True)
WORK_DIR.mkdir(parents=True, exist_ok=True)


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


with zipfile.ZipFile(ZIP_PATH) as z:
    if z.testzip() is not None:
        raise ValueError("ZIP 파일 검증 실패: 다시 다운로드하여 업로드하세요.")
    base = WORK_DIR.resolve()
    for member in z.infolist():
        dest = (base / member.filename).resolve()
        if not dest.is_relative_to(base):
            raise ValueError(f"ZIP 내부의 안전하지 않은 경로: {member.filename}")
        if member.is_dir():
            dest.mkdir(parents=True, exist_ok=True)
        else:
            dest.parent.mkdir(parents=True, exist_ok=True)
            if not dest.exists() or dest.stat().st_size != member.file_size:
                with z.open(member) as src, open(dest, "wb") as dst:
                    while chunk := src.read(1024 * 1024):
                        dst.write(chunk)

metadata_paths = list(WORK_DIR.rglob("metadata.json"))
if len(metadata_paths) != 1:
    raise ValueError("metadata.json을 정확히 하나 찾지 못했습니다.")
ROOT = metadata_paths[0].parent
records = json.loads(metadata_paths[0].read_text(encoding="utf-8"))
for row in records:
    row["path"] = str(ROOT / row["file"])
    if sha256(row["path"]) != row["sha256"]:
        raise ValueError(f"원본 영상 해시 불일치: {row['file']}")
print("확인된 영상:")
for i, row in enumerate(records, 1):
    print(f"{i}. {row['file']} | {row['variant']} | {row['duration_seconds']}초 | 전신 분석={row['pose_eligible']}")
print("결과 저장 위치:", OUT)

MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
if not MODEL_PATH.is_file() or MODEL_PATH.stat().st_size < 1_000_000:
    urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)
if MODEL_PATH.stat().st_size < 1_000_000:
    raise RuntimeError("MediaPipe 모델 다운로드에 실패했습니다.")
MODEL_SHA = sha256(MODEL_PATH)

# MediaPipe Pose Landmarker의 33개 관절 인덱스
EDGES = [(11, 12), (11, 23), (12, 24), (23, 24),
         (23, 25), (25, 27), (27, 29), (29, 31),
         (24, 26), (26, 28), (28, 30), (30, 32)]


def pose_for_video(path):
    key = hashlib.sha256(f"{sha256(path)}|{MODEL_SHA}|{SAMPLE_FPS}|{mp.__version__}".encode()).hexdigest()
    cached = CACHE / f"{key}.npz"
    if cached.exists():
        with np.load(cached, allow_pickle=False) as f:
            return {name: f[name] for name in f.files}
    cap = cv2.VideoCapture(str(path))
    fps = cap.get(cv2.CAP_PROP_FPS)
    if not cap.isOpened() or fps <= 0:
        cap.release()
        raise RuntimeError(f"영상 디코딩 실패: {path}")
    options = mp.tasks.vision.PoseLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=str(MODEL_PATH)),
        running_mode=mp.tasks.vision.RunningMode.VIDEO,
        num_poses=1, min_pose_detection_confidence=0.5,
        min_pose_presence_confidence=0.5, min_tracking_confidence=0.5,
    )
    poses, indices, times = [], [], []
    frame_idx, next_sample, last_ms = 0, 0.0, -1
    try:
        with mp.tasks.vision.PoseLandmarker.create_from_options(options) as landmarker:
            while True:
                ok, frame = cap.read()
                if not ok:
                    break
                t = frame_idx / fps
                if t + 1e-8 >= next_sample:
                    h, w = frame.shape[:2]
                    factor = min(1.0, 960.0 / max(h, w))
                    if factor < 1:
                        frame = cv2.resize(frame, (round(w * factor), round(h * factor)))
                    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                    ts_ms = max(last_ms + 1, round(t * 1000))
                    last_ms = ts_ms
                    result = landmarker.detect_for_video(
                        mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), ts_ms)
                    landmarks = np.full((33, 4), np.nan, dtype=np.float32)
                    if result.pose_landmarks:
                        for j, lm in enumerate(result.pose_landmarks[0]):
                            landmarks[j] = [lm.x, lm.y, lm.visibility, lm.presence]
                    poses.append(landmarks)
                    indices.append(frame_idx)
                    times.append(t)
                    next_sample += 1 / SAMPLE_FPS
                frame_idx += 1
    finally:
        cap.release()
    if not poses:
        raise RuntimeError(f"샘플링된 프레임이 없습니다: {path}")
    arrays = dict(poses=np.asarray(poses), indices=np.asarray(indices),
                  times=np.asarray(times), source_fps=np.asarray(fps))
    np.savez_compressed(cached, **arrays)
    return arrays


def points(poses, ids):
    pts = poses[:, ids, :2]
    conf = poses[:, ids, 2:4]
    valid = np.isfinite(pts).all(axis=2) & np.isfinite(conf).all(axis=2) & (conf.min(axis=2) >= VISIBILITY_MIN)
    clean = np.where(valid[..., None], pts, np.nan)
    count = valid.sum(axis=1)
    avg = np.nansum(clean, axis=1) / np.maximum(count[:, None], 1)
    avg[count == 0] = np.nan
    return avg


def angle(a, b, c):
    u, v = a - b, c - b
    cosine = np.sum(u * v, axis=1) / (np.linalg.norm(u, axis=1) * np.linalg.norm(v, axis=1) + 1e-9)
    return np.degrees(np.arccos(np.clip(cosine, -1, 1)))


def clean_series(values, max_gap=2):
    values = np.asarray(values, dtype=float).copy()
    valid = np.flatnonzero(np.isfinite(values))
    if len(valid) < 3:
        return values
    for left, right in zip(valid[:-1], valid[1:]):
        if 1 < right - left <= max_gap + 1:
            values[left + 1:right] = np.interp(np.arange(left + 1, right), [left, right], [values[left], values[right]])
    return values


def segments(mask):
    start = None
    for i, good in enumerate(list(mask) + [False]):
        if good and start is None:
            start = i
        elif not good and start is not None:
            yield start, i
            start = None


def measure(arrays):
    p = arrays["poses"]
    hip, toe = points(p, [23, 24]), points(p, [31, 32])
    shoulder, heel = points(p, [11, 12]), points(p, [29, 30])
    knee_l = angle(points(p, [23]), points(p, [25]), points(p, [27]))
    knee_r = angle(points(p, [24]), points(p, [26]), points(p, [28]))
    knees = np.vstack([knee_l, knee_r]).T
    knee = np.full(len(p), np.nan)
    valid_k = np.isfinite(knees).any(axis=1)
    knee[valid_k] = np.nanmean(knees[valid_k], axis=1)

    # 기준 길이는 영상 전체에서 고정해 카메라 움직임과 화면상의 체격 차이를 줄입니다.
    body_lengths = toe[:, 1] - shoulder[:, 1]
    body_lengths = body_lengths[np.isfinite(body_lengths) & (body_lengths > 0.15)]
    if not len(body_lengths):
        raise RuntimeError("어깨와 발끝이 함께 보이는 프레임이 부족합니다.")
    scale = float(np.median(body_lengths))
    rise = (toe[:, 1] - hip[:, 1]) / scale
    heel_to_toe = (toe[:, 1] - heel[:, 1]) / scale
    return dict(rise=rise, heel_to_toe=heel_to_toe, knee_angle=knee,
                visible_ratio=float(np.isfinite(rise).mean()), scale=scale)


def count_candidates(signal, times, min_prominence=0.025, median_width=3):
    # 이 값은 관찰 후보일 뿐 정자세 횟수나 의학적 평가가 아닙니다.
    x = clean_series(signal)
    smooth = np.full_like(x, np.nan)
    fps = 1 / np.median(np.diff(times)) if len(times) > 1 else SAMPLE_FPS
    min_len = max(7, int(round(fps * 1.2)))
    peaks_all = []
    for begin, end in segments(np.isfinite(x)):
        if end - begin < min_len:
            continue
        y = median_filter(x[begin:end], size=median_width, mode="nearest")
        smooth[begin:end] = y
        spread = float(np.percentile(y, 90) - np.percentile(y, 10))
        if float(np.max(y) - np.min(y)) < min_prominence:
            continue
        threshold = max(min_prominence, spread * 0.25)
        peaks, properties = find_peaks(
            y, prominence=threshold,
            distance=max(3, round(fps * 0.65)),
            width=max(1, round(fps * 0.12)),
        )
        for j, peak in enumerate(peaks):
            k = begin + peak
            if y[peak] >= np.percentile(y, 15) + threshold * 0.8:
                peaks_all.append((k, float(properties["prominences"][j])))
    return smooth, peaks_all


def draw_plot(row, arrays, measurements, smooth, peaks, count_source, destination):
    t = arrays["times"]
    fig, axs = plt.subplots(3, 1, figsize=(11, 8), sharex=True)
    axs[0].plot(t, measurements["rise"], color="#a5b4fc", alpha=.55, label="raw hip-to-toe rise")
    if count_source == "body_rise_relative":
        axs[0].plot(t, smooth, color="#4338ca", lw=2, label="smoothed / count signal")
    if peaks:
        ix = np.array([p[0] for p in peaks])
        if count_source == "body_rise_relative":
            axs[0].scatter(t[ix], smooth[ix], c="tomato", s=30, label=f"count candidates: {len(ix)}")
    axs[0].set_ylabel("relative rise")
    axs[0].legend(loc="best")
    axs[1].plot(t, measurements["heel_to_toe"], color="#059669")
    if count_source == "heel_to_toe_proxy":
        axs[1].plot(t, smooth, color="#047857", lw=2, label="count signal")
        if peaks:
            axs[1].scatter(t[ix], smooth[ix], c="tomato", s=30, label=f"count candidates: {len(ix)}")
        axs[1].legend(loc="best")
    axs[1].set_ylabel("heel-to-toe proxy")
    axs[2].plot(t, measurements["knee_angle"], color="#d97706")
    axs[2].set_ylabel("knee angle (degrees)")
    axs[2].set_xlabel("time (s)")
    fig.suptitle(f"{Path(row['file']).name}  |  {row['variant']}\nCount signal: {count_source}; detected peaks are tentative")
    fig.tight_layout()
    fig.savefig(destination, dpi=145)
    plt.close(fig)


def draw_pose(bgr, pose):
    h, w = bgr.shape[:2]
    for a, b in EDGES:
        pa, pb = pose[a], pose[b]
        if (np.isfinite(pa).all() and np.isfinite(pb).all()
                and min(pa[2], pa[3], pb[2], pb[3]) >= VISIBILITY_MIN):
            cv2.line(bgr, (round(float(pa[0] * w)), round(float(pa[1] * h))),
                     (round(float(pb[0] * w)), round(float(pb[1] * h))), (65, 235, 125), 3)
    for j in [11, 12, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]:
        pt = pose[j]
        if np.isfinite(pt).all() and min(pt[2], pt[3]) >= VISIBILITY_MIN:
            cv2.circle(bgr, (round(float(pt[0] * w)), round(float(pt[1] * h))), 4, (255, 220, 45), -1)


def save_gif(row, arrays, peaks, target):
    cap = cv2.VideoCapture(row["path"])
    if not cap.isOpened():
        raise RuntimeError(f"GIF 원본 열기 실패: {row['path']}")
    t = arrays["times"]
    total_peaks = np.array([t[k] for k, _ in peaks], dtype=float)
    clip_length = min(MAX_GIF_SECONDS, float(t[-1]))
    if len(total_peaks) and total_peaks.min() >= MAX_GIF_SECONDS:
        clip_length = min(clip_length, max(8.0, float(total_peaks.max() - total_peaks.min() + 3)))
        start_t = max(0.0, float(total_peaks.min() - 1.5))
    else:
        start_t = 0.0
    end_t = min(float(t[-1]), start_t + clip_length)
    wanted = np.arange(start_t, end_t + 1e-6, 1 / GIF_FPS)
    frames = []
    try:
        for sec in wanted:
            nearest = int(np.argmin(np.abs(t - sec)))
            frame_num = round(float(sec) * float(arrays["source_fps"]))
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_num)
            ok, bgr = cap.read()
            if not ok:
                continue
            h, w = bgr.shape[:2]
            scale = min(1., 760 / max(h, w))
            if scale < 1:
                bgr = cv2.resize(bgr, (round(w * scale), round(h * scale)))
            draw_pose(bgr, arrays["poses"][nearest])
            panel = cv2.copyMakeBorder(bgr, 64, 46, 0, 0, cv2.BORDER_CONSTANT, value=(20, 27, 40))
            count = int(np.sum(total_peaks <= sec + 1e-6))
            cv2.putText(panel, f"CANDIDATE COUNT {count} / {len(peaks)}   {sec:.1f}s", (12, 27),
                        cv2.FONT_HERSHEY_SIMPLEX, .68, (255, 255, 255), 2)
            cv2.putText(panel, row["variant"][:40], (12, 52),
                        cv2.FONT_HERSHEY_SIMPLEX, .52, (170, 220, 255), 1)
            cv2.putText(panel, "UNREVIEWED: not a correctness label", (10, panel.shape[0] - 15),
                        cv2.FONT_HERSHEY_SIMPLEX, .52, (255, 240, 175), 1)
            frames.append(cv2.cvtColor(panel, cv2.COLOR_BGR2RGB))
    finally:
        cap.release()
    if frames:
        imageio.mimsave(target, frames, duration=1 / GIF_FPS, loop=0)


def save_preview(row, target):
    cap = cv2.VideoCapture(row["path"])
    duration = float(row["duration_seconds"])
    tiles = []
    try:
        for sec in np.linspace(0.1, max(.2, duration - .3), 6):
            cap.set(cv2.CAP_PROP_POS_MSEC, float(sec * 1000))
            ok, bgr = cap.read()
            if ok:
                im = Image.fromarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
                im.thumbnail((320, 210))
                tiles.append((sec, im.copy()))
    finally:
        cap.release()
    board = Image.new("RGB", (3 * 330, 2 * 245), "#eef2f7")
    painter = ImageDraw.Draw(board)
    for k, (sec, im) in enumerate(tiles):
        x, y = (k % 3) * 330, (k // 3) * 245
        board.paste(im, (x, y))
        painter.text((x + 8, y + 215), f"{sec:.1f}s", fill="#111827")
    board.save(target)


summaries = []
for row in records:
    stem = Path(row["file"]).stem
    print("\n분석:", stem, flush=True)
    preview = OUT / "previews" / f"{stem}.jpg"
    save_preview(row, preview)
    summary = dict(file=row["file"], variant=row["variant"],
                   posture_label="unreviewed", preview=str(preview))
    if not row["pose_eligible"]:
        summary.update(count_candidate=None, tracking_ratio=None,
                       note="발 근접 시점: 전신 관절·반복 횟수 분석에서 제외")
        summaries.append(summary)
        continue
    try:
        arrays = pose_for_video(row["path"])
        metric = measure(arrays)
        if row["variant"] == "barbell_explosive_calf_raise":
            count_source = "heel_to_toe_proxy"
            smooth, peaks = count_candidates(metric["heel_to_toe"], arrays["times"],
                                             min_prominence=0.016, median_width=1)
        else:
            count_source = "body_rise_relative"
            smooth, peaks = count_candidates(metric["rise"], arrays["times"])
        plot = OUT / "plots" / f"{stem}.png"
        gif = OUT / "gifs" / f"{stem}.gif"
        draw_plot(row, arrays, metric, smooth, peaks, count_source, plot)
        save_gif(row, arrays, peaks, gif)
        frame_data = pd.DataFrame({
            "time_s": arrays["times"], "frame_index": arrays["indices"],
            "body_rise_relative": metric["rise"], "count_signal_smoothed": smooth,
            "heel_to_toe_proxy": metric["heel_to_toe"],
            "knee_angle_degrees": metric["knee_angle"],
            "candidate_at_frame": [int(i in {k for k, _ in peaks}) for i in range(len(arrays["times"]))],
        })
        frame_data.to_csv(OUT / f"{stem}_frames.csv", index=False, encoding="utf-8-sig")
        summary.update(count_candidate=len(peaks),
                       count_signal=count_source,
                       tracking_ratio=round(metric["visible_ratio"], 3),
                       peak_times_s=[round(float(arrays["times"][k]), 2) for k, _ in peaks],
                       plot=str(plot), gif=str(gif),
                       note=(f"{count_source} 파형의 봉우리로 계산한 후보 횟수. "
                             "교대 발끝 들기·부하·가림 영향 확인 필요"))
        print(f"반복 후보: {len(peaks)} | 발끝·골반 추적 비율: {metric['visible_ratio']:.1%}")
    except Exception as error:
        summary.update(count_candidate=None, tracking_ratio=None,
                       note=f"관절 분석 불가: {type(error).__name__}: {error}")
        print(summary["note"])
    summaries.append(summary)

pd.DataFrame(summaries).to_csv(OUT / "summary.csv", index=False, encoding="utf-8-sig")
(OUT / "summary.json").write_text(json.dumps(summaries, ensure_ascii=False, indent=2), encoding="utf-8")
print("\n분석 완료. 결과:", OUT)
result_table = pd.DataFrame(summaries)[["file", "variant", "count_candidate", "tracking_ratio", "note"]]
try:
    from IPython.display import display
    display(result_table)
except ImportError:
    print(result_table.to_string(index=False))

# GIF를 코랩 셀에 바로 출력하려면 이 코드를 실행합니다.
try:
    from IPython.display import display as show, Image as NotebookImage
    for result in summaries:
        if result.get("gif") and Path(result["gif"]).exists():
            print(result["file"])
            show(NotebookImage(filename=result["gif"]))
except ImportError:
    pass
