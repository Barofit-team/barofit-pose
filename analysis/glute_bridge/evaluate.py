"""Analyze a local bridge video with the same public JS analyzer used by clients.

python -m analysis.glute_bridge.evaluate VIDEO OUTPUT --model pose_landmarker_full.task --ffmpeg PATH
"""
from pathlib import Path
import argparse,json,subprocess
from analysis.common.video import extract_video
from analysis.common.contract import json_safe
from .render import render

def main():
    p=argparse.ArgumentParser()
    p.add_argument('video');p.add_argument('output');p.add_argument('--model',required=True)
    p.add_argument('--ffmpeg',default='ffmpeg');p.add_argument('--node',default='node')
    a=p.parse_args();out=Path(a.output).resolve();out.mkdir(parents=True,exist_ok=True)
    arr,meta=extract_video(Path(a.video),Path(a.model),out/'cache',target_fps=20,max_width=960)
    packets=out/'landmarks.jsonl'
    with packets.open('w',encoding='utf8') as f:
        for pose,t,wh in zip(arr['poses'],arr['times'],arr['dims']):
            f.write(json.dumps(dict(timestampMs=float(t)*1000,width=int(wh[0]),height=int(wh[1]),landmarks=json_safe(pose)),allow_nan=False)+'\n')
    (out/'extraction.json').write_text(json.dumps(meta,indent=2),encoding='utf8')
    root=Path(__file__).resolve().parents[2]
    subprocess.run([a.node,str(root/'examples/glute_bridge.mjs'),str(packets),str(out/'results')],check=True)
    print(render(a.video,packets,out/'results/frames.jsonl',out/'analysis.mp4',a.ffmpeg))

if __name__=='__main__':main()
