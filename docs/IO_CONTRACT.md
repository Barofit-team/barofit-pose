# 입력·출력 규격 v1.0

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

| 필드 | 의미 |
|---|---|
| `schemaVersion` | `1.0` — 객체 형식 버전 |
| `exercise` | `pushup`, `plank`, 향후 `squat` |
| `engineVersion` | 판정 구현 버전 |
| `timestampMs` | 입력 프레임 시각 |
| `ignored` | 중복/역순 등으로 처리하지 않은 결과인지 |
| `tracking` | `tracking`, `selecting_side`, `tracking_unavailable` |
| `side` | 실제 판정에 쓰는 `left`, `right`, 아직 미선택이면 null |
| `count` | 푸시업 누적 움직임 횟수. 플랭크는 null |
| `holdSeconds` | 향후 유지 시간. 현재는 null(미구현) |
| `codes` | 현재 표시 가능한 피드백 코드 배열 |
| `items` | 항목별 판정 객체. 아직 회차 평가가 없으면 null일 수 있음 |
| `events` | 해당 프레임에서 새로 발생한 이벤트. 플랭크 Python은 현재 빈 배열 |
| `metrics` | 계산한 수치. 계산 불가 값은 null |

`tracking`은 일부 판정 가능 여부를 나타냅니다. 전 항목 정상/준비 완료를 뜻하지 않습니다.
`codes: []`만 보고 정상이라고 표시하지 마세요. `tracking`과 `items`를 함께 확인해야 합니다.
`ignored: true` 결과로 기존 화면 값을 덮어쓰지 않습니다.

| 항목 상태 | 의미 |
|---|---|
| `within_reference` | 평가 가능한 범위에서 기준 충족 |
| `warning` | 기준 미충족 |
| `tracking_unavailable` | 필요한 좌표가 없어 평가 불가 |
| `pending_feedback` | 워밍업 또는 평가 대기 |
| `body_unavailable` | 몸통 기준을 얻지 못해 손 위치 평가 보류 |
| `body_deviation` | 몸통 정렬 이탈 때문에 손 위치 평가 보류 |
| `interrupted` | 회차 피드백 확정 전에 중단/종료 |

평가 불가·대기·보류를 준수나 미준수에 넣지 않습니다. 준수율 분모는 평가 가능한 회차/시간만 사용합니다.

## 3. 운동별 차이

### 푸시업

`items` 키: `hip`, `elbow`, `chest`, `hand`, `return`.
회차 판정은 카운트 후 0.6초 대기 뒤 확정됩니다. 따라서 카운트와 피드백 이벤트는 같은 프레임에 발생하지 않을 수 있습니다.
`hipStatus`는 현재 프레임의 골반 상태이며 `items.hip`은 최근 회차 평가입니다.
`metrics`에는 `t`(초), `elbow`(도), `hip`(%), `chest`, `hand`, `body`, `horizontal` 등이 있습니다.
`diagnostics`는 좌우 관절별 신뢰도·누락 원인을 포함하는 진단용 값입니다.

| 이벤트 | 주요 데이터 |
|---|---|
| `rep.completed` | `rep`, `start_s`, `bottom_s`, `end_s`, `signal` |
| `rep.feedback` | `rep`, `items`, `codes`, 평가 가능 시 `metrics` |
| `feedback.changed` | 현재 골반 경고의 변화 |
| `tracking.changed` / `tracking.blocked` / `tracking.recovered` | 관측 상태 변화 |
| `side.selected` / `side.changed` / `side.released` | 판정할 좌우 변경 |
| `frame.gap` | 프레임 시간 간격 초과 |
| `set.completed` | `count`, 항목별 `evaluable/compliant/warning/unknown/compliance_pct` |

**원본 이벤트의 `t`, `*_s`는 초입니다. 공통 프레임의 `timestampMs`와 단위가 다릅니다.**
일부 `side.released`에는 아직 시간/좌우가 없을 수 있으므로 null을 처리해야 합니다.
`set.completed`의 통계 단위는 회차이며 분모 0이면 `compliance_pct`는 null입니다.
종료 직전 확정 대기 중인 회차는 `interrupted`→unknown으로 집계됩니다. 종료가 미래 프레임을 만들어내지는 않습니다.

### 플랭크

`items` 키: `hip`, `shoulder`, `knee`. 연속 프레임 기준입니다.
`metrics`: `hip_offset_pct`, `hip_angle_deg`, `shoulder_deviation_deg`, `knee_deg`, `elbow_deg`.
거리 비율은 %, 각도는 도입니다. 팔꿈치 각도는 기록만 하고 판정하지 않습니다.
`raw`에는 원본 v0.2 결과가 있습니다. 원본의 `HIP_HIGH`를 공통 `codes`에서만 `HIP_RAISE`로 표기합니다.
`raw`의 `WARMUP/UNOBSERVABLE/NO_WARNING/NO_HIP_WARNING`은 어댑터에서 위 공통 상태로 변환합니다.
Python 어댑터는 프레임 판정만 제공합니다. 세트 종료 집계·유지 시간·JS 구현은 추가 작업입니다.

## 4. 생명주기와 앱 책임

```text
준비 안내/시작 결정 (앱)
→ 새 엔진 생성
→ 시간 순서대로 프레임 전달
→ 화면 갱신 / 음성 제어
→ 일시정지 시 연속성 초기화
→ 세트 종료 처리 / 결과 저장
```

- JS 푸시업: `pushFrame`, `breakContinuity(reason)`, `finish`. `finish()` 재호출은 빈 배열을 반환합니다.
- Python 플랭크: `push_frame`, `break_continuity`. 새 영상은 새 인스턴스를 만듭니다.
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
