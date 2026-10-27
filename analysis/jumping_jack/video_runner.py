"""python -m analysis.jumping_jack.video_runner VIDEO --model MODEL --output RESULTS"""
import argparse
import json
import subprocess
from pathlib import Path
from analysis.common.video import extract_video
from analysis.common.contract import json_safe


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('video', type=Path)
    parser.add_argument('--model', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--node', default='node')
    args = parser.parse_args()
    arrays, info = extract_video(args.video, args.model, args.output/'cache', target_fps=20, max_width=640)
    packets = args.output/'landmarks.jsonl'
    with packets.open('w', encoding='utf-8') as stream:
        for pose, t, dims in zip(arrays['poses'], arrays['times'], arrays['dims']):
            stream.write(json.dumps(dict(timestampMs=float(t)*1000, width=int(dims[0]),
                height=int(dims[1]), landmarks=json_safe(pose)), allow_nan=False)+'\n')
    (args.output/'extraction.json').write_text(json.dumps(info, ensure_ascii=False, indent=2), encoding='utf-8')
    root = Path(__file__).resolve().parents[2]
    subprocess.run([args.node, str(root/'examples/jumping_jack.mjs'), str(packets.resolve()),
                    str(args.output.resolve())], check=True)


if __name__ == '__main__':
    main()
