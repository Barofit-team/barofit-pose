# Barofit Pose

바로핏의 **MediaPipe 관절 추출 연동 + 운동별 자세 판정 모듈**을 관리합니다.
앱 전체나 FastAPI 서버가 아닙니다. Python으로 판정 기준을 검증하고, 앱·웹용 코드는 별도로 관리합니다.

## 현재 상태

| 운동 | Python 분석 | 앱·웹 JavaScript | 내용 |
|---|---|---|---|
| 푸시업 | 기존 통합 카운트 v3 보존 | APK v1.3 엔진 보존 | 움직임 카운트, 골반·팔꿈치·상체 이동·손 위치·복귀 피드백 |
| 플랭크 | 측면 v0.2 보존 | JavaScript 이식 및 웹 리플레이 | 골반 정렬, 어깨–팔꿈치 정렬, 무릎 펴기. 팔꿈치 각도는 기록만 함 |
| 레그 레이즈 | 영상 추출 후 공통 JS 엔진 호출 | 측면 v0.1.1 | 올림–내림 카운트, 무릎 펴기·하강 속도, 상승·하강·정지 시간. [기준](docs/LEG_RAISE_V01.md) · [템포](docs/LEG_RAISE_TEMPO.md) |
| 글루트 브리지 | 영상 추출 후 공통 JS 엔진 호출 | 측면 v0.4 | 상승–복귀 카운트, 골반 상승·발 위치·하강 속도, 구간 속도 및 템포. [사용법·검증](docs/GLUTE_BRIDGE.md) |
| 스쿼트 | 담당자 추가 예정 | 담당자 추가 예정 | [운동 추가 안내](docs/ADDING_EXERCISE.md) |
| 버드독 | 1차 프로토타입 v1.0 | Python과 동일 규칙 / 웹 반영 | 준비·유지·복귀, 횟수·유지 시간, 팔·다리 정렬. [입출력·기준·검증](docs/BIRD_DOG_V1.md) |

플랭크는 기준을 충족한 자세의 유지 시간과 항목별 준수율을 제공합니다. 준비/시작/종료 등 서비스 흐름은 별도로 관리합니다.

프론트 연동: [실시간 결과 v2](docs/realtime-contract-v2.md) · [세트 종료 결과 v2](docs/result-contract-v2.md). 푸쉬업·플랭크·버드독·레그 레이즈의 JS 공개 Analyzer에 적용합니다. 운동별 판정 의미와 측정 단위는 각 규격에 명시했습니다.

## 구조

```text
analysis/                 Python 검증 코드
  common/                 MediaPipe 영상 추출, 공통 입력 처리
  pushup/                 기존 배치 분석 엔진 + 고정 기준 파일
  plank/                  현재 검증된 판정 로직
  squat/                  스쿼트 담당자 작업 위치
runtime/                  앱·웹용 JavaScript 모듈
  common/                 입력 검사와 공통 출력 타입
  pushup/                 판정 엔진, 좌우 선택, 음성 피드백 간격 제어
  plank/                  측면 판정 엔진 + 항목별 시간 집계
  squat/                  추가 위치 안내
examples/                 영상 추출·분석·Android 연동·웹 리플레이 예제
tests/                    자동 검증, 합성 관절 샘플
docs/                     입출력·판정 기준·검증 기록
```

## 바로 실행

### JavaScript — Node.js 20 이상

외부 npm 의존성이 없는 판정 모듈입니다. 아래 명령은 카메라를 켜지 않습니다.

```sh
npm test
npm run demo
```

데모는 **합성 서 있는 자세**를 입력하므로 0회·인식 불가가 정상입니다.
실제 영상은 먼저 아래 Python 예제로 관절을 추출한 다음 입력합니다.

```sh
node examples/pushup.mjs results/extracted/frames.jsonl
```

### Python — 3.10 이상, 로컬 검증은 3.12 사용

저장소 루트에서 실행합니다. 가상환경 사용을 권장합니다.

```sh
python -m venv .venv
# Windows PowerShell
.venv/Scripts/Activate.ps1
# macOS/Linux에서는 source .venv/bin/activate
python -m pip install -e .
python -m unittest discover -s tests/python -v
```

기존 관절 NPZ가 있으면 MediaPipe 없이 판정만 실행할 수 있습니다.

```sh
python -m examples.analyze_landmarks plank data/clip.npz results/plank
python -m examples.analyze_landmarks pushup data/clip.npz results/pushup --side left
```

NPZ는 `poses(N,33,5)`, `times(N)`(초), `dims(N,2)`(너비·높이), `indices(N)`를 포함합니다.
출력: 세 운동 모두 `summary.json`·`events.json`. 플랭크·버드독은 `frames.jsonl`, 푸쉬업은 프레임·회차·움직임 CSV도 저장합니다.

### 원본 영상에서 추출

```sh
python -m pip install -e ".[video]"
python -m examples.extract_video data/clip.mp4 --model models/pose_landmarker_full.task --output results/extracted
```

모델 준비는 [MediaPipe 연동](docs/MEDIAPIPE.md)을 따릅니다.
분석 대상 영상과 출력 파일은 Git에 올라가지 않습니다.

## 앱에서 사용하는 방법

```javascript
import {PushupAnalyzer} from './runtime/index.js';
const analyzer = new PushupAnalyzer(); // 세트마다 새 인스턴스
const result = analyzer.pushFrame({timestampMs, width, height, landmarks});
// result.count / result.codes / result.tracking을 화면에 반영
// result.side에 해당하는 관절로 뼈대를 그리기
const events = analyzer.finish(); // 세트 종료 시 한 번 처리
```

프레임을 서버에 보낼 필요는 없습니다. 앱에서 직접 함수 호출 후 결과를 사용합니다.
Python 분석 코드는 React Native에서 직접 실행되지 않습니다.
APK에서 사용한 Android 관절 추출 라이브러리 소스는 `examples/react-native/pose-native/`에 있습니다.
완성 앱이 아니며 카메라 권한·화면·생명주기 연결은 호스트 앱에서 담당합니다.

## 팀원이 먼저 볼 문서

1. [입출력 규격](docs/IO_CONTRACT.md)
2. [스쿼트 및 새 운동 추가 방법](docs/ADDING_EXERCISE.md)
3. [운동별 판정 기준과 한계](docs/RULES.md)
4. [MediaPipe 모델·연동 방법](docs/MEDIAPIPE.md)
5. [검증 결과](docs/VALIDATION.md)

개발은 `feat/squat`처럼 브랜치에서 진행하고 PR로 변경 이유·테스트 결과를 공유합니다.
영상·모델 바이너리·APK·개인 로그·인증정보는 커밋하지 않습니다.
정확도 향상과 코드 이식 일치 검증은 구분합니다. 여기의 수치는 임상적으로 검증된 자세 기준이 아닙니다.

## 배포 범위

초기 버전은 팀 내부 코드 공유용입니다. npm/PyPI 공개 배포나 FastAPI 서비스는 포함하지 않습니다.
외부 코드·모델·데이터의 권리는 각각의 원 출처에 따릅니다. [출처 안내](docs/SOURCES.md) 참고.

## 세트 결과 규격

푸쉬업·플랭크·버드독·레그 레이즈는 [세트 결과 JSON v2](docs/result-contract-v2.md)를 사용합니다. 항목별 `compliancePct`는 0~100이며 집계 단위는 `aggregationBasis`로 구분합니다. 프레임 판정과 카운트 로직은 유지됩니다.
