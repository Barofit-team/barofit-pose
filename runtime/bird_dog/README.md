# 버드독 웹 런타임 — 실험 중

Python `analysis/bird_dog/adapter.py` v0.3의 상태 및 기하 계산을 JS로 옮겼다.

```js
import {BirdDogAnalyzer} from './analyzer.js';
const analyzer = new BirdDogAnalyzer();
const result = analyzer.pushFrame({
  timestampMs: 1000, width: 960, height: 540,
  landmarks: /* 33 × [x, y, z, visibility, presence] */
});
analyzer.breakContinuity('pause');
const summary = analyzer.summary();
const events = analyzer.finish();
```

- 준비 → 뻗기 → 유지 → 복귀를 구분한다.
- `LEFT_LEG_HIGH` / `RIGHT_LEG_HIGH`: 유지 중인 다리가 몸통 연장선보다 위로 벗어난 경우.
- `BODY_MOVEMENT`: 안정된 준비 구간에서 확보한 기준보다 몸통 움직임이 커진 경우.
- 기준은 관측된 준비 자세이며, 올바른 자세라는 인증이 아니다.
- 무릎·팔·지지 정렬 등 다른 항목은 `disabled`, 허리 곡률·축 회전은 `not_supported`다.
- `count`와 `holdSeconds`는 `null`이다. 횟수나 운동 유지 시간 기능이 구현됐다는 뜻으로 사용하면 안 된다.
- 화면 바깥/가려진 관절과 판단 대상이 아닌 단계는 `unknown` / `not_applicable`로 구분한다.
- 수치는 임시 공학 기준이며, 신규 사람의 정상 오경고와 오류 누락이 있어 정식 지원 종목으로 안내하지 않는다.

`summary()`의 항목별 시간은 인접한 관측 프레임 구간을 합산한 테스트용 값이다. 영상 공백과 일시정지는 제외하며, 판정 불가·대상 외 시간을 정상으로 계산하지 않는다.

검증:

```text
node --test tests/js/bird_dog.test.mjs
```

Python v0.3에서 추출한 합성 798프레임의 입력·기대 결과를 고정 fixture로 보관한다. CI에서 Python 설치나 로컬 분석 코드 없이 비교하며, 영상·사용자 좌표는 포함하지 않는다. 자세한 출처는 `tests/js/fixtures/README.md`에 기록했다.
