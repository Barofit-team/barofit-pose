"""Local video -> cached MediaPipe landmarks + portable JSONL packets."""
import argparse
import json
from pathlib import Path
from analysis.common.video import extract_video
from analysis.common.contract import json_safe


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('video', type=Path)
    parser.add_argument('--model', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=Path('results/extracted'))
    args = parser.parse_args()
    arrays, info = extract_video(args.video, args.model, args.output/'cache')
    import numpy as np
    np.savez_compressed(args.output/'landmarks.npz', **arrays)
    with (args.output/'frames.jsonl').open('w', encoding='utf-8') as out:
        for pose, t, dims in zip(arrays['poses'], arrays['times'], arrays['dims']):
            packet = dict(timestampMs=float(t)*1000, width=int(dims[0]), height=int(dims[1]),
                          landmarks=json_safe(pose))
            out.write(json.dumps(packet, allow_nan=False)+'\n')
    print(f"Saved {info['sampled_frames']} frames to {args.output}")


if __name__ == '__main__':
    main()
