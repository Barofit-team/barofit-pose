# 리포트 서비스 라벨 수정안

barofit-report-labels.patch는 Barofit-team/barofit-report의 dev 기준
4d859346df28b802cecaa0077389684c2ce2520b에 적용하는 별도 변경안입니다.
GitHub 앱의 해당 저장소 쓰기가 403으로 거절되어 원격 PR을 생성하지 못했습니다.
프론트엔드 파일은 포함하지 않습니다.

내용:
- 4개 항목 하드코딩을 pose 공통 카탈로그 52개 한국어 라벨로 확장.
- GeneratedReportService의 새 리포트 강점/개선/다음 목표 문장에 연결.
- 알 수 없는 항목의 원시 id를 사용자 문구로 출력하지 않음.
- 실제 generate 경로와 라벨 카탈로그 동기화 단위 테스트 추가.
- 기존 저장 리포트는 불변 정책대로 소급 갱신하지 않음.

적용:
1. report 저장소에서 dev 최신 상태와 사용자 변경을 확인하고 별도 브랜치를 만듭니다.
2. git apply --check /path/to/barofit-report-labels.patch
3. git apply /path/to/barofit-report-labels.patch

에이전트는 기준 커밋의 별도 체크아웃에서 패치 적용 검사를 통과했습니다.
Java 컴파일러·Docker·minikube가 없고 Gradle 다운로드도 실패하여 Java 테스트/Spotless 및
서비스/infra 통합 검사는 통과 여부를 확인하지 못했습니다. 패치에 테스트는 있지만 실행 검증 전입니다.
보고용 서버 코드가 검증되었다고 해석하거나 그대로 운영 배포하지 않습니다.

적용 환경에서 공통 라이브러리 의존성을 준비하고 report의
./gradlew spotlessApply test integrationTest spotlessCheck와 여러 저장소 변경에 필요한
infra E2E를 완료한 뒤 report 저장소에 별도 PR을 올려야 합니다.
