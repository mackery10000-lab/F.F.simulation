# 영상 API 검토·센싱 신뢰성 자율 개발 결과

2026-11-17 (Asia/Seoul). **코드·실제 외부 영상 추론·자산 교체·전체 센싱 실행은 수행했다. 요구된 고정밀 3D 복원과 실경기 분류 정확도 개선은 완료되지 않았다.** 검증 통과와 성능 개선을 구분한다.

## 1. 완료 사항과 실제 수정 파일

원본 `input/reference_fight.mp4` SHA-256 `71e169c159bcac11267815c135d4dceafe58ef5c2fbbf7030399acff06f20e86`의 180초 시간축에서 1 Hz·180 JPEG 프레임을 PleumRouter `gpt-6-luna`에 실제 입력했다. 30회 요청/30회 검증, 요청 ID·응답 해시·시간·토큰은 `api_refinement/batch-*.json`, 원응답은 `response-*.json`이다. 입력 JPEG 자체와 키는 배포하지 않았다. 사용량 188,762토큰, 카탈로그 단가 계산 USD 0.061085; 확정 청구액은 아니다. 기존 크레딧만 사용했고 추가 결제/자동 충전은 하지 않았다. 로컬 MediaPipe의 25 FPS·4,500프레임 추론과 API 1 Hz 표본을 혼동하지 않는다.

API 제안과 독립 로컬 관측을 사용한 제약 최적화로 8개 관절 보정/56프레임이 바뀌었다. 좌표만 바꾸고 기존 관측 신뢰도, 누락 관절 비율, 시간축, 단안 깊이/스케일의 미검증 상태를 유지했다. 새 기본 모션 SHA-256 `821cb126ced624d3bbc6d2d50226031bff1657246689ead58ae27a985d4c27dc`. 같은 모션으로 180초 MP4와 관절 GLB를 생성하고 `assets/sensing/` 및 `github.f.f/assets/sensing/`에 설치했다. `output/runs/latest/3d_capture.mp4`도 갱신하고 이전 파일을 `.cache/autonomous_before/`에 보존했다.

수정 소스/산출물 전체 목록과 해시는 [changed-files.json](changed-files.json), 배포 경로별 파일/해시는 `github.f.f/PACKAGE_MANIFEST.json`에 있다. 주요 소스: `sensing/{adapters,contracts,sensors,fusion,tag-tracking,movement}.ts`, `sensing/tests/reliability.test.ts`, `analysis-platform/src/sensing/SensingLab.tsx`, 입력 로더·영상 후보 API, 3개 `scripts/*video_api*`/publish 스크립트, Blender/렌더링/동기화/검증 도구. 다른 기존 사용자 변경을 reset/clean하지 않았다.

## 2. 핵심 오류와 해결

- 근접만으로 ID 신뢰도를 낮추던 adapter 로직 및 ID→UWB NLOS 결합을 제거했다. RF는 상대 몸통 capsule/명시적 장애물, 카메라는 FOV/가림, 신원 판정은 별도 근거를 사용한다. 이는 간소한 기하 proxy이며 전자기 해석이 아니다.
- 태그별 인과적 Kalman 필터·이상치 제외·짧은 누락 예측·시간/불확실도/속도 제한에 따른 만료를 구현했다. 좋은 최신 fix는 필터 지연을 피하도록 보존한다. 거리 그래프·태그 카드·지도는 공통 위치/상태/불확실도를 사용한다. 카메라 불일치로 RF 좌표를 강제 평균하지 않는다.
- 펀치의 신체 크기 정규화, 여러 뷰의 시간 구간별 중앙값, 시간 궤적 변화 조건, 팔꿈치 누락 제외, 이전 손목이 미관측인 재검출 구간의 가짜 고속 제외를 적용했다. 융합 확인과 유형 신뢰도를 별도로 기록하고 적중은 UNKNOWN이다.
- 짧은 관측 누락에는 상태를 제한적으로 유지하고 재관측 근거가 없음을 명시한다. 오래된 상태는 UNKNOWN으로 만료한다. 100 Hz IMU/30 Hz 카메라에서도 원본 25 FPS 시간 불확실도를 유지한다.
- 첫 API 배치의 무인 인트로는 정당한 빈 관측으로 오프라인 재검증했다. 유료 재시도는 없었다. 직접 보정이 품질 조건에 실패해 동일 응답의 제약 최적화를 사용했다. SciPy 미설치는 가상환경 설치로 해결했다. 초기 필터의 지연/과도한 예측을 확인하고 좋은 관측 보존·빠른 누락 구간 보류로 보완했다. 브라우저 시험의 잘못된 화면 selector는 실제 3D 화면으로 전환 후 검수하도록 수정했다.

## 3. 개선 전후 및 한계

같은 원본·시드 42·20초, 이전 입력/이전 엔진과 새 입력/새 엔진 비교. 새 좌표 보정 구간은 20초 이후이므로 이 구간의 차이는 센싱 변경에 따른 것이다. `baseline-metrics-20s.json`, `final-metrics-20s.json` 및 이전 모션/새 센싱 분리 실행이 근거다.

| 항목 | 이전 | 최종 |
|---|---:|---:|
| 유효 거리 표본 | 114 | 196 |
| 거리 계산 불가 | 87 | 5 |
| 거리 RMSE (비보정 표시 단위) | 0.08230117747674064 | 0.17309936962243097 |
| NLOS range 관측 | 514 | 350 |
| 전체 이벤트 | 12 | 29 |
| 센서 융합 확인 | 10 | 22 |
| 보류 | 2 | 7 |
| Uncertain 전체 | 6 | 11 |

거리 누락은 줄었지만 추가로 채운 필터·예측 구간까지 포함한 RMSE는 **증가했다**. 서로 유효한 시간 표본 집합도 다르므로 단순 정확도 향상으로 해석할 수 없다. 전체 179.96초에서는 유효 거리 657/1800 → 1630/1800, RMSE 0.180718 → 0.260108; 예측 41개 표본의 RMSE는 0.634401다. 불확실도/신뢰도는 통계적으로 교정되지 않았으며 실제 하드웨어 정확도는 아니다. [전체 결과](final-metrics-full.json).

관측 재투영 RMS 7.410763472695 → 7.410762304012px. 개선은 매우 작으며 고정밀 3D 복원 성공으로 표시하지 않는다. 관절 관측률 0.452280 → 0.452280, 뼈 길이/가속도 비퇴행 조건만 검증했다. 가드/스탠스/풋워크 UNKNOWN 비율은 최종 전체 실행에서 각각 98.53%/99.14%/100.00%다. 미관측 손·발/신원 근거 부족을 임의로 채우지 않았다. 이벤트/분류 수 증가는 실제 precision/recall 향상을 뜻하지 않는다.

## 4. 테스트·빌드·연동·호환성

- Python: {'passed': 365, 'subtests_passed': 43}; `python-regression.log`.
- 센싱: {'passed': 70, 'failed': 0}; 분석 앱: {'passed': 51, 'failed': 0}; 독립 배포: {'passed': 21, 'failed': 0}. 원래 62개 센싱 시험을 보존하고 신뢰성 시험 8개를 추가했다.
- 분석 앱/배포본 `npm run build`: {'platform': True, 'mirror': True}. 분석 앱의 기존 큰 bundle 경고는 남아 있다.
- 전체 재생: 179.96초/4,500프레임, 184,952개 측정, 191개 이벤트(보류 73개). 원본/배포본 measurement digest 일치: **True**, `b4f1589a51a5254524d7dc5b2e4d4280adc0499a03484baa5ed515445e853bd3`. 센싱 API 호출 원본/배포본 합계 0회.
- GLB/수치 관절 368개 비교 PASS, 최대 약 0.00002207 표시 단위 차이. MP4 4,500프레임/25 FPS/180초 생성, 기존 시각 리그와 약 6.3e-16~2e-15 수준 일치. 실제 표면/피부의 해부학적 정확도 검증은 아니다.
- 실제 Edge: 원본 PASS, production 배포 PASS. 새 해시·리그·태그 상태·영상 메타데이터·90초 seek 확인, 외부 요청 0회. `browser-*.json/png`.
- 패키지 무결성/상대 import/원본-배포 모듈 동일성 검사는 `package-check.log`; 키/환경변수/원본 영상/모델 weights 제외. 기존 16관절 호환성, stance/label poisoning, 시간 인과성, 누락 관절, rewind, source generation 독립성 회귀 시험을 유지했다.

## 5. GitHub 상태

root `F.F.git`와 실제 nested 배포 저장소 `F.F.simulation.git`를 구분했다. root의 광범위한 기존 미커밋 변경은 보존했다. 배포 파일의 commit/push 상태: `status=PUSHED; branch=codex/video-sensing-reliability-20261117; implementation_commit=645329d0f19203188fd55ec52ecaa3910c955f17; evidence_commit=2c7e043836fa1d63c382e3c40bb6147ac45f0e23; remote_push=True; remote_commit_matches=True; remote_evidence_commit_matches=True; pull_request_url=https://github.com/mackery10000-lab/F.F.simulation/pull/1; hosting_deployment=NOT_EXECUTED`. 원격 branch 업로드와 호스팅 재배포는 별개이며 외부 배포 성공은 주장하지 않는다. 상세 Git 증거는 [git-publication.json](git-publication.json)이다. 전체 staged diff 검사는 과거 보존 로그 3곳의 공백으로 exit 2였고, 이번 코드의 별도 diff 검사는 통과했다. 원문 로그를 임의로 수정하지 않았다.

## 6. 미완료 사유와 후속 작업

실측 또는 독립 정답이 없어 전체 3D 정확도, 선수 ID 일관성, 실제 펀치·풋워크 정확도를 확정할 수 없다. 외부 일반 시각 모델의 대다수 관절 제안은 독립 관측/정합 조건을 통과하지 못했다. 56프레임의 작은 보정이 미관측 관절 문제를 해결하지는 못했다. 가려진 손/발 복원에는 이 영상에 적합한 전문 pose/temporal lifting 모델과 검수 라벨이 필요하다. 현 센서 시뮬레이션의 예측 거리 오차와 불확실도 교정, 과도한 Hook 분류 가능성, UNKNOWN이 많은 동작 분석은 추가 연구/정답 평가 대상이다.

다음 우선순위는 신원·동작 검수 라벨 작성, 어려운 근접/가림 구간의 전문 모델 평가, 추적 단절과 예측 오차를 함께 줄이는 필터 교정, 실제 장치 데이터 검증이다. 기존 미검증 metric_valid를 true로 바꾸거나 센싱 결과를 생성 입력으로 되돌리는 순환은 만들지 않았다.

실제 명령·실패·복구의 누적 기록: [autonomous_execution_log.md](../autonomous_execution_log.md). 전체 검증 요약: [verification.json](verification.json).
