# 스쿼트·버드독 실험 페이지

기존 바로핏 리플레이 웹에 붙이는 예제다. 이 폴더만으로는 독립 실행되지 않는다.

```sh
node examples/web/install-experiments.mjs /path/to/existing-site/dist
```

기존 푸시업·플랭크 페이지와 공통 Worker·녹화·ZIP 저장 코드, MediaPipe Full 모델이 필요하다. 설치 스크립트는 필요한 파일을 확인한 뒤 이 폴더의 페이지와 `runtime/common`, `runtime/squat`, `runtime/bird_dog`를 웹 폴더에 복사한다. 기존 푸시업·플랭크 엔진과 메뉴는 변경하지 않는다.

- `experiment.html?exercise=squat`: 측면 스쿼트, 서있는 준비 자세부터 시작
- `experiment.html?exercise=bird_dog`: 버드독, 네발기기 준비 자세부터 시작
- `guide.html`: 운동별 데모와 검증 범위

입력 영상을 1배속으로 재생하면서 브라우저에서 새 좌표를 추출한다. 분석 결과 JSON, 전체 프레임 JSONL·이벤트·메모가 포함된 ZIP, 분석 화면 녹화(선택)를 저장한다. 원본 영상은 서버로 전송하지 않는다.

스쿼트 깊이는 직전 완료 회차 결과를 유지해서 표시한다. 현재 경고는 2초, 회차 경고는 4초 유지하며 동일 음성은 10초, 음성 사이 간격은 6초다. 화면 표시를 유지해도 원시 프레임 판정이나 준수율을 변경하지 않는다. 버드독은 활성 3항목과 좌우 단계·각도를 표시한다.

## 예제 영상

Git에는 모델·원본 영상·분석 영상을 넣지 않는다. 기존 배포 폴더의 아래 파일을 별도로 제공해야 예제 버튼·데모가 동작한다.

```text
samples/pushup-good.mp4
samples/pushup-bad.mp4
samples/squat-good.mp4
samples/squat-bad.mp4
demos/pushup-feedback.mp4
demos/squat-initial.mp4
```

출처·라이선스는 `guide.html`에 표시한다. 이 파일들이 없어도 사용자가 선택한 영상은 분석할 수 있다.

스쿼트 원본은 팀원의 [`feat/squat-colab`](https://github.com/Barofit-team/barofit-pose/tree/feat/squat-colab) 노트북이다. 원본과 웹의 좌우 선택·추적 중단 정책은 다르다. 버드독은 오경고·미검출 보완 중이다. [운동별 구현 현황](../../../docs/EXERCISE_STATUS_20261020.md)을 먼저 확인한다.
