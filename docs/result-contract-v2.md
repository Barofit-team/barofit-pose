# 세트 결과 JSON v2

푸쉬업·플랭크·버드독의 공개 Analyzer `summary()`와 `finish()`에 적용한다.
판정 임계값, 관절 계산, 카운트 조건, 상태 전이, 시간 집계 방식은 유지한다.

## 공통 구조

`finish()`는 이벤트 배열을 반환한다. 마지막 `set.completed` 이벤트의 `summary`에 결과가 들어간다. 종료를 다시 호출하면 빈 배열이다.

| 세트 종료 이벤트 | 내용 |
|---|---|
| schemaVersion | `2.0` |
| type | `set.completed` |
| exercise / engineVersion | 운동과 판정 엔진 버전 |
| timestampMs | 마지막 분석 프레임 시각. 입력과 같은 시간축의 밀리초, 프레임이 없으면 null |
| summary | 아래 공통 세트 요약 |

| summary 필드 | 내용 |
|---|---|
| schemaVersion / exercise / engineVersion | 결과 규격·운동·엔진 버전 |
| count | 완료 동작 수. 횟수를 측정하지 않는 운동은 null |
| holdSeconds | 운동별 유지 시간(초). 플랭크는 세 항목 모두 정상 판정 시간, 버드독은 품질과 별개인 관측 유지 시간. 미지원은 null |
| observedSeconds | 집계된 연속 샘플 구간의 시간(초). 실제 운동 시간으로 간주하지 않음 |
| gapSeconds | 집계에서 제외한 긴 샘플 공백(초). 미측정이면 null |
| items | 판정 항목 ID → 아래 공통 항목 집계 |
| details | 운동별 부가 정보. 버드독의 좌우 횟수·반복 내역·설정 등 |

## 항목별 준수율

| items 안의 필드 | 의미 |
|---|---|
| aggregationBasis | `repetition`(회차) 또는 `time`(시간) |
| unit | 각각 `repetitions` 또는 `seconds` |
| compliant | 준수한 회차 수 또는 시간 |
| warning | 경고가 발생한 회차 수 또는 시간 |
| unknown | 평가하지 못한 회차 수 또는 시간 |
| notApplicable | 그 항목이 적용되지 않는 구간. 별도로 집계하지 않는 엔진은 0 |
| evaluated | `compliant + warning` |
| compliancePct | `100 × compliant / evaluated`, **0~100**. evaluated가 0이면 **null** |

unknown·notApplicable은 분모에서 제외한다. null은 0점이 아니며 ‘평가 자료 없음’으로 표시한다.
서로 다른 집계 단위의 준수율이나 표본을 단순 합산하지 않는다. 같은 항목·단위·판정 버전의 세트를 합칠 때는 compliant와 evaluated를 각각 합한 뒤 비율을 계산한다.

| 운동 | 준수율 집계 | 횟수 / 시간 해석 |
|---|---|---|
| 푸쉬업 | 회차 | count는 완료한 시도 동작 수. 자세 경고로 카운트를 취소하지 않음. 시간 필드는 미측정 null |
| 플랭크 | 시간 | count는 null. holdSeconds는 골반·어깨·무릎이 모두 정상인 누적 시간. 경고·판정 보류 중에는 누적 중지 |
| 버드독 | 시간 | count는 한쪽 뻗기→복귀 1회(좌우 한 번씩이면 2회). holdSeconds는 품질과 별개로 관측된 유지 시간 |

버드독은 **횟수를 세지만 준수율은 시간 기준**이다. 기존 집계를 그대로 보존했다. 준비·가림·전환 구간의 처리도 기존 알고리즘을 따른다. 척추 중립 등 미지원 항목은 0%로 만들어 넣지 않는다.

## 연결 방법과 변경 범위

```js
const events = analyzer.finish();
const result = events.find(e => e.type === 'set.completed');
// result.summary.items[itemId].compliancePct
// result.summary.items[itemId].aggregationBasis
```

- 이전 `compliance_pct`(0~100), `compliance`(0~1)를 모두 `compliancePct`(0~100)로 통일했다.
- 이전의 flattened 세트 종료 결과 대신 `event.summary`를 사용한다.
- JS 공개 프레임 결과는 [실시간 결과 v2](realtime-contract-v2.md)를 사용한다. `rep.completed` 등 비종료 이벤트 내용은 기존 규격을 유지한다. 해당 이벤트의 `t`, `start_s`, `end_s`는 기존대로 초 단위다. 세트 종료 이벤트의 timestampMs만 밀리초다.
- 스쿼트와 원시/과거 비교용 엔진은 이번 변환 대상이 아니다. 푸쉬업은 공개 `PushupAnalyzer`를 사용한다. 저수준 `PushupEngine`·`LivePushupEngine` 결과는 기존 규격이다.
- Python의 푸쉬업 배치 참조 엔진은 모바일 엔진과 구현이 다르므로 engineVersion으로 구분한다. 출력 구조는 같다.
- Python 플랭크에는 JS와 같은 시간 집계 출력부를 추가했다. 자세 판정 규칙은 바꾸지 않았다.
- 테스트 웹의 녹화·사용자 메모 등 외부 보고서 형식은 유지하고, 세 운동 모두 `summary`에 공통 결과를 담는다. ZIP에는 동일 규격의 `set.completed.json`도 별도로 저장한다. 세션 ID·영상 경로는 앱/백엔드가 붙이는 메타데이터다.
- 과거에 저장한 JSON과 설치된 APK는 자동으로 바뀌지 않는다. 앱은 새 모듈을 반영해 다시 빌드해야 한다.

예제: `examples/results-v2/`의 운동별 `set.completed.json`.
로컬 테스트 웹 반영: `node examples/web/install-result-contract.mjs <site/dist>`.

플랭크 유지 시간의 누적·보류 기준: [관측 유지 시간](PLANK_HOLD.md). JSON 필드 구조는 변경하지 않았다.

## JSON Schema

검사 파일: [set-completed-v2.schema.json](../schemas/set-completed-v2.schema.json). `evaluated = compliant + warning`과 준수율 산술 관계, 봉투·summary의 engineVersion 일치는 별도 검증한다. JSON Schema는 필드·형식·단위 조합·범위를 검사한다.
