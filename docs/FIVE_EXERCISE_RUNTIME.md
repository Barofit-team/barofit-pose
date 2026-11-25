# 추가 5종 JS 분석기 — 실험 버전 0.1

## 앱에서 사용할 수 있는 범위

공개 진입점 `runtime/index.js`에서 아래 분석기를 import합니다. 기존 18종에 5종을 추가하여 JS 지원 운동은 23종입니다. MoveNet 푸시업 어댑터는 별도 운동으로 세지 않습니다. 풀업과 인버티드 로우의 JS 이식은 이번 변경에 포함하지 않습니다.

| 운동 ID | 클래스 | 1회 후보 기준 | 촬영 |
|---|---|---|---|
| `jump_squat` | `JumpSquatAnalyzer` | 서기 → 무릎 굽힘 → 발목 상승·무릎 폄 → 착지 후보 | 측면·사선, 발목 포함 |
| `reverse_crunch` | `ReverseCrunchAnalyzer` | 무릎–어깨 거리/몸통 길이가 감소한 뒤 복귀 | 측면·사선, 교차 다리 변형 시범 기준 |
| `flutter_kicks` | `FlutterKicksAnalyzer` | 위쪽 다리가 좌→우→좌 또는 우→좌→우로 교대 | 양쪽 골반·발목·어깨가 보이는 측면·사선 |
| `burpee` | `BurpeeAnalyzer` | 서기 → 몸통 수평·무릎 폄을 동반한 바닥 자세 → 서기 | 전신 측면. 정면 미지원 |
| `situp` | `SitupAnalyzer` | 몸통 낮춤 → 일으킴 → 다시 낮춤 | 측면·사선, 어깨·골반·무릎·발목 |

모두 **자동 횟수 후보**입니다. 운동 수행·정자세를 인증하지 않습니다. `items.form` 및 완료 회차의 `lastRepetition.items.form`은 `unknown`이며, 세트 `items.form.unknown`에 회차를 누적합니다. `compliancePct`는 null입니다. 점프 스쿼트의 발목 상승은 화면상의 상승 후보로, 실제 공중 체류를 보장하지 않습니다. 버피는 점프·푸시업 완료를 별도로 평가하지 않습니다.

## 입력·출력과 프론트 연결

입력은 [기존 규격](IO_CONTRACT.md)의 `pushFrame({landmarks,width,height,timestampMs})` 그대로입니다. 출력은 `frame.result` v2와 `set.completed` v2입니다. 새 exercise 분기·measurementBasis·TypeScript 선언·CameraReadiness 프로필·JSON Schema를 함께 추가했습니다. 시간은 프레임에서 밀리초, `events[].t`에서 초입니다.

```js
import {BurpeeAnalyzer,CameraReadiness} from '@barofit/pose';
const analyzer=new BurpeeAnalyzer();
const readiness=new CameraReadiness({exercise:'burpee'});
// 카메라 프레임마다 readiness.pushFrame(frame)으로 관측 가능 여부를 확인합니다.
// 앱이 '운동 중'이고 측정 가능할 때만 analyzer.pushFrame(frame)을 호출합니다.
const frameResult=analyzer.pushFrame(frame);
analyzer.breakContinuity('auto_pause');
// 일시정지·재인식·5초 카운트다운 중에는 analyzer에 프레임을 넣지 않습니다.
// 운동 재개 후 정상 카메라 시간축의 프레임부터 다시 전달합니다.
const resumedResult=analyzer.pushFrame(resumedFrame);
const events=analyzer.finish();
```

위 예제의 `frame`/`resumedFrame`은 앱의 실제 MediaPipe 입력 객체입니다. 프론트는 `CameraReadiness`의 `ready`뿐 아니라 **현재 프레임의 `observable`**도 확인해야 합니다. ready에는 이탈 유예 시간이 있어 즉시 false가 되지 않을 수 있습니다.

- `breakContinuity(reason)`: 완료 횟수, 관측 시간, 이전 회차 집계를 유지합니다. 미완료 회차, 단계 확인 타이머, 좌우 선택, 기준 자세 보정을 버립니다. 명시적 중단 구간은 관측 시간·gapSeconds에 넣지 않습니다.
- 누락·낮은 visibility/presence·화면 밖 관절: 해당 동작을 이어 세지 않습니다. 한 프레임 누락도 미완료 회차를 취소하므로 가림이 잦으면 과소 집계될 수 있습니다.
- 프레임 공백 >350ms: 미완료 회차와 기준을 버리고 공백 전체를 gapSeconds로 기록합니다.
- 해상도 변경·사용 측 변경: 미완료 동작과 기준을 다시 설정합니다. 회전·크롭 변경은 앱에서 breakContinuity를 호출해야 합니다.
- 중복/역순 입력과 finish 이후 입력: ignored이며 내부 누적값을 변경하지 않습니다. finish 재호출은 []입니다.
- Analyzer 자체는 세션 흐름을 실행하지 않습니다. 2초 이탈·5초 재개 흐름은 [ExerciseSessionController](POSE_SESSION_RECOVERY.md)로 연결할 수 있습니다. 카메라 콜백, 운동·휴식 타이머 표시, UI·TTS는 프론트에서 연결합니다.
- `observedSeconds`는 연속해서 관측 가능한 프레임 사이 시간입니다. 운동 유효 자세 유지 시간이나 세션 총 시간으로 쓰지 않습니다. holdSeconds는 null입니다.

## 측정과 임계값

- x,y를 원본 이미지 픽셀로 변환하여 각도와 거리비를 계산합니다. NaN/Infinity/null, visibility 또는 presence <0.5, 화면 밖 좌표를 사용하지 않습니다. 보간·미래 프레임 필터링을 하지 않습니다.
- 한쪽만 필요한 종목은 최초 유효 후보 중 최소 관절 신뢰도가 높은 쪽을 선택하고, 유효한 동안 고정합니다. 반대쪽으로 바뀌면 새 동작으로 시작합니다. `{side:'left'|'right'}`로 고정할 수도 있습니다.
- 점프 스쿼트 auto에서 양쪽이 유효하면 두 무릎 각도 중 작은 값과 발목 y의 평균을 사용합니다. 한쪽/양쪽 측정 범위가 바뀌면 보정을 다시 합니다. 고정 side에서는 지정한 쪽만 씁니다.
- 플러터킥은 양쪽이 필요하며 side 고정 옵션을 받지 않습니다. 반환 side:null은 양쪽 비교를 뜻합니다.
- 점프 스쿼트: 무릎 ≥155°, 몸통 ≥55°인 서기 300ms로 바닥 기준 보정. 무릎 <130° → 무릎 >145° 및 발목 y 상승 >이미지 높이 6.5% → 기준 높이 2.5% 이내 복귀. 단계마다 60ms 확인.
- 리버스 크런치: 같은 쪽 무릎–어깨 거리/몸통 길이 ≥1.63 → ≤1.49 → ≥1.63. 단계마다 160ms 확인. 골반 말림 자체를 평가하지 않는 시범용 대리지표입니다.
- 플러터킥: 다리 상승 각도 차이 ≥12°, 높은 쪽 ≥8°, 70ms 확인, 교대 간격 ≥160ms. 같은 단계 1,500ms 초과 시 교대 이력을 버립니다. 교대 2번이 1회입니다.
- 버피: 서기 300ms로 어깨 높이와 신장 투영값 보정. 어깨 하강/신장 >0.58, 손목이 어깨 아래쪽, 몸통 수평 대비 <40°, 무릎 >140°를 150ms 확인. 하강비 <0.23·골반 아래 방향 복귀를 100ms 확인하면 1회입니다.
- 싯업: 몸통 수평 대비 ≤24° → ≥48° → ≤24°, 각 단계 90ms 확인. 골반–발목 높이 차이가 몸통 길이 1.2배 이내인 바닥 운동만 관측합니다.
- 10초를 넘는 미완료 동작은 취소하고 시작 자세부터 다시 확인합니다. 장시간 멈춘 동작을 새 회차로 이어 세지 않습니다.

기존 Python Colab은 전체 영상 보간·평활화, 초기 기준 구간, 관절 신뢰도 기준, 좌우 선택이 다릅니다. 실시간 JS는 인식 누락을 넘어 이어 세지 않으므로 Python과 횟수 일치를 보장하지 않습니다. 기존 Python 실험 코드를 수정하거나 앱에 직접 연결하지 않습니다.

## 검증 및 한계

합성 테스트는 정상 왕복, 정지, 순간 흔들림, 불완전 동작, 누락·저신뢰도·화면 이탈, 좌우 변경, 공백, 해상도 변경, 명시적 일시정지, 5초 후 재개, 중복/역순 입력, 종료 재호출을 확인합니다. 정상 자세 정확도 시험이 아닙니다.

별도 보관된 기존 시범 ZIP 5종(총 8개 클립)의 MediaPipe 좌표를 새로 추출해 JS auto로 재생했습니다. 원본 영상·좌표는 커밋하지 않았고 집계값만 [검증 기록](validation/five-exercise-runtime-20261124.json)에 기록했습니다. 아래 숫자는 수동 정답이 없는 자동 후보로, 정확도·재현율이 아닙니다.

| 시범 | 후보 횟수 |
|---|---:|
| 점프 스쿼트 사선 | 5 |
| 리버스 크런치 교차 다리 | 3 |
| 플러터킥 사선 / 측면 | 6 / 5 |
| 버피 정면 / 측면 | 0 / 1 |
| 싯업 반복 / 단일 | 10 / 1 |

정면 버피는 낮은 관측률로 검증에 실패하여 지원하지 않습니다. 가림·좌우 오인·카메라 각도에 따라 결과가 달라집니다. 점프 스쿼트 고정 side 오른쪽은 같은 시범에서 1회, 왼쪽은 5회였으므로 auto 또는 관측이 좋은 쪽을 사용해야 합니다. 플러터킥 두 촬영 방향도 후보가 달라 실제 검수가 필요합니다. 서로 다른 사람·기기·속도에 대한 일반화 검증, 실제 앱 카메라·프론트 통합 시험은 아직 하지 않았습니다.

재생: `node examples/pilot_replay.mjs situp /local/frames.jsonl`. 좌표 한 줄은 공통 PoseFrame 객체입니다. 고정 side는 마지막 인자로 전달합니다. `BAROFIT_REPLAY_OUTPUT` 환경변수를 지정하면 프레임·종료 이벤트를 로컬 JSON으로 저장합니다.

자동 검사 명령과 결과는 검증 기록에 함께 보존합니다.

검사 명령:

- `npm test`: 188개 통과 (신규 28개 포함).
- `npm run test:types`: TypeScript 7.0.2 strict/noEmit 검사 통과. CI에서도 실행합니다.
- `python -m unittest discover -s tests/python -v`: 기존 48개 통과.
- 별도 보관된 시범 좌표의 프레임·종료 응답 2,064개를 두 v2 JSON Schema로 검증했습니다.
