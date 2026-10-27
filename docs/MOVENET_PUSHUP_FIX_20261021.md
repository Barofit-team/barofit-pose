# MoveNet 푸시업 연결 보완 — 2026-10-21

## 변경 범위

- 선택형 `MoveNetPushupAnalyzer` 추가. 기본 `PushupAnalyzer`와 MediaPipe 실행 경로는 유지한다.
- MoveNet 원점수 0.3 이상을 관절 사용 기준으로 적용한다. 점수는 정확도 확률이 아니다.
- 팔꿈치가 관측되지 않아도 어깨·손목·골반·발목이 확보되면 기존 어깨 이동 카운터를 계속 사용한다.
- 팔꿈치 평가에는 실제 관측된 팔꿈치만 사용한다. 관측 부족은 `tracking_unavailable` / `unknown`으로 기록한다.
- 필요한 관절의 짧은 누락은 최대 180ms(마지막 정상 관측부터 회복까지) 동안 후보 동작을 보존한다. 누락 프레임에서 횟수를 추가하거나 좌표를 보간하지 않는다.
- 누락 프레임은 평가 자료에 결측으로 남긴다. 긴 누락·시간 단절·좌우 전환은 후보 동작을 초기화한다.
- 기존 각도·거리·왕복 범위·횟수 중복 병합·피드백 기준은 변경하지 않는다.

180ms는 해부학적 기준이 아닌 추적 연속성 설정이다. 15fps에서 한 프레임 누락 시 관측 간 간격은 약133ms, 두 프레임 누락 시 약200ms다. 원래 카운터의 250ms 시간 단절 기준보다 짧게 두었다.

## P5 원인

내려가는 구간마다 MoveNet 팔꿈치 점수가 0.3 아래로 떨어졌다. 기존 연결부가 관절 하나의 누락에도 전체 동작 기록을 지워, 관측 가능한 어깨 이동까지 소실됐다. 예를 들어 2.4초에서 팔꿈치는0.21, 손목은0.74다. 보완 후 팔꿈치 평가는 보류하면서 어깨 왕복은 유지된다.

## 동일 입력 재생 결과

두 MoveNet 열 모두 추적 crop, 원점수 기준0.3을 사용한다. 같은 좌표와 타임스탬프를 재생하여 연결부 변경 효과만 비교했다.

| 영상 | 수정 전0.3 | 수정 후0.3 | 기존 MediaPipe |
|---|---:|---:|---:|
| P2 good |12|12|12|
| P2 bad |13|13|12|
| P5 good |0|6|9|
| P5 bad |8|8|6|

P5 good의 수정 후6회는 어깨 신호로 검출됐다. 팔꿈치 항목은6회 중5회가 관측 부족으로 보류됐다. 카운트 복구를 관절 추적 정확도 개선으로 해석하면 안 된다.

P5 원본은 이미 움직이는 도중에 시작한다. 1.4~14.4초의 주요 왕복6회, 14.5~17.2초 마지막 동작과 불완전한 복귀, 17.2초 이후 무릎을 접고 운동을 끝내는 구간을 구분해 영상에 표시했다. MediaPipe의17.533초·18.533초 카운트는 종료 동작에서 발생했다. 따라서 MediaPipe9회를 정답으로 삼지 않는다. 마지막 시도를 세는 정책이나 자동 종료는 이번 수정 범위에 포함하지 않았다.

P2 bad13회와 P5 bad8회는 기존0.3 결과 유지 여부 확인값이다. 전체 반복의 정답을 수작업 라벨링한 정확도 평가가 아니다. 소수 영상에 대한 결함 수정 및 회귀 점검이며, 교체 승인 근거가 아니다.

## 다른 종목

플랭크·버드독·점핑잭12개 영상도0.3으로 재생했다. 이번 푸시업 연결부 수정 전후의 결과는 동일하다. 기존 엔진의0.5 하드코딩에 맞춘 단조변환은 비교 스크립트 내부에서만 사용한다. 표시·원본 저장 점수는 MoveNet 원점수이며 변환값을 신뢰도 확률로 해석하지 않는다. 자세별 신뢰도 처리 방식까지 검증한 범용 MoveNet 운영 모듈은 아니다.

## 사용

```javascript
import {MoveNetPushupAnalyzer} from './runtime/index.js';
const analyzer = new MoveNetPushupAnalyzer();
const result = analyzer.pushKeypoints({timestampMs, width, height, keypoints});
// keypoints: 원본 영상 기준 정규화된 17개 [y, x, rawScore]
// 기존 frame.result v2; details.diagnostics.poseAdapter에 어댑터 조건 기록
const end = analyzer.finish(); // 기존 set.completed v2
```

재현: `node examples/compare_movenet_fix.mjs PREVIOUS_COMPARISON_DIR OUTPUT_DIR`

64개 단위·회귀 검사를 통과했다. 영상 결과는 기존 frame.result/set.completed v2 스키마로 검증하며 원래16개 엔진·설정·공통 반환 파일의 해시를 비교한다. runtime/index.js에는 선택형 어댑터 export만 추가했다.

[Google MoveNet 모델 카드:0.3 권장](https://www.kaggle.com/models/google/movenet/tensorFlow2/singlepose-lightning/4)
