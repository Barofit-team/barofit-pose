const BASE_LABELS=Object.freeze({
  hip:'골반 정렬',elbow:'팔꿈치 굽힘',chest:'상체 이동 범위',hand:'손 위치',
  return:'시작 자세 복귀',shoulder:'어깨·팔꿈치 정렬',knee:'무릎 펴기',
  depth:'동작 깊이',trunk:'몸통 기울기',range:'동작 범위',body_line:'몸통 정렬',
  knee_extension:'무릎 펴기',opposite_arm:'반대쪽 팔 협응',hip_height:'골반 높이',
  arm_raise:'팔 벌림 높이',leg_open:'다리 벌림',coordination:'팔·다리 협응',torso:'몸통 기울기',
  hip_extension:'골반 올리기',foot_position:'발 위치',lowering_control:'내려오는 속도 조절',
  lumbar_contact:'허리 바닥 접촉',lumbar_neutral:'허리 중립',knee_tracking:'무릎 진행 방향',
  arm_extension:'팔 펴기',movement_control:'동작 속도 조절',pike_shape:'파이크 자세',
  head_path:'머리 이동 경로',press_return:'밀어 올리고 돌아오는 자세',hip_alignment:'골반 정렬',
  form:'자세 평가',same_side_pair:'반대쪽 팔·다리 협응',body_movement:'몸통 안정성',
  shoulder_shrug:'어깨 으쓱임',leg_spread:'다리 벌어짐',
  axial_rotation:'몸통 회전',elbow_flare:'팔꿈치 벌어짐',toe_loading:'발끝 지지',
});
const SIDE_LABELS=Object.freeze({leg_high:'다리 높이',knee_bent:'무릎 펴기',arm_high:'팔 높이',
  arm_low:'팔 처짐',elbow_bent:'팔꿈치 펴기',hand_alignment:'지지 손 정렬',
  support_knee_alignment:'지지 무릎 정렬'});
export const ITEM_LABELS=Object.freeze({...BASE_LABELS,...Object.fromEntries(
  ['left','right'].flatMap(side=>Object.entries(SIDE_LABELS).map(([key,label])=>[
    side+'_'+key,(side==='left'?'왼쪽 ':'오른쪽 ')+label])))});
export function itemLabel(id) {return Object.hasOwn(ITEM_LABELS,id)?ITEM_LABELS[id]:'자세 평가 항목';}
