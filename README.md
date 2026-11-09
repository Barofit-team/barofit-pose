# Barofit Pose

MediaPipe 관절 좌표를 입력받아 운동 횟수, 유지 시간, 자세 피드백을 계산하는 JavaScript 모듈입니다. 공개 진입점은 [runtime/index.js](runtime/index.js)입니다.

## 지원 운동

| 운동 | 운동 ID (`exercise`) | 클래스 | 측정 |
|---|---|---|---|
| 푸시업 | `pushup` | `PushupAnalyzer` | 횟수 |
| 플랭크 | `plank` | `PlankAnalyzer` | 유지 시간 |
| 스쿼트 | `squat` | `SquatAnalyzer` | 횟수 |
| 버드독 | `bird_dog` | `BirdDogAnalyzer` | 좌우 횟수·유지 시간 |
| 점핑잭 | `jumping_jack` | `JumpingJackAnalyzer` | 횟수 |
| 레그 레이즈 | `leg_raise` | `LegRaiseAnalyzer` | 횟수 |
| 글루트 브리지 | `glute_bridge` | `GluteBridgeAnalyzer` | 횟수 |
| 파이크 푸시업 | `pike_pushup` | `PikePushupAnalyzer` | 횟수 |
| 수퍼맨 | `superman` | `SupermanAnalyzer` | 횟수·유지 시간 |
| [마운틴 클라이머](docs/MOUNTAIN_CLIMBER_V01.md) | `mountain_climber` | `MountainClimberAnalyzer` | 한쪽 무릎 왕복 횟수 · 골반 들림 · 회차 기준 준수율 |
| 런지 | `lunge` | `LungeAnalyzer` | 횟수 |
| 스플릿 스쿼트 | `split_squat` | `SplitSquatAnalyzer` | 횟수 |
| 불가리안 스플릿 스쿼트 | `bulgarian_split_squat` | `BulgarianSplitSquatAnalyzer` | 횟수 |
| 인클라인 푸시업 | `incline_pushup` | `InclinePushupAnalyzer` | 횟수 |
| 옆으로 누워 다리 들기 | `side_lying_leg_raise` | `SideLegRaiseAnalyzer` | 횟수 |
| 스탠딩 카프레이즈 | `standing_calf_raise` | `StandingCalfRaiseAnalyzer` | 횟수 |
| 데드버그 | `dead_bug` | `DeadBugAnalyzer` | 횟수 |

런지부터 데드버그까지 7종은 실험 버전입니다. 합성 입력으로 회차와 중단 처리를 검증했으며, 실기기 정확도는 아직 확인되지 않았습니다.

## 규격

마운틴 클라이머 v0.5는 전신 측면 영상으로 1차 프로토타입 검증을 마쳤습니다. 지지 다리가 불확실해도 관측된 무릎 왕복은 집계하며, 골반 판정 보류 회차는 준수율의 분모에서 제외합니다.

세트마다 Analyzer 인스턴스를 하나 생성합니다. 입력 프레임의 필드는 다음과 같습니다.

| 필드 | 형식 | 기준 |
|---|---|---|
| `timestampMs` | number | 같은 카메라·영상 시간축에서 단조 증가하는 밀리초 |
| `width`, `height` | 양의 정수 | 관절 추출에 사용한 프레임의 너비와 높이(픽셀) |
| `landmarks` | 33×5 배열 | MediaPipe 순서의 `[x, y, z, visibility, presence]`. 누락값은 `null`, 사람 전체 미검출은 `[]` |

| 메서드 | 동작 |
|---|---|
| `pushFrame(frame)` | `frame.result` v2를 반환합니다. `ignored`가 참이면 화면·음성 갱신을 건너뜁니다. 현재 자세는 `items`와 `currentCodes`, 최근 완료 회차는 `lastRepetition`에서 읽습니다. |
| `breakContinuity('pause')` | 일시정지 시 호출합니다. 완료 횟수를 보존하고 중단 전후 동작을 분리합니다. |
| `summary()` | 현재 세트의 집계를 반환합니다. 항목별 `aggregationBasis`는 회차 또는 시간이며, `compliancePct`는 0~100, 평가 데이터가 없으면 `null`입니다. |
| `finish()` | 이벤트 배열을 반환합니다. `type === 'set.completed'`인 이벤트의 `summary`를 저장합니다. 반복 호출은 빈 배열을 반환합니다. |

출력 스키마 · [실시간 프레임](schemas/frame-result-v2.schema.json) · [세트 종료](schemas/set-completed-v2.schema.json) · [TypeScript 타입](runtime/common/contracts.d.ts)

## 파일 구조

```text
runtime/
  index.js           공개 Analyzer 내보내기
  common/            입력 검사, v2 출력 생성, 공통 타입
  cycles/            신규 7종의 관절 측정·회차 판정
  adapters/          MoveNet 입력 어댑터
  <운동 디렉터리>/   운동별 판정 엔진
schemas/             프레임·세트 종료 결과의 JSON Schema
analysis/            Python 분석, 관절 추출, 운동별 프로토타입
examples/            영상 추출·JSONL 재생·앱 연동 예제
tests/               JavaScript·Python 테스트와 입력 샘플
docs/                운동별 판정 기준과 검증 기록
```

## 모델 명령어

저장소 루트에서 실행합니다. JS 런타임은 Node.js 20 이상을 사용합니다.

**샘플 프레임으로 푸시업 실행 및 전체 JS 테스트**

```sh
npm run demo
npm test
```

**다른 종목 실행** — 예시는 런지의 세트 결과를 출력합니다. 다른 운동은 위 표의 클래스로 교체합니다.

```sh
node --input-type=module -e "
import { LungeAnalyzer } from './runtime/index.js';
import { readFileSync } from 'node:fs';

const model = new LungeAnalyzer();
const input = readFileSync('tests/fixtures/standing.jsonl', 'utf8');
for (const line of input.trim().split(/\r?\n/)) {
  model.pushFrame(JSON.parse(line));
}
const completed = model.finish().find(event => event.type === 'set.completed');
console.log(completed.summary);
"
```

**영상에서 관절 추출 후 분석** — Python 3.10 이상에서 실행합니다. 입력 영상과 MediaPipe 모델 파일 경로는 실제 파일 위치로 지정합니다.

```sh
python -m pip install -e ".[video]"
python -m examples.extract_video data/clip.mp4 --model models/pose_landmarker_full.task --output results/extracted
node examples/pushup.mjs results/extracted/frames.jsonl
```

촬영 준비 상태: [CameraReadiness 사용법](docs/CAMERA_READINESS.md) — 앱 내부 관절 인식 상태 반환. 기존 운동 결과 v2와 별도 이벤트입니다.

## 사이드 플랭크 · 초기 영상 검증

팔뚝 지지형의 골반·어깨·무릎 판정과 정상 유지 시간 측정을 추가했습니다. 공통 v2 실시간·종료 규격을 사용합니다. 골반 과상승은 정상 영상과 측정 범위가 겹치는 구간을 보류합니다. 자세한 범위와 검증 결과는 [사이드 플랭크 문서](docs/SIDE_PLANK.md)를 참고하세요.
