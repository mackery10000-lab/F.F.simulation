# 원본 영상→3D 실제 재실행 및 센싱 기준 모델 교체

2026-11-17 (Asia/Seoul). 현재 기준 입력을 `video_api_refresh_r2`로 교체했다. 기존 생성 결과를 검토만 한 실행이 아니라 원본 영상의 전체 native 관절 추론, 외부 API 이미지 추론, 수치 모션 생성, 영상·리그 생성, 활성 입력 교체와 독립 배포본 실행을 수행했다.

## 실제 생성 실행

원본 `input/reference_fight.mp4`, SHA-256 `71e169c159bcac11267815c135d4dceafe58ef5c2fbbf7030399acff06f20e86`. MediaPipe Heavy로 180초·25 FPS·4,500프레임을 캐시 없이 다시 추론했다. 새 원시 결과는 `output/unified/video_api_refresh_r2/data/`에 있다. `native-reconstruction.json`, `pipeline_stages.json`에 fresh native 입력과 실제 실행 단계가 기록된다.

설정된 PleumRouter `gpt-6-luna` 키를 실제 사용해 원본 JPEG 360개를 2.0 Hz로 처리했다. 실제 새 추론 호출 60회, 전체 성공 60회, 캐시 사용 0회. 토큰 376,872, 카탈로그 단가 기준 계산 USD 0.121844. 확정 청구액과 구분하며 기존 크레딧만 사용했다. 키와 원본 영상 픽셀은 Git에 포함하지 않는다. 요청 ID·응답·사용량·해시는 `api_refinement/batch-*.json`, `response-*.json`에 있다.

API 좌표와 새 로컬 관측을 결합해 제약 최적화한 보정은 12개다. 이전 활성 모션과 비교한 실제 좌표 변경은 84프레임/336개 좌표 값이며 최대 변화는 0.001904186 표시 단위다. 메타데이터만 바꾼 파일이 아니다. 관측되지 않은 관절의 신뢰도를 올리지 않았고, 좌표계 Z-up·25 FPS·23관절·A/B·0~179.96초를 유지했다.

## 실제 교체 파일

| 경로 | 역할/최종 해시 |
|---|---|
| `assets/sensing/motion.json.gz` | 센싱·시각화 공통 관절 입력 `0bd33fdb572a45edbb59895dd65ece351bbe5fccb8f6078945a691ebb9dfb779` |
| `assets/sensing/3d_capture.mp4` | 같은 좌표로 새로 렌더링한 4,500프레임·180초 MP4 `9463b9bd2c59cb0d4994186b282f2768213f85bad56c7e85f734496a104ca6b3` |
| `assets/sensing/mma_joint_rig.glb` | 같은 관절 위치의 12.5 Hz 검수 리그 |
| `assets/sensing/manifest.json`, `reference_video.json`, `motion_v2_contract.json` | 활성 run·좌표·MP4·GLB의 해시 연결 |
| `output/runs/latest/3d_capture.mp4` | 기존 최신 렌더링 파일 교체 |
| `github.f.f/assets/sensing/` | 원본과 바이트가 같은 독립 배포용 기준 자산 |

이전 활성 자산은 `.cache/video_api_refresh_r2_before/`, 이전 수치 기준은 이 보고서의 `before/`에 보존했다. 사람 외형 메시 템플릿을 새로 스캔한 것은 아니며, 센싱에 실제 입력되는 관절 모션과 이를 구동하는 리그/영상을 바꿨다. MP4는 시각화 자산이고 센싱은 숫자 모션을 읽는다.

## 실제 센싱 실행·빌드·호환성

source/mirror 모두 179.96초·4,500프레임을 실행했다. 수신 184,952개, 이벤트 191개/보류 73개. 두 실행의 측정 digest `1ad8ff60cc03d6044742627c64e711d228a72c020ccba6104b2f22c87b74cb1f` 일치. 센싱 중 외부 API 호출은 합계 0회다. 기존 기준 실행의 입력은 `821cb126ced624d3bbc6d2d50226031bff1657246689ead58ae27a985d4c27dc`, 새 입력은 `0bd33fdb572a45edbb59895dd65ece351bbe5fccb8f6078945a691ebb9dfb779`로 실제 다르다.

센싱 시험: 70 pass / 0 fail. 분석 앱: 53 pass / 0 fail. 독립 배포: 21 pass / 0 fail. source/mirror 빌드 및 패키지 검사, GLB 관절 정합, 실제 Edge의 새 입력 해시·태그 상태·180초 영상·90초 seek를 확인했다. 실행별 명령/종료 코드는 `finish_stages.json`, 세부 결과는 각 `.log`와 `browser-*.json`에 있다. Python 회귀 시험은 `python-tests.log`에 별도 기록한다.

첫 독립 배포 시험은 이전 run ID를 고정한 조건 때문에 20 pass/1 fail이었다. 이를 현재 매니페스트·모션 asset ID·native provenance ID의 일치 검증으로 교체하고 시험·빌드·패키지·브라우저를 재실행해 통과했다. 이전 실패 로그 `mirror-tests.initial.log`와 실패/복구 단계는 보존했다. 실행 결과를 숨기거나 숫자 데이터 검증을 삭제하지 않았다. 별도 `artifact-audit.json`에서는 MP4 4,500프레임을 실제 디코딩하고, 60개 실제 API 응답의 해시·요청 ID·원본 출처, 실제 좌표 변화, 원본/배포본 자산 바이트 일치를 재검증했다.

## GitHub 반영

실제 배포 checkout은 `github.f.f`, 원격은 `mackery10000-lab/F.F.simulation.git`이다. 원본 workspace의 기존 미커밋 변경은 보존한다. 새 자산·연동 파일·매니페스트·실행 증거를 기존 PR #1 브랜치에 반영했다. 최종 원격 상태: `{"status": "PUSHED", "branch": "codex/video-sensing-reliability-20261117", "implementation_commit": "f460861925c6e44ed935c5413371e881423909b8", "remote_push": true, "remote_commit_matches": true, "pull_request_url": "https://github.com/mackery10000-lab/F.F.simulation/pull/1", "hosting_deployment": "NOT_EXECUTED"}`. 상세 원격 확인은 `git-publication.json`을 참조한다. main 병합과 운영 호스팅 배포는 수행하지 않는다.

## 정확도에 대한 범위

이번 요청의 기준 모델 교체와 실행 검증은 수행했다. 다만 단안 깊이·실측 공간 스케일·선수 ID·미관측 관절의 정확도를 독립 입증한 것은 아니다. `metric_valid=false`를 유지한다. 제한적 보정 전후 관측 재투영 RMS는 7.410763472695→7.410761454338px이며, 이를 전체 고정밀 복원 성공으로 해석하지 않는다. 새 모델로 판정 수가 달라져도 실제 정답 라벨 없는 정확도 향상을 주장하지 않는다.

## 재현

처음 실행할 때 새 run 이름으로 다음 명령을 사용한다. 기존 native run은 덮어쓰지 않으며, 활성화 전에 후보 렌더링과 검증을 분리한다.

```powershell
.\.venv\Scripts\python.exe -X utf8 scripts/run_video_sensing_refresh.py --run-id NEW_RUN_ID --execute-api --sample-hz 2 --budget-usd 1
.\.venv\Scripts\python.exe -X utf8 tools/finish_video_sensing_refresh.py --run-id NEW_RUN_ID
```

현재 실행은 별도로 시작한 fresh native 작업을 `--wait-native`로 이어 받았다. 실제 모델 생성 입력에 센싱 결과를 되돌리는 순환은 없다.
