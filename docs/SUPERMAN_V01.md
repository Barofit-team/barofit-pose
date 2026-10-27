> 초기 0.1.0 검증 기록입니다. 현재 종료 동작 보완과 추가 결과는 [0.2.0 검증 기록](SUPERMAN_V02.md)을 참고하세요.

# 수퍼맨 판정·검증 — 2026-10-26

## 구현 범위

엎드린 상태에서 양팔을 머리 위로 뻗고 양다리와 함께 들어 올린 뒤 내려오는 수퍼맨을 처리합니다. 네발기기 수퍼맨(버드독), 짐볼 변형, 교대 들기는 별도 변형입니다. 측면 또는 측면에 가까운 사선 촬영을 대상으로 합니다.

`SupermanAnalyzer`는 기존 MediaPipe 33개 관절 입력을 받으며 별도의 신경망 학습 없이 동작 주기와 자세를 계산합니다. 어깨·골반·무릎·발목으로 주기를 추적하고, 팔꿈치·손목이 보이면 팔 펴짐을 추가 평가합니다. 시작할 때 팔을 앞으로 뻗은 자세를 확인하고 관측 품질이 높은 쪽을 선택합니다. 선택한 쪽의 추적이 사라지면 반복 기록을 끊고 반대쪽을 검토합니다.

## 자료와 측정값

| 항목 | 자료의 기준 | 계산·출력 | 숫자의 근거 |
|---|---|---|---|
| 동작 주기 | 팔·다리를 천천히 들어 잠시 유지한 뒤 내려옵니다 | `extensionDeg = atan2(Hy−Sy, abs(Sx−Hx)) + atan2(Hy−Ky, abs(Kx−Hx))`. 각 항을 도 단위로 환산합니다. 최저 관측값 대비 8° 상승 → 반전 4° → 시작값 + max(4°, 진폭의 25%)까지 복귀하면 1회입니다 | 영상에서 분리한 공학적 동작 검출 조건. 척추 각도가 아닙니다 |
| 무릎 펴짐 | 다리를 뻗은 채 들어 올립니다 | 골반–무릎–발목 2D 각도가 150° 미만으로 250ms 지속되면 `KNEE_BENT` | 정상·오류 시범의 측정값을 비교한 개발 설정. ACE가 제시한 각도가 아닙니다 |
| 팔 펴짐 | 팔을 뻗은 채 들어 올립니다 | 어깨–팔꿈치–손목 145° 미만으로 400ms 지속되면 `ELBOW_BENT` | 공학적 후보. 합성 입력과 정상 영상으로 점검했으며 팔 굽힘만을 명시한 오류 영상 검증은 부족합니다 |
| 동작 속도 | 천천히 올리고 내리며 잠시 유지합니다 | 검출된 상승·복귀 구간이 1.6초 미만이면 `MOVEMENT_FAST` | 정상 검출 구간 2.4–4.9초와 빠른 시범 약 0.8–1.0초를 구분하는 개발 설정입니다 |
| 유지·템포 | 자료에 따라 짧은 정지, 1초, 2–3초 등 표현이 다릅니다 | 상승·하강·정지·미분류 시간을 측정합니다. 상승을 관측한 뒤 들린 상태에서 정지가 확인된 시간을 `holdSeconds`에 누적합니다 | 관측값입니다. 근육 수축 시간이나 올바른 자세 유지 시간으로 해석하지 않습니다 |

S=어깨, H=골반, K=무릎입니다. 영상 가로·세로 길이를 반영한 픽셀 좌표로 계산합니다. 팔의 위치가 운동 조건과 모순되거나 손목이 보이지 않으면 팔은 미평가로 두고 몸통·다리 카운트를 유지합니다.

허리 곡률, 허리의 지면 접촉, 어깨 으쓱, 양다리 벌어짐은 현재 측면 관절만으로 확정하지 않습니다. 실시간 항목의 `lumbar_neutral`, `shoulder_shrug`, `leg_spread`는 `not_supported`이며 종료 결과 `details.unsupportedItems`에 명시합니다.

## 출력 규격

공통 v2 엔벨로프를 그대로 사용하고 `exercise: "superman"` 분기만 추가했습니다.

| 필드 | 의미 |
|---|---|
| `count` | 검출된 상승·복귀 완료 횟수. 자세 오류 때문에 취소하지 않습니다 |
| `holdSeconds` | 상승 후 들린 상태에서 정지가 확인된 누적 시간. 400ms 속도 창, 8°/s 이하, 250ms 정지 확인 이후 누적합니다 |
| `observedSeconds` | 필요한 몸통·다리 관절을 연속 관측한 시간. 운동 전체 소요 시간이 아닙니다 |
| `measurementBasis.count` | `completed_superman_raise_lower_attempt` |
| `measurementBasis.holdSeconds` | `observed_raised_still` |
| `measurementBasis.observedSeconds` | `continuous_visible_intervals` |
| `items` | `knee_extension`, `arm_extension`, `movement_control`. 실시간 항목은 현재 상태이며 종료 집계는 회차 단위입니다 |
| `currentCodes` / `lastRepetition` | 현재 경고 / 최근 완료 회차의 평가. `codes`는 표시용 합집합입니다 |
| `details.repetitions[].metrics.tempo` | `riseMovingMs`, `lowerMovingMs`, `pauseMs`, `topHoldMs`, `bottomHoldMs`, `midPauseMs`, `unclassifiedMs`, `intervalMs`, 구간 목록 |

세트 항목의 `aggregationBasis`는 `repetition`, 단위는 `repetitions`입니다. `compliancePct`는 정상/(정상+경고)×100이며 미평가만 있으면 `null`입니다. 상승이 확인된 구간에서만 자세를 평가하고, 완료된 회차를 집계합니다. 준비 구간과 미완성 시도를 완료 회차로 합산하지 않습니다. 이미 들고 있는 상태에서 입력이 시작되면 그 이전 상승·유지 시간을 복원하지 않습니다.

템포 분할의 멈춤 확인 조건은 공용 `measureTempo`를 사용합니다. 실시간 `holdSeconds`와 종료 회차의 `topHoldMs`는 각각 인과적 누적·사후 구간 분할이므로 동일 값이 아닙니다. 정지 여부와 정확한 유지 시간의 정답 라벨 검증은 별도입니다.

## 실제 영상 결과

| 원본·구간 | 결과 | 확인 사항 |
|---|---|---|
| Colossus 정상, 5.5–24.5초 | 4회, 경고 0 | 해당 자료의 정상 시범 |
| Colossus 무릎 굽힘 오류, 52–63.5초 | 3회, 무릎 경고 3회 | 원본 자막이 오류 종류를 명시합니다. 시작·끝의 부분 동작은 완료 횟수에서 제외했습니다 |
| Colossus 빠른 반복, 63.5–74초 | 8회, 속도 경고 8회 | 원본 자막이 rushing으로 명시합니다. 추가 무릎 경고는 별도 정답 라벨 없이 발생한 검출입니다 |
| Fit Father 연속 정상, 83–94.8초 | 2회, 경고 0 | 시작부터 올라가 있는 부분 동작은 제외됩니다. 손이 잘려 팔 평가가 unknown입니다 |
| XHIT 연속 정상, 9–20.5초 | 1회, 경고 0 | 길게 유지하는 한 회를 검출했습니다. 팔 추적 오류 구간을 보류합니다 |
| Douglas 네발기기 변형, 6–35초 | 0회 | 다른 변형을 같은 운동의 오류로 라벨링하지 않았습니다 |

정상·오류와 추적 한계를 포함해 5개 원본에서 16개 구간을 실행했습니다. 연속 구간과 편집 포함 구간이 중복되어 있으므로 16명을 검증했다는 뜻이 아닙니다. 조정 중 다른 제작자 영상까지 사용했으므로 독립된 테스트 정확도는 산출하지 않았습니다.

### 발견한 문제와 처리

- 무릎을 많이 접으면 준비 자세 조건에서 제외되던 문제를 수정했습니다. 무릎 굽힘 오류 자체가 카운트를 막지 않습니다.
- 팔 좌표 이상 때문에 몸통·다리의 반복 기록이 끊기던 문제를 분리했습니다. 팔 측정이 불가능하면 unknown이며 카운트는 가능한 관절로 이어갑니다.
- 복귀점을 절대 4° 차이만으로 비교하면 서로 다른 바닥 자세 때문에 두 반복이 합쳐졌습니다. 관측 진폭의 25%를 함께 적용한 후 무릎 오류 시범에서 3회를 분리했습니다.
- 순간 속도만으로 유지 시간을 계산하면 추적 흔들림 때문에 누적이 과도하게 끊겨서, 400ms 창의 속도와 정지 지속 조건을 적용했습니다.
- Fit Father의 83–97초 편집 포함 구간은 카메라 전환·설명 동작에서 1회를 추가 검출합니다. 연속 시범 구간은 2회이며 원본 편집 구간은 3회입니다. 모듈은 영상 컷을 자동 인식하지 않습니다. 알려진 컷·중단에는 `breakContinuity()`를 호출해야 합니다.
- 다른 편집 포함 정상 구간에서는 무릎 경고가 잠깐 발생했습니다. 가까운 구도·가림·설명 동작까지 무오류로 검증된 상태는 아닙니다.
- Well+Good의 허리 과신전 시범과 정상 시범의 관절 선분 값이 겹쳤습니다. 이를 분리하려고 임계값만 바꾸지 않고 미지원 항목으로 남겼습니다.

## 실행·검증

```sh
node examples/superman.mjs landmarks.jsonl output/superman
node --test tests/js/superman.test.mjs
```

원본 프레임은 `analysis/common/video.py`의 MediaPipe 추출기를 거쳐 동일한 JavaScript 런타임에 시간순으로 입력했습니다. 실제 출력 2,505프레임과 16개 세트 결과가 JSON Schema 검증을 통과했습니다. 새 운동 테스트에는 정상·오류·좌우 반전·한쪽 관절·팔 가림·정지·작은 움직임·미완성·추적 손실·시간 간격·쪽 전환·중단·중복 종료를 포함했습니다.

`analysis/superman/sources.json`과 `evaluation.json`에 출처·구간과 실행 결과를 보관합니다. 원본 영상·관절 좌표·모델 바이너리는 Git에 포함하지 않습니다.

## 출처

- [ACE — Supermans](https://www.acefitness.org/resources/everyone/exercise-library/9/supermans/): 사지 신전, 천천히 들고 내리기, 머리 정렬, 과도한 허리 꺾임 방지.
- [Fit Father Project — Superman Exercise](https://www.fitfatherproject.com/superman-exercise/), [영상](https://www.youtube.com/watch?v=cZxtPxeR2H8): 작은 가동범위, 1초 정지, 천천히 복귀.
- [Colossus Fitness — Fix Your Form](https://www.youtube.com/watch?v=UXUGfiNL1lI): 무릎 과도한 굽힘·빠른 반복을 원본에서 오류로 명시. 영상 메타데이터에 Creative Commons Attribution 표시.
- [Well+Good — The Right Way](https://www.youtube.com/watch?v=ATly_pW0i6g): 정상, 어깨 으쓱, 과도한 들기, 다리 벌어짐 비교.
- [XHIT Daily](https://www.youtube.com/watch?v=z6PJMT2y8GQ): 정상 들기·유지 시범.
- [Douglas Chiropractic & Physiotherapy](https://www.youtube.com/watch?v=YXbpJ1L8W50): 네발기기 변형의 제외 확인용.

명시적인 재사용 허가가 확인되지 않은 영상은 로컬 검증에만 사용하고 재배포하지 않습니다.
