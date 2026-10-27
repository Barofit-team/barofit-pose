# 점핑잭 v0.1 · 2026-10-21

정면 일반 점핑잭의 다리 벌리기→모으기를 카운트하고, 회차별 자세를 평가한다. 팔 동작이 부족해도 완료한 다리 움직임은 카운트한다. 기존 푸쉬업·플랭크·버드독 판정은 변경하지 않았다.

## 근거와 계산

| 항목 / 코드 | 운동 안내의 근거 | 계산 / 초기 경계값 |
|---|---|---|
| 팔 올리기 / `ARMS_LOW` | 팔을 머리 위로 올리기 | 골반–어깨–손목 각도. 양팔 중 작은 각도의 회차 최대값이 145° 미만 |
| 다리 벌리기 / `LEGS_NARROW` | 발을 바깥으로 벌리기 | 발목 수평 간격 / 어깨 너비의 최대값이 1.15 미만 |
| 협응 / `ARMS_LEGS_ASYNC` | 팔 올리기와 다리 벌리기를 함께 수행 | 최고 구간 간격이 max(100ms, 회차 길이의 20%) 초과 또는 두 움직임의 상관계수 0.2 미만 |
| 시작 자세 복귀 / `RETURN_INCOMPLETE` | 발을 모으고 팔을 옆으로 내리기 | 회차 끝 발목/어깨 비율 0.9 초과 또는 팔 각도 40° 초과. 팔은 끝점 ±120ms에서 확인 |
| 몸통 기울임 / `TORSO_LEAN` | 상체를 세워 유지 | 어깨 중앙–골반 중앙의 화면 수직선 대비 기울기 15° 초과가 250ms 지속 |

운동 방법은 [NASM](https://www.nasm.org/resource-center/exercise-library/jumping-jacks), 사진으로 표현된 동작 순서는 [European Fitness Badge 지도자 안내서](https://fitness-badge.eu/wp-content/uploads/2017/03/EFB-Instructors-Handbook-EN.pdf)(인쇄 p.23, PDF 26번째 페이지)와 [Beach Cities Health District 안내서](https://bchd.blob.core.windows.net/docs/ys/2018-19/2017_8MinMornExercise_Handbook_FINAL.pdf)를 참고했다. EFB의 손뼉 조건은 해당 검사 방식이므로 필수 항목으로 사용하지 않았다.

**위 수치는 자료에서 제시한 정답 각도가 아니다.** 2D 관절로 안내를 구현하기 위한 초기 공학적 경계값이며 이번 영상들을 보며 조정했다. 동일 영상으로 조정·확인했으므로 독립 평가 성능을 의미하지 않는다. 착지 충격, 코어 활성, 허리 곡률은 평가하지 않는다. 몸통 항목은 정면 좌우 기울임이며 척추 중립 판정이 아니다.

## 입력과 출력

- `JumpingJackAnalyzer`의 `pushFrame`, `breakContinuity`, `summary`, `finish` 사용. 기존 MediaPipe 33관절 입력을 받는다.
- 어깨·골반·발목이 화면 안에서 관측되어야 한다. 손목만 안 보이면 다리 카운트는 유지하고 팔 관련 평가는 보류한다.
- 발 간격 변화 0.35 어깨너비 이상, 회차 350–5000ms를 초기 움직임 탐지 조건으로 사용한다. 250ms 초과 공백은 동작을 끊는다.
- `count`: 완료한 벌리기–모으기 시도. `holdSeconds`: null. `observedSeconds`: 관절을 연속 관측한 시간.
- `items/currentCodes`: 현재 상태. `lastRepetition`: 최근 회차 평가. `codes`: 화면 표시 후보. TTS는 매 프레임 codes를 재생하지 않고 회차 이벤트를 이용한다.
- 실시간 `frame.result` v2와 `set.completed` v2를 사용한다. 항목별 `aggregationBasis`는 `repetition`, `compliancePct`는 0–100. unknown은 평가 분모에서 제외한다.

```sh
python -m analysis.jumping_jack.video_runner input.mp4 --model models/pose_landmarker_full.task --output results/jumping_jack
# 이미 추출한 관절 JSONL 사용
node examples/jumping_jack.mjs frames.jsonl results/jumping_jack
```

Python 분석도 같은 JavaScript 엔진을 호출한다. MediaPipe 영상 의존성과 Node.js가 필요하다. 시작 준비·종료 정책은 호출 측에서 관리한다.

## 이번 확인 결과

| 자료 | 관측 결과 |
|---|---|
| NASM / PittAlex / Kickstand 정상 시범 3구간 | 각각 4 / 12 / 19회 검출, 자세 경고 없음 |
| QEVD 팔 동작 생략 3구간 | 총 11회 카운트, 11회 팔 올리기 경고 |
| QEVD 팔·다리 반대 움직임 1구간 | 3회 카운트, 3회 협응 경고 |
| 팔이 어깨 높이에서 멈추는 복귀 사례 | 복귀 경고 확인 |
| 발이 잘리거나 다리 움직임이 작은 사례 | 카운트 누락·판정 보류가 남음 |

전체 29개 구간을 실행했다. 같은 원본의 겹치는 구간을 포함하며 29명 평가가 아니다. QEVD는 정상·오류 후보를 확보하는 용도로 사용했고 제공 라벨을 모든 프레임의 정답으로 취급하지 않았다. 정상 시범의 무경고 결과도 전체 오경고율 0%를 의미하지 않는다.

준비 동작까지 포함한 Kickstand 구간에서는 1회 추가 카운트가 발생했다. 시작 준비 감지는 이 모듈에 포함하지 않는다. 다리 벌림 경계값의 일반화와 몸통 기울임의 실제 오류 양성 사례 검증은 부족하다. 스텝잭·측면 구도는 지원 범위가 아니다.

검증: 전체 JavaScript 테스트 56개 통과. 이번 실행의 실시간 결과 3,815개 및 세트 결과 29개가 JSON Schema를 통과했다. 원본→관절 추출→공통 엔진→결과 저장 CLI 실행도 확인했다.

## 관절 추출 모델 비교

동일 6개 구간에서 모델마다 382프레임을 처리했다. Ryzen 7 7800X3D CPU, 원본을 너비 640px로 공통 축소한 후 각 모델의 입력 처리·추론·출력 변환 시간을 측정했다. 디코딩·공통 축소·렌더링·초기화는 제외했다. 모델당 10회 워밍업. MediaPipe 기본 스레드, 나머지는 가능한 곳에 4스레드. RTMPose는 매 프레임 사람 검출을 포함한다. 모바일 측정치가 아니다.

| 모델 | 중앙값 ms | 95백분위 ms |
|---|---:|---:|
| MediaPipe Full | 12.27 | 13.14 |
| MediaPipe Lite | 9.16 | 9.82 |
| MoveNet Lightning | 3.66 | 3.95 |
| MoveNet Thunder | 13.07 | 13.59 |
| RTMPose-s + YOLOX-tiny | 35.21 | 39.02 |
| YOLO26n Pose | 21.31 | 24.24 |

이번 구성에서는 Lightning이 가장 빠르다. 기존 구조를 유지하며 경량화할 첫 후보는 MediaPipe Lite다. 현재 기본 Full은 유지한다. 모델별 관절 정의·입력 크기·추적 방식이 다르며, MoveNet 동적 인물 크롭 같은 추가 최적화는 적용하지 않았다.

6개 정지 장면의 67개 관절을 눈으로 표시한 참고 대조도 만들었지만, 전문가 정답·충분한 표본·프레임 정밀 일치가 확보되지 않아 정식 정확도나 모델 순위로 사용하지 않는다. 비교 영상에서 손목·발목의 흔들림과 빠진 관절을 확인하는 예비 비교다. 모델 교체 결정에는 독립 라벨 영상과 실제 Android 지연·발열 측정이 필요하다.

모델 출처: [MediaPipe](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker), [MoveNet](https://www.tensorflow.org/hub/tutorials/movenet), [RTMPose](https://github.com/open-mmlab/mmpose/tree/main/projects/rtmpose), [YOLO26](https://docs.ultralytics.com/models/yolo26/).

영상 출처: [NASM](https://www.youtube.com/watch?v=uLVt6u15L98), [PittAlex](https://www.youtube.com/watch?v=FDYqpyAJqWQ), [Kickstand](https://www.youtube.com/watch?v=va9tnGWzeVw), [QEVD](https://www.qualcomm.com/developer/software/qevd-dataset). 분석용 원본·가중치는 저장소에 포함하지 않는다.
