import {zipFiles} from './report.js';
import {SessionRecording} from './recording.js';
const $=id=>document.getElementById(id),video=$('video'),overlay=$('overlay'),ctx=overlay.getContext('2d');
const exercise=new URLSearchParams(location.search).get('exercise')==='bird_dog'?'bird_dog':'squat';
const defs={
 squat:{name:'스쿼트',module:'./exercise-modules/squat/analyzer.js',className:'SquatAnalyzer',description:'무릎 굽힘과 상체 기울기를 확인합니다. 팀원 노트북의 초기 기준을 웹으로 옮긴 실험 버전입니다.',preparation:'서 있는 자세부터 시작하세요. 한 명의 전신이 보이는 측면 구도를 사용하세요.',note:'서기 → 무릎 125° 이하 → 서기에서 1회. 더 얕은 시도는 현재 세지 않습니다.'},
 bird_dog:{name:'버드독',module:'./exercise-modules/bird_dog/analyzer.js',className:'BirdDogAnalyzer',description:'준비 → 뻗기·유지 → 복귀를 구분하고 팔·다리 정렬을 확인합니다.',preparation:'네발기기 자세부터 시작하세요. 측면에서 전신을 촬영하면 보이는 관절부터 평가합니다.',note:'한쪽을 뻗고 유지한 뒤 돌아오면 1회입니다. 자세와 횟수는 따로 기록합니다.'}
};
const def=defs[exercise],mod=await import(def.module),Analyzer=mod[def.className];
const TEXT={SQUAT_SHALLOW:'조금 더 내려갈 수 있는지 확인해 주세요. 통증이 있다면 중단하세요.',TRUNK_LEAN:'상체가 많이 기울어 보여요. 균형을 확인해 주세요.',LEG_HIGH:'뻗은 다리를 몸통과 나란히 맞춰 주세요.',KNEE_BENT:'뻗은 다리의 무릎을 펴 주세요.',BODY_MOVEMENT:'뻗은 자세를 유지하는 동안 몸통을 안정적으로 유지해 주세요.'};
const LABELS={depth:'스쿼트 깊이',trunk:'상체 기울기',left_leg_high:'왼쪽 다리 정렬',right_leg_high:'오른쪽 다리 정렬',leg_high:'다리 정렬',left_knee_bent:'왼쪽 무릎 펴기',right_knee_bent:'오른쪽 무릎 펴기',body_movement:'유지 중 몸통 움직임',same_side_pair:'반대쪽 팔·다리 조합'};
for(const [side,label] of [['left','왼쪽'],['right','오른쪽']])for(const [k,v] of Object.entries({arm_high:'팔 과상승',arm_low:'팔 높이',elbow_bent:'팔꿈치 펴기',hand_alignment:'지지 손 위치',support_knee_alignment:'지지 무릎 위치'}))LABELS[side+'_'+k]=label+' '+v;
const STATUS={within_reference:'기준 범위',warning:'확인 필요',pending_feedback:'판정 대기',pending_rep:'회차 완료 대기',tracking_unavailable:'관절 확인 필요',not_applicable:'평가 단계 아님',not_evaluated:'회차 완료 대기',unknown:'판정 보류',normal:'기준 범위',UNKNOWN:'판정 보류'};
const PHASE={bird_dog:'뻗기·유지',preparation:'준비 자세',reaching:'뻗는 중',holding:'유지 중',returning:'돌아오는 중',not_ready:'준비 자세 확인',unknown:'단계 확인 중',WAIT_STANDING:'서 있는 자세 확인',READY:'서기 / 동작 대기',LOWERED:'내려간 상태',UNOBSERVABLE:'관절 확인 필요'};
const TRACKING={tracking:'관절 추적 중',selecting_side:'관측할 쪽 확인 중',tracking_unavailable:'관절 인식 불가'};
$('exercise').value=exercise;$('title').textContent=`${def.name} · 실험`;$('exercise-label').textContent=`이번 분석 · ${def.name}`;$('description').textContent=def.description;$('preparation').textContent=def.preparation;$('count-note').textContent=def.note;$('unit').textContent='회';
const capture=document.createElement('canvas'),cg=capture.getContext('2d'),worker=new Worker('pose-worker.js');
let mode='empty',ready=false,busy=false,generation=0,file=null,objectUrl,engine,session,recording,latest=null,lastSample=-Infinity,to=0,pendingEnd=false,scheduled=false,callbackId=null,saved=true,spoken={},lastVoice=-Infinity,lastRep=null,displayCodes=[],warningMemory=new Map(),lastDisplayTime=0;
function notice(s){$('notice').hidden=!s;$('notice').textContent=s;}
function stopVoice(){window.speechSynthesis?.cancel();}
function controls(){const locked=['starting','running','paused','finishing'].includes(mode);$('start').disabled=!ready||!file||locked||busy;$('pause').disabled=!['running','paused'].includes(mode);$('pause').textContent=mode==='paused'?'다시 재생':'일시정지';$('finish').disabled=!['running','paused'].includes(mode);for(const id of ['file','from','to','record-full','exercise'])$(id).disabled=locked;$('seek').disabled=!file||locked;$('mode-label').textContent=mode.toUpperCase();}
const pointOK=p=>p?.length===5&&p.every(Number.isFinite)&&p[3]>=.5&&p[4]>=.5&&p[0]>=0&&p[0]<=1&&p[1]>=0&&p[1]<=1;
function skeleton(g,pose,side,w,h){if(!pose?.length)return;const sides=exercise==='bird_dog'?['left','right']:[side];for(const s of sides){if(!['left','right'].includes(s))continue;const ids=s==='left'?[11,13,15,23,25,27]:[12,14,16,24,26,28];g.strokeStyle=s==='left'?'#50edcd':'#ffb77c';g.fillStyle=g.strokeStyle;g.lineWidth=3;for(const [a,b] of [[0,1],[1,2],[0,3],[3,4],[4,5]]){const p=pose[ids[a]],q=pose[ids[b]];if(!pointOK(p)||!pointOK(q))continue;g.beginPath();g.moveTo(p[0]*w,p[1]*h);g.lineTo(q[0]*w,q[1]*h);g.stroke();}for(const i of ids){const p=pose[i];if(!pointOK(p))continue;g.beginPath();g.arc(p[0]*w,p[1]*h,4,0,Math.PI*2);g.fill();}}}
function paint(){ctx.clearRect(0,0,overlay.width,overlay.height);if(latest&&Math.abs(video.currentTime-latest.video_s)<.3&&$('bones').checked)skeleton(ctx,latest.landmarks,latest.side,overlay.width,overlay.height);if(recording&&mode==='running'){recording.draw(video,latest,video.currentTime,skeleton);if(recording.rec?.state==='recording'){const g=recording.ctx,c=recording.canvas;g.fillStyle='#102b29';g.fillRect(0,c.height-72,c.width,72);g.fillStyle='white';g.font='16px sans-serif';g.fillText(`${video.currentTime.toFixed(2)}s | ${exercise} EXPERIMENT | ${latest?.count??'count: N/A'}`,12,c.height-45);g.fillText(displayCodes.join(' / ')||'See item states in JSON',12,c.height-18);}}}
function codeText(c){const extra={ARM_HIGH:'팔이 몸통보다 높이 올라가 있어요. 높이를 조금 낮춰 주세요.',ARM_LOW:'편안한 범위에서 팔을 몸통과 나란히 뻗어 주세요.',ELBOW_BENT:'뻗은 팔꿈치를 편안하게 펴 주세요.',HAND_ALIGNMENT:'바닥을 짚은 손을 어깨 아래에 맞춰 주세요.',SUPPORT_KNEE_ALIGNMENT:'바닥에 댄 무릎을 골반 아래에 맞춰 주세요.',SAME_SIDE_PAIR:'서로 반대쪽 팔과 다리를 뻗어 주세요.'};return TEXT[c]??Object.entries({...TEXT,...extra}).find(([k])=>c===k||c.endsWith('_'+k))?.[1]??c;}
function clearFeedback(){lastRep=null;displayCodes=[];warningMemory.clear();lastDisplayTime=0;}
function presentation(r){
  const t=(r?.timestampMs??0)/1000;
  lastDisplayTime=t;
  for(const e of r?.events??[]){
    if(e.type==='rep.completed'&&e.depth_state){
      lastRep={rep:e.rep,status:e.depth_state,angle:e.min_knee_deg,time:t};
      if(e.depth_state==='warning')warningMemory.set('SQUAT_SHALLOW',{until:t+4,lastSeen:t,kind:'rep'});
      else warningMemory.delete('SQUAT_SHALLOW');
    }
  }
  if(r?.tracking==='tracking_unavailable')warningMemory.clear();
  else for(const code of r?.codes??[]){
    const old=warningMemory.get(code);
    warningMemory.set(code,{until:t+(code==='SQUAT_SHALLOW'?4:2),lastSeen:t,kind:old?.kind??'live'});
  }
  for(const [code,value] of warningMemory)if(value.until<t)warningMemory.delete(code);
  const current=new Set(r?.codes??[]);
  displayCodes=[...warningMemory.keys()].sort((a,b)=>Number(current.has(b))-Number(current.has(a)));
}
function metricLine(text){const p=document.createElement('p');p.className='muted';p.textContent=text;return p;}
const deg=value=>Number.isFinite(value)?`${value.toFixed(1)}°`:'측정 불가';
function update(r){
  if(r)presentation(r);
  $('count').textContent=r?.count??0;
  $('side').textContent=r?.side==='left'?'왼쪽':r?.side==='right'?'오른쪽':exercise==='bird_dog'?'좌·우':'—';
  $('tracking').textContent=TRACKING[r?.tracking]??'영상 선택 대기';
  $('phase').textContent=r?`동작 단계 · ${PHASE[r.movementPhase??r.phase??r.state]??'확인 중'}`:'동작 단계 대기';
  const codes=r?displayCodes:[];
  const held=codes.length&&!(r?.codes??[]).includes(codes[0]);
  $('feedback-title').textContent=codes.length?(held?'방금 동작에서 확인한 부분':'자세를 확인해 주세요'):'항목별 상태를 확인하세요';
  $('feedback').textContent=codes.length?codeText(codes[0]):r?.tracking==='tracking_unavailable'?'필요한 관절이 보이지 않아 평가를 보류하고 있어요.':def.preparation;
  const items=r?.items??{},active=exercise==='bird_dog'?['left_leg_high','right_leg_high','left_knee_bent','right_knee_bent','left_arm_high','right_arm_high','left_arm_low','right_arm_low','left_elbow_bent','right_elbow_bent','left_hand_alignment','right_hand_alignment','left_support_knee_alignment','right_support_knee_alignment','same_side_pair','body_movement']:['depth','trunk'];
  $('live-items').replaceChildren(...active.map(key=>{
    const el=document.createElement('div');el.className='plank-item';
    const value=items[key],status=typeof value==='object'?(value?.status??value?.state):value;
    const last=key==='depth'&&lastRep;
    el.textContent=last?`${LABELS[key]} · 직전 ${lastRep.rep}회 ${STATUS[lastRep.status]??lastRep.status} (${deg(lastRep.angle)})`:
      `${LABELS[key]} · ${STATUS[status]??'판정 대기'}`;
    el.dataset.status=last?lastRep.status:status??'pending_feedback';
    return el;
  }));
  if(exercise==='squat'&&r?.metrics){
    $('live-items').append(metricLine(`현재 무릎 ${deg(r.metrics.knee_deg)} · 상체 기울기 ${deg(r.metrics.trunk_deg)}`));
    if(lastRep)$('live-items').append(metricLine('깊이는 마지막으로 완료한 회차의 결과입니다. 현재 동작은 복귀 후 평가합니다.'));
  }else if(exercise==='bird_dog'&&r?.metrics){
    for(const [side,label] of [['left','왼쪽'],['right','오른쪽']]){
      const m=r.metrics[side];
      if(m)$('live-items').append(metricLine(`${label} · ${PHASE[m.phase]??'단계 확인 중'} · 몸통–허벅지 ${deg(m.thigh_alignment_deg)} · 무릎 ${deg(m.knee_angle_filtered_deg)}`));
    }
    $('live-items').append(metricLine(`누적 유지 ${(r.holdSeconds??0).toFixed(1)}초 · 왼다리 ${r.details?.sideCounts?.left??0}회 · 오른다리 ${r.details?.sideCounts?.right??0}회`));
    if(r.details?.body)$('live-items').append(metricLine(r.details?.body.reference_ready?
      `유지 구간 내 몸통 움직임 ${Number.isFinite(r.details?.body.perpendicular_shift_ratio)?(100*r.details?.body.perpendicular_shift_ratio).toFixed(1)+'%':'측정 불가'} · 기울기 변화 ${deg(r.details?.body.trunk_change_deg)}`:
      '뻗은 자세가 안정되면 유지 중 몸통 움직임을 확인합니다.'));
    $('live-items').append(metricLine('다리 각도는 몸통 연장선 기준입니다. 허리 곡률·회전은 판정하지 않습니다.'));
  }
  const f=session?.frames.slice(-30)??[],span=f.length>1?f.at(-1).time-f[0].time:0;
  $('fps').textContent=span>0?`${((f.length-1)/span).toFixed(1)} FPS`:'— FPS';
}
function speak(){
  if(!$('voice').checked||!window.speechSynthesis||speechSynthesis.speaking||speechSynthesis.pending)return;
  const now=performance.now()/1000;
  const code=displayCodes.find(c=>now-(spoken[c]??-Infinity)>=10);
  if(!code||now-lastVoice<6||!session)return;
  const activeSession=session,u=new SpeechSynthesisUtterance(codeText(code)),sourceTime=video.currentTime;
  u.lang='ko-KR';u.rate=1;
  const ko=speechSynthesis.getVoices().find(v=>v.lang.startsWith('ko'));if(ko)u.voice=ko;
  u.onerror=e=>activeSession.audio.push({t:sourceTime,code,error:e.error});
  speechSynthesis.speak(u);spoken[code]=now;lastVoice=now;
  activeSession.audio.push({t:sourceTime,code,text:u.text,observation_t:warningMemory.get(code)?.lastSeen??lastDisplayTime});
}
function cancelSchedule(){
  if(callbackId!==null){
    if(video.cancelVideoFrameCallback)video.cancelVideoFrameCallback(callbackId);else cancelAnimationFrame(callbackId);
  }
  callbackId=null;scheduled=false;
}
function schedule(){
  if(mode!=='running'||scheduled)return;
  scheduled=true;const g=generation;
  const callback=()=>{if(g!==generation)return;scheduled=false;callbackId=null;if(mode==='running')tick();};
  callbackId=video.requestVideoFrameCallback?video.requestVideoFrameCallback(callback):requestAnimationFrame(callback);
}
async function tick(){scheduled=false;if(mode!=='running')return;const t=video.currentTime;$('clock').textContent=`${t.toFixed(1)} / ${video.duration.toFixed(1)}초`;$('seek').value=t;paint();if(t>=to){finish('range_end');return;}if(!busy&&t-lastSample>=1/15-.001){busy=true;lastSample=t;const g=generation;try{cg.drawImage(video,0,0,capture.width,capture.height);const bitmap=await createImageBitmap(capture);if(g!==generation||mode!=='running'){bitmap.close();busy=false;if(pendingEnd)complete();controls();}else worker.postMessage({type:'frame',generation:g,time:t,width:capture.width,height:capture.height,inferenceTimestamp:performance.now(),bitmap},[bitmap]);}catch(e){busy=false;notice(e.message);finish('frame_error');}}schedule();}
worker.onmessage=e=>{const d=e.data;if(d.type==='ready'){ready=true;$('model-state').textContent='MediaPipe Full · 모델 준비 완료';controls();return;}if(d.type==='error'){busy=false;if(d.generation!==undefined&&d.generation!==generation){if(pendingEnd)complete();controls();return;}notice(d.message??'분석 오류');if(pendingEnd)complete();else if(mode==='running')finish('model_error');controls();return;}if(d.type!=='pose')return;busy=false;if(d.generation!==generation||!['running','finishing'].includes(mode)){if(pendingEnd)complete();controls();return;}try{const r=engine.pushFrame({timestampMs:d.time*1000,width:d.width,height:d.height,landmarks:d.landmarks});if(!r.ignored){latest={...r,video_s:d.time,landmarks:d.landmarks};session.frames.push({time:d.time,width:d.width,height:d.height,inference_ms:d.inference_ms,presence_proxy:d.presence_proxy,...r,landmarks:d.landmarks});session.events.push(...(r.events??[]));update(r);if(mode==='running')speak();paint();}}catch(error){notice(error.message);session.events.push({type:'analysis.error',t:d.time,message:error.message});finish('rule_error');}if(pendingEnd)complete();};
worker.onerror=e=>{busy=false;ready=false;notice(`모델 실행 오류: ${e.message}`);if(pendingEnd)complete();else if(['running','paused'].includes(mode))finish('worker_error');controls();};
function seek(t){return new Promise((resolve,reject)=>{if(Math.abs(video.currentTime-t)<.01){resolve();return;}const timer=setTimeout(()=>{video.removeEventListener('seeked',done);reject(new Error('영상 위치 이동이 지연되었습니다.'));},8000);function done(){clearTimeout(timer);resolve();}video.addEventListener('seeked',done,{once:true});video.currentTime=t;});}
async function start(){if(!ready||!file||busy)return;if(!saved&&!confirm('저장하지 않은 결과를 새 분석으로 바꿀까요?'))return;const from=Number($('from').value);to=Number($('to').value);if(!Number.isFinite(from)||!Number.isFinite(to)||from<0||to>video.duration+.05||to-from<1||to-from>600){notice('영상 범위 안에서 1초 이상, 10분 이하로 선택하세요.');return;}mode='starting';generation++;cancelSchedule();pendingEnd=false;controls();notice('');stopVoice();latest=null;clearFeedback();spoken={};lastVoice=-Infinity;engine=new Analyzer();session={id:crypto.randomUUID(),exercise,created_at:new Date().toISOString(),source_name:file.name,from,to,frames:[],events:[],audio:[],controls:[]};$('memo').value='';$('results').hidden=true;recording=new SessionRecording();lastSample=-Infinity;saved=false;update(null);try{await seek(from);video.playbackRate=1;await video.play();if($('record-full').checked)recording.start(video.videoWidth,video.videoHeight);mode='running';controls();schedule();}catch(e){video.pause();mode='ready';notice(e.message);controls();}}
function pause(){if(mode==='running'){video.pause();generation++;cancelSchedule();mode='paused';session.controls.push({type:'pause',t:video.currentTime});session.events.push(...(engine.breakContinuity()??[]));stopVoice();warningMemory.clear();displayCodes=[];recording.pause();latest=null;paint();controls();}else if(mode==='paused'){mode='starting';controls();video.play().then(()=>{recording.resume();mode='running';lastSample=-Infinity;session.controls.push({type:'resume',t:video.currentTime});controls();schedule();}).catch(e=>{mode='paused';notice(e.message);controls();});}}
function finish(reason='manual'){
  if(!['running','paused'].includes(mode))return;
  session.controls.push({type:'end',reason,t:video.currentTime});
  video.pause();cancelSchedule();stopVoice();mode='finishing';pendingEnd=true;controls();
  if(!busy)complete();
}
function showSummary(summary){
  $('summary-copy').textContent=`${def.name} · 분석 프레임 ${session.frames.length}개${exercise==='squat'?` · ${summary.count??latest?.count??0}회`:''}`;
  $('summary-detail').textContent=JSON.stringify(summary,null,2);
  $('item-cards').replaceChildren(...Object.entries(summary.items??{}).map(([key,item])=>{
    const card=document.createElement('div');card.className='plank-item';
    const count=item.aggregationBasis ? `평가 ${item.evaluated.toFixed(1)}${item.unit==='seconds'?'초':'회'} · 경고 ${item.warning.toFixed(1)}${item.unit==='seconds'?'초':'회'}` : Number.isFinite(item.evaluable_reps)?`평가 ${item.evaluable_reps}회 · 경고 ${item.warning_reps}회`:
      `평가 ${(item.evaluable_s??0).toFixed(1)}초 · 경고 ${(item.warning_s??0).toFixed(1)}초`;
    const pct=item.aggregationBasis?item.compliancePct:item.compliance_pct;
    card.textContent=`${LABELS[key]??key} · ${Number.isFinite(pct)?pct.toFixed(1)+'% 준수':'평가 자료 없음'} · ${count}`;
    return card;
  }));
}
async function complete(){
  if(!pendingEnd)return;
  pendingEnd=false;
  try{
    session.events.push(...(engine.finish()??[]));session.summary=engine.summary();
    await recording.stop();
  }catch(e){
    session.summary??=engine.summary();session.events.push({type:'finalize.error',message:e.message});
    notice(`영상 저장 처리 중 오류: ${e.message}. 판정 결과는 저장할 수 있습니다.`);
  }
  mode='finished';$('results').hidden=false;showSummary(session.summary);
  const media=recording.metadata();
  $('full-status').textContent=recording.blob?
    (media.status==='ready'?'분석 영상을 ZIP에 함께 저장합니다.':'일부 분석 영상만 저장되었습니다. JSON의 media 상태를 확인하세요.'):
    '영상 기록 없음 · 좌표와 판정 결과는 저장할 수 있습니다.';
  controls();
}
function report(){return {schemaVersion:'1.0',session_id:session.id,exercise_id:exercise,experimental:true,created_at:session.created_at,source:{name:session.source_name,selected_start_s:session.from,selected_end_s:session.to,actual_end_s:session.controls.findLast(c=>c.type==='end')?.t??session.frames.at(-1)?.time??session.from},runtime:{model:'pose_landmarker_full',mediapipe:'0.10.32',delegate:'CPU',target_fps:15},engine_version:session.summary?.engineVersion??latest?.engineVersion??null,summary:session.summary,events:session.events,audio:session.audio,controls:session.controls,frames_analyzed:session.frames.length,frame_details:'전체 결과 ZIP의 frames.jsonl',display_policy:{last_rep_depth:'until_next_completed_rep',live_warning_hold_s:2,rep_warning_hold_s:4,tts_same_code_s:10,tts_between_messages_s:6},media:recording.metadata(),review:{memo:$('memo').value},limits:[def.description,def.note]};}
function download(blob,name){const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),30000);saved=true;}
const jb=v=>new Blob([JSON.stringify(v,null,2)],{type:'application/json'});
async function exportZip(){$('zip').disabled=true;try{const entries=[...(session.summary.schemaVersion==='2.0'?[{name:'set.completed.json',blob:jb(session.events.findLast(e=>e.type==='set.completed'))}]:[]),{name:'result.json',blob:jb(report())},{name:'frames.jsonl',blob:new Blob([session.frames.map(f=>JSON.stringify(f)).join('\n')])},{name:'events.json',blob:jb(session.events)},{name:'audio.json',blob:jb(session.audio)},{name:'controls.json',blob:jb(session.controls)}];if(recording.blob)entries.push({name:recording.metadata().file_name,blob:recording.blob});download(await zipFiles(entries),`barofit-${exercise}-${session.id}.zip`);}catch(e){notice(`저장 실패: ${e.message}`);}finally{$('zip').disabled=false;}}
$('file').onchange=()=>{const f=$('file').files[0];if(!f)return;if(!saved&&!confirm('저장하지 않은 결과를 버리고 영상을 변경할까요?')){$('file').value='';return;}video.pause();cancelSchedule();stopVoice();generation++;latest=null;clearFeedback();paint();file=f;if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=URL.createObjectURL(f);video.src=objectUrl;mode='loading';session=null;saved=true;$('results').hidden=true;$('file-title').textContent=f.name;$('empty').hidden=true;controls();};
video.onloadedmetadata=()=>{if(!Number.isFinite(video.duration)){notice('영상 길이를 읽을 수 없습니다. 다른 MP4 영상을 선택하세요.');return;}overlay.width=video.videoWidth;overlay.height=video.videoHeight;capture.width=Math.min(960,video.videoWidth);capture.height=Math.round(capture.width*video.videoHeight/video.videoWidth);$('from').value=0;$('to').value=Math.min(video.duration,600).toFixed(2);$('seek').max=video.duration;$('seek').value=0;mode='ready';$('clock').textContent=`0.0 / ${video.duration.toFixed(1)}초`;update(null);controls();};
video.onerror=()=>{notice('이 영상을 재생할 수 없습니다. MP4 또는 WebM 파일로 다시 선택하세요.');if(['running','paused','finishing'].includes(mode))finish('video_error');else{mode='empty';file=null;controls();}};
video.onended=()=>finish('video_end');$('start').onclick=start;$('pause').onclick=pause;$('finish').onclick=()=>finish();$('seek').oninput=()=>{video.currentTime=Number($('seek').value);latest=null;paint();};$('bones').onchange=paint;$('voice').onchange=()=>{$('sound').textContent=$('voice').checked?'음성 켜짐':'음성 꺼짐';if(!$('voice').checked)stopVoice();};$('json').onclick=()=>download(jb(report()),`barofit-${exercise}-${session.id}.json`);$('zip').onclick=exportZip;$('memo').oninput=()=>{saved=false;};
$('exercise').onchange=e=>{if(!saved&&!confirm('결과를 저장하지 않고 이동할까요?')){e.target.value=exercise;return;}saved=true;location.href=e.target.value==='pushup'?'./':e.target.value==='plank'?'plank.html':`experiment.html?exercise=${e.target.value}`;};
document.addEventListener('visibilitychange',()=>{if(document.hidden&&mode==='running')pause();});window.addEventListener('beforeunload',e=>{if(!saved){e.preventDefault();e.returnValue='';}});controls();update(null);worker.postMessage({type:'init'});
