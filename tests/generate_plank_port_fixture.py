"""Generate local-only Python expected results from prior plank exports."""
import argparse,json
from pathlib import Path
import numpy as np
from analysis.plank.multi_rule import PlankRule
from analysis.common.contract import json_safe

p=argparse.ArgumentParser();p.add_argument('exports',nargs='+',type=Path);p.add_argument('--output',type=Path,required=True)
args=p.parse_args();args.output.mkdir(parents=True,exist_ok=True)
for root in args.exports:
    for folder in sorted(root.iterdir()):
        if not folder.is_dir() or not (folder/'predictions.csv').exists():continue
        paths=list((folder/'cache').glob('*.npz')) or list((root/'inputs'/folder.name).glob('*.npz'))
        if len(paths)!=1:raise ValueError(folder)
        rows=[];rule=PlankRule()
        with np.load(paths[0],allow_pickle=False) as a:
            for t,pose,d in zip(a['times'],a['poses'],a['dims']):
                ms=float(t)*1000
                frame=dict(timestampMs=ms,width=int(d[0]),height=int(d[1]),landmarks=json_safe(pose))
                rows.append(dict(frame=frame,expected=json_safe(rule.step(ms/1000,pose,d))))
        (args.output/(folder.name+'.json')).write_text(json.dumps(rows,allow_nan=False),encoding='utf-8')
        print(folder.name,len(rows))
