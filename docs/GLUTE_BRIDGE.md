# 글루트 브리지 · v0.4 · 2026-10-23

측면·전신 촬영의 양발 바닥 브리지용 JavaScript 판정 모듈입니다. MediaPipe 33관절 PoseFrame을 입력받으며 관절 추출 자체는 클라이언트가 담당합니다.

```js
import {GluteBridgeAnalyzer} from './runtime/index.js';
const analyzer = new GluteBridgeAnalyzer();
const live = analyzer.pushFrame(frame); // frame.result v2
const result = analyzer.finish()[0]; // set.completed v2
```

`node examples/glute_bridge.mjs frames.jsonl results/glute_bridge`로 저장된 좌표를 재생할 수 있습니다. 입력은 timestampMs, width, height, landmarks이며 좌표 형식은 공통 PoseFrame과 같습니다. 카운트는 상승 후 시작 높이 근처로 복귀한 시도이며 자세 경고로 취소하지 않습니다. holdSeconds는 null, observedSeconds는 사용 가능한 자세를 연속 관측한 시간입니다. 항목별 준수율은 repetition 기준 0–100, 미평가는 null입니다.

|판정 항목|코드|계산 기준|
|---|---|---|
|골반 상승 부족|HIP_LIFT_LOW|최고 신전각 150° 미만 또는 최고점 골반 직선 이탈 비율 >0.07 및 무릎 대비 골반 높이 비율 <0.35|
|발 위치|FOOT_POSITION_OFFSET|상단 정강이 기울기 >25° 또는 준비 자세의 골반–발목 거리/다리 길이 <0.30 및 무릎각 <35°|
|빠른 하강|LOWERING_FAST|전체 하강 <0.6초 및 평균 >65°/초 또는 연속 0.20~0.35초 구간 속도 >105°/초. 최소 15° 하강과 여러 프레임 근거 사용|
|허리 중립·좌우 무릎 정렬|not_supported|측면 관절만으로 확정하지 않으며 정상 판정에 포함하지 않음|

수치 임계값은 영상 기반 공학적 설정값입니다. 고관절 투영각은 척추 곡률이나 근육 수축도를 의미하지 않습니다. 하강 경고는 회차 완료 시 확정됩니다.

|측정값|필드|단위|
|---|---|---|
|실시간 움직임 상태|metrics.tempo.state|rising / lowering / still / unknown|
|실제 상승·하강 시간|repetition.metrics.tempo.riseMovingMs / lowerMovingMs|ms|
|상단·하단·중간 정지|tempo.topHoldMs / bottomHoldMs / midPauseMs|ms|
|전체 정지·미분류·회차 구간|tempo.pauseMs / unclassifiedMs / intervalMs|ms|
|최고점부터 복귀까지|loweringDurationMs|ms, 정지 포함 가능|
|전체 하강 평균 속도|loweringSpeedDegS|°/s|
|급하강 구간 근거|loweringEvidence.peakWindow|startMs / endMs / durationMs / dropDeg / speedDegS|
|하강 판정 이유|loweringEvidence.reason|fast_descent / rapid_segment / fast_descent_and_burst / within_reference|

회차 측정값은 실시간 lastRepetition.metrics와 종료 summary.details.repetitions[].metrics에 동일하게 기록합니다. 정지 시간은 위치 변화가 작은 시간이며 근육 활성이나 수축을 직접 측정하지 않습니다.

검증: 162개 클립/구간 수정 전후 비교, 정상 시범 8구간·11회의 하강 경고 0건. 추가 빠른 동작 라벨 24개에서 경고 영상 20→22개. 라벨은 영상 단위이며 회차별 정확도로 해석하지 않습니다. 기존 카운트·골반 상승·발 위치와 템포 시간 분할은 보존했습니다.

[하강 템포 근거·검증](GLUTE_BRIDGE_V04.md) · [발 위치 보완 기록](GLUTE_BRIDGE_V02.md) · [초기 설계 기록](GLUTE_BRIDGE_V01.md)
