# 실시간 결과 규격 v2

앱·웹에서 사용하는 `runtime/`의 `PushupAnalyzer`, `PlankAnalyzer`, `BirdDogAnalyzer`, `JumpingJackAnalyzer`, `LegRaiseAnalyzer.pushFrame()` 규격이다. 운동별 판정 의미를 유지하면서 같은 반환 구조를 제공한다.

## 설계 원칙

**공통 봉투 + 운동별 정보**로 구분한다. `exercise`를 보고 운동 고유 화면을 선택하고, 공통 화면은 같은 필드로 처리한다. 운동마다 의미가 다른 항목을 같은 판정으로 합치지 않는다.

- `schemaVersion`은 반환 형식, `engineVersion`은 판정 구현 버전이다.
- 모든 결과에 같은 최상위 필드가 있다. 미제공 수치는 `null`, 빈 목록은 `[]`, 빈 항목은 `{}`다. `0`은 실제 0이다.
- `items`는 현재 관측, `lastRepetition`은 최근 회차 평가다. 두 값을 섞어 현재 자세를 표시하지 않는다.
- 운동 고유 각도·거리는 `metrics`, 좌우 횟수·원시 상태·진단 정보는 `details`에 보존한다.
- 카운트, 유지 시간의 계산 기준은 `measurementBasis`로 명시한다.

TypeScript의 [discriminated union](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions), OpenAPI의 [discriminator](https://spec.openapis.org/oas/v3.0.4.html#discriminator-object), JSON Schema의 [필수 필드](https://json-schema.org/understanding-json-schema/reference/object)와 [oneOf](https://json-schema.org/understanding-json-schema/reference/combining)를 참고했다. HTTP API를 추가한 것은 아니며, 앱 내부 데이터 객체에도 같은 계약 설계 방식을 적용했다.

## 공통 필드

| 필드 | 의미 / 프론트 사용 |
|---|---|
| `schemaVersion`, `type` | `2.0`, `frame.result` |
| `exercise`, `engineVersion` | 운동 종류, 판정 구현 버전 |
| `timestampMs` | 입력 프레임과 같은 시간축의 밀리초. 서버 시각이 아님 |
| `ignored`, `ignoredReason` | 무시한 입력 여부와 이유. 무시한 결과는 화면·TTS에 적용하지 않음 |
| `tracking` | `tracking`, `selecting_side`, `tracking_unavailable`. 정상 자세나 전 항목 평가 가능을 뜻하지 않음 |
| `side` | 선택한 해부학적 좌우. 버드독은 유지 중인 다리가 한쪽일 때 그쪽, 양쪽/없음은 null |
| `count` | 누적 횟수. 지원하지 않으면 null |
| `holdSeconds` | 누적 유지 시간(초). 아래 운동별 누적 조건 확인 |
| `observedSeconds` | 모듈이 누적한 연속 관측 시간(초). 세션 전체 경과 시간이 아님 |
| `measurementBasis` | 횟수·유지·관측 시간 각각의 계산 기준 |
| `phase` | 엔진의 동작 단계. 미제공은 null. 프론트의 준비/시작/휴식 상태와 별개 |
| `items` | **현재 관측** 항목 ID → 판정 상태 |
| `currentCodes` | 현재 관측 경고 코드 |
| `lastRepetition` | 최근 회차 번호·평가 시각·항목·경고·측정값. 평가 표시 구간 밖이면 null |
| `codes` | 기존 엔진의 표시 후보 코드 그대로. 현재 경고와 최근 회차 경고가 함께 있을 수 있음 |
| `metrics` | 운동별 측정값. 기존 이름·단위 유지, 측정 불가 값은 null |
| `events` | 이번 호출에서 발생한 원본 엔진 이벤트. 같은 스냅샷을 반복해서 이벤트처럼 처리하지 않음 |
| `details` | 운동별 상세 정보. 공통 UI에서 전부 해석할 필요 없음 |

## 운동별 의미 — 반드시 유지

| 정보 | 푸쉬업 | 플랭크 | 버드독 |
|---|---|---|---|
| count | 완료된 움직임 시도 | null | 한쪽 다리 뻗기→복귀 1회. 좌우 합하면 2회 |
| count 기준 | `completed_attempt` | null | `one_leg_out_and_back` |
| holdSeconds | null | 관측된 플랭크에서 골반·어깨·무릎이 모두 기준 충족한 시간 | 기존 엔진이 holding으로 관측한 시간. 자세 오류 여부와 별개 |
| holdSeconds 기준 | null | `all_required_items_compliant` | `observed_holding` |
| observedSeconds | null — 기존 엔진이 제공하지 않음 | 연속 샘플 구간 누적 | 연속 샘플 구간 누적 |
| phase | null | null | not_ready / preparation / reaching / holding / returning |
| items | 현재 골반 상태 `hip` | hip / shoulder / knee | 좌우 팔·다리·지지 관절, 같은 쪽 동작, 몸통 움직임 등 기존 항목 |
| lastRepetition | hip / elbow / chest / hand / return 회차 평가 | null | null — 기존 엔진이 이 형태의 회차 평가를 제공하지 않음 |
| details | diagnostics, 원본 hipStatus | 원시 판정 raw | sideCounts, holdingSides, body, enginePhase, 기준 한계 정보 |

버드독의 `body_movement`는 유지 중 몸통 움직임이며 척추 중립 판정이 아니다. `lumbar_neutral`, `axial_rotation`의 `not_supported`를 유지한다. 팔꿈치 굽힘 경고를 팔꿈치 벌어짐의 확정 판정으로 바꾸지 않는다.

푸쉬업 `lastRepetition.timestampMs`는 **회차 평가가 확정된 시각**이다. 동작 시작·종료 시각은 원본 이벤트의 `start_s`, `end_s`로 확인한다. 엔진의 기존 피드백 표시 시간 동안만 `lastRepetition`을 제공하며, 영구 보관용 회차 목록이 아니다. 모든 회차 기록이 필요하면 `rep.feedback` 이벤트를 누적한다.

## 프론트 처리

1. `ignored`이면 결과를 적용하지 않는다. 중복·역순은 `non_monotonic_timestamp`, 종료 후 입력은 `finished`다. 누적값은 보존되지만 현재 판정·경고·이벤트는 비운다.
2. 정상 처리된 결과로 횟수·시간을 갱신한다. 값이 null이면 해당 지표를 숨긴다.
3. 현재 항목 카드는 `items`, 최근 회차 카드는 `lastRepetition.items`로 따로 표시한다. 이전 회차 카드가 null이 되면 기존 카드를 지우거나 과거 평가라고 명시한다.
4. `codes`는 TTS 재생 명령이 아니다. 기존 음성 간격·중복 억제 정책을 거친다. 현재 경고만 필요하면 `currentCodes`를 쓴다.
5. 버드독 좌우 횟수 등은 `exercise`로 분기해서 `details`에서 읽는다.
6. 뼈대는 입력에 사용한 landmarks를 그린다. 반환 결과에 좌표를 중복 복사하지 않는다. 프레임 시각을 맞춰 화면에 반영한다.

`within_reference`만 기준 충족이며 `warning`은 경고다. `pending_feedback`(대기), `tracking_unavailable`/`unknown`(평가 불가), `body_unavailable`/`body_deviation`(몸통 때문에 보류), `interrupted`, `not_applicable`, `not_supported`, `disabled`는 서로 구분한다. 경고 코드가 없다고 정상으로 처리하지 않는다.

잘못된 입력 형식은 기존처럼 TypeError다. 데이터 형식 오류와 정상 입력의 관절 미검출은 다르다.

## 단위·이벤트 호환

반환 봉투와 `lastRepetition.timestampMs`는 밀리초, 누적 시간은 초다. 기존 비종료 이벤트 내용은 보존했다. 이벤트의 `t`, `start_s`, `bottom_s`, `end_s`, `feedback_end_s`는 **초**다. `events`는 `type`으로 구분하는 운동별 데이터이며, 프레임마다 동일한 이벤트 필드를 강제하지 않는다. `finish()`의 세트 종료 결과는 기존 [세트 결과 v2](result-contract-v2.md)를 그대로 사용한다.

`metrics`의 기존 단위도 바꾸지 않았다. 플랭크 `hip_offset_pct`는 %, 나머지 `_deg`는 도다. 버드독 `_ratio`는 비율, `_deg`는 도, `_ratio_s`·`_deg_s`는 초당 변화량이다. 푸쉬업 원시 `hip`은 %, `elbow`는 도이며 `chest`는 손목–어깨의 화면 수직 거리/이미지 긴 변, `body`는 어깨–발목 거리/이미지 긴 변, `hand`는 어깨–발목 축에 대한 손목 투영 위치 비율이다. 모두 픽셀 자체가 아닌 무차원 비율이다. 회차 `lastRepetition.metrics.chest_range` 등 정규화된 값과 혼용하지 않는다.

## 스쿼트·런지 추가 시

- 엔진 계산을 바꾸지 말고 같은 필드로 반환하는 어댑터를 작성한다.
- 각 항목이 현재 프레임 판정인지 회차 평가인지 먼저 정한다. 스쿼트처럼 혼합이면 각각 나누어 전달한다.
- 횟수 단위(좌우 합계인지, 한쪽 1회인지), 유지 시간 조건, 시간 공백 처리, 지표 단위를 명시한다.
- 운동 전용 필드는 `details`와 운동별 타입에 추가한다. 새로운 운동을 정상 지원하기 전에 `exercise` union, JSON Schema 분기와 테스트를 함께 확장한다.
- 정상·관절 미검출·평가 대기·중복 프레임·일시정지 후 재개·종료 후 입력에서 같은 최상위 구조인지 확인한다.
- 반환 변경 전후의 카운트·경고·수치·세트 집계가 동일한지 비교한다.

스쿼트·런지는 이 규격의 적용 범위와 별도로 확인한다. Python `analysis/`와 내부 엔진의 원본 출력은 연구·비교용으로 보존했다. 프론트는 원본 엔진 대신 공개 Analyzer를 사용한다.

## 파일 / 이전 규격에서 이동한 필드

- 타입: `runtime/common/contracts.d.ts` (`FrameResult` 운동별 union)
- 검사 스키마: `schemas/frame-result-v2.schema.json`
- 변환 코드: `runtime/common/realtime.js`
- 실사용 예제: `examples/realtime-consumer.mjs`
- 실제 출력 샘플: `examples/realtime-v2/`

| 기존 필드 | v2 |
|---|---|
| 푸쉬업 items | lastRepetition.items. 현재 hip은 items.hip |
| 푸쉬업 hipStatus / diagnostics | details.hipStatus / details.diagnostics |
| 플랭크 raw | details.raw |
| 버드독 movementPhase | phase |
| 버드독 phase(거친 구분) | details.enginePhase |
| 버드독 sideCounts / holdingSides / body | details의 같은 이름 |

기존 APK·배포된 사이트는 별도 번들이므로 자동으로 업데이트되지 않는다. 새 모듈을 가져갈 때 소비 코드도 함께 바꿔야 한다. 이 변경은 반환 규격 변경이므로 v1과 호환되는 형식이라고 취급하지 않는다.


## 점핑잭 추가 · 2026-10-21

`JumpingJackAnalyzer`도 같은 v2 봉투를 사용한다. `exercise=jumping_jack`, `count`는 다리 벌리기→모으기 시도 수, `holdSeconds=null`이다. 항목은 `arm_raise`, `leg_open`, `coordination`, `return`, `torso`이며 세트 준수율은 회차 기준 0–100이다. 현재 판정과 최근 회차 판정은 기존처럼 분리한다. [상세 기준과 사용법](JUMPING_JACK_V01.md). 기존 운동의 의미와 판정 규칙은 변경하지 않았다.

## 레그 레이즈 추가 · 2026-10-23

`LegRaiseAnalyzer`는 `exercise=leg_raise`, `measurementBasis.count=completed_raise_lower_attempt`를 반환한다. `knee_extension`은 현재 관측, `lowering_control`은 회차 완료 후 `lastRepetition`에 평가된다. `lumbar_contact`는 `not_supported`이며 정상 상태로 표시하지 않는다. 유지 시간은 `null`이다. [기준과 측정값](LEG_RAISE_V01.md).

템포 관측값은 실시간 `metrics.tempo`, 회차 `lastRepetition.metrics.tempo`, 세트 `summary.details.repetitions[].metrics.tempo`에 저장한다. 카운트·판정·준수율은 유지한다. [필드와 측정 방법](LEG_RAISE_TEMPO.md).

## 글루트 브리지

`exercise: glute_bridge`, `count`는 상승·복귀 시도 수, `holdSeconds`는 null입니다. 항목은 회차 기준이며 `compliancePct`는 0–100 또는 null입니다. 실시간 `measurementBasis.count`는 `completed_bridge_raise_lower_attempt`입니다. 상세 항목·관측 템포·미지원 항목은 [글루트 브리지 기준](GLUTE_BRIDGE_V01.md)에 정리했습니다.

## 수퍼맨 추가

`exercise: "superman"` 분기를 추가합니다. 공통 필드의 의미와 기존 운동 분기는 유지합니다. `count`는 상승·복귀 완료 횟수, `holdSeconds`는 상승을 관측한 뒤 들린 상태에서 정지한 시간입니다. 자세 준수 시간과 구분합니다. 판정 항목은 `knee_extension`, `arm_extension`, `movement_control`이며 세트 집계는 `aggregationBasis: "repetition"`, `unit: "repetitions"`, `compliancePct: 0–100 또는 null`입니다. [세부 정의](SUPERMAN_V01.md)를 참고하세요.


### 파이크 푸시업

`exercise: pike_pushup`은 회차 기반 운동입니다. `count`는 완료된 하강–상승 시도, `holdSeconds`는 null입니다. 항목은 `pike_shape`, `head_path`, `press_return`이며, 세트 준수율은 회차 기준 0~100입니다. 미평가 항목은 분모에서 제외하고 평가 0회면 null입니다. [최신 판정·검증](PIKE_PUSHUP_V02.md) · [입출력·실행 방법](PIKE_PUSHUP_V01.md)을 참고하십시오.
