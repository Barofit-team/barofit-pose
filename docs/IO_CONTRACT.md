# 입력·출력 규격

앱·웹 실시간 반환은 [실시간 결과 v2](realtime-contract-v2.md), 세트 종료는 [세트 결과 v2](result-contract-v2.md)를 사용합니다. 입력 규격은 유지합니다. Python 연구 출력과 내부 원본 엔진은 별도입니다.

## 1. 입력 — 모든 운동 동일

`PushupAnalyzer.pushFrame(frame)`(JS), `PlankAnalyzer.push_frame(frame)`(Python)가 받는 객체입니다.
앱 메모리에서 객체로 전달하며 JSON은 저장/전송할 때만 필요합니다.

| 필드 | 형식 | 규칙 |
|---|---|---|
| `timestampMs` | number | 동일 세트에서 단조 증가하는 밀리초. Date.now가 아닌 영상/카메라의 동일 시간축 |
| `width`, `height` | 양의 정수 | 좌표 추출에 사용한 회전 보정 후 이미지 크기. 화면 표시 영역 크기가 아님 |
| `landmarks` | 33×5 배열 | 각 관절 `[x,y,z,visibility,presence]` |

- x,y는 이미지 너비·높이로 정규화된 좌표. x는 오른쪽, y는 아래로 증가합니다.
- z는 MediaPipe 정규화 깊이값으로 미터가 아닙니다. 현재 판정은 2D x,y만 사용합니다.
- 좌우는 **사람의 해부학적 좌우**입니다. 화면 좌우와 다를 수 있습니다.
- 전면 카메라 미리보기 반전은 그리기 단계에서 처리합니다. 관절 ID를 맞바꾸지 않습니다.
- 누락된 관절은 `[null,null,null,null,null]`. 사람 전체 미검출은 `[]`도 허용합니다.
- JSON에는 NaN/Infinity를 쓰지 않습니다. 프레임 순서를 정렬하거나 보간해 오류를 숨기지 않습니다.
- 회전·크롭이 바뀌면 좌표와 이미지 크기를 함께 갱신하고 움직임 이력을 끊습니다.
- 여러 사람을 동시에 추적하는 규격은 아닙니다. 추출기는 한 사람 기준입니다.

| 관절 | 왼쪽 ID | 오른쪽 ID |
|---|---:|---:|
| 어깨 | 11 | 12 |
| 팔꿈치 | 13 | 14 |
| 손목 | 15 | 16 |
| 골반 | 23 | 24 |
| 무릎 | 25 | 26 |
| 발목 | 27 | 28 |

## 2. 공통 프레임 출력

[실시간 결과 v2](realtime-contract-v2.md)의 필드 표를 기준으로 합니다.
`PushupAnalyzer`, `PlankAnalyzer`, `BirdDogAnalyzer`의 JS 공개 반환을 통일했습니다.
현재 판정은 `items`, 최근 회차 평가는 `lastRepetition`, 운동별 추가 데이터는 `details`입니다.
`ignored` 결과는 화면에 적용하지 않으며, 항목별 평가 불가 상태를 정상으로 바꾸지 않습니다.

## 3. 운동별 차이

### 푸시업

`lastRepetition.items` 키: `hip`, `elbow`, `chest`, `hand`, `return`. 현재 관측은 `items.hip`.
회차 판정은 카운트 후 0.6초 대기 뒤 확정됩니다. 따라서 카운트와 피드백 이벤트는 같은 프레임에 발생하지 않을 수 있습니다.
`details.hipStatus`는 원본 골반 상태이며 `items.hip`은 공통 상태로 표현한 현재 골반 판정입니다. 최근 회차의 골반 판정은 `lastRepetition.items.hip`입니다.
`metrics`에는 `t`(초), `elbow`(도), `hip`(%), `chest`, `hand`, `body`, `horizontal` 등이 있습니다.
`details.diagnostics`는 좌우 관절별 신뢰도·누락 원인을 포함하는 진단용 값입니다.

| 이벤트 | 주요 데이터 |
|---|---|
| `rep.completed` | `rep`, `start_s`, `bottom_s`, `end_s`, `signal` |
| `rep.feedback` | `rep`, `items`, `codes`, 평가 가능 시 `metrics` |
| `feedback.changed` | 현재 골반 경고의 변화 |
| `tracking.changed` / `tracking.blocked` / `tracking.recovered` | 관측 상태 변화 |
| `side.selected` / `side.changed` / `side.released` | 판정할 좌우 변경 |
| `frame.gap` | 프레임 시간 간격 초과 |
| `set.completed` | v2 공통 이벤트: `timestampMs`, `summary` ([세부 규격](result-contract-v2.md)) |

**원본 이벤트의 `t`, `*_s`는 초입니다. 공통 프레임의 `timestampMs`와 단위가 다릅니다.**
일부 `side.released`에는 아직 시간/좌우가 없을 수 있으므로 null을 처리해야 합니다.
푸쉬업 세트 집계는 `summary.items` 아래에 있으며 `aggregationBasis: repetition`, `unit: repetitions`입니다. `compliancePct`는 0~100, 분모 0이면 null입니다. 세트 종료 이벤트는 `t` 대신 `timestampMs`(밀리초)를 사용합니다.
종료 직전 확정 대기 중인 회차는 `interrupted`→unknown으로 집계됩니다. 종료가 미래 프레임을 만들어내지는 않습니다.

### 플랭크

`items` 키: `hip`, `shoulder`, `knee`. 연속 프레임 기준입니다.
`metrics`: `hip_offset_pct`, `hip_angle_deg`, `shoulder_deviation_deg`, `knee_deg`, `elbow_deg`.
거리 비율은 %, 각도는 도입니다. 팔꿈치 각도는 기록만 하고 판정하지 않습니다.
`raw`에는 원본 v0.2 결과가 있습니다. 원본의 `HIP_HIGH`를 공통 `codes`에서만 `HIP_RAISE`로 표기합니다.
`raw`의 `WARMUP/UNOBSERVABLE/NO_WARNING/NO_HIP_WARNING`은 어댑터에서 위 공통 상태로 변환합니다.
Python·JS `PlankAnalyzer` 모두 프레임 판정과 세트 종료 집계를 제공합니다.
`count`는 null입니다. `holdSeconds`는 [플랭크 관측 유지 시간](PLANK_HOLD.md)을 누적합니다. 자동 세트 시작·종료는 수행하지 않습니다.
`observedSeconds`는 0.25초 이하로 연속된 샘플의 시간 합이며 실제 운동 유지 시간이 아닙니다.
`gapSeconds`는 그보다 긴 샘플 공백의 합입니다. 명시적 일시정지는 두 값 모두에서 제외합니다.
`summary().items`의 각 항목은 `aggregationBasis: time`, `unit: seconds`와 `compliant`, `warning`, `unknown`, `notApplicable`, `evaluated`, `compliancePct`를 갖습니다.
양 끝 프레임에서 같은 쪽으로 평가 가능할 때만 직전 프레임의 판정에 시간 간격을 배분합니다. 나머지는 unknown입니다.
`compliancePct = compliant / evaluated * 100`, 평가 시간 0이면 null입니다. 버드독도 같은 공통 세트 구조와 시간 기준 항목 집계를 사용합니다. 상세 내용은 [세트 결과 JSON v2](result-contract-v2.md)를 참고하세요.

## 4. 생명주기와 앱 책임

```text
준비 안내/시작 결정 (앱)
→ 새 엔진 생성
→ 시간 순서대로 프레임 전달
→ 화면 갱신 / 음성 제어
→ 일시정지 시 연속성 초기화
→ 세트 종료 처리 / 결과 저장
```

- JS 푸쉬업·플랭크·버드독: `pushFrame`, `breakContinuity(reason)`, `summary`, `finish`. `finish()` 재호출은 빈 배열을 반환합니다.
- Python 플랭크·버드독: `push_frame`, `break_continuity`, `summary`, `finish`. 새 영상은 새 인스턴스를 만듭니다.
- 중복/역순 프레임은 JS에서 ignored, Python 플랭크에서 ValueError. 이 차이는 보존했습니다.
- 카메라 프레임은 순서대로 처리하고 오래된 결과는 앱에서 버립니다. 준비 중 카운트 차단은 별도 상태 관리가 필요합니다.
- 골격 그리기·카메라 권한·실제 TTS 재생·세트 ID·재전송/중복 방지·백엔드 저장은 이 함수의 역할이 아닙니다.
- 앱용 `FeedbackVoice`는 중복 안내 간격만 제어합니다. `codes`가 바뀔 때마다 음성을 바로 재생하지 않습니다.

## 5. Python 푸시업 분석은 별도 배치 인터페이스

`predict_unified(arrays, model, side)` → `(frames, repetitions, motion_audit, selected_side)`.
분석용 Pandas 표이며 공통 프레임 객체가 아닙니다. 앱에는 `PushupAnalyzer`를 사용합니다.
Python auto는 전체 영상의 좌표 품질로 한쪽을 선택하고 JS live는 시간 순서대로 선택·재선택하므로
auto 결과가 무조건 일치한다고 가정하지 않습니다. 이식 비교는 좌우를 고정하고 같은 좌표를 입력합니다.
Python 레퍼런스는 설정을 모듈 전역에 적용하므로 서로 다른 설정의 동시 서버 요청에 그대로 사용하지 않습니다.
