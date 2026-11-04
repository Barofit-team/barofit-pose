"""Replay a local clip through the public JS analyzer and render sampled source frames."""
import argparse
import json
from pathlib import Path
import subprocess
import cv2
import numpy as np
from analysis.common.video import extract_video


def run(video, model, dest, ffmpeg):
    dest.mkdir(parents=True, exist_ok=True)
    data, info = extract_video(video, model, dest.parent/'cache', target_fps=30, max_width=960)
    packets = dest/'landmarks.jsonl'
    with packets.open('w') as out:
        for t, (w,h), p in zip(data['times'],data['dims'],data['poses']):
            frame=dict(timestampMs=round(t*1000),width=int(w),height=int(h),landmarks=np.where(np.isfinite(p),p,None).tolist())
            out.write(json.dumps(frame, allow_nan=False)+'\n')
    subprocess.run(['node', str(Path(__file__).with_name('replay.mjs')),str(packets),str(dest)],check=True)
    rows=[json.loads(s) for s in (dest/'frames.jsonl').read_text().splitlines()]
    (dest/'source.json').write_text(json.dumps(info,indent=2))
    lookup={int(i):j for j,i in enumerate(data['indices'])};cap=cv2.VideoCapture(str(video))
    w,h=map(int,data['dims'][0]); size=f'{w}x{h+94}'
    cmd=[ffmpeg,'-loglevel','error','-y','-f','rawvideo','-pix_fmt','bgr24','-s',size,'-r',str(info['fps']),'-i','-',
         '-vf','pad=ceil(iw/2)*2:ceil(ih/2)*2','-c:v','libx264','-pix_fmt','yuv420p','-movflags','faststart',str(dest/'analysis.mp4')]
    proc=subprocess.Popen(cmd,stdin=subprocess.PIPE);j=0
    try:
        for i in range(info['decoded_frames']):
            ok,image=cap.read()
            if not ok:raise ValueError('source decoding failed')
            j=lookup.get(i,j);r=rows[j]; image=cv2.resize(image,(w,h)); p=data['poses'][j]
            text=[]
            for side,offset,color in [('left',0,(240,205,0)),('right',1,(30,150,255))]:
                m=r['metrics'].get(side)
                if m is None:continue
                hip = 'unavailable' if m['hipLift'] is None else f"{m['hipLift']:.2f}"
                text.append(f"{side[0].upper()} knee {m['kneeForward']:.2f} hip {hip} above {m['hipAboveShoulder']:.2f}")
                for a,b in [(11,15),(11,23),(23,25),(25,27)]:
                    pts=p[[a+offset,b+offset]]
                    if np.all(np.isfinite(pts)) and np.min(pts[:,3:])>=.5:
                        xy=(pts[:,:2]*[w,h]).astype(int);cv2.line(image,tuple(xy[0]),tuple(xy[1]),color,3)
            band=np.full((94,w,3),23,np.uint8);lines=[f"{r['timestampMs']/1000:.2f}s   COUNT {r['count']}   {r['phase']}", ' | '.join(text) or 'Side view unavailable', 'Feedback: '+(' / '.join(r['codes']) or 'none')]
            for idx,line in enumerate(lines):cv2.putText(band,line,(7,23+28*idx),0,min(.55,w/1200),(240,240,240),1,cv2.LINE_AA)
            proc.stdin.write(np.vstack([band,image]).tobytes())
    finally:
        cap.release();proc.stdin.close();status=proc.wait()
    if status:raise RuntimeError('ffmpeg failed')

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('video',type=Path);parser.add_argument('model',type=Path);parser.add_argument('dest',type=Path);parser.add_argument('--ffmpeg',default='ffmpeg');args=parser.parse_args();run(**vars(args))
