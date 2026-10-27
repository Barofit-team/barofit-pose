"""Paired identical frames -> MediaPipe Full and MoveNet Lightning.

python -m analysis.model_comparison.extract manifest.json --output results --mediapipe model.task --movenet model.tflite
Optional --dynamic-crop adds a causal MoveNet variant following the TF Hub
MoveNet tutorial crop algorithm (OpenCV resampling, not bit-identical TF resize).
"""
import argparse,json,time,hashlib,platform
from pathlib import Path
import cv2,numpy as np,mediapipe as mp
try:
 from ai_edge_litert.interpreter import Interpreter
except ImportError:
 from tensorflow.lite import Interpreter

def dump(path,value):path.write_text(json.dumps(value,ensure_ascii=False,allow_nan=False,indent=2),encoding='utf-8')
class MoveNet:
 def __init__(self,path,dynamic=False):
  self.net=Interpreter(model_path=str(path),num_threads=4);self.net.allocate_tensors();self.i=self.net.get_input_details()[0];self.o=self.net.get_output_details()[0];self.n=int(self.i['shape'][1]);self.dynamic=dynamic;self.box=None
 def __call__(self,f):
  h,w=f.shape[:2];n=self.n;rgb=cv2.cvtColor(f,cv2.COLOR_BGR2RGB)
  if not self.dynamic:
   s=min(n/w,n/h);nw,nh=round(w*s),round(h*s);left,top=(n-nw)//2,(n-nh)//2
   x=np.zeros((n,n,3),np.uint8);x[top:top+nh,left:left+nw]=cv2.resize(rgb,(nw,nh))
  else:
   if self.box is None:self.box=((w-max(w,h))/2,(h-max(w,h))/2,max(w,h))
   bx,by,length=self.box
   mx,my=np.meshgrid(np.linspace(bx,bx+length,n,dtype=np.float32),np.linspace(by,by+length,n,dtype=np.float32))
   x=cv2.remap(rgb,mx,my,cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT)
  self.net.set_tensor(self.i['index'],x[None].astype(self.i['dtype']));self.net.invoke();a=self.net.get_tensor(self.o['index'])[0,0].astype(float)
  if not self.dynamic:
   # Undo the actual rounded resize dimensions, keeping output in original frame space.
   a[:,0]=(a[:,0]*n-top)/nh;a[:,1]=(a[:,1]*n-left)/nw
  else:
   a[:,0]=(by+a[:,0]*length)/h;a[:,1]=(bx+a[:,1]*length)/w
   p=a[:,[1,0]]*[w,h];good=a[:,2]>.2
   if (good[5] or good[6]) and (good[11] or good[12]):
    center=(p[11]+p[12])/2;torso=np.max(np.abs(p[[5,6,11,12]]-center));body=np.max(np.abs(p[good]-center));half=min(max(torso*1.9,body*1.2),max(center[0],w-center[0],center[1],h-center[1]))
    self.box=(center[0]-half,center[1]-half,half*2) if 1<half<=max(w,h)/2 else None
   else:self.box=None
  return a.tolist()

def main():
 p=argparse.ArgumentParser();p.add_argument('manifest');p.add_argument('--output',required=True);p.add_argument('--mediapipe',required=True);p.add_argument('--movenet',required=True);p.add_argument('--dynamic-crop',action='store_true');args=p.parse_args()
 root=Path(args.output);root.mkdir(parents=True,exist_ok=True);cases=json.loads(Path(args.manifest).read_text(encoding='utf-8'));cv2.setNumThreads(1)
 dump(root/'environment.json',{'platform':platform.platform(),'processor':platform.processor(),'python':platform.python_version(),'opencv':cv2.__version__,'mediapipe':mp.__version__,'sample_fps':20,'max_width':640,'movenet_threads':4,'mp_threads':'default','dynamic_crop':args.dynamic_crop,'models':{k:{'path':str(Path(v).resolve()),'sha256':hashlib.sha256(Path(v).read_bytes()).hexdigest()} for k,v in [('mediapipe',args.mediapipe),('movenet',args.movenet)]}})
 for c in cases:
  dest=root/c['id'];dest.mkdir(exist_ok=True)
  if (dest/'extraction.json').exists():continue
  opts=mp.tasks.vision.PoseLandmarkerOptions(base_options=mp.tasks.BaseOptions(model_asset_path=args.mediapipe),running_mode=mp.tasks.vision.RunningMode.VIDEO,num_poses=1,min_pose_detection_confidence=.5,min_pose_presence_confidence=.5,min_tracking_confidence=.5)
  detector=mp.tasks.vision.PoseLandmarker.create_from_options(opts);nets={'movenet':MoveNet(args.movenet)}
  if args.dynamic_crop:nets['movenet_crop']=MoveNet(args.movenet,True)
  cap=cv2.VideoCapture(c['path']);fps=cap.get(5);assert fps>0,c;end=c.get('end') or cap.get(7)/fps;idx=round(c.get('start',0)*fps);cap.set(1,idx);nxt=idx/fps;start=nxt;records=[];outputs={k:[] for k in ['mediapipe',*nets]};latency={k:[] for k in outputs}
  while True:
   ok,f=cap.read();source_t=idx/fps;idx+=1
   if not ok or source_t>=end:break
   if source_t+1e-7<nxt:continue
   nxt+=.05;h,w=f.shape[:2];f=cv2.resize(f,(min(w,640),round(h*min(w,640)/w)));h,w=f.shape[:2];t=round((source_t-start)*1000)
   meta={'timestampMs':t,'sourceTime':source_t,'frameIndex':idx-1,'width':w,'height':h};records.append(meta)
   st=time.perf_counter();r=detector.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB,data=cv2.cvtColor(f,cv2.COLOR_BGR2RGB)),t);latency['mediapipe'].append((time.perf_counter()-st)*1000)
   landmarks=[[a.x,a.y,a.z,a.visibility,a.presence] for a in r.pose_landmarks[0]] if r.pose_landmarks else []
   outputs['mediapipe'].append({**meta,'landmarks':landmarks})
   for name,net in nets.items():
    st=time.perf_counter();points=net(f);latency[name].append((time.perf_counter()-st)*1000);outputs[name].append({**meta,'keypoints':points})
  cap.release();detector.close()
  for k,rows in outputs.items():(dest/f'{k}_input.jsonl').write_text('\n'.join(json.dumps(row,allow_nan=False) for row in rows),encoding='utf-8')
  info={'case':c,'frames':len(records),'source_fps':fps,'source_sha256':hashlib.sha256(Path(c['path']).read_bytes()).hexdigest(),'latency_ms':latency,'timing_scope':'per-frame preprocessing + inference + coordinate conversion; decode/shared resize excluded; first 10 frames excluded only from reported statistics'};dump(dest/'extraction.json',info)
  print(c['id'],len(records),{k:round(float(np.median(v[10:])),2) for k,v in latency.items()},flush=True)
if __name__=='__main__':main()
