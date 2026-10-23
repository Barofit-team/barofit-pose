# 글루트 브리지 0.1 — 2026-10-23

이 문서는 0.1 검토 기록입니다. 현재 발 위치 보완 및 추가 영상 결과는 [0.2 검토 기록](GLUTE_BRIDGE_V02.md)에 정리했습니다.

## 범위와 인터페이스

양발을 바닥에 둔 글루트 브리지의 측면 영상용 모듈입니다. 관절 추출은 MediaPipe Pose Landmarker, 판정은 JavaScript `GluteBridgeAnalyzer`가 수행합니다.

`PoseFrame → pushFrame(frame) → frame.result v2 → finish() → set.completed v2`

- `runtime/glute_bridge/analyzer.js`: 판정과 반복 집계
- `examples/glute_bridge.mjs`: MediaPipe JSONL 입력을 분석하는 실행 예제
- `analysis/glute_bridge/render.py`: 좌표·판정·템포를 표시하는 영상 생성기
- 실시간·세트 종료 공통 필드는 기존 v2와 같습니다. `exercise`에 `glute_bridge`를 추가했습니다.
- `count`: 상승 후 시작 높이 부근으로 복귀한 시도 수입니다. 자세 경고는 카운트를 취소하지 않습니다.
- `holdSeconds`: null. 반복 운동의 상단 정지 시간은 회차별 `metrics.tempo.topHoldMs`에 저장합니다.
- `observedSeconds`: 사용 가능한 자세를 연속 관측한 시간입니다. 휴식 포함 세션 전체 시간이나 정상 자세 유지 시간이 아닙니다.
- `items`: 현재 관측, `lastRepetition`: 최근 완료 회차, `currentCodes`: 현재 경고, `codes`: 현재·최근 회차 표시 후보입니다.
- 항목 집계는 `aggregationBasis: repetition`, 준수율은 0–100이며 평가 수가 0이면 null입니다. 미지원 항목은 unknown으로 집계합니다.

## 판정 근거와 측정

| 항목 | 자료상의 지침 | 모듈의 처리 |
|---|---|---|
| 고관절 펴기 | 엉덩이를 들어 고관절을 펴되 가능한 범위에서 수행 | 어깨–골반–무릎의 투영 각도와 반복별 최고값 측정. `HIP_LIFT_LOW`는 상승 범위가 작다는 관측 안내이며 원인·가동성 제한을 진단하지 않습니다. |
| 발 위치 | 위에서 무릎 아래에 발목이 오도록 위치 조절 | 상단 정강이 기울기 대리값. 준비 자세에서 매우 큰 기울기도 안내합니다. `FOOT_POSITION_OFFSET` |
| 하강 제어 | 천천히 시작 위치로 내려오기 | 하강 시간과 각속도를 함께 적용. `LOWERING_FAST` |
| 허리 중립 | 허리를 과도하게 젖혀 높이를 만들지 않기 | `lumbar_neutral: not_supported`. 고관절 각도만으로 허리 곡률을 판정하지 않습니다. |
| 좌우 무릎 정렬 | 무릎·발 방향과 양측 정렬 유지 | 측면 한쪽 관절만으로 확정하지 않으며 `knee_tracking: not_supported`입니다. |

근거:
- [ACE Glute Bridge](https://www.acefitness.org/resources/everyone/exercise-library/49/glute-bridge/): 고관절 신전, 과도한 요추 젖힘 방지, 천천히 하강.
- [Sports Injury Physio](https://www.sports-injury-physio.com/post/glute-bridge-exercises-4-variations-demonstrated): 개인의 가능한 범위, 과하게 높이 들기와 제한된 가동범위의 차이.
- [Well+Good / Charlee Atkins](https://www.youtube.com/watch?v=wPM8icPu6H8): 상단 무릎–발목 정렬, 발을 너무 멀리/가까이 두는 시범.

## 수치 기준

아래 수치는 논문에서 검증한 임상 기준이 아니라 1차 구현·영상 검토용 공학적 설정값입니다.

| 설정 | 값 | 의미 |
|---|---|---|
| 관절 품질 | visibility/presence 각각 0.5 이상 | 어깨·골반·무릎·발목 중 보이는 한쪽 사용 |
| 동작 진입 | 준비 250ms, 시작 각도 155° 이하 | 상단에서 시작된 잘린 영상의 첫 하강을 임의로 세지 않음 |
| 카운트 | 변화 20° 이상 → 최고점에서 6° 감소 → 시작+12° 이내 복귀 | 미세 흔들림 제외. 복귀 8° 설정은 빠른 영상에서 평활화 지연으로 회차가 합쳐져 12°로 수정 |
| 회차 시간 | 650ms–30s | 짧은 잡음·시간 초과 제외 |
| 작은 상승 범위 | 최고 투영각 <150° | 최초 160°는 정상 시범 157.9°에서 경고. 150°로 1차 조정했으며 독립 평가 전입니다. 무조건 더 높이 들라는 지시가 아닙니다. |
| 발 위치 대리값 | 상단 정강이 기울기 >25° / 준비 >35° | 현재 경고는 250ms 지속. 회차는 상단 5° 범위의 중앙값 사용 |
| 빠른 하강 | 600ms 미만 및 평균 각속도 >65°/s | 두 조건 동시 충족 |
| 관측 단절 | 300ms 초과 간격 또는 필수 관절 실패 | 진행 중 회차 초기화. 좌우 전환도 기록을 연결하지 않음 |

각도는 이미지 가로·세로 픽셀 비율을 반영합니다. 카메라를 수평에 가깝게 고정한 측면 촬영을 전제로 합니다. 정강이 기울기는 화면 수직 기준입니다.

## 실제 영상 검토 결과

공개 영상 3개에서 9개 구간을 추출했습니다. 구간 선택은 영상과 설명·자막을 함께 확인했습니다. 전문가가 별도로 라벨링한 데이터셋이나 독립 평가 세트는 아닙니다.

| 구간 | 카운트 | 확인 결과 |
|---|---:|---|
| Sports Injury Physio 기본 시범 284–300s | 1 | 활성 항목 경고 없음 |
| Sports Injury Physio 첫 시범 263–280s | 1 | 투영 최고각 157.9°. 160°에서 발생한 오경고 확인 후 설정 조정 |
| Well+Good 정상 59–72s | 2 | 활성 항목 경고 없음. 시작·끝의 불완전 회차 제외 |
| Positive Motion 정상 진행 719–739s | 1 | 활성 항목 경고 없음. 구도 전환 포함, 수동 회차 정답 확정 대상에서 제외 |
| Well+Good 발이 먼 준비 17.8–20s | 0 | 현재 발 위치 경고. 완료 회차가 없어 세트 회차 준수율은 null |
| Well+Good 발이 가까운 빠른 반복 20–24.3s | 2 | 빠른 하강 2회 포착. 원본이 설명한 가까운 발 위치 자체는 미검출 |
| Sports Injury Physio 과하게 높이 들기 303–322s | 1 | 허리 과신전은 미지원. 높은 골반 각도만으로 구분 불가 |
| Sports Injury Physio 제한된 범위 설명 351–369s | 1 | 작은 움직임과 앞부분 큰 움직임 혼재. 한계 사례로 보존 |
| Positive Motion 허리 과신전·교정 394–423s | 1 | 구간 중 화면 전환·관절 오인식 존재. 허리 판정 성능으로 집계하지 않음 |

정상 최고각 약 158–197°와 과신전 설명 구간 약 190–198°가 겹쳤습니다. 따라서 최초 실험한 >195° 허리 대리 경고는 제거하고 각도만 기록합니다. 경고가 없다는 것이 허리까지 정상이라는 의미는 아닙니다.

작은 상승 범위의 오류 검출은 합성 회차로 작동을 검사했으며, 실제 독립 오류 영상으로 검증 완료한 항목은 아닙니다. 발 위치도 먼 발의 준비 경고와 상단 정강이 정렬만 확인했습니다.

## 재현

```sh
python -m analysis.glute_bridge.evaluate clip.mp4 results/glute_bridge --model pose_landmarker_full.task --ffmpeg ffmpeg
node examples/glute_bridge.mjs frames.jsonl results/glute_bridge
node --test tests/js/glute_bridge.test.mjs
```

검증 결과: 실시간 2,019개와 세트 종료 9개가 JSON Schema v2 검사를 통과했습니다. 기존 운동을 포함한 JavaScript 테스트 93개를 통과했습니다. 분석 영상은 원본 속도로 출력하며 영어 표기를 사용합니다.

자료는 공개 열람 영상으로, 원본 영상의 재배포·상용 학습 허용을 확인한 것은 아닙니다. 저장 구간은 내부 검증 자료로 관리합니다.
