# 기존 리플레이 웹에 플랭크 추가

기존 바로핏 리플레이 Site의 상단 운동 선택에서 푸시업/플랭크로 이동합니다.
푸시업 페이지·엔진은 유지하고 플랭크 페이지가 `runtime/plank`를 사용합니다.

```sh
node examples/web/install-plank.mjs /path/to/existing-site/dist
python examples/web/make-plank-voices.py /path/to/existing-site/dist/assets/coach
```

두 번째 명령은 신규 음성 파일이 없을 때만 실행합니다 (`edge-tts==7.3.1`, 네트워크 필요).
기존 Site의 `pose-worker.js`, `recording.js`, `speech.js`, `report.js`, `style.css`, MediaPipe 0.10.32 번들·WASM·Full 모델, 골반 음성 파일을 사용합니다. 이 예제 폴더만으로는 독립 실행되지 않습니다.

## 사용자 흐름

1. 운동 선택 → 플랭크 → 측면 영상 선택
2. 실제 자세 구간의 시작·끝 설정 → 분석 시작
3. 한쪽 뼈대, 항목별 상태·수치, 음성 확인
4. 세트 종료 또는 영상 끝 → 전체 결과 ZIP 저장

영상을 1배속으로 재생하면서 Worker에서 새 좌표를 추출합니다. 사전 분석 영상을 재생하는 방식이 아닙니다. 목표 15fps, 입력 너비 최대 960px, CPU로 실행합니다. 느린 기기에서는 분석 프레임을 건너뛰며 공백을 기록합니다.
분석 영상은 실제 재생을 무음으로 녹화하며 일시정지 구간을 제외합니다. MediaRecorder 지원 여부/오류/크기 제한(160MiB)은 결과에 표시합니다.

## 결과

- `result.json`: 설정·모델/엔진 버전·출처 파일명·항목별 시간/준수율·메모
- `frames.jsonl`: 모든 추출 좌표, 원시/필터 지표, 판정 상태, 추론 시간
- `frames.csv`: 수치·상태 요약
- `events.json`, `controls.json`, `audio.json`: 판정 변화·재생 제어·음성 기록
- `analysis_full.webm` 또는 `.mp4`: 분석 화면 녹화(선택)

서버 업로드는 없습니다. 창을 닫거나 운동을 바꾸기 전에 다운로드하세요.
`holdSeconds:null`이며 화면의 시간은 연속 관측 시간입니다. 실제 버틴 시간으로 사용하지 마세요.
어깨 정렬은 화면 수직 방향과 비교하므로 카메라를 수평으로 두고 촬영합니다.

## 수정 원칙

판정 수정은 `runtime/plank/`와 Python 기준 구현에 반영한 뒤 대조 검증합니다. Site의 복사본만 수정하지 않습니다. 설치 스크립트로 동기화하고 팀 저장소와 Site를 각각 게시합니다.
추가 운동은 같은 프레임 규격을 사용하고 운동별 별도 엔진/테스트를 둡니다.
