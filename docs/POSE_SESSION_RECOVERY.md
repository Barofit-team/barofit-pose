# 인식 이탈·재인식·운동 재개 제어

## 적용 범위

`ExerciseSessionController`가 한 운동 Analyzer를 감싸고 인식 상태와 측정 허용 여부를 반환합니다. 화면 이탈, 관절 가림, 모델 추적 실패를 물리적으로 구분하지 않으며 **필요 관절을 관측할 수 있는가**를 판단합니다. 정상 자세 판정과도 다릅니다.

- 300ms 연속 관측 후 최초 측정을 시작합니다. 최초 시작에는 재개용 5초 카운트다운을 중복 적용하지 않습니다.
- 필요한 관절을 못 보는 첫 프레임부터 측정을 차단하고 미완료 동작을 버립니다. 2초 유예는 UI의 자동 일시정지 확정을 위한 시간입니다.
- 측정 불가가 2초 지속되면 `auto_paused`로 전환합니다. 그 전에 복구되면 안정성 확인 후 바로 측정하며 5초 카운트다운을 적용하지 않습니다.
- 자동 일시정지 이후에는 300ms 연속 재인식을 확인하고 5초 카운트다운을 시작합니다. 해당 시간 동안 카메라 관측은 계속하지만 Analyzer에는 프레임을 보내지 않습니다.
- 카운트다운 중 한 프레임이라도 필요한 관절이 누락되면 즉시 취소합니다. 새로 안정적인 재인식을 확인한 뒤 5초를 처음부터 셉니다. 촬영 해상도나 관측할 쪽이 바뀌어도 연속 확인을 다시 합니다.
- 카운트다운 만료 시점의 **새롭고 유효한 카메라 프레임**부터 측정합니다. `tick()`만으로 측정을 재개하거나 과거 프레임을 보간하지 않습니다.

별도 `session.state` v1 객체를 추가했으며 기존 입력 PoseFrame, `frame.result` v2, `set.completed` v2 형식과 기존 판정 기준은 바꾸지 않았습니다. [JSON Schema](../schemas/session-state-v1.schema.json)를 제공합니다.

기반 브랜치는 운동 5종 JS 추가 PR #8입니다. 해당 PR을 먼저 main에 병합하고 이번 PR을 main으로 변경하여 병합합니다. 두 PR이 병합되기 전에는 main의 배포 코드가 자동으로 바뀌지 않습니다.

## 프론트에서 연결

```js
import {ExerciseSessionController,SquatAnalyzer} from '@barofit/pose';

const session=new ExerciseSessionController({analyzer:new SquatAnalyzer()});

// 카메라 추적 콜백마다 호출합니다. 미검출도 같은 시간축으로 landmarks:[]를 전달합니다.
function onPose(frame) {
  const state=session.pushFrame(frame);
  if(state.ignored)return;
  // state.phase / recognition / countdownRemainingMs로 일시정지·재개 화면을 갱신합니다.
  // 카운트·유효 유지 시간은 state.summary를 표시합니다.
  if(state.frameResult) {
    // 실제로 Analyzer에 전달된 이번 프레임의 자세 판정입니다.
  }
}
// 카메라 콜백이 멈추는 경우를 감지하려면 약 100ms마다 호출합니다.
// nowMs는 frame.timestampMs와 같은 단조 증가 시간축이어야 합니다.
function onWatchdog(nowMs) {
  const state=session.tick(nowMs);
  if(state.ignored)return;
  // tick 결과도 화면에 반영하지만 frameResult는 항상 null입니다.
}

session.pause();    // 수동 일시정지: 재인식해도 자동으로 풀리지 않습니다.
session.resume();   // 안정적인 재인식 + 5초 카운트다운을 다시 거칩니다.
const finalEvents=session.finish(); // 기존 set.completed v2 반환. 재호출은 []입니다.
```

실시간 카메라용 타이머 정리 예제는 [examples/session.mjs](../examples/session.mjs)에 있습니다. 이 예제는 프레임과 watchdog 모두 `performance.now()`로 시각을 붙입니다. 앱이 이미 일관된 카메라 시간축을 쓰면 본 클래스에 원래 프레임을 전달하고 watchdog 시각도 같은 축으로 변환해야 합니다. 멈춘 video.currentTime과 계속 흐르는 performance.now를 그대로 섞으면 안 됩니다. 마지막 watchdog 시각보다 과거인 프레임은 오래된 결과로 무시됩니다. 비동기 추론 결과의 원본 PTS를 그대로 쓸 때는 시각 변환이 필요하며, 실시간 예제는 콜백 처리 시점에 공통 시각을 부여하여 이 문제를 피합니다.

**일시정지·카운트다운 중에도 카메라 프레임은 Controller로 계속 전달**해야 합니다. Controller가 Analyzer로 보내는 것을 차단합니다. 프론트가 카메라 콜백까지 중단하면 재인식을 확인할 수 없습니다. 컨트롤러와 Analyzer를 프레임마다 새로 만들거나, 감싼 Analyzer에 별도로 pushFrame을 호출하지 않습니다. 한 세트에 하나씩 만들고 종료 시 watchdog을 정리합니다.

UI·TTS·앱 화면은 이번 코드에서 직접 변경하지 않았습니다. 프론트는 이 모듈을 import하고 콜백·화면 상태에 연결해야 합니다. 세션 운동 타이머도 `measurementEnabled`와 실제 전달된 프레임을 기준으로 제어해야 하며, 2초 유예나 카운트다운을 유효 운동 시간으로 더하지 않습니다.

## 상태 신호

| phase | 화면에서의 의미 | Analyzer 전달 |
|---|---|---|
| waiting_for_pose | 최초 준비 또는 관절·측 변경 후 안정성 확인 | 차단 |
| active | 인식 안정, 운동 측정 가능 | 유효한 새 프레임만 |
| recognition_lost | 측정 불가, 2초 이탈 확정 전 | 차단 |
| auto_paused | 이탈 확정 또는 재개 준비 중 | 차단 |
| countdown | 재개까지 5→1초 | 차단 |
| manually_paused | 사용자 일시정지, 명시적 resume 필요 | 차단 |
| finished | 세트 종료 | 차단 |

- `recognition.observable`: 필요한 관절이 현재 보이는가.
- `recognition.stable`: 같은 관측 기준으로 300ms 안정적으로 보였는가.
- `recognition.side`: 관측 게이트에서 선택한 해부학적 쪽. 실제 판정 쪽은 `frameResult.side`로 확인합니다. 둘이 같다고 가정하지 않습니다.
- `recognition.reasonCode`: NO_PERSON, BODY_OUT_OF_FRAME, MISSING_LANDMARK, LOW_VISIBILITY, LOW_PRESENCE, STABILIZING 또는 CAMERA_FRAME_TIMEOUT. 모델의 추정 사유로, 실제 물리적 이탈·가림 확정 라벨이 아닙니다.
- `recognition.observedAtMs`: 마지막 카메라 관측 시각. watchdog이 경과 시간을 확인했다고 새 영상 관측으로 바꾸지 않습니다.
- `lossDurationMs`, `countdownRemainingMs`: 같은 단조 증가 밀리초 시간축. 화면 초 표시는 `Math.ceil(countdownRemainingMs/1000)`로 계산합니다.
- `frameResult`: 이번 호출에 Analyzer로 전달한 프레임의 기존 v2 결과. 중단·대기·watchdog·ignored 호출에서는 null이며, 예전 자세 경고를 현재 판정처럼 재사용하지 않습니다.
- `summary`: 현재까지의 Analyzer 누적 집계. paused/countdown 상태에서도 완료 횟수·유효 유지 시간을 그대로 표시할 수 있습니다.
- `events`: session.phase_changed / session.auto_paused / session.countdown_started / session.countdown_cancelled / session.resumed / session.measurement_suspended 및 breakContinuity의 원래 이벤트. session 이벤트는 timestampMs, 기존 Analyzer의 t는 초 단위를 유지합니다.
- `ignored`: 프레임 중복·시각 역순·종료 후 입력. 이 결과는 화면에 적용하지 않습니다. 타이머·누적값을 바꾸지 않으며 events가 비어 있습니다.

카메라 프레임이 400ms 넘게 도착하지 않으면 watchdog은 현재 관측을 사용할 수 없다고 처리합니다. 2초 이탈 시간은 마지막 프레임 시각부터 계산합니다. 프레임이 정상적으로 도착하면서 관절이 누락되는 경우에는 첫 누락 프레임 시각부터 계산합니다. 브라우저 백그라운드나 OS 중단으로 watchdog도 실행되지 않았다면 복귀 후 다음 tick/프레임에서 그 공백을 처리합니다.

옵션: lossMs=2000, countdownMs=5000, stabilizeMs=300, maxFrameGapMs=400. 설정은 인스턴스 생성 시만 전달합니다. 모든 시간은 유한수이며 countdownMs만 0을 허용합니다.

## 측면과 양쪽 관절

기존 CameraReadiness의 기본 정책은 유지하고, Controller에서는 새 `switchToVisibleSide:true` 옵션을 사용합니다. 기존 쪽이 유효한 동안 고정하고, 그쪽을 관측할 수 없지만 반대쪽이 유효하면 새 쪽에서 안정성을 다시 확인합니다. 이때 미완료 동작·연속 유지 구간은 이어 붙이지 않습니다.

- 한쪽 관측이 충분한 종목은 하나의 완전한 관절 체인으로 처리합니다. 좌우 관절을 섞어서 가상의 한쪽 몸을 만들지 않습니다.
- 버드독·점핑잭·데드버그·플러터킥은 원래 양쪽을 요구하므로 한쪽만으로 대체하지 않습니다.
- 사이드 플랭크는 지지 쪽 체인과 **양쪽 어깨**가 필요합니다. 양쪽 어깨의 높이로 지지 방향을 추정하는 기존 판정 기준을 유지합니다.
- Analyzer에 고정 side가 있으면 게이트도 같은 쪽을 쓰며 반대쪽으로 임의 전환하지 않습니다. 필요하면 옵션으로 side를 전달합니다.
- 관절이 보인다는 신호가 운동 자세·측정 정확도를 보장하지 않습니다. 바닥 자세나 준비 자세를 다시 확인하는 과정은 각 Analyzer의 기존 규칙대로 진행됩니다.

## breakContinuity 감사 결과

| 분석기 묶음 | 보존 | 초기화/취소 |
|---|---|---|
| 푸시업 | 완료 count, 누적 항목 집계 | 회차 후보·필터·좌우 선택·피드백 이력. 완료했으나 평가 대기 중인 회차는 interrupted/unknown 처리 가능 |
| 플랭크 | 유효 holdSeconds, 관측·공백 시간, 항목 누적 | 필터·이전 프레임·HoldTimer 연속 상태 |
| 스쿼트 | count·완료 회차·몸통 시간 누적 | 준비/동작 후보, 좌우 선택, 이전 프레임 |
| 버드독 | count·sideCounts·holdSeconds·항목 누적 | 미완료 다리 회차·몸통 기준·필터·지속 타이머 |
| 점핑잭·레그 레이즈·글루트 브리지·수퍼맨·파이크 푸시업 | 완료 count·완료 회차·누적 시간 | 진행 중 동작·평활화·템포·관측 이력. 파이크 평가 대기는 미평가로 정리 가능 |
| 마운틴 클라이머 | 완료 count·완료 회차·관측 누적 | 진행 중 무릎 왕복·관측 이력 |
| 기존 Cycle 7종 | 완료 count·완료 회차·관측 누적 | ready/attempt·측 선택·카프 기준·최근 회차 표시 |
| 추가 Pilot 5종 | 완료 count·완료 회차·관측 누적 | 미완료 단계·좌우 선택·교대 이력·기준 자세 보정·최근 회차 표시 |
| 사이드 플랭크 | holdSeconds·좌우 유지 시간·항목 누적 | 이전 프레임·확인/경고 타이머 |

완료 카운트를 취소하지 않습니다. 중단 때문에 미확정 평가가 unknown이 되는 경우가 있으므로 항목별 평가 통계가 완전히 불변이라고 약속하지 않습니다. 누적 holdSeconds/observedSeconds/gapSeconds는 명시적 중단·카운트다운을 포함하지 않으며, 재개 첫 프레임에서 시간을 소급해 더하지 않습니다. 미완료 동작은 재개 후 시작 자세부터 다시 수행해야 합니다.

## 검증

- JS 209개 통과: 새 세션 테스트 19개와 새 readiness 테스트 2개 포함.
- TypeScript strict/noEmit 및 기존 Python 48개 통과.
- 23종 실제 Analyzer 인스턴스로 중단·카운트다운·재개 첫 프레임에서 count/hold/observed/gap 누적이 보존되는지 검사했습니다.
- 실제 SplitSquatAnalyzer의 완료 횟수 1→일시정지→1 유지→새 동작 2회, PlankAnalyzer와 SidePlankAnalyzer의 0보다 큰 유효 유지 시간 보존·재누적을 합성 관절로 확인했습니다.
- 2,254개 합성 관절 기반 실제 Analyzer의 session.state 응답을 세션 v1·프레임/세트 v2 JSON Schema로 검증했습니다.
- 별도 보관한 기존 시범 8개 클립의 MediaPipe 좌표도 재생했습니다. 7개 클립에서 인위적인 2.2초 누락과 5초 재개 구간을 삽입하고, 해당 구간 및 재개 첫 프레임에서 누적값이 변하지 않음을 검사했습니다. 정면 버피는 원래 미지원으로 이탈 삽입 검사에 들어가지 못했습니다.
- 위 재생은 실제 카메라 연결 시험이 아닙니다. 삽입 구간에는 한 프레임의 자세를 반복 사용했습니다. 기준 자세 보정이 다시 필요하거나 가림이 잦으면 전체 횟수가 줄거나 0회가 될 수 있습니다. 이를 정확도·재현율이나 전체 영상 정답 횟수 일치로 표현하지 않습니다.
- 모바일 OS/기기, 프론트 실제 화면·카메라, 여러 사람에 대한 검증은 미실시입니다. [검증 집계](validation/pose-session-20261125.json)를 확인하세요.
