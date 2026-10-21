# 스쿼트 웹 런타임 — 실험 중

팀원 [`feat/squat-colab`, `54c56ab`](https://github.com/Barofit-team/barofit-pose/blob/54c56ab77c27d9e4b40314bc945519cca645607a/examples/notebooks/barofit_squat_comparison.ipynb)의 Python 수식·상태 전이를 `engine.js`로 옮겼다. 임계값은 원본의 초기 설정을 유지했다.

```js
import {SquatAnalyzer} from '@barofit/pose';
const analyzer = new SquatAnalyzer({side: null}); // 자동, 또는 'left' / 'right'
const result = analyzer.pushFrame({timestampMs, width, height, landmarks});
analyzer.breakContinuity('pause');
const summary = analyzer.summary();
const events = analyzer.finish();
```

- 측면의 어깨·골반·무릎·발목을 사용한다.
- 서기 ≥155° → 굽힘 ≤125° → 서기로 카운트한다.
- 완료 회차의 최소 무릎 각도 >100°이면 `SQUAT_SHALLOW`. 횟수는 차감하지 않는다.
- 상체 기울기 >45°가 0.6초 지속되면 `TRUNK_LEAN`, ≤40°에서 해제한다. 허리 곡률을 측정하는 지표는 아니다.
- 더 얕은 시도는 카운트되지 않는다. 푸시업의 시도 카운트 정책과 다르다.
- `analyzer.js`의 실시간 좌우 선택은 원본과 별도다. 서있는 준비 상태가 0.4초 확보된 쪽을 고른 뒤 고정한다. 관절 누락·좌우 전환·일시정지는 미완성 회차를 끊는다.
- 깊이 준수율은 완료 회차 기준, 상체 기울기 준수율은 평가 가능한 시간 기준이다. `holdSeconds`는 `null`이다.

원본과 JS의 구현 일치를 확인했으며 실제 자세 정확도는 아직 미확정이다. 배경 인물과의 추적 혼선도 보완해야 한다. [운동별 구현 현황](../../docs/EXERCISE_STATUS_20261020.md) 참고.

```text
node --test tests/js/squat.test.mjs
```
