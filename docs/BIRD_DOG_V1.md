# 버드독 1차 프로토타입

## 적용 범위

한 명을 고정된 측면 카메라로 촬영하는 기본 버드독. 준비 → 뻗기·유지 → 복귀를 구분한다. 준비 때 가려졌던 관절이 뻗은 뒤 보이면 그때부터 해당 항목을 평가한다. 지지 손목 가림으로 다리 판정 전체를 중단하지 않는다.

척추 중립·허리 곡률과 몸통의 축 회전은 판정하지 않는다. `BODY_MOVEMENT`는 유지 중 관측되는 몸통 움직임이며, 척추 중립의 대체 지표가 아니다.

## 횟수와 시간

- 한쪽을 뻗었다가 준비 위치로 돌아오면 **1회**, 좌우 한 번씩 하면 **2회**다. 서비스의 표시 단위이며 모든 운동 자료가 동일한 단위를 쓰는 것은 아니다.
- 위치 변화뿐 아니라 뻗은 구간이 짧게라도 확인되어야 한다. 0.25초 유지 확인은 추적 잡음에 의한 중복 카운트를 막는 기술 조건이며, 올바른 자세 점수로 횟수를 거절하는 기준이 아니다.
- `holdSeconds`는 관측된 유지 시간이다. 오류가 있더라도 시간은 누적하며, 올바른 자세로 버틴 시간과 같지 않다.
- 준비 과정이 잘린 채 유지 자세부터 시작하면 피드백·유지 시간은 제공하지만, 그 불완전한 첫 회차는 카운트하지 않는다.
- 긴 인식 단절·일시정지는 진행 중 회차를 끊는다. 완료 횟수는 보존하고, 단절 전후의 움직임을 이어서 세지 않는다.
- AAOS는 팔·반대 다리를 뻗어 일정 시간 유지한 뒤 복귀·반복하는 방법을 제시한다. 유지와 반복을 함께 기록하는 근거이며, 안내의 15초를 모든 사용자에게 강제하지 않는다.

## 판정 항목

`L`은 화면에서 측정한 같은 쪽 어깨–골반 길이. 각도는 픽셀 가로·세로 비율을 보정한 2D 각도다.

| 코드 (LEFT/RIGHT 접두어) | 계산 | 평가 시점 / 조건 |
|---|---|---|
| `LEG_HIGH` | 어깨→골반 연장 방향 대비 골반→무릎이 위로 20° 초과 | 뻗은 다리 유지 중 |
| `KNEE_BENT` | 골반–무릎–발목 내각 155° 미만 | 유지 중, 무릎 각도가 빠르게 바뀌는 전환 구간 제외 |
| `ARM_HIGH` | 골반→어깨 연장 방향 대비 어깨→팔꿈치가 위로 20° 초과이고 화면 수평 대비도 20° 초과 | 팔이 뻗어진 뒤 안정된 구간 |
| `ARM_LOW` | 같은 팔 방향이 몸통 대비 −25° 미만이고 화면 수평 대비도 −25° 미만 | 팔이 뻗어진 뒤 안정된 구간. 편안한 범위에서 정렬하도록 안내 |
| `ELBOW_BENT` | 어깨–팔꿈치–손목 내각 155° 미만 | 뻗은 팔 유지 중 |
| `HAND_ALIGNMENT` | 지지 손목과 어깨의 화면 수평 거리 / L > 0.30 | 준비·유지 중, 바닥을 짚은 손에만 적용 |
| `SUPPORT_KNEE_ALIGNMENT` | 지지 무릎과 골반의 화면 수평 거리 / L > 0.30 | 준비·유지 중, 바닥에 댄 무릎에만 적용 |
| `SAME_SIDE_PAIR` | 뻗은 팔과 다리가 같은 해부학적 쪽 | 양팔 상태와 한쪽 뻗은 다리를 구분할 수 있을 때만 |
| `BODY_MOVEMENT` | 유지 중 0.8초 창에서 지지점 대비 어깨·골반의 수직 이동 범위 > 0.12 L 또는 몸통 기울기 범위 > 12° | 유지 시작 후 0.3초 안정화. 첫 준비 자세를 정상 기준으로 삼지 않음 |

경고는 조건이 0.35초 지속될 때 발생한다. 팔은 움직임이 잦아든 뒤 0.35초 안정화하며, 무릎 각도가 초당 35° 이상 바뀌면 해당 프레임을 굽힘 평가에서 보류한다. 임계값 근처의 순간 좌표 변화가 바로 경고·해제를 반복하지 않도록 동작 단계와 지속 시간을 함께 사용한다.

**위 숫자는 논문에서 검증된 정상/비정상 경계값이 아니다.** 운동 자료로 평가 항목을 정한 뒤, 현재 영상과 합성 회귀 사례로 동작을 확인한 공학적 초기값이다. 카메라 높이·사선 투영·옷·가림에 따른 차이가 남는다. 팔의 화면 수평 조건은 정상적인 몸통 기울기를 팔 높이 오류로 오인하지 않기 위한 추가 조건이며, 수평에 가까운 고정 카메라를 전제로 한다.

## 공통 입출력

푸시업·플랭크와 같은 `PoseFrame`을 사용한다. `timestampMs`, `width`, `height`, `landmarks`(33 × x/y/z/visibility/presence). 좌우 이름은 MediaPipe의 해부학적 좌우다.

| 출력 | 의미 |
|---|---|
| `schemaVersion`, `exercise`, `engineVersion`, `timestampMs` | 공통 식별·버전·시간 |
| `tracking`, `side` | 현재 관측 상태와 유지 중인 다리 쪽 |
| `phase` | preparation / reaching / holding / returning / not_ready (JS v2) |
| `details.enginePhase` | 기존의 거친 단계 구분. Python 연구 출력은 이전 이름 유지 |
| `count`, `details.sideCounts` | 누적 완료 횟수와 왼다리·오른다리별 횟수 |
| `holdSeconds` | 누적 관측 유지 시간 |
| `items`, `codes` | 항목별 상태와 현재 경고 코드 |
| `metrics`, `body` | 각도·거리·단계·몸통 움직임 수치 |
| `events` | rep.started / rep.completed / rep.interrupted / phase.changed / feedback.changed / frame.gap |

`rep.completed`에는 회차 번호, 다리 쪽, 시작·종료 시각(초), 해당 회차의 유지 시간, 관측된 경고 코드가 들어간다. `finish()`는 미완료 회차를 별도 표시하고 `set.completed`와 최종 집계를 반환한다.

`summary()`는 [공통 세트 결과 v2](result-contract-v2.md)를 제공한다. 항목은 `aggregationBasis: time`, `unit: seconds`, `compliant`, `warning`, `unknown`, `notApplicable`, `evaluated`, `compliancePct`로 저장한다. 준수율은 `100 × compliant / evaluated`이며 평가 불가·대상 아님·판정 대기는 분모에서 제외한다. 평가 시간이 없으면 null이다. 좌우 횟수·회차 목록·설정은 `details`에 저장한다. 판정·시간 집계 알고리즘은 유지한다.

공통 결과 필드가 같다고 각 운동의 세는 단위까지 같다는 뜻은 아니다. 플랭크의 후속 유지 시간 구현은 [관측 유지 시간](PLANK_HOLD.md)을 참고한다.

## 사용

```js
import {BirdDogAnalyzer} from '@barofit/pose';
const analyzer = new BirdDogAnalyzer();
const result = analyzer.pushFrame(poseFrame); // 메모리 객체, 서버 요청 없음
const interruption = analyzer.breakContinuity('pause');
const summary = analyzer.summary();
const finalEvents = analyzer.finish();
```

Python은 `from analysis.bird_dog import BirdDogAnalyzer`, `push_frame(frame)`, `break_continuity()`, `summary()`, `finish()`를 사용한다. 웹은 기존 테스트 페이지 `experiment.html?exercise=bird_dog`에서 같은 JS 모듈을 사용한다. APK 신규 빌드는 이번 작업에 포함하지 않았다.

## 1차 검증

- 기존 23개 클립의 동일 MediaPipe 좌표를 재사용해 규칙 변경만 비교했다. 같은 원본의 중복·교정·오류 구간이 포함되므로 23명을 뜻하지 않는다.
- NHS 정상 유지 구간 7초에서 기존 몸통 경고 4.957초 → 0초. 새 방식은 그중 6.759초 평가, 나머지는 보류다.
- 지지 손목 가림이 있던 NHS 다른 시범의 유지 6초에서 다리·무릎 평가가 전 구간 가능해졌고 해당 경고는 0초다.
- Healthline의 과상승 시범 4구간 중 3구간에서 `LEG_HIGH`, 나머지 1구간에서는 허벅지 방향 대신 무릎 굽힘이 관측된다. 발목이 높다는 이유로 다리 과상승과 무릎 굽힘을 혼동하지 않는다.
- Mission의 무릎 굽힘 구간 5초는 전 구간 경고. 다른 2.2초 구간에서는 1.923초 경고, 나머지는 전환·보류다.
- E3 정상 클립 4회, Vissco 4회, NHS 각 1회, Hinge 6회 출력. 이는 현재 클립 검토 결과이며 일반 인구 카운트 정확도 수치는 아니다.
- 팔 과상승·굽힘·같은 쪽 조합·지지점 정렬은 합성 양성/음성 및 가림·중단 조건을 회귀 검증한다. 실제 오류 양성 영상은 항목별로 균등하게 확보되지 않아 다리·무릎과 동일한 검증 수준이라고 부르지 않는다.
- Howcast 사선, Squat University 지도자 동반 영상 등에서는 투영·가림으로 보류와 일부 잘못된 경고가 남는다. 고정 측면 1인 촬영 범위의 프로토타입으로 제공한다.
- v0.5는 `legacy_v05.py`, `legacy-v05.js`로 보존하며, 과거 테스트는 그 버전을 계속 검증한다. 새 v1 테스트는 별도로 실행한다.

## 근거

- [ACE Bird-dog](https://www.acefitness.org/resources/everyone/exercise-library/14/bird-dog/): 손–어깨·무릎–골반 정렬, 반대쪽 팔·다리 뻗기, 중립을 유지할 수 있는 범위에서 수평에 가깝게 올리기.
- [AAOS Spine Conditioning Program — Bird Dog](https://www.orthoinfo.org/recovery/spine-conditioning-program/): 팔을 몸통 높이로 뻗고 반대 다리를 펴서 유지한 뒤 복귀·반복. 예시 유지 시간 15초, 5회.

자료의 자세 지침과 현재 영상에서 검증한 수학적 근사값은 구분한다. 피드백은 자세 교정 보조 정보이며 척추 상태를 진단하지 않는다.
