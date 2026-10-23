# 레그 레이즈 외부 영상 검증 — 2026-10-23

## 결론

카운트·무릎 펴기·빠른 하강 안내를 제공하는 1차 프로토타입의 소규모 기능 검증을 완료했습니다. 새 영상에 맞춘 판정 로직·임계값 수정은 하지 않았습니다. 빠른 하강 경고는 템포 안내이며 정상/비정상을 확정하는 지표로 해석하지 않습니다.

## 추가 검증

기존 개발 영상과 다른 3개 출처, 3명의 시범에서 6개 구간을 선택했습니다. 같은 사람의 여러 구간은 독립된 사람으로 세지 않았습니다. 추론 전 원본의 0.5초 간격 장면을 검토해 완전 왕복을 기록하고, 결과와 경고 시점의 원본을 재확인했습니다. 전문가 독립 정답 라벨은 아닙니다.

| 구간 | 육안 완전 왕복 / 카운트 | 무릎 경고 회차 | 빠른 하강 경고 회차 |
|---|---:|---:|---:|
| Barbell Logic · 측면 | 2 / 2 | 0 | 0 |
| Barbell Logic · 사선 | 1 / 1 | 0 | 0 |
| Mobility Doc · 최고점에서 오래 유지 | 1 / 1 | 0 | 0 |
| Mobility Doc · 손으로 골반 지지 | 4 / 4 | 0 | 0 |
| Movement Collective · 다리 펴기 | 5 / 5 | 0 | 1 |
| Movement Collective · 굽힌 무릎 변형 | 3 / 3 | 3 | 3 |

총 16회가 일치했습니다. 다리를 편 시범 13회에서 회차별 무릎 경고는 없었습니다. 의도적으로 무릎을 굽히는 변형 3회에서는 무릎 경고가 모두 발생했습니다. 이 변형은 오류 정답이 아니라 규격 차이에 대한 반응 확인 자료입니다.

### 빠른 하강 경고

Movement Collective의 다리를 편 시범 4회차(원본 약 32–33초)는 하강 1.068초·87.4°/s로 경고가 발생했습니다. 원본에서도 비교적 빠르게 내려가며 큰 추적 이탈은 보이지 않았습니다. 다만 1.1초 경계와 32ms 차이로, 한 샘플 간격보다 작은 차이입니다. 경고 발생 자체는 현재 규칙과 일치하지만 이를 확정적 자세 오류나 검증된 위험 기준으로 볼 수는 없습니다. 나머지 다리를 편 12회에는 하강 경고가 없었습니다. 굽힌 무릎 변형은 0.80–0.93초 하강으로 3회 모두 경고가 발생했습니다.

### 준비·종료 동작

Mobility Doc의 완료 후 무릎 접기(구간 19.95–21.96초), Movement Collective의 운동 변형 전환(0.47–1.00초)에 실시간 무릎 경고가 표시됐습니다. 회차 카운트와 완료 회차 무릎 평가에는 섞이지 않았습니다. 현재 모듈은 누운 상태의 휴식과 운동 의도를 자동 구분하지 않습니다.

## 반환 규격

| 구분 | 확인 결과 |
|---|---|
| 실시간 공통 구조 | 푸시업·플랭크·버드독·점핑잭·레그 레이즈의 최상위 필드 일치. `schemaVersion: 2.0`, `type: frame.result` |
| 실시간 항목 | 현재 상태 `items/currentCodes`, 최근 완료 회차 `lastRepetition`, 표시용 `codes`, 각도·거리 등 `metrics` |
| 세트 종료 | 공통 `set.completed`와 `summary` 구조. 횟수·관측 시간·항목별 집계·운동별 상세 기록 |
| 레그 레이즈 횟수 의미 | `measurementBasis.count: completed_raise_lower_attempt` |
| 준수율 | `aggregationBasis: repetition`, `unit: repetitions`, `compliancePct: 0–100` 또는 평가 불가 시 `null` |
| 유지 시간 | 레그 레이즈는 `holdSeconds: null`; 플랭크 등 다른 운동의 유지 시간 의미는 보존 |
| 허리 접촉 | 실시간 `not_supported`, 세트에서 회차별 `unknown`, 준수율 `null`. 정상 처리하지 않음 |

새 영상의 실시간 결과 1,305개와 세트 종료 결과 6개가 JSON Schema 검사를 통과했습니다. 5개 운동의 공통 구조·중복 시각·종료 후 입력 처리도 별도 확인했습니다. 회차 이벤트 수, 최종 카운트, 회차 목록, 항목별 합계, 준수율을 별도로 대조했습니다. 기존 JavaScript 테스트 79개가 통과했습니다.

## 실행 조건 및 범위

- MediaPipe Pose Landmarker Full 0.10.32, 최대 입력 폭 960px. 목표 샘플링 20fps 설정이며 실제 저장 입력은 원본 간격에 따라 약 12/15fps입니다. 출력 영상은 원본 약 24/30fps와 재생 시간을 유지합니다.
- 실제 사용한 입력·회차·원본 구간·로직 SHA256을 함께 저장했습니다. 새 평가 중 로직과 임계값은 변경하지 않았습니다.
- Fit Father 영상은 벤치 변형 및 발끝 잘림, Red Delta 영상은 발목 잘림 때문에 추론 전에 주요 평가에서 제외했습니다.
- 허리–바닥 접촉은 판정하지 않습니다. 양쪽 다리 동기화나 호흡·복부 힘까지 평가하는 모듈도 아닙니다.
- 이번 결과는 작은 표본의 기능 검증입니다. 영상별 구간 합계 일치를 전체 사용자 정확도로 환산하지 않습니다.

## 원본

- [Barbell Logic — Lying Leg Raise: Gym Shorts (How To)](https://www.youtube.com/watch?v=jrSWj0huh5o)
- [Mobility Doc — Perfect Lying Leg Raises Form to Strengthen Your Core & Avoid Back Pain](https://www.youtube.com/watch?v=3oIpxsn6FxQ)
- [The Movement Collective  — Lying leg raises tutorial - core](https://www.youtube.com/watch?v=iUs7hd8u1wg)
