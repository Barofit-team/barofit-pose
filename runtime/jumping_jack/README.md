# Jumping jack · 0.1

정면 일반 점핑잭의 시도 횟수와 자세 피드백. `JumpingJackAnalyzer`는 `pushFrame`, `breakContinuity`, `summary`, `finish`를 제공한다.

```js
import {JumpingJackAnalyzer} from '@barofit/pose';
const analyzer = new JumpingJackAnalyzer();
const realtime = analyzer.pushFrame(frame); // 기존 33개 MediaPipe PoseFrame
const endEvents = analyzer.finish();        // set.completed v2
```

횟수는 다리 벌리기→모으기의 완료된 시도다. 팔 동작이 부족해도 횟수는 유지한다. 팔만 흔들거나 관절이 가려져 다리 움직임을 확인할 수 없으면 횟수를 만들지 않는다. 영상 끝의 미완성 시도를 완성된 횟수로 보정하지 않는다.

`items/currentCodes`는 현재 관측, `lastRepetition`은 최근 회차 평가, `codes`는 두 값의 표시 후보다. 회차 평가는 `rep.feedback` 이벤트와 세트 `details.repetitions`에 저장한다. 준수율은 회차 기준이며 0–100이다. `unknown`은 분모에서 제외한다.

판정 근거, 초기 임계값, 검증 범위: [JUMPING_JACK_V01.md](../../docs/JUMPING_JACK_V01.md).
