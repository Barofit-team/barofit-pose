# 버드독 v1.0 — 1차 프로토타입

고정 측면 1인 촬영. 준비 → 뻗기·유지 → 복귀를 구분한다.
한쪽 동작 1회와 관측 유지 시간을 기록하며, 자세 오류로 횟수를 취소하지 않는다.

- 팔·다리 정렬, 팔꿈치·무릎 펴기, 지지 손·무릎 위치, 반대쪽 조합, 유지 중 몸통 움직임
- 관절이 가려지면 그 관절이 필요한 항목만 보류
- 허리 곡률·척추 중립·축 회전은 판정하지 않음
- `pushFrame(frame)` → 공통 결과, `summary()` → 세트 집계, `finish()` → 종료 이벤트
- `breakContinuity('pause')`는 완료 횟수를 보존하고 미완료 동작을 끊음

[전체 판정 기준·입출력·검증 범위](../../docs/BIRD_DOG_V1.md)

Python 기준 구현: `analysis/bird_dog/prototype_v1.py`.
과거 v0.5는 `legacy-v05.js`로 보존하고 과거 회귀 테스트에서만 사용한다.

```sh
node --test tests/js/bird_dog_v1.test.mjs
```
