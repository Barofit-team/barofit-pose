"""Experimental video review, not an accuracy benchmark.

python -m examples.bird_dog_video clip.mp4 --model pose.task --output results/bird
"""
import argparse
import json
import subprocess
from pathlib import Path
import numpy as np
from analysis.common.video import extract_video
from analysis.common.contract import json_safe
from analysis.bird_dog import BirdDogAnalyzer


def analyze(video, model, output, start=0.0, end=None, ffmpeg=None, warmup_start=None):
    import cv2
    if warmup_start is not None and (warmup_start < 0 or warmup_start > start):
        raise ValueError("warmup_start must be between zero and start")
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    arrays, info = extract_video(video, model, output/"cache", target_fps=15)
    indices = [i for i,t in enumerate(arrays["times"]) if t>=start and (end is None or t<end)]
    if not indices:
        raise ValueError("No frames in the requested time interval")
    analyzer = BirdDogAnalyzer()
    results = []
    feed_indices=[i for i,t in enumerate(arrays["times"])
                  if t >= (start if warmup_start is None else warmup_start)
                  and (end is None or t<end)]
    for i in feed_indices:
        d = arrays["dims"][i]
        row=analyzer.push_frame(dict(timestampMs=float(arrays["times"][i])*1000,
            width=int(d[0]), height=int(d[1]), landmarks=json_safe(arrays["poses"][i])))
        if arrays["times"][i]>=start:
            results.append(row)
    with (output/"frames.jsonl").open("w",encoding="utf8") as f:
        for row in results:
            f.write(json.dumps(row,ensure_ascii=False,allow_nan=False)+"\n")
    # Time-weighted; do not count gaps or unknown as normal.
    stats = {}
    for j,row in enumerate(results[:-1]):
        dt = (results[j+1]["timestampMs"]-row["timestampMs"])/1000
        if dt<=0 or dt>analyzer.config.max_gap_seconds:
            continue
        for key,state in row["items"].items():
            stat=stats.setdefault(key,dict(observed_seconds=0.,warning_seconds=0.,unknown_seconds=0.,
                                          not_applicable_seconds=0.,disabled_seconds=0.))
            if state in ("within_reference","warning","pending_feedback"):
                stat["observed_seconds"]+=dt
                if state=="warning":
                    stat["warning_seconds"]+=dt
            elif state == "not_applicable":
                stat["not_applicable_seconds"]+=dt
            elif state in ("disabled","not_supported"):
                stat["disabled_seconds"]+=dt
            else:
                stat["unknown_seconds"]+=dt
    for stat in stats.values():
        stat["warning_fraction_of_observed"]=(stat["warning_seconds"]/stat["observed_seconds"]
                                              if stat["observed_seconds"] else None)
    finish_events=analyzer.finish()
    summary=analyzer.summary()
    review=dict(summary=summary, source=info, start=start, end=end, warmup_start=warmup_start,
                 sampled_frames=len(results), frameItemStats=stats, finishEvents=finish_events,
                 note="Observed hold time is independent of posture quality. Warning fractions are NOT accuracy.",
                 videos_are_research_review_only=True)
    (output/"summary.json").write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding="utf8")
    (output/"review.json").write_text(json.dumps(review,ensure_ascii=False,indent=2),encoding="utf8")
    events=[event for row in results for event in row.get('events',[])]+finish_events
    (output/"events.json").write_text(json.dumps(events,ensure_ascii=False,indent=2),encoding="utf8")
    cap=cv2.VideoCapture(str(video))
    first_dim=arrays["dims"][indices[0]]
    w,h=map(int,first_dim)
    raw=output/"overlay_raw.mp4"
    # Actual sampled cadence (extractor may sample below 15fps on noninteger FPS).
    times=arrays["times"][indices]
    render_fps=1/float(np.median(np.diff(times))) if len(times)>1 else 15
    writer=cv2.VideoWriter(str(raw),cv2.VideoWriter_fourcc(*"mp4v"),render_fps,(w,h+120))
    if not writer.isOpened():
        raise RuntimeError("Video writer unavailable")
    edges=[(11,13),(13,15),(12,14),(14,16),(11,23),(12,24),(23,25),(25,27),(24,26),(26,28)]
    next_frame=0
    try:
        for i,row in zip(indices,results):
            target=int(arrays["indices"][i])
            while next_frame<target:
                if not cap.grab():
                    raise RuntimeError("Video decode failed while skipping frames")
                next_frame+=1
            ok,frame=cap.read()
            next_frame+=1
            if not ok:
                raise RuntimeError("Video seek/decode failed")
            frame=cv2.resize(frame,(w,h));p=arrays["poses"][i]
            visible=np.isfinite(p[:,[0,1,3,4]]).all(axis=1)&(p[:,3]>=.5)&(p[:,4]>=.5)
            visible&=(p[:,:2]>=0).all(axis=1)&(p[:,:2]<=1).all(axis=1)
            xy=(np.nan_to_num(p[:,:2])*[w,h]).astype(int)
            for a,b in edges:
                if visible[a] and visible[b]:
                    cv2.line(frame,tuple(xy[a]),tuple(xy[b]),(255,220,0),2)
            for k in [11,12,13,14,15,16,23,24,25,26,27,28]:
                if visible[k]:
                    cv2.circle(frame,tuple(xy[k]),3,(0,40,255),-1)
            # Posterior trunk extension is the reference, not screen horizontal.
            for shoulder,hip,ankle in [(11,23,25),(12,24,26)]:
                if visible[[shoulder,hip,ankle]].all():
                    u=xy[hip]-xy[shoulder]
                    L=np.linalg.norm(u)
                    if L>15:
                        end_point=xy[hip]+u/L*np.linalg.norm(xy[ankle]-xy[hip])
                        cv2.line(frame,tuple(xy[hip]),tuple(end_point.astype(int)),(0,255,255),2)
            panel=cv2.copyMakeBorder(frame,120,0,0,0,cv2.BORDER_CONSTANT,value=(20,20,20))
            body=row.get("body",{})
            shift=body.get("perpendicular_shift_ratio")
            detail=(f"Body perpendicular: {shift*100:.1f}% | {body.get('side')} | {row['items']['body_movement']}"
                    if shift is not None else f"Body: {row['items']['body_movement']} | ref: {row.get('referenceStatus','none')}")
            lines=[f"BIRD DOG v1 | {row['timestampMs']/1000:.2f}s | {row['movementPhase']} | COUNT {row['count']} | HOLD {row['holdSeconds']:.1f}s",
                   " / ".join(row["codes"]) or "No active warning (see item coverage)",
                   "Thigh L/R: "+" / ".join(
                       f"{row['metrics'][s]['thigh_alignment_deg']:.1f}deg"
                       if row['metrics'][s].get('thigh_alignment_deg') is not None else "unknown"
                       for s in ['left','right'])+f" | high >{analyzer.config.thigh_high_deg:g}deg | lumbar NOT measured",
                   detail+" | Knee L/R: "+" / ".join(f"{row['metrics'][s]['knee_angle_filtered_deg']:.0f}" if row['metrics'][s].get('knee_angle_filtered_deg') is not None else "?" for s in ['left','right'])]
            for k,line in enumerate(lines):
                cv2.putText(panel,line[:110],(8,22+27*k),cv2.FONT_HERSHEY_SIMPLEX,.43,(255,255,255),1)
            writer.write(panel)
    finally:
        cap.release();writer.release()
    check=cv2.VideoCapture(str(raw))
    written=int(check.get(cv2.CAP_PROP_FRAME_COUNT))
    check.release()
    if written != len(results):
        raise RuntimeError(f"Overlay frame count mismatch: {written}/{len(results)}")
    if ffmpeg:
        dest=output/"overlay.mp4"
        subprocess.run([str(ffmpeg),"-hide_banner","-loglevel","error","-y","-i",str(raw),
                        "-vf","pad=ceil(iw/2)*2:ceil(ih/2)*2","-c:v","libx264",
                        "-pix_fmt","yuv420p","-movflags","+faststart",str(dest)],check=True)
    return summary


def main():
    p=argparse.ArgumentParser()
    p.add_argument("video",type=Path)
    p.add_argument("--model",type=Path,required=True)
    p.add_argument("--output",type=Path,required=True)
    p.add_argument("--start",type=float,default=0)
    p.add_argument("--end",type=float)
    p.add_argument("--warmup-start",type=float,help="Earlier preparation input; excluded from scored/rendered interval")
    p.add_argument("--ffmpeg",type=Path,help="H.264 output for browser playback")
    a=p.parse_args()
    analyze(a.video,a.model,a.output,a.start,a.end,a.ffmpeg,a.warmup_start)
    print(a.output)


if __name__=="__main__":
    main()
