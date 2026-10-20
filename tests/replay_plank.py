"""Optional local replay of P1..P4 or E1..E5 export folders. Does not modify originals."""
import argparse
import json
from pathlib import Path
import numpy as np
import pandas as pd
from analysis.plank.multi_rule import PlankRule

parser=argparse.ArgumentParser()
parser.add_argument('export',type=Path)
parser.add_argument('--report',type=Path)
args=parser.parse_args()
results=[]
for folder in sorted(args.export.iterdir()):
    if not folder.is_dir() or not (folder/'predictions.csv').exists():continue
    candidates=list((folder/'cache').glob('*.npz'))
    if not candidates:candidates=list((args.export/'inputs'/folder.name).glob('*.npz'))
    if len(candidates)!=1:raise ValueError(f'{folder.name}: expected one landmark cache')
    with np.load(candidates[0],allow_pickle=False) as a:
        rule=PlankRule()
        actual=pd.DataFrame([rule.step(float(t),p,d) for t,p,d in zip(a['times'],a['poses'],a['dims'])])
    expected=pd.read_csv(folder/'predictions.csv')
    assert len(actual)==len(expected),folder.name
    for col in ['hip_state','shoulder_state','knee_state','side','warning_codes']:
        assert actual[col].fillna('').tolist()==expected[col].fillna('').tolist(),(folder.name,col)
    for col in ['hip_offset_pct','shoulder_deviation_deg','knee_deg','elbow_deg']:
        assert np.allclose(pd.to_numeric(actual[col]).to_numpy(dtype=float),
                           expected[col].to_numpy(dtype=float),equal_nan=True),(folder.name,col)
    results.append(dict(case=folder.name,frames=len(actual),match=True))
if not results:raise ValueError('No comparable exports found')
if args.report:args.report.write_text(json.dumps(results,indent=2)+'\n',encoding='utf-8')
print(json.dumps(results,indent=2))
