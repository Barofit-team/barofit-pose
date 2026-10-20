# MediaPipe 연동

## 모델

현재 검증에 사용한 것은 새로 학습한 모델이 아니라 Google MediaPipe Pose Landmarker Full입니다.

- 파일: `pose_landmarker_full.task`
- SHA-256: `5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1`
- Python 추출 버전: `mediapipe==0.10.32`
- 기존 APK Android 의존성: `com.google.mediapipe:tasks-vision:1.0.0`
- 추출: 한 사람, VIDEO 모드, 목표 15fps, 최대 너비 960, 검출/존재/추적 신뢰도 0.5

모델 바이너리는 Git에 포함하지 않습니다. 기존 팀 공유 파일을 `models/pose_landmarker_full.task`에 두거나
[공식 모델 페이지](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/index#models)에서 Full을 준비합니다.
공식 다운로드 위치: https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task

파일을 교체했다면 SHA와 라이브러리 버전을 기록하고 다시 검증합니다.
Python은 모델 경로를 실행 인자로 받으며, 카메라/영상/MediaPipe 의존성은 판정 모듈 import에 강제하지 않습니다.

## Android 연동 예제

`examples/react-native/pose-native/`는 APK v1.3에서 사용하던 실제 네이티브 라이브러리 소스입니다.
카메라와 저장 영상 처리, 관절 이벤트, 진단 내보내기 등이 포함됩니다. 전체 React Native 앱은 아닙니다.

호스트 앱에서 해당 폴더를 로컬 의존성으로 설치하고, 모델을
`pose-native/android/src/main/assets/pose_landmarker_full.task`에 넣습니다.
카메라 권한 요청과 컴포넌트 크기·생명주기·시작/정지는 호스트 앱이 연결해야 합니다.
원본 테스트 앱은 React Native 0.83.1 / React 19.2.0을 사용했습니다.
다른 버전이나 새 아키텍처에서의 호환성을 이번 정리 작업으로 보장하지는 않습니다.

`PoseCamera` 또는 `PoseVideo`의 `onPose` 이벤트에는 `nativeEvent`로 입력 규격의 네 값이 전달됩니다.
`PushupAnalyzer.pushFrame(event.nativeEvent)`의 반환값으로 화면을 갱신합니다.
사람이 없으면 landmarks가 빈 배열일 수 있고 이 경우 인식 불가로 처리됩니다.
영상 반복 재생 등으로 시각이 처음으로 돌아가면 새 분석 인스턴스를 만듭니다.

원본 네이티브 예제는 자체 골격 오버레이가 있습니다. 제품 UI에서 판정한 한쪽만 그리는 정책은
반환된 `side`와 좌표를 이용해 별도로 연결해야 합니다. 기본 오버레이를 그대로 제품 정책이라고 가정하지 않습니다.
