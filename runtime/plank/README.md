# 플랭크 JavaScript 모듈

`engine.js`는 `analysis/plank/` v0.2의 인과적 이식입니다. 임계값·중앙값 필터·좌우 선택·히스테리시스를 유지합니다.
`analyzer.js`의 `PlankAnalyzer`가 공통 프레임 입력을 받아 결과·이벤트·항목별 시간 통계를 반환합니다.

```js
import {PlankAnalyzer} from '@barofit/pose';
const engine = new PlankAnalyzer();
const result = engine.pushFrame({timestampMs:1000,width:960,height:540,landmarks:[]});
engine.breakContinuity('pause');
const events = engine.finish();
```

빈 배열은 미검출입니다. 실제 입력은 33개 `[x,y,z,visibility,presence]` 배열입니다.
`count`, `holdSeconds`는 null입니다. `observedSeconds`는 0.25초 이하 간격의 분석 샘플 사이 시간만 합산합니다. 운동 유지 시간을 자동으로 감지한 값이 아닙니다.
각 항목의 `compliance_pct`는 평가 가능 시간 기준이며, 미검출·안정화·좌우 전환은 준수로 처리하지 않습니다.

기존 9개 영상에서 얻은 동일 좌표 2,533프레임을 Python과 대조했습니다. 상태·피드백·선택 측은 모두 일치하고 숫자 허용오차는 1e-8입니다. 이는 새 영상에 대한 정확도 평가와는 다릅니다.
웹 리플레이는 `examples/web/`를 참고하세요. 앱에 이 모듈을 연결하는 작업은 별도로 필요합니다.
