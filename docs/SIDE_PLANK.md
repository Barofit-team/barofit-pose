# 사이드 플랭크 · 2026-11-09

팔뚝 지지·다리를 편 정적 유지형입니다. 몸 앞면과 지지 팔꿈치, 양쪽 어깨, 골반, 무릎, 발목이 보이는 수평 카메라 구도를 사용합니다. `SidePlankAnalyzer`는 MediaPipe의 33개 좌표를 받아 동일한 JavaScript 엔진으로 앱과 영상 분석을 처리합니다.

## 판정 및 측정

| 항목 | 측정값 | 초기 기준 | 근거 |
|---|---|---|---|
| 골반 정렬 `hip` | 지지 쪽 어깨–발목 직선에 대한 골반의 부호 있는 수직거리 / 어깨–발목 길이 × 100 | 아래 +4% 초과 `HIP_DROP`; 위 −8% 미만 `HIP_RAISE`; −8~−4% 구간은 `unknown` | ACE·Calgary의 몸 일직선 지침. 수치 자체는 문헌의 처방값이 아닙니다. |
| 지지 어깨 `shoulder` | 어깨–팔꿈치 선의 화면 수직선 이탈각 | 25° 초과 `SHOULDER_ELBOW_OFFSET` | 팔꿈치를 어깨 아래에 두는 지침. 정상 시범에서 약 23°까지 관찰해 20° 후보를 수정했습니다. 카메라 기울기에 영향을 받습니다. |
| 지지 다리 `knee` | 골반–무릎–발목 각도 | 160° 미만 `KNEE_BENT` | 다리 편 변형의 정성 기준. 각도는 초기 공학적 후보이며 실제 굽힘 오류 영상 검증은 완료하지 않았습니다. |
| 팔꿈치 각도 | 어깨–팔꿈치–손목 | 기록만 수행 | 전완이 카메라를 향하면 실제 굽힌 팔도 2D에서 거의 펴진 팔처럼 투영됩니다. 변형 분류에 사용하지 않습니다. |
| 정상 유지 시간 | `holdSeconds` | 자세 확보 0.3초 후, 모든 항목이 정상인 연속 표본 구간 | 경고·보류·누락·좌우 전환·중단·큰 시간 간격은 누적하지 않습니다. |

각도·거리는 영상 종횡비를 반영한 픽셀 좌표로 계산합니다. 골반 거리 부호는 화면 아래 방향이 양수이며 좌우 반전에 보존됩니다. `side`는 화면의 좌우가 아니라 지지하는 신체 쪽입니다. 양쪽 어깨의 높이와 지지 팔·다리 관측으로 선택합니다.

## 반환 규격

- `pushFrame`, `breakContinuity`, `summary`, `finish` 인터페이스를 제공합니다.
- 실시간 `frame.result` v2, 종료 `set.completed` v2이며 `count`는 null입니다.
- `phase`: `unobservable` / `positioning` / `stabilizing` / `holding`. 프론트 세션 상태와 별개입니다.
- `observedSeconds`: 큰 간격을 제외한 연속 입력 시간. 운동 시간 전체를 의미하지 않습니다.
- `summary.items.hip/shoulder/knee`: 시간 기준, 초 단위, `compliancePct` 0–100. `unknown`과 `notApplicable`은 준수율 분모에서 제외합니다.
- `summary.details.sideHoldSeconds`: 좌·우 정상 유지 시간. `configuration`: 사용한 초기 임계값.
- `hip: unknown`이면 정상 판정이 아니며 정상 유지 시간도 누적하지 않습니다. 준수율과 함께 평가 시간·미평가 시간을 표시해야 합니다.
- 척추 곡률·근육 활성·실제 바닥 접촉·회전은 판정하지 않습니다. 팔을 편 변형이나 힙딥 운동을 자동으로 분류하는 모델은 아닙니다.

## 실제 영상 검토

| 출처 | 구간 / 용도 | 결과 |
|---|---|---|
| Get Exercise Confident | 58–89초 정상, 138–156초 의도적 오류 및 복귀 | 정상 어깨 오경고를 수정했습니다. 처짐을 검출하고 복귀 시 해제했습니다. 높임은 정상 표본과 값이 겹쳐 보류됩니다. |
| E3 Rehab Exercise Library | 전체 약 9.6초, 준비·정상·하강 | 정상 유지 구간은 경고 없이 누적합니다. 마지막 하강 일부가 처짐으로 기록되므로 종료 경계 평가는 별도입니다. |
| Children’s Hospital Colorado | 0–40초, 정상 시범 | 골반 값이 −4~−8% 영역에 들어갑니다. 오경고 대신 보류하며 이 때문에 정상 유지 시간이 실제보다 짧습니다. |
| FRESH! Wellness Group | 225–257초, 독립 재검증 | 228–237초 정적 유지 후 힙딥 변형. 변형을 원본 오류 라벨로 간주하지 않습니다. 정적 모드에 넣었을 때 하강 검출 여부를 확인합니다. |

Get Exercise Confident 영상은 강사와 운동자가 함께 나와 고정 ROI로 강사의 얼굴을 제외한 뒤 추출했습니다. 원본 전체에서의 다중 인물 추적 성공으로 해석하지 않습니다. Nuffield Health 자료는 강사 오추적·화면 확대 때문에 최종 평가에서 제외했습니다.

골반 과상승은 정상과 오류 측정 분포가 겹치므로 검증 완료로 표현하지 않습니다. 어깨·무릎의 경고 분기는 합성 입력으로 검증했으며 독립 실제 오류 시범에 대한 검출 성능은 확정하지 않았습니다. −8% 경고도 큰 변위에 대한 후보입니다.

## 근거 및 영상

- [ACE · Side Plank with Straight Leg](https://www.acefitness.org/resources/everyone/exercise-library/101/side-plank-with-straight-leg/)
- [University of Calgary · Side plank](https://www.ucalgary.ca/shred-injuries/all-sports/soccer/side-plank)
- [Get Exercise Confident](https://www.youtube.com/watch?v=rCxF2nG9vQ0)
- [E3 Rehab](https://www.youtube.com/watch?v=eRygfYEe1hs)
- [Children’s Hospital Colorado](https://www.youtube.com/watch?v=N_s9em1xTqU)
- [FRESH! Wellness Group](https://www.youtube.com/watch?v=wRUPXfh_2yg)

원본 영상의 별도 재배포 허가를 확인하지 않았습니다. 원본·관절 로그·분석 영상은 로컬 검증 폴더에 보관하며 저장소에는 포함하지 않습니다.

## 유지 시간 공통 처리

플랭크와 `runtime/common/hold.js`의 누적 함수를 공유합니다. 연속된 두 표본이 모두 정상일 때만 시간 차이를 더하며, 준비 확인 시간은 소급해서 더하지 않습니다. 0.25초를 초과하는 입력 간격, 좌우 전환, 화면 크기 변경, 관절 누락은 연결하지 않습니다. 자세 판정 임계값은 유지했습니다.

| 반환 위치 | 의미 |
|---|---|
| 실시간 `holdSeconds` / 종료 `summary.holdSeconds` | 모든 필수 항목을 지킨 누적 시간(초) |
| 실시간 `observedSeconds` / 종료 `summary.observedSeconds` | 큰 입력 간격을 제외한 관측 시간(초) |
| 종료 `summary.items.*.compliancePct` | 항목별 평가 가능 시간 중 준수 시간 비율(0–100), 평가 시간이 없으면 null |
| 종료 `summary.details.sideHoldSeconds` | 좌·우별 정상 유지 시간(초) |

유지 시간은 모든 항목의 동시 준수를 요구하므로 항목별 준수율 평균과 다릅니다. `unknown`은 정상 유지 시간에 포함하지 않으며 준수율 분모에서도 제외합니다.
