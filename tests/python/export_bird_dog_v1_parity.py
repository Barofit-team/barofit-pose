"""Export reproducible input/output pairs; optional real MediaPipe NPZ manifest."""
import argparse,json,gzip,sys
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from analysis.bird_dog import BirdDogAnalyzer
from analysis.common.contract import json_safe
from test_bird_dog_v1 import sequence,put

def main():
    ap=argparse.ArgumentParser();ap.add_argument('output',type=Path);ap.add_argument('--manifest',type=Path);a=ap.parse_args()
    def high(f,t,x):
        if x==1:put(f,13,700,130);put(f,15,800,60);put(f,28,260,80)
    def missing(f,t,x):
        if t<1400:f['landmarks'][15]=[None]*5
        if t==2500:f['landmarks'][26]=[None]*5
    cases=[('normal',sequence()),('mirror',sequence(mirror=True)),('high_bent',sequence(high)),('missing',sequence(missing)),
           ('cut_start',sequence()[40:]),('gap',[f for f in sequence() if not 2000<=f['timestampMs']<3000])]
    if a.manifest:
        for c in json.loads(a.manifest.read_text('utf8')):
            arr=np.load(c['cache'])
            fs=[dict(timestampMs=float(t)*1000,width=int(d[0]),height=int(d[1]),landmarks=json_safe(p))
                for t,d,p in zip(arr['times'],arr['dims'],arr['poses'])]
            cases.append((c['id'],fs))
    count=0;a.output.parent.mkdir(parents=True,exist_ok=True)
    with gzip.open(a.output,'wt',encoding='utf8') as out:
        for name,frames in cases:
            engine=BirdDogAnalyzer()
            for frame in frames:
                out.write(json.dumps(dict(case=name,frame=frame,expected=engine.push_frame(frame)),allow_nan=False)+'\n');count+=1
            out.write(json.dumps(dict(case=name,finish=engine.finish()),allow_nan=False)+'\n')
    print(f'{len(cases)} sequences / {count} frames -> {a.output}')
if __name__=='__main__':main()
