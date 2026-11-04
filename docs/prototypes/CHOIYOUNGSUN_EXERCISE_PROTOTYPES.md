# 최영선 운동 분석 1차 자료

아래 표는 초기 Colab 분석 자료의 범위입니다. 현재 앱 연동용 7종은 [README](../../README.md)와 [공개 진입점](../../runtime/index.js)을 참조하세요.

| 운동 | 코드 또는 자료 | 현재 범위 |
| --- | --- | --- |
| 런지 | `analysis/lunge/barofit_lunge_v2_full.ipynb` | REHAB24-6 Ex5 구간 선택, 관절 추출, 카운트·피드백, 비교 GIF, 결과 JSON |
| 옆으로 누워 다리 들기 | `analysis/side_leg_raise/barofit_side_lying_leg_raise.ipynb` | QEVD 영상 후보 준비, 관절 추출, 카운트·피드백, 비교 GIF |
| 데드버그 | `docs/prototypes/barofit_dead_bug_data_guide.md`, `analysis/dead_bug/barofit_dead_bug_manifest.json` | 데이터 출처·선정 후보만 보존. 분석 코드는 이 브랜치에 없음 |
| 스탠딩 카프레이즈 | `analysis/standing_calf_raise/analyze_standing_calf_raise.py` | 영상 ZIP 입력, 횟수 후보·각도·그래프·GIF 생성 |
| 인클라인 푸쉬업 | `analysis/incline_pushup/incline_pushup_colab_analysis.py` | REHAB24-6 Ex3 ZIP 입력, 동작 카운트·피드백·비교 GIF |
| 불가리안 스플릿 스쿼트 | `analysis/bulgarian_split_squat/verify_bulgarian_split_squat_colab.py` | 데모 ZIP 입력, 스켈레톤·전방 무릎 각도·카운트 MP4 |
| 스플릿 스쿼트 | `analysis/split_squat/verify_split_squat_colab.py` | 데모 ZIP 입력, 스켈레톤·전방 무릎 각도·카운트 MP4 |

각 노트북은 Google Colab에서 위에서 아래로 실행합니다. `.py` 파일은 파일 상단의 설치·입력 ZIP 안내를 확인한 뒤 Colab 코드 셀에 붙여 실행합니다. 운동별 원본 데이터와 이용 조건은 각 파일·가이드에서 확인합니다. ZIP을 구동하는 스크립트는 원본 ZIP을 별도로 MyDrive에 배치해야 합니다.

카운트·자세 안내는 영상에 대한 자동 추정값입니다. 실제 정자세 판정 정확도나 운동별 회차 기준 준수율을 검증한 결과로 간주하지 않습니다. 자료 영상 중 데모 영상은 `unreviewed`이며 자동 카운트만 표시합니다. 실기기 정확도 평가에는 원본 영상과 회차·오류 라벨 대조가 필요합니다.
