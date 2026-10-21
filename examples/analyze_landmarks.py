"""Run from repo root: python -m examples.analyze_landmarks plank clip.npz results/plank"""
from pathlib import Path
import argparse
import json
import numpy as np
from analysis.common.contract import json_safe
from analysis.common.result import set_summary, set_completed, item_result
from analysis.plank.adapter import PlankAnalyzer
from analysis.bird_dog import BirdDogAnalyzer
from analysis.pushup.unified_engine import predict_unified, unified_item_summary


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('exercise', choices=['pushup', 'plank', 'bird_dog'])
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
        summary = set_summary(exercise='pushup', engineVersion='pushup-python-batch-reference',
            count=len(reps), details=dict(side=side), items={v['item']: item_result('repetition',
                v['compliant'], v['warnings'], v['unknown']) for v in unified_item_summary(reps).to_dict('records')})
        (args.output/'summary.json').write_text(json.dumps(json_safe(summary), ensure_ascii=False,
                                                       indent=2, allow_nan=False), encoding='utf-8')
        (args.output/'events.json').write_text(json.dumps([set_completed(summary,float(arrays['times'][-1])*1000)],
            ensure_ascii=False,indent=2,allow_nan=False),encoding='utf-8')
    else:
        analyzer = BirdDogAnalyzer() if args.exercise == 'bird_dog' else PlankAnalyzer()
        events = []
        with (args.output/'frames.jsonl').open('w', encoding='utf-8') as out:
            for p, t, d in zip(arrays['poses'], arrays['times'], arrays['dims']):
                frame = dict(landmarks=json_safe(p), timestampMs=float(t)*1000,
                             width=int(d[0]), height=int(d[1]))
                result = analyzer.push_frame(frame)
                events.extend(result.get('events', []))
                out.write(json.dumps(result, ensure_ascii=False, allow_nan=False)+'\n')
        events.extend(analyzer.finish())
        for name, value in [('summary.json',analyzer.summary()),('events.json',events)]:
            (args.output/name).write_text(json.dumps(value,ensure_ascii=False,indent=2,allow_nan=False),encoding='utf-8')
    print(f'Saved {n} frame results: {args.output}')


if __name__ == '__main__':
    main()
