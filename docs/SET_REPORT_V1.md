# 세트 리포트 집계 v1 — 23종 공통

## 변경 범위

23종 공개 JS Analyzer의 summary()/finish()에 공통 리포트 집계를 연결했습니다. 기존 frame.result v2와 set.completed v2의 최상위 봉투·items의 단위/준수율, 카운트·운동 판정 규칙은 유지합니다. Python 배치 출력에는 JS 실시간 관측 기록이 없으므로 같은 추적률을 임의로 채우지 않습니다.

추가 정보는 summary.details에 둡니다. 기존 details.reps, configuration, protocol, experimental 등은 보존합니다. 프론트 저장소와 Java 리포트 서비스 코드는 이번 AI 저장소 PR에서 변경하지 않습니다.

| 공통 경로 | 의미 |
|---|---|
| details.repetitions | number, timestampMs, side, items, codes, metrics를 갖춘 완료 회차 목록 |
| details.sideCounts | 제공 가능한 좌우 횟수. 확인할 수 없으면 null |
| details.sideHoldSeconds | 엔진이 제공하는 좌우 유지 시간. 미지원이면 null |
| details.itemLabels | 현재 summary.items의 itemId → 한국어 이름 |
| details.report | 아래의 리포트 지표 v1 |

스쿼트의 기존 details.reps는 호환용으로 남기고 공통 repetitions를 추가합니다. 기존 repetitions의 엔진 고유 필드도 제거하지 않고 공통 필드를 보완합니다. 버드독처럼 자세가 시간 기준인 종목은 회차에 없는 자세 평가를 만들어내지 않습니다. 푸시업은 실시간 rep.completed/rep.feedback를 기록해 엔진의 짧은 피드백 표시 기간이 지나도 완료 회차를 보존합니다.

## 오류 코드

- feedbackCodes: 세트에서 실제 관측된 현재 경고 코드 또는 완료 회차 경고 코드의 합집합. 화면 문구가 아닌 안정된 코드 문자열입니다.
- errorCounts: 코드별 발생 횟수. **프레임 개수가 아닙니다.**
- errorCountBasisByCode: 각 코드의 집계 단위. completed_repetitions 또는 warning_episodes.
- repetitionErrorCounts: 완료 회차 중 해당 코드가 있는 회차 수. 같은 회차 카드가 여러 프레임 표시되거나 완료 이벤트와 카드가 동시에 있어도 한 번만 셉니다.
- warningEpisodeCounts: currentCodes에서 경고가 새로 나타난 관측 구간 수. 경고가 끊기거나 연속성이 초기화된 뒤 다시 나타나면 새 구간입니다.
- warningSeconds: 같은 관측 쪽에서 연속 유효한 양 끝 프레임에 모두 존재한 현재 코드의 구간 시간. 400ms를 넘는 공백·명시적 중단 구간은 더하지 않습니다.

자세가 회차 기준인 운동은 errorCounts에 완료 회차 오류를 사용합니다. 플랭크·사이드 플랭크·버드독 등 항목이 시간 기준인 운동은 경고 구간 수를 사용합니다. 스쿼트는 깊이 오류 SQUAT_SHALLOW가 회차 기준, 몸통 TRUNK_LEAN은 경고 구간 기준이므로 코드별 단위를 명시합니다. 서로 다른 단위를 합해 '오류 동작 총 횟수'라고 표현하지 않습니다.

현재 경고가 발생했지만 회차가 완료되지 않거나 최종 회차 평가에서 해제될 수 있습니다. 이 경우 feedbackCodes/warningEpisodeCounts에 관측 이력은 남더라도 완료 회차의 errorCounts에는 포함되지 않을 수 있습니다. 후속 회차 평가가 수정되면 최신 네이티브 회차/rep.feedback로 갱신하며 과거 잠정 회차 오류를 중복 누적하지 않습니다.

## 세트 점수

postureScore = 평가 데이터가 있는 항목별 (100 × compliant / evaluated)의 산술평균입니다. 시간/회차의 원시 수량을 섞어 합하지 않고, 각 항목의 비율을 동일 가중치로 평균합니다.

- evaluatedItemCount와 scoreBasis를 함께 제공합니다.
- unknown, interrupted, not_applicable, not_supported 등 미평가는 분모에 넣지 않습니다.
- 평가 가능한 항목이 없으면 null입니다. '0점' 또는 '100점'으로 만들지 않습니다.
- 신규 Pilot 5종은 횟수를 세어도 form이 unknown이므로 자세 점수는 null입니다.
- 이 점수는 관측된 규칙 준수율의 요약이며 운동 수행의 전체 정확도·의학적 안전성 점수가 아닙니다. 관측 항목이 적은 높은 점수를 전신 자세가 좋다는 뜻으로 확대하지 않습니다.

## 추적률

trackingAvailablePct = 100 × tracking.availableSeconds / tracking.totalSeconds. 분모가 없으면 null입니다.

Analyzer 단독 사용:
- 유효하게 받아들인 프레임 사이 시간을 분모로 사용합니다. 양 끝이 tracking이고 간격이 400ms 이내인 구간만 available입니다.
- selecting_side/tracking_unavailable와 긴 공백은 사용할 수 없는 구간입니다.
- 명시적 breakContinuity로 끊은 시간은 분모에서도 제외합니다.
- tracking.acceptedFrames는 Analyzer가 받아들인 프레임 수이며 중복/역순/종료 후 프레임은 제외합니다. 프레임 비율을 추적률로 쓰지 않습니다.

ExerciseSessionController 사용:
- basis는 session_observability_intervals입니다. Controller가 분석기로 보내지 않은 인식 손실도 관측하므로 거짓으로 100%가 되지 않습니다.
- 최초 측정 시작 이후 카메라 관측 가능 여부로 계산합니다. 자동 인식 손실·자동 일시정지 중 재인식 대기는 포함하되, 수동 일시정지·5초 카운트다운은 분모에서 제외합니다.
- tracking은 관절을 관측할 수 있는가에 관한 지표이며 자세가 정상인가 또는 모델 위치 정확도가 얼마인가를 뜻하지 않습니다.
- 해당 통계는 분석기의 count/holdSeconds/observedSeconds/gapSeconds를 변경하지 않습니다. 추적률의 관측 시도 시간과 유효 운동 유지 시간은 서로 다른 값입니다.

## 후반 자세 저하 후보

lateFormBreakdown은 '피로 진단'이 아닌 규칙 준수율 하락 후보입니다.

- 회차 기준: 회차 순서의 앞 절반/뒤 절반에서 공통으로 평가된 항목을 비교합니다. 항목마다 각 절반에 최소 3회의 평가가 필요합니다.
- 시간 기준: 측정 구간을 1초 버킷으로 집계한 앞 절반/뒤 절반을 비교합니다. 항목마다 각 절반에 최소 5초 평가가 필요합니다.
- 공통으로 비교 가능한 항목만 동일 가중치로 평균합니다.
- 앞 점수 − 뒤 점수가 15점 이상이면 candidate:true, 충분한 비교 자료가 있고 하락이 작으면 false입니다.
- 자료가 부족하거나 완료 회차 기록이 불완전하거나 마지막 추적 상태가 측정 불가이면 candidate:null과 이유를 반환합니다.
- earlyScore/lateScore/dropPoints/itemIds/최소 평가량/비교 단위를 제공하므로 비교 범위를 확인할 수 있습니다.
- 15점·최소 3회/5초는 공학적 후보 기준이며 별도의 사람별 정답 검증을 마친 기준이 아닙니다.

## 하위 연동

기존 workout DTO에 이미 있는 세 필드는 다음 어댑터로 얻을 수 있습니다. 프론트 파일 자체는 수정하지 않았습니다.

```js
import {workoutReportFields} from '@barofit/pose';
const end=analyzer.finish().find(e=>e.type==='set.completed');
const {feedbackCodes,errorCounts,trackingAvailablePct}=workoutReportFields(end.summary);
// 기존 set payload의 빈 배열/빈 객체/null 대신 위 값을 사용할 수 있습니다.
```

어댑터는 기존 workout 제한(코드 20개 이하, 대문자/밑줄 1~50자, 오류 횟수는 nonnegative int, 추적률 0~100 또는 null)을 검사하고, 초과 자료를 조용히 자르지 않고 오류를 발생시킵니다. 분석기의 원본 report 지표는 이 제한 때문에 잘라내지 않습니다.

항목명은 ITEM_LABELS, itemLabel(id), details.itemLabels로 제공합니다. 배포/언어 간 공통 자료는 [posture-item-labels.json](../schemas/posture-item-labels.json)입니다. 현재 23종 항목과 좌우 버드독 항목, 알려진 미지원 항목을 포함합니다. 알 수 없는 미래 항목은 '자세 평가 항목'으로 표시하며 원시 id를 사용자 문장에 노출하지 않습니다.

**GeneratedReportService.java의 기존 4개 하드코딩 라벨은 AI 저장소 변경만으로 바뀌지 않습니다.** 해당 서비스에서 details.itemLabels를 보존·사용하거나 이 JSON의 라벨을 반영해야 합니다. 이번 PR은 AI가 공통 리포트 데이터와 한국어 이름을 제공하는 범위이며, 프론트나 Java 서비스가 이미 새 필드를 전송/소비한다고 주장하지 않습니다. 원본 영상·관절 좌표를 리포트 API로 전송하지 않습니다.

## 호환성과 검증

- JS 공개 pushFrame/summary/finish/breakContinuity를 공통 집계기가 관찰합니다. 사설 _pushFrameLegacy 또는 core.pushFeatures로 직접 우회하면 해당 실시간 관측 이력은 집계할 수 없습니다.
- 기존 결과의 카운트·자세 항목·이벤트·시간·Python/JS 판정 동등성 검사는 유지하고, JS에 새로 생긴 리포트 메타데이터만 기존 기준 결과 비교에서 분리했습니다.
- 23종의 빈 세트/라벨/통일된 details, 회차 중복 표시, 최종 피드백 갱신, 평가 중단, 정지·누락·타임스탬프·pause/finish, 시간 가중 추적률, 후반 후보의 자료 부족을 테스트합니다.
- 실제 규칙으로 생성한 플랭크 경고와 스플릿 스쿼트 오류 회차도 세트 리포트까지 확인합니다.
- 기존 8개 시범 좌표 재생은 카운트 변화 없이 리포트 직렬화를 확인하는 보조 검사입니다. 자세 점수·후반 후보의 사람 정답 정확도를 검증한 것은 아닙니다.
- 정의: [set-report-v1.schema.json](../schemas/set-report-v1.schema.json). 기존 v2 세트 스키마는 report가 있는 경우 공통 필드를 검사하되, report 없는 기존 Python/레거시 v2는 허용합니다.

## 리포트 서버 변경안

별도 서버 저장소에 적용할 [라벨 패치](../integrations/barofit-report-labels.patch)와 [적용/검증 안내](../integrations/README.md)를 포함합니다. 해당 저장소 쓰기 권한이 403으로 거절되어 서버 PR은 생성하지 못했습니다. 패치 적용 검사는 통과했으나 Java 컴파일·단위/통합 테스트·Spotless·infra E2E는 환경 제약으로 검증 전입니다.

최종 검증 기록: [set-report-20261125.json](validation/set-report-20261125.json).
