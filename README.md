# Barofit Pose

바로핏의 **MediaPipe 관절 추출 연동 + 운동별 자세 판정 모듈**을 관리합니다.
앱 전체나 FastAPI 서버가 아닙니다. Python으로 판정 기준을 검증하고, 앱·웹용 코드는 별도로 관리합니다.

## 앱 연동 가능 종목 · 9종

아래 9종은 [공개 진입점](runtime/index.js)에서 Analyzer를 가져와 앱과 웹에서 실행할 수 있습니다. MoveNet 푸시업 어댑터는 같은 운동의 다른 입력 경로입니다.

| 운동 | Python 분석 | 앱·웹 JavaScript | 내용 |
|---|---|---|---|
| 푸시업 | 기존 통합 카운트 v3 보존 | APK v1.3 엔진 보존 | 움직임 카운트, 골반·팔꿈치·상체 이동·손 위치·복귀 피드백 |
| 플랭크 | 측면 v0.2 보존 | JavaScript 이식 및 웹 리플레이 | 골반 정렬, 어깨–팔꿈치 정렬, 무릎 펴기. 팔꿈치 각도는 기록만 함 |
| 점핑잭 | 영상 추출 후 공통 JS 엔진 호출 | 정면 v0.1 | 시도 카운트, 팔·다리·협응·복귀·몸통. [기준·검증](docs/JUMPING_JACK_V01.md) |
| 레그 레이즈 | 영상 추출 후 공통 JS 엔진 호출 | 측면 v0.1.1 | 올림–내림 카운트, 무릎 펴기·하강 속도, 상승·하강·정지 시간. [기준](docs/LEG_RAISE_V01.md) · [템포](docs/LEG_RAISE_TEMPO.md) |
| 글루트 브리지 | 영상 추출 후 공통 JS 엔진 호출 | 측면 v0.4 | 상승–복귀 카운트, 골반 상승·발 위치·하강 속도, 구간 속도 및 템포. [사용법·검증](docs/GLUTE_BRIDGE.md) |
| 파이크 푸시업 | 영상 추출 후 공통 JS 엔진 호출 | 측면 v0.2 | 하강–복귀 카운트, 역V 유지·머리 경로·복귀 방향. [기준·검증](docs/PIKE_PUSHUP_V02.md) |
| 수퍼맨 | 영상 추출 후 공통 JS 엔진 호출 | 측면·사선 v0.3 | 팔 굽힘과 카운트 분리, 무릎·속도 피드백, 종료 구분. [최신 검증](docs/SUPERMAN_V03.md) |
| 스쿼트 | 구현 | 실시간·세트 종료 v2 | 깊이는 회차별, 몸통은 시간 기준으로 집계합니다.  [규격](runtime/squat/README.md) |
| 버드독 | 1차 프로토타입 v1.0 | Python과 동일 규칙 / 웹 반영 | 준비·유지·복귀, 횟수·유지 시간, 팔·다리 정렬. [입출력·기준·검증](docs/BIRD_DOG_V1.md) |

플랭크는 기준을 충족한 자세의 유지 시간과 항목별 준수율을 제공합니다. 준비/시작/종료 등 서비스 흐름은 별도로 관리합니다.

## 분석 단계 종목 · 7종

| 단계 | 종목 | 저장 위치 |
|---|---|---|
| Colab 분석 노트북 | 런지, 옆으로 누워 다리 들기 | [런지](analysis/lunge/) · [옆으로 누워 다리 들기](analysis/side_leg_raise/) |
| 영상 분석 스크립트 | 스탠딩 카프레이즈, 인클라인 푸시업, 불가리안 스플릿 스쿼트, 스플릿 스쿼트 | [카프레이즈](analysis/standing_calf_raise/) · [인클라인 푸시업](analysis/incline_pushup/) · [불가리안 스플릿 스쿼트](analysis/bulgarian_split_squat/) · [스플릿 스쿼트](analysis/split_squat/) |
| 데이터 준비 | 데드버그 | [데이터 가이드](docs/prototypes/barofit_dead_bug_data_guide.md) · [데이터 목록](analysis/dead_bug/) |

이 7종의 앱 연동에는 공개 Analyzer와 v2 출력 구현이 필요합니다. 분석별 입력 영상과 실행 방법은 [프로토타입 안내](docs/prototypes/CHOIYOUNGSUN_EXERCISE_PROTOTYPES.md)에 정리했습니다.

## 앱 공통 규격

앱은 세트마다 Analyzer를 생성합니다. `pushFrame()`에 같은 카메라 시간축의 밀리초, 영상 크기, MediaPipe 관절 33×5를 전달합니다. 전체 미검출 프레임은 빈 관절 배열로 전달합니다.

| 호출 | 앱에서 사용할 결과 |
|---|---|
| `pushFrame(frame)` | `frame.result` v2를 반환합니다. `ignored`면 화면과 음성을 갱신하지 않습니다. 현재 판정은 `items`·`currentCodes`, 최근 완료 회차는 `lastRepetition`에서 읽습니다. |
| `breakContinuity('pause')` | 일시정지 시 진행 중인 동작을 끊습니다. 세션 타이머는 앱에서 관리합니다. |
| `summary()` | 현재까지의 세트 집계를 반환합니다. `items.*.aggregationBasis`로 회차·시간 기준을 구분합니다. `compliancePct`는 0~100이며 평가할 데이터가 없으면 `null`입니다. |
| `finish()` | 이벤트 배열에서 `type === 'set.completed'`인 이벤트의 `summary`를 저장합니다. 다시 호출하면 빈 배열을 반환합니다. |

[실시간 규격](docs/realtime-contract-v2.md) · [세트 종료 규격](docs/result-contract-v2.md) · [JSON Schema](schemas/) · [TypeScript 타입](runtime/common/contracts.d.ts)

## main 검토 결과 · 2026-11-04

`efe7403`에서 기존 JS 테스트 120개와 Python 테스트 48개가 통과했습니다. JS 테스트에서 공개 Analyzer가 반환한 실시간 결과 17,270개와 세트 종료 이벤트 48개를 저장소의 JSON Schema로 검증했습니다. 검증 범위는 저장소 테스트와 합성 입력이며, 실기기·원본 영상에 대한 신규 정확도 측정은 별도입니다.

| 재현 항목 | 결과 및 연동 시 영향 |
|---|---|
| 일시정지 후 시간 집계 | 마지막 프레임 5초 뒤에 재개하면 버드독·글루트 브리지·점핑잭·레그 레이즈·파이크 푸시업·수퍼맨은 `gapSeconds`가 5초 늘어납니다. 스쿼트·플랭크는 같은 입력에서 늘지 않고 푸시업은 해당 지표가 `null`입니다. 종목 간 추적 손실 시간을 비교할 때 일시정지 구간이 섞입니다. |
| 인클라인 푸시업 분석 초안 | 팔꿈치 각도를 170°→80°로 낮춘 뒤 15fps에서 15프레임을 누락시키고 170°로 재개하면 1회가 기록됩니다. 관절 미검출 전후의 움직임이 한 회차로 연결되므로 앱 이식 전 재검증이 필요합니다. |

## 구조

관절 추출기 교체 실험: [MoveNet Lightning 연결·4종 운동 비교](docs/MOVENET_TRANSFER_20261021.md). 기본 MediaPipe는 유지하며, 비교용 입력 어댑터와 별도 실행 예제를 제공한다.

```text
analysis/                 Python 검증 코드
  common/                 MediaPipe 영상 추출, 공통 입력 처리
  pushup/                 기존 배치 분석 엔진 + 고정 기준 파일
  plank/                  현재 검증된 판정 로직
  squat/                  스쿼트 분석 코드
runtime/                  앱·웹용 JavaScript 모듈
  common/                 입력 검사와 공통 출력 타입
  pushup/                 판정 엔진, 좌우 선택, 음성 피드백 간격 제어
  plank/                  측면 판정 엔진 + 항목별 시간 집계
  squat/                  측면 판정 엔진 + 깊이·몸통 집계
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

## MoveNet 선택형 비교

기본 MediaPipe 경로는 유지합니다. [MoveNet 푸시업 연결 보완](docs/MOVENET_PUSHUP_FIX_20261021.md)은 신뢰도0.3, 부분 관절 누락, 수정 전후 결과와 사용법을 정리합니다.

푸시업 종료 동작의 추가 카운트를 막는 [공통 수행 상태 구분](docs/PUSHUP_ACTIVITY_20261021.md)을 두 모델 실행 경로에 적용했습니다. 작은 움직임 기준과 자세 평가 기준은 유지합니다.

## 수퍼맨

`SupermanAnalyzer`는 엎드린 양팔·양다리 들기/복귀를 카운트하고 무릎·팔 펴짐 및 반복 속도를 평가합니다. 실시간·세트 종료 v2를 사용합니다. [판정 근거](docs/SUPERMAN_V01.md), [팔 굽힘·종료 분리 검증](docs/SUPERMAN_V03.md), [JSONL 실행 예제](examples/superman.mjs)를 참고하세요.
