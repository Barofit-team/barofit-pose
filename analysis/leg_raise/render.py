"""Render existing v2 frame results over source frames at the SOURCE frame rate.

python -m analysis.leg_raise.render VIDEO LANDMARKS_JSONL FRAMES_JSONL OUTPUT --ffmpeg PATH
"""
from pathlib import Path
import argparse,json,subprocess,math
import cv2,numpy as np

def render(video,packets,results,output,ffmpeg='ffmpeg'):
    frames=[json.loads(x) for x in Path(packets).read_text(encoding='utf8').splitlines()]
    rows=[json.loads(x) for x in Path(results).read_text(encoding='utf8').splitlines()]
    if not frames or len(frames)!=len(rows):raise ValueError('Missing or unaligned frame results')
    cap=cv2.VideoCapture(str(video));fps=cap.get(cv2.CAP_PROP_FPS)
    if not cap.isOpened() or not math.isfinite(fps) or fps<=0:raise ValueError('Cannot decode video')
    scale=min(960/cap.get(3),640/cap.get(4));w=round(cap.get(3)*scale)//2*2;h=round(cap.get(4)*scale)//2*2
    output=Path(output);output.parent.mkdir(parents=True,exist_ok=True);raw=output.with_name(output.stem+'_raw.mp4')
    header=280 if any('tempo' in r['metrics'] for r in rows) else 160
    writer=cv2.VideoWriter(str(raw),cv2.VideoWriter_fourcc(*'mp4v'),fps,(w,h+header));idx=0;n=0
    try:
        while True:
            ok,img=cap.read()
            if not ok:break
            t=n/fps*1000;n+=1
            while idx+1<len(frames) and frames[idx+1]['timestampMs']<=t:idx+=1
            f,r=frames[idx],rows[idx];img=cv2.resize(img,(w,h));panel=np.zeros((h+header,w,3),np.uint8);panel[header:]=img
            ids=r['metrics'].get('landmarkIds',[]);a=f['landmarks'];color=(235,220,20)
            def point(i):
                p=a[i]
                return None if any(p[j] is None for j in [0,1,3,4]) or min(p[3:5])<.5 else (round(p[0]*w),round(p[1]*h)+header)
            if len(a)==33 and len(ids)==4:
                for j,(u,v) in enumerate(zip(ids,ids[1:])):
                    pu,pv=point(u),point(v)
                    if pu and pv:cv2.line(panel,pu,pv,(0,220,255) if j==0 else color,2,cv2.LINE_AA)
                for i,label in zip(ids,['S','H','K','A']):
                    p=point(i)
                    if p:cv2.circle(panel,p,4,(255,255,255),-1);cv2.putText(panel,label,(p[0]+5,p[1]-5),0,.45,(20,120,240),1,cv2.LINE_AA)
            m=r['metrics'];rep=r['lastRepetition'];codes=', '.join(r['codes']) or 'no measured warning'
            lines=[f"LEG RAISE | {t/1000:.1f}s | COUNT {r['count']} | Count phase: {r['phase']} | {r['side'] or '-'}",
                   f"FEEDBACK: {codes}",
                   f"Knee {m.get('kneeDeg',0):.0f} deg | Leg elevation {m.get('legElevationDeg',0):.0f} deg | {r['tracking']}",
                   f"Last rep {rep['number'] if rep else '-'} | Rule lowering window {rep['metrics']['loweringDurationMs']/1000:.2f}s" if rep else 'Last rep: pending completed raise + lower',
                   'LOW BACK / FLOOR CONTACT: NOT MEASURED']
            if header>160:
                live=m.get('tempo',{});tempo=rep['metrics'].get('tempo') if rep else None
                lines.extend([f"LIVE TEMPO: {live.get('state','unavailable').upper()} | State {live.get('stateDurationMs',0)/1000:.2f}s",
                              f"Current confirmed pause: {live.get('pauseDurationMs',0)/1000:.2f}s (angle-based)"])
                if tempo:
                    lines.extend([f"REP TEMPO | UP moving {tempo['riseMovingMs']/1000:.2f}s | DOWN moving {tempo['lowerMovingMs']/1000:.2f}s",
                                  f"TOP hold {tempo['topHoldMs']/1000:.2f}s | Other pause {(tempo['pauseMs']-tempo['topHoldMs'])/1000:.2f}s | Uncertain {tempo['unclassifiedMs']/1000:.2f}s"])
                else:lines.extend(['REP TEMPO: pending completed raise + lower','TOP HOLD measures position, not muscle contraction'])
            for j,text in enumerate(lines):cv2.putText(panel,text,(10,23+j*29),0,min(.53,w/1500),(70,170,255) if j==1 and r['codes'] else (225,225,225),1,cv2.LINE_AA)
            writer.write(panel)
            if n==max(1,round(fps*3)):cv2.imwrite(str(output.with_suffix('.jpg')),panel)
    finally:cap.release();writer.release()
    subprocess.run([ffmpeg,'-y','-v','error','-i',str(raw),'-c:v','libx264','-crf','21','-pix_fmt','yuv420p','-movflags','+faststart',str(output)],check=True)
    return {'frames':n,'fps':fps,'durationSeconds':n/fps,'output':str(output)}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('video');p.add_argument('packets');p.add_argument('results');p.add_argument('output');p.add_argument('--ffmpeg',default='ffmpeg');a=p.parse_args()
    print(json.dumps(render(a.video,a.packets,a.results,a.output,a.ffmpeg)))
