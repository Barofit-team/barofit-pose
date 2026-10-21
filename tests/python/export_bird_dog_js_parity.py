"""Emit Python reference results for JS parity, using optional NPZ caches.

Example:
  BIRD_DOG_CACHE_ROOT=<results folder>
  PYTHON_EXECUTABLE=<numpy-capable python> node --test tests/js/bird_dog.test.mjs
"""
import json
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from analysis.bird_dog.legacy_v05 import BirdDogAnalyzer, BirdDogConfig
from analysis.common.contract import json_safe
from test_bird_dog_v02 import sample


def emit(name, frames, config=None):
    engine = BirdDogAnalyzer(BirdDogConfig(**(config or {})))
    for frame in frames:
        result = engine.push_frame(frame)
        print(json.dumps(dict(case=name, config=config or {}, frame=frame, expected=result),
                         allow_nan=False, separators=(',', ':')))


def synthetic(name, config=None):
    frames = []
    for t in range(0, 4001, 50):
        extent = min(1., max(0., (t - 1000) / 600))
        if t > 2500:
            extent = max(0., 1 - (t - 2500) / 600)
        frame = sample(t, extent, high='high' in name,
                       body_shift=40. if 'shift' in name and t > 1000 else 0.)
        if 'hidden' in name:
            frame['landmarks'][25] = [None] * 5
        if 'low_confidence' in name and 1500 <= t < 2200:
            for i in (11, 13, 15, 23, 25, 27):
                frame['landmarks'][i][3] = .2
        if 'mirror' in name:
            for row in frame['landmarks']:
                if row[0] is not None:
                    row[0] = 1 - row[0]
        if 'missing' in name and 1500 <= t < 1800:
            frame['landmarks'] = []
        if 'gap' in name and 1400 <= t < 2000:
            continue
        if 'size' in name and t >= 2000:
            frame['width'] //= 2
            frame['height'] //= 2
        frames.append(frame)
    emit(name, frames, config)


for name in ['neutral', 'high', 'shift', 'high_hidden', 'high_mirror',
             'high_missing', 'high_gap', 'high_size', 'low_confidence']:
    synthetic(name)
synthetic('camera_roll', {'camera_roll_deg': 12.})

cache_root = os.environ.get('BIRD_DOG_CACHE_ROOT')
if cache_root:
    import numpy as np
    for path in sorted(Path(cache_root).glob('*/cache/*.npz')):
        data = np.load(path)
        frames = [json_safe(dict(timestampMs=float(t)*1000, width=int(dims[0]),
                                height=int(dims[1]), landmarks=pose))
                  for t, dims, pose in zip(data['times'], data['dims'], data['poses'])]
        emit(path.parent.parent.name, frames)
