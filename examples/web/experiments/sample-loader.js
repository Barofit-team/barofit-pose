const input=document.getElementById('file');
const exercise=document.getElementById('exercise-nav')?'pushup':new URLSearchParams(location.search).get('exercise');
if(input&&['pushup','squat'].includes(exercise)){
 const box=document.createElement('div');box.className='panel settings';box.style.padding='16px';
 const title=document.createElement('strong');title.textContent='예제 영상으로 바로 테스트';box.append(title);
 const row=document.createElement('div');row.className='toolbar';box.append(row);
 for(const [label,kind] of [['정상 라벨 영상','good'],['오류 라벨 영상','bad']]){
  const b=document.createElement('button');b.textContent=label;
  b.onclick=async()=>{if(input.disabled)return;b.disabled=true;const before=b.textContent;b.textContent='영상 불러오는 중…';try{
   const name=`${exercise}-${kind}.mp4`,r=await fetch(`samples/${name}`);if(!r.ok)throw new Error('예제 영상을 가져오지 못했습니다.');
   const blob=await r.blob(),dt=new DataTransfer();dt.items.add(new File([blob],name,{type:'video/mp4'}));input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));
  }catch(e){const n=document.getElementById('notice');n.hidden=false;n.textContent=e.message;}finally{b.textContent=before;b.disabled=input.disabled;}};
  row.append(b);
 }
 const p=document.createElement('p');p.className='muted';p.style.fontSize='12px';p.textContent='Mendeley · CC BY 4.0. 원본의 영상 단위 라벨이며, 모든 프레임의 자세 정답은 아닙니다. 출처는 데모·검증 범위 페이지에 있습니다.';box.append(p);
 document.querySelector('.viewer-column').append(box);
 new MutationObserver(()=>row.querySelectorAll('button').forEach(b=>b.disabled=input.disabled)).observe(input,{attributes:true,attributeFilter:['disabled']});
}
