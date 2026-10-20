"""Shared frame shape. No coordinates are corrected or interpolated."""
import math
import numpy as np


def unpack_frame(frame):
    t = frame['timestampMs']
    w, h = frame['width'], frame['height']
    if isinstance(t, bool) or not isinstance(t, (int, float)) or not math.isfinite(t) or t < 0:
        raise ValueError('timestampMs must be finite and nonnegative')
    if any(isinstance(v, bool) or not isinstance(v, int) or v <= 0 for v in (w, h)):
        raise ValueError('width/height must be positive integers')
    points = frame['landmarks']
    if points == []:
        points = [[None] * 5 for _ in range(33)]
    if len(points) != 33 or any(len(p) != 5 or any(v is not None and
        (isinstance(v, bool) or not isinstance(v, (int, float))) for v in p) for p in points):
        raise ValueError('Expected 33 x 5 numeric/null landmarks')
    return float(t) / 1000, np.asarray(points, dtype=float), np.array([w, h])


def json_safe(value):
    if isinstance(value, dict):
        return {str(k): json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, np.ndarray)):
        return [json_safe(v) for v in value]
    if isinstance(value, np.generic):
        return json_safe(value.item())
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value
