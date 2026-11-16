# Colab 영상 분석 프로토타입 6종

MediaPipe 관절 추정과 운동별 규칙을 사용해 영상의 반복 후보를 기록합니다. 이 프로토타입은 오프라인 영상 입력용입니다. 앱에서 사용하는 JavaScript Analyzer 및 공통 결과 v2에는 아직 연결하지 않았습니다.

| 운동 | Colab 코드 | 검증 기준 | 시범 영상 자동 감지 | 한계 |
|---|---|---|---|---|
| 점프 스쿼트 | [verify_jump_squat_colab.py](../../analysis/jump_squat/verify_jump_squat_colab.py) | 무릎 각도와 발목 높이로 하강·도약·복귀 후보 감지 | 5회 | 머리 뒤에 손을 둔 변형 시범. 착지 품질 미판정 |
| 리버스 크런치 | [verify_reverse_crunch_colab.py](../../analysis/reverse_crunch/verify_reverse_crunch_colab.py) | 무릎–어깨 거리와 몸통 길이의 비율로 접힘·펴짐 감지 | 5회 | 교차 다리 변형. 두 사람이 겹치는 구간 있음 |
| 플러터킥 | [verify_flutter_kicks_colab.py](../../analysis/flutter_kicks/verify_flutter_kicks_colab.py) | 좌우 다리 각도 차로 교대 두 번을 1회 후보로 집계 | 측면 5회 / 사선 6회 | 동일 수행의 두 시점이며 합산하지 않음. 사선 추가 후보는 미검수 |
| 버피 | [verify_burpee_colab.py](../../analysis/burpee/verify_burpee_colab.py) | 어깨 하강 비율로 서기·낮은 자세·서기 복귀 감지 | 정면 1회 / 측면 1회 | 점프·착지 및 푸시업 깊이는 미판정 |
| 풀업 | [verify_pullup_colab.py](../../analysis/pullup/verify_pullup_colab.py) | 같은 팔의 팔꿈치 펴짐·굽힘·펴짐 감지 | 전신 1회 / 상체 중심 2회 | 철봉 통과·반동·그립 미판정 |
| 싯업 | [verify_situp_colab.py](../../analysis/situp/verify_situp_colab.py) | 어깨–골반 선 기울기의 낮음·높음·낮음 전환 감지 | 단일 1회 / 연속 10회 | 등·팔꿈치 접촉 미판정 |

## 실행

1. 해당 운동의 팀 공유용 검증 ZIP을 압축 해제하지 않고 Google Drive의 MyDrive에 한 개만 올립니다.
2. 표에서 운동의 Python 파일을 열어 전체 내용을 Colab 코드 셀 하나에 붙여 넣고 실행합니다.
3. 출력 MP4와 GIF, 프레임별 CSV, 요약 JSON을 `MyDrive/BarofitResults/<운동 ID>/run_*`에서 확인합니다.

## 입력 영상 출처

저장소에는 원본 영상, 추출 좌표 및 검증 ZIP을 올리지 않습니다. 아래 원본과 팀 공유 ZIP 이름으로 입력을 식별할 수 있습니다. ZIP에는 영상 경로와 해시를 담은 매니페스트가 포함됩니다.

| 운동 | 공유 ZIP | 원본 출처 |
|---|---|---|
| 점프 스쿼트 | `barofit_jump_squat_pilot_v1.zip` | [DVIDS 원본](https://www.dvidshub.net/video/549351/prisoner-squat-jump) |
| 리버스 크런치 | `barofit_reverse_crunch_pilot_v1.zip` | [DVIDS 원본](https://www.dvidshub.net/video/825274/2-minute-cross-leg-reverse-crunch) |
| 플러터킥 | `barofit_flutter_kicks_pilot_v1.zip` | [DVIDS 원본](https://www.dvidshub.net/video/639942/flutter-kicks) |
| 버피 | `barofit_burpee_pilot_v1.zip` | [DVIDS 원본](https://www.dvidshub.net/video/753244/burpee) |
| 풀업 | `barofit_pullup_pilot_v1.zip` | [DVIDS 원본](https://www.dvidshub.net/video/877400/pft-prep-perfect-pull-ups) |
| 싯업 | `barofit_situp_pilot_v1.zip` | [DVIDS 원본](https://www.dvidshub.net/video/1016256/culture-fitness-sit-ups) |

## 검증 범위

위 횟수는 제공 시범 영상에서 사전 실행한 자동 감지 후보입니다. 수동 라벨 대비 정확도, 다른 참가자·촬영 각도에서의 성능, 자세 준수율은 확인하지 않았습니다. 입력 영상과 결과 파일은 별도로 관리합니다.
