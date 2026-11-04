# 바로핏 데드버그 데이터 조사·실행 안내

작성일: 2026-10-26

## 1. 선정 데이터

Qualcomm Exercise Video Dataset(QEVD)의 **QEVD-FIT-300k 원본 영상**과 **QEVD-FIT-COACH/fine_grained_labels.json**을 사용한다. 공식 라벨 파일을 직접 조사한 결과, `dead bugs`는 3,752개 영상 항목, `dead bugs (legs only)`는 3,367개 영상 항목이 확인되었다. 합계 7,119개이며 이는 사람 수가 아니다.

이번 실험은 팔·다리를 함께 사용하는 `dead bugs`만 선택한다. 다리만 사용하는 변형을 팔 협응 오류로 잘못 판정하지 않도록 두 종류를 섞지 않는다.

| 데이터 | 포함 내용 | 이번 사용 |
|---|---|---|
| QEVD-FIT-300k | 짧은 원본 MP4 운동 영상 | Part 1의 영상 5개 |
| QEVD-FIT-COACH | 운동명·동작 속성 등 추가 라벨 | fine_grained_labels.json |
| REHAB24-6 | 팔 외전, Arm VW, 테이블 푸시업, 다리 외전, 런지, 스쿼트 | 데드버그가 없어 제외 |

## 2. 비교 영상

| 번호 | 파일 | 표시 이름 | 원본 속성 | 길이 |
|---|---|---|---|---:|
| 1 | `00002796.mp4` | 기준 후보: 반대쪽 협응 | `dead bugs - moving opposite leg` | 8.00초 |
| 2 | `00001432.mp4` | 같은 쪽 팔·다리 후보 | `dead bugs - moving same side` | 7.93초 |
| 3 | `00005475.mp4` | 다리 펴기 부족 후보 | `dead bugs - not fully extending legs` | 7.97초 |
| 4 | `00001604.mp4` | 빠른 속도 후보 | `dead bugs - too fast` | 7.93초 |
| 5 | `00003091.mp4` | 교대가 빠른 후보 | `dead bugs - start moving opposite leg too early` | 7.93초 |

기준 후보 1개와 비교 후보 4개를 짝지어 GIF 4개를 만든다. 영상 5개의 원본 크기 합계는 약 1.76MB이다. 전체 데이터셋을 다운로드할 필요가 없다.

**'moving opposite leg'는 반대쪽 협응에 대한 라벨이며 완전한 정자세 인증이 아니다.** 기준 후보에도 무릎·속도 경고가 나올 수 있다. 나머지 라벨도 영상 단위 속성이므로 모든 프레임이 동일한 오류를 보인다는 의미는 아니다. 원본 라벨을 엔진에 넣어 경고를 강제하지 않는다.

## 3. 제공 파일과 실행

- `barofit_dead_bug_data_guide.md`: 이 안내 문서. 노션에 복사하거나 가져올 수 있다.
- `barofit_dead_bug_manifest.json`: 영상 파일명, 원본 속성, ZIP 바이트 위치, CRC, SHA-256 등 선택 영상 다운로드 정보. 원본 영상 파일은 아니다.
- 전체 코드는 채팅에 제공한다. IPYNB 파일은 만들지 않았다.

Colab의 새 노트북에 코드를 1번부터 순서대로 붙여넣어 실행한다. Google 계정 연결을 허용하면 Drive에 데이터와 결과가 저장된다. 코드에 선택 영상 정보가 포함되어 있어 manifest 파일을 따로 업로드할 필요는 없다.

```text
내 드라이브/Barofit/dead_bug/
  videos/                  선택한 원본 영상 5개
  pose_cache/              관절 및 표시용 프레임 캐시
  날짜_시각_식별자/         실행별 결과
```

`SAVE_TO_DRIVE=True`가 기본이다. False로 바꾸면 `/content/barofit_dead_bug`에 저장되며 런타임이 종료되면 사라질 수 있다. 결과는 항상 새 폴더를 만들어 저장한다.

다운로드 코드는 공식 서버에 필요한 바이트만 요청한다. 전체 분할 ZIP은 받지 않는다. CRC 및 SHA-256을 검증하며 서버가 Range 요청을 거부하거나 파일 버전이 달라지면 중단한다. 이때 검증을 끄지 말고 다운로드 정보를 재확인한다.

## 4. 분석 내용

| 기능 | 구현 |
|---|---|
| 관절 추출 | MediaPipe Pose Landmarker Full, 영상 모드 |
| 샘플링 | 15 FPS |
| 카운트 단위 | 한쪽 다리 뻗기 후 준비 자세 복귀 = 1회 |
| 좌우 집계 | left/right 별도 저장, 합이 전체 count |
| 관절 표시 | 사진 위 팔·몸통·다리 스켈레톤과 무릎 각도 |
| 실시간 안내 | 반대쪽 팔·다리 뻗기, 준비 자세, 촬영 상태 안내 |
| 회차 피드백 | 다리 범위, 무릎 펴기, 반대쪽 팔, 양다리 동시 뻗기, 속도 |
| 그래프 | 통합 그래프 1장 + 케이스별 6개 각도 패널 5장 |
| 결과 | GIF 4개, 프레임 JSONL, 세트 JSON, CSV, 설정, 결과 ZIP |

MediaPipe는 자세 추정 모델이며 VLM이 아니다. 이 코드는 LLM/VLM을 호출하지 않고 관절 측정값과 규칙으로 피드백 문장을 만든다. API 키가 필요 없다.

## 5. 측정 규칙

- 좌표에 영상 가로·세로 크기를 곱해 종횡비를 보정한다.
- 고관절각: 어깨–골반–무릎.
- 무릎각: 골반–무릎–발목.
- 팔 뻗기각: 골반–어깨–손목.
- 카운트: 고관절각 110° 이하 준비 → 130° 이상 뻗기 → 110° 이하 복귀.
- 품질 초기값: 회차 최고 고관절각 150°, 최고 무릎각 150°, 반대 팔 뻗기각 125°.
- 속도 초기값: 관측된 임계값 사이클 1.2초 미만이면 경고.
- 양다리 고관절각이 함께 130° 이상인 상태가 0.25초 이상이면 교대 중복 경고 후보.
- 자세 추적 누락이나 큰 시간 간격이 생기면 진행 중 동작을 중단한다. 미완료 동작을 강제로 1회로 만들지 않는다.

모든 임계값은 **개발용 실험값**이다. 촬영 각도와 가림에 영향을 받는 2D 측정치이며 실제 3D 관절각이나 의료적 정상 기준으로 해석하지 않는다. 허리의 바닥 접촉, 척추 중립, 복압, 호흡은 이 코드로 확인할 수 없다. `lumbar_contact`는 `not_supported`로 반환한다.

왼쪽 1회 + 오른쪽 1회는 총 2회다. '양쪽을 모두 하면 1회'라는 서비스 정의가 필요하면 별도 집계 기준을 정해야 한다.

## 6. Barofit JSON 연결

| 필드 | 의미 |
|---|---|
| exercise | dead_bug |
| items/currentCodes | 현재 관측 항목과 현재 경고 |
| lastRepetition | 최근 완료 회차 평가 |
| metrics.sides | 좌우 고관절·무릎·팔 각도 |
| details.phases | 좌우 동작 상태 |
| details.sideCounts | 좌우 카운트 |
| details.sourceLabel | 원본 영상 속성 |
| measurementBasis.count | one_leg_out_and_back |
| summary.items | repetition/repetitions 기준 회차 집계 |

`evaluated = compliant + warning`이며 분모가 0이면 `compliancePct=null`이다. unknown 및 not_supported를 정상으로 처리하지 않는다. 코드에는 필드·산술·예외 처리 검사가 포함되어 있으나 기존 전체 JSON Schema를 대체하는 공식 검증기는 아니다.

기존 스키마는 pushup/plank/bird_dog만 허용하므로 **dead_bug 확장 합의가 필요**하다. 이번 결과를 기존 스키마에 그대로 통과한다고 표현하면 안 된다.

## 7. 실제 점검 결과의 해석

선정 영상은 다운로드와 관절 추출을 실제로 실행하여 확인했다. 기본 규칙의 초기 출력은 다음과 같다. 이 값은 사람이 센 정답 횟수가 아니라 **자동으로 검출한 완전한 임계값 사이클 수**다.

| 영상 | 자동 카운트 | 주의점 |
|---|---:|---|
| 00002796 | 2 | 기준 협응 후보에도 다른 항목 경고가 존재 |
| 00001432 | 4 | 같은 쪽 협응 오류를 모든 회차에서 잡는 것은 아님 |
| 00005475 | 1 | 원본 범위 부족 라벨과 자동 판정이 완전히 일치하지 않음 |
| 00001604 | 6 | 한쪽 관절의 가림으로 좌우 집계가 불균형 |
| 00003091 | 5 | 원본의 빠른 교대 라벨을 현재 중복 규칙이 모두 검출하지 못함 |

이 다섯 사례는 코드 동작 확인용 후보이며 성능 평가 세트가 아니다. 정상/오류 자동 분류 성능을 확보했다고 주장할 수 없다. 이후 전문가가 검토한 기준 영상, 프레임별 좌우 가시성, 수동 회차 경계와 오류 라벨을 추가해 카운트 오차·오류 탐지 precision/recall을 검증해야 한다.

GIF는 짧은 쪽 영상 길이에 맞춰 재생되며 동작 위상을 강제로 맞추지 않는다. GIF가 반복될 때 카운트 표시가 처음으로 돌아가는 것은 재생 루프다. 전체 최종 카운트는 세트 JSON에서 확인한다.

## 8. 데이터 이용 조건

공식 QEVD 연구용 라이선스는 연구용 이용을 규정하며 원본 데이터의 제3자 재배포를 제한한다. 그래서 이 제공 파일에는 원본 MP4나 원본 영상이 포함된 GIF를 넣지 않았다. 코드가 사용자의 환경에서 공식 서버로부터 필요한 영상을 직접 받는다. 사용 전 공식 조건을 확인한다.

원본 영상·해당 영상이 보이는 GIF를 공개 GitHub에 올리지 않는다. 상업 서비스 적용 권한은 별도로 확인해야 한다.

## 9. 출처 링크

- [QEVD 공식 소개](https://www.qualcomm.com/developer/software/qevd-dataset)
- [QEVD 공식 다운로드](https://www.qualcomm.com/developer/software/qevd-dataset/downloads)
- [QEVD 연구용 라이선스](https://www.qualcomm.com/content/dam/qcomm-martech/dm-assets/documents/Dataset-Research-License-Feb-25-2025.pdf)
- [QEVD-FIT-COACH 라벨 원본 ZIP](https://softwarecenter.qualcomm.com/api/download/software/dataset/AIDataset/Qualcomm_Exercise_Video_Dataset/QEVD-FIT-COACH/QEVD-FIT-COACH.zip)
- [이번 영상이 포함된 Part 1 z01](https://softwarecenter.qualcomm.com/api/download/software/dataset/AIDataset/Qualcomm_Exercise_Video_Dataset/QEVD-FIT-300k-Part-1/QEVD-FIT-300k-Part-1.z01)
- [Part 1 z02](https://softwarecenter.qualcomm.com/api/download/software/dataset/AIDataset/Qualcomm_Exercise_Video_Dataset/QEVD-FIT-300k-Part-1/QEVD-FIT-300k-Part-1.z02)
- [Part 1 zip](https://softwarecenter.qualcomm.com/api/download/software/dataset/AIDataset/Qualcomm_Exercise_Video_Dataset/QEVD-FIT-300k-Part-1/QEVD-FIT-300k-Part-1.zip)
- [MediaPipe Pose Landmarker Python 공식 문서](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/python)
- [REHAB24-6 운동 목록](https://zenodo.org/records/13305826)

분할 파일 링크를 직접 누르면 대용량 파일을 받게 되므로, 이번 작업은 채팅의 부분 다운로드 코드를 사용하는 편이 적합하다.
