# 글루트 브리지 발 위치 보완·외부 영상 검토 — 2026-10-23

## 변경 결과

가까운 발의 준비 자세를 별도로 측정하도록 수정했습니다. 카운트 조건, 골반 상승 기준 150°, 하강 속도 기준, 결과 v2 공통 필드는 유지했습니다. 엔진 버전은 `glute-bridge-0.2.0`입니다.

| 구분 | 수정 전 | 수정 후 |
|---|---|---|
| 발 위치 | 상단 정강이 기울기만 사용 | 기존 기울기 + 하단 골반–발목 거리/다리 길이 + 무릎 각도 |
| 가까운 발 시범 2회 | 0회 검출 | 2회 검출; `FOOT_POSITION_OFFSET` |
| 준비 자세 | 먼 발 안내 | 가까운 발도 250ms 지속 시 안내 |
| 하단 근거가 없는 완료 회차 | 상단 기울기가 작으면 통과 | 다른 경고가 없으면 `unknown` |
| 카운트 | 기존 방식 | 전체 18구간에서 수정 전과 동일 |

## 놓친 원인

Well+Good의 가까운 발 시범에서 상단 정강이 기울기는 약 11.0°, 6.3°였습니다. 발을 당기면 무릎도 함께 이동하므로 발이 가까워도 정강이가 수직에 가까울 수 있습니다. 상단 기울기 25° 조건만으로는 이 차이를 구분하지 못했습니다.

하단에서 `distance(hip, ankle) / (distance(hip, knee) + distance(knee, ankle))`를 계산합니다. 가까운 발 시범의 회차별 하단 중앙값은 0.271, 0.272였고 같은 사람의 정상은 0.321, 0.327이었습니다. 무릎 내각은 오류 약 31°, 정상 약 37–38°였습니다. 두 값은 서로 관련된 기하학적 측정이며 독립된 증거 두 개를 의미하지 않습니다.

- 가까운 발 후보: 거리 비율 <0.30 및 무릎 내각 <35°.
- 회차 하단 기준 +8° 이내 표본 및 시작점 직전 최대 400ms의 하단 표본을 보존합니다.
- 최소 2개 표본, 100ms 이상의 관측 구간에서 중앙값으로 평가합니다.
- 관절 누락·관측 단절·좌우 전환 시 근거를 초기화합니다.
- 상단 기울기 25° 기준은 그대로 유지합니다.
- 새 값은 파일럿 영상에서 설정한 공학적 허용값입니다. 모든 체형에 적용되는 임상 기준이 아니며 가까운 발 양성 표본은 한 사람의 2회입니다.

## 추가 영상 검토

| 원본 / 구간 | 카운트 | 결과 |
|---|---:|---|
| NASM 52–98s | 3 | 발 위치·골반 상승 오경고 없음. 최고각 약 184–188° |
| Airrosti 62–81s | 1 | 완료 1회, 끝의 잘린 동작 별도. 최고각 약 172°, 경고 없음 |
| Body & Spine 정상 44–58s | 1 | 최고각 약 166°, 경고 없음 |
| Will Harlow 정상 457–481s | 1 | 최고각 약 178°, 경고 없음 |
| Doc Jen 부분 범위 31–59s | 1 | 첫 작은 동작은 약 128→143°로 카운트·경고 없음. 두 번째는 약 156°로 1회, 경고 없음 |
| Performance Sport & Spine 오류 19–27s | 1 | 허리 과신전과 불충분한 고관절 신전의 혼합 시범. 투영 최고각 약 183°로 통과 |
| Performance Sport & Spine 교정 27–33.5s | 0 | 첫 상승과 마지막 복귀가 잘린 구간. 약 177°까지 관측, 경고 없음 |
| Body & Spine 먼 발 79–104s | 0 | 발 이동 후 복귀가 기존 시작 각도에 못 미쳐 미완료. 발 위치 경고도 미검출 |

추가 정상 4개 구간의 완료 6회에서 활성 항목 경고가 없었습니다. 기존 정상 4개 구간 5회도 경고가 추가되지 않았습니다. 이는 작은 표본의 결과이며 전체 정확도 추정치가 아닙니다. 추가 영상은 발 위치 규칙을 변경한 뒤 동일 설정으로 실행했습니다. 일부 영상은 카메라 편집·잘린 회차가 있어 수동 카운트 정답 평가에서 분리했습니다.

## 골반 상승 부족 검증 결론

골반 상승 부족의 실제 오류 검출이 검증됐다고 판단할 수 없습니다.

1. 낮은 동작은 카운트 진입 변화량 20°에 못 미치면 회차 피드백도 나오지 않습니다. Doc Jen의 첫 동작이 해당합니다.
2. 어깨–골반–무릎의 영상 투영각이 커도 고관절을 제대로 펴는 대신 허리를 젖혔을 수 있습니다. Performance Sport & Spine의 오류가 해당합니다. 이를 허리 판정 성공으로 집계하지 않습니다.
3. Doc Jen의 영상은 전문가가 처방한 부분 범위 연습입니다. 오류 정답 데이터로 취급하지 않습니다. 원본 NASM도 보상이나 통증 없이 가능한 범위를 설명합니다.

따라서 `HIP_LIFT_LOW`는 제한적인 투영 상승 범위 안내입니다. 근육 활성, 허리 중립, 통증 없는 개인 가동범위 또는 전체 동작의 정답을 의미하지 않습니다. 이를 맞추려고 150°를 올리면 기존 정상 157.9°와 새로운 부분 범위 시범에 경고를 만들 수 있어 이번 변경에서는 유지했습니다.

## 결과 규격·회귀 검사

- `frame.result` / `set.completed`: schemaVersion `2.0`, 공통 필드 동일.
- 실시간 `metrics.hipAnkleLegRatio` 추가.
- 회차 `metrics.setupHipAnkleLegRatio`, `setupKneeDeg`, `footPositionReason` 추가.
- 항목 코드는 기존 `foot_position` / `FOOT_POSITION_OFFSET` 유지. `footPositionReason`은 `close_setup`, `top_shin_offset`, `within_reference`, `setup_unobserved`입니다.
- 18구간 4,623프레임 및 18세트 JSON Schema 통과. 모든 구간에서 수정 전후 카운트 동일.
- 기존 운동 포함 JavaScript 테스트 95개 통과.
- 수정 전 엔진은 `analysis/glute_bridge/baselines/v01.mjs`에 재현용으로 보존했습니다.

## 출처

- [Well+Good / The Right Way](https://www.youtube.com/watch?v=wPM8icPu6H8): 기존 가까운 발 시범과 정상 비교.
- [NASM / How to do a Glute bridge](https://www.youtube.com/watch?v=SKOMwg1JLrU): 기본 자세 및 보상·통증 없이 가능한 범위.
- [Airrosti / How to Perform the Perfect Glute Bridge](https://www.youtube.com/watch?v=OUgsJ8-Vi0E): 정상 골반 위치와 통제된 상승·하강.
- [Body & Spine / Top 5 mistakes](https://www.youtube.com/watch?v=zaoudoVfm9c): 정상·먼 발·빠른 하강·과신전 시범.
- [Will Harlow / Bridge](https://www.youtube.com/watch?v=1AKWmWAzddE): 정상 동작 시범.
- [Doc Jen Fitness / Partial Range Glute Bridge](https://www.youtube.com/watch?v=teC_lImWqfU): 의도적인 부분 범위 연습. 오류 라벨 아님.
- [Performance Sport & Spine / Cues and Common Mistakes](https://www.youtube.com/watch?v=liFujQjR6x0): 허리 과신전·고관절 신전 교정 비교.

원본의 재배포·상업적 학습 권한을 확인한 자료는 아니며 분석 자료는 로컬 내부 검토용입니다.
