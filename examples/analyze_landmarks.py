"""Run from repo root: python -m examples.analyze_landmarks plank clip.npz results/plank"""
from pathlib import Path
import argparse
import json
import numpy as np
from analysis.common.contract import json_safe
from analysis.plank.adapter import PlankAnalyzer
from analysis.pushup.unified_engine import predict_unified, unified_item_summary


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('exercise', choices=['pushup', 'plank'])
    parser.add_argument('input', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--side', choices=['left', 'right', 'auto'], default='auto',
                        help='Push-up batch reference only; plank chooses a side causally')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    with np.load(args.input, allow_pickle=False) as data:
        arrays = {k: data[k] for k in ['poses', 'times', 'dims', 'indices']}
    n = len(arrays['times'])
    if not n or any(len(v) != n for v in arrays.values()):
        raise ValueError('NPZ arrays must have equal, nonzero frame counts')
    if args.exercise == 'pushup':
        reference = Path(__file__).resolve().parents[1] / 'analysis/pushup/reference.json'
        model = json.loads(reference.read_text(encoding='utf-8'))
        frames, reps, audit, side = predict_unified(arrays, model, args.side)
        frames.to_csv(args.output/'frames.csv', index=False)
        reps.to_csv(args.output/'repetitions.csv', index=False)
        audit.to_csv(args.output/'motion_audit.csv', index=False)
        summary = dict(exercise='pushup', implementation='python-batch-reference', side=side,
                       count=len(reps), items=unified_item_summary(reps).to_dict('records'))
        (args.output/'summary.json').write_text(json.dumps(json_safe(summary), ensure_ascii=False,
                                                       indent=2, allow_nan=False), encoding='utf-8')
    else:
        analyzer = PlankAnalyzer()
        with (args.output/'frames.jsonl').open('w', encoding='utf-8') as out:
            for p, t, d in zip(arrays['poses'], arrays['times'], arrays['dims']):
                frame = dict(landmarks=json_safe(p), timestampMs=float(t)*1000,
                             width=int(d[0]), height=int(d[1]))
                out.write(json.dumps(analyzer.push_frame(frame), ensure_ascii=False, allow_nan=False)+'\n')
    print(f'Saved {n} frame results: {args.output}')


if __name__ == '__main__':
    main()
