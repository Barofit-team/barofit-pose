# 촬영 준비 상태 모듈

`CameraReadiness`는 앱 내부에서 MediaPipe 프레임을 받아 `camera.readiness` v1 객체를 반환합니다. 서버 요청 없이 실행되며 기존 운동 판정·카운트·실시간 v2·세트 종료 v2는 변경하지 않습니다.

```js
import {CameraReadiness, PushupAnalyzer} from '@barofit/pose';
const camera = new CameraReadiness({exercise: 'pushup'});
const analyzer = new PushupAnalyzer();
function onPose(frame) {
  const preparation = camera.pushFrame(frame);
  // 프론트가 preparation으로 준비 안내와 카운트다운을 처리합니다.
  // 운동 시작 이후에는 원본 frame을 기존 analyzer.pushFrame(frame)에 전달합니다.
  // ready=false일 때 프레임을 누락시키는 필터로 사용하지 않습니다.
  return preparation;
}
```

입력은 기존 `{timestampMs,width,height,landmarks}`입니다. 관절은 MediaPipe 33개, 각 값은 `[x,y,z,visibility,presence]`이며 검출이 없으면 `[]`입니다. x/y는 모델 입력 이미지의 정규화 좌표입니다. 화면 미러링·회전·크롭을 적용한 표시 좌표가 아닙니다. 미리보기가 이미지를 잘라 표시한다면 프론트에서 같은 영역으로 조정해야 합니다.

| 필드 | 의미 |
|---|---|
| status | no_person / adjust_camera / stabilizing / ready |
| ready | 잠깐의 인식 실패를 허용하는 준비 상태 |
| observable | 이번 프레임의 필수 관절 충족 여부 |
| selectedSide | 준비가 완료된 쪽. 기존 운동 분석기의 선택을 강제로 바꾸지 않음 |
| candidateSide | 안정성 확인 중인 쪽 |
| missingLandmarks | 누락·가림·낮은 신뢰도 관절 |
| outOfFrameLandmarks | 추정 좌표가 이미지 밖인 관절. 실제 화면 밖 여부의 정답은 아님 |
| reasonCode / message | 현재 관측 사유와 기본 한국어 안내 |
| stableForMs | 현재 후보가 연속 조건을 충족한 시간(ms) |
| ignored | 역순·중복 프레임. 이전 상태를 반환하며 시간 누적하지 않음 |

## 기본 동작

- 가시성·존재 신뢰도 각각 0.5 이상, x/y 0~1 내부의 유효 좌표를 확인합니다.
- 1초 연속 확보 후 준비 완료, 0.5초 연속 실패 시 준비 해제합니다.
- 프레임 간격 0.4초 초과, 입력 해상도 변경, `breakContinuity()` 호출 시 안정성 확인을 다시 시작합니다.
- 한쪽을 선택한 뒤 잠깐의 흔들림으로 쪽을 바꾸지 않습니다. 지속 실패 후 다른 쪽을 새로 1초 확인합니다.
- 0.5초 유예 중에는 `ready:true, observable:false`일 수 있습니다. 자세 판정은 원본 프레임의 신뢰도를 기존처럼 확인해야 합니다.
- 신뢰도와 시간 기준은 초기 엔지니어링 설정이며 휴대폰별 실측 정확도를 의미하지 않습니다. 생성자 옵션으로 조정할 수 있습니다.

## 운동별 관절 프로필

| 운동 | 기본 확인 범위 |
|---|---|
| 푸시업·플랭크·수퍼맨·파이크 푸시업·인클라인 푸시업·마운틴 클라이머 | 한쪽 어깨·팔꿈치·손목·골반·무릎·발목 |
| 스쿼트·런지·스플릿 스쿼트·불가리안 스플릿 스쿼트·레그 레이즈·글루트 브리지·사이드 라잉 레그 레이즈 | 한쪽 어깨·골반·무릎·발목 |
| 버드독·데드버그·점핑잭 | 양쪽 어깨·팔꿈치·손목·골반·무릎·발목 |
| 스탠딩 카프 레이즈 | 한쪽 어깨·골반·무릎·발목·뒤꿈치·발끝 |

한쪽 운동은 `side:'left'` 또는 `'right'`로 고정할 수 있습니다. 양쪽 운동은 한쪽 고정을 허용하지 않습니다. 이 프로필은 촬영 시작의 관찰 가능 범위이며, 모든 세부 판정 항목이 항상 평가된다는 보장이 아닙니다. 특히 마운틴 클라이머의 반대쪽 지지 다리가 불확실하면 기존 분석기가 골반만 unknown으로 처리합니다. 버드독·데드버그의 양쪽 요구는 보수적 초기 설정으로 실기기 준비 자세 검증이 필요합니다.

이 모듈은 자세의 올바름, 운동 시작·종료, 사람 수·동일인 여부, 촬영 방향을 판정하지 않습니다. `no_person`은 검출된 관절 배열이 없다는 의미입니다. 몸이 너무 작거나 모델이 관절을 잘못 추정했지만 신뢰도가 높은 경우까지 보장하지 않습니다.

## 검증 · 2026-11-09

- 기존 테스트와 신규 준비 상태 테스트 총 152개 통과.
- 실제 영상에서 추출해 저장한 관절 605프레임 재생: 마운틴 클라이머 215, 레그 레이즈 232, 점핑잭 158.
- 최초 준비 완료 각각 1000ms, 약1001ms, 약1001ms.
- 준비 완료 상태 프레임 각각 191, 217, 108. 정확도 지표가 아니라 상태 분포입니다.
- 신규 휴대폰 촬영 실험 대신 저장된 관절 재생과 합성 결측·시간 경계 테스트를 수행했습니다.

재현: `node examples/camera-readiness-replay.mjs exercise input.jsonl output.jsonl`.
규격: [camera-readiness-v1.schema.json](../schemas/camera-readiness-v1.schema.json).

### 실제 보행 영상 검증

OpenCV 공개 `vtest.avi`의 고정 영역 2개 구간을 잘라 MediaPipe Full로 새로 추출했습니다. 총 31초·310프레임이며 결과 JSON Schema 검증을 통과했습니다.

| 장면 | 관측 결과 |
|---|---|
| 빈 화면에서 진입 | 5초 관절 확보 → 6초 ready |
| 손목 가림 | 7.7초 인식 실패 → 8.2초 준비 해제 |
| 가림 해소 | 9.6초 ready |
| 화면 경계 이탈 | 13.3초 관절 이탈 → 13.8초 준비 해제 |
| 다른 구간의 이탈·재진입 | 8.9초 준비 해제 → 11.7초 ready |

여러 사람이 등장하며 단일 포즈 추출기가 다른 사람으로 대상을 바꿀 수 있습니다. 동일인 유지 검증은 포함하지 않습니다. 원본: https://github.com/opencv/opencv/blob/4.x/samples/data/vtest.avi
