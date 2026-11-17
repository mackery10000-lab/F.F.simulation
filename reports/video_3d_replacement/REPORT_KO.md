# 원본 영상 기반 기준 3D·센싱 입력 교체

완료 기록: 2026-11-17T13:54:20.475744+09:00

원본 `input/reference_fight.mp4`의 180초 전체(25 FPS, 4,500프레임)를 로컬 MediaPipe Heavy · 1280px 폭으로 새로 분석했다. 이전 추론 캐시나 LUNA 합성 장면을 입력으로 재사용하지 않았다. 새 23관절 모션으로 180초 3D MP4와 관절 GLB를 생성하고 기본 센싱 입력 및 `github.f.f` 배포 폴더에 반영했다. 원격 GitHub push는 수행하지 않았다.

## 실제 산출물

| 파일 | 역할 |
|---|---|
| `assets/sensing/motion.json.gz` | 모든 센싱 화면의 기본 25 FPS 수치 모션 |
| `assets/sensing/3d_capture.mp4` | 같은 모션으로 렌더링한 960×540 · 25 FPS · 180초 3D 영상 |
| `assets/sensing/mma_joint_rig.glb` | 같은 모션의 12.5 Hz 관절 위치 검수용 리그 |
| `assets/sensing/reference_video.json` | 원본 영상 → 수치 모션 → MP4의 SHA-256 연결 |
| `output/runs/latest/3d_capture.mp4` | 기존 최신 3D 영상 파일 교체본 |
| `github.f.f/assets/sensing/` | 위 기준 파일들의 바이트 동일 배포본 |

센싱 화면 아래 “영상에서 재구성한 기준 3D 영상 보기”에서 MP4를 재생할 수 있다. 원본 경기 영상 픽셀·AI 가중치·키는 배포하지 않는다. 기존 선수 시각 메시를 새 관절 모션으로 구동하며 새 인체 표면 스캔을 만든 것은 아니다.

`github.f.f`는 내부에 자체 `.git`이 있는 기존 배포 checkout이다. 그 checkout 내부의 소스·자산·문서를 수정하고 production 빌드와 로컬 실행을 검증했다. commit/push 및 원격 호스팅 재배포는 수행하지 않았다.

- 원본 영상 SHA-256: `71e169c159bcac11267815c135d4dceafe58ef5c2fbbf7030399acff06f20e86`
- 새 기본 모션 SHA-256: `aabd5085b7c76ef9fafe36dea0aeea02c661ca294be33d772cfc295d9271ca04`
- 새 MP4 SHA-256: `d670751743917b0899a31a0d21d39500ae661708c5915b65b5111a3926bb2208`
- 새 MP4 크기: 16,952,613 bytes
- 과거 영상 기반 모션과 달라진 프레임: 4,500/4,500

## 연결과 검증

손·발·머리 추가 관절은 이번에 추론한 원본 33관절 관측에서 가져왔다. 단안 깊이는 공통 약한 원근 카메라와 MediaPipe 사전 추정으로 복원했으며 metric_valid=false다. 프레임별 관측 신뢰도를 보존해 미관측 관절이 가드·스탠스 판정의 카메라 근거로 변하지 않게 했다. 기존 리그가 실제 발끝 좌표를 정적 오프셋으로 덮던 문제도 수정했다.

- MP4 전체 디코딩: 4,500/4,500프레임, 25 FPS, 180초 PASS. 수치 좌표는 0~179.96초, 마지막 영상 프레임 표시까지 포함한 인코딩 길이는 180초다.
- 전체 영상 렌더링 중 기존 시각 리그와 수치 좌표 최대 차이: 1.948433501e-15 표시 m.
- GLB 관절 검수: 368개 표본, 최대 차이 2.206834841e-05 표시 m.
- 원본·배포본 전체 센싱 replay: 179.96초, 184,888개 측정, measurement_digest 동일 `ae4e546ae7b406509e2bfde199c49a0ce0aee9d94f87df50bab48aabb9a3ca4e`.
- 센싱 중 외부 API 호출: 원본 0회, 배포본 0회.
- 센싱 회귀 검사, source/mirror 타입 검사·빌드·패키지 검사·Edge 브라우저 검증 결과는 같은 폴더의 로그와 JSON에 기록했다. 브라우저에서 새 입력 해시, 실제 선수 리그, 새 MP4 메타데이터 및 90초 seek를 확인했다.

## 추정 한계와 보존 범위

실측 깊이·크기·선수 식별의 정확도 향상을 독립 검증한 결과는 아니다. 가림 구간은 숫자 자세 가설을 유지하더라도 관측 신뢰도를 0으로 두며 UNKNOWN/보류가 정상이다. 접촉·적중·충격력은 확정하지 않는다. LUNA 합성 장면은 회귀 시험용으로 보존되며 기본 입력의 대체 경로로 사용하지 않는다. 기존 V7/V8/V9와 과거 영상 분석의 해시 연결은 이력 보존을 위해 유지했다. 현재 센싱 입력과 새 MP4는 `saved_video_motion_file`로 별도 명시했다.

기하 품질은 WARN이다. 16관절 재구성 내부 진단의 reprojection RMS는 18.20→3.49px, 시간별 뼈 길이 RMS는 0.077→0.030 표시 m로 감소했지만, 머리 겹침 proxy 표본은 36→69로 증가했다. 관절 속도 p99는 18.31 표시 m/s이며 가림·재검출 전환에 큰 움직임이 남아 있다. observational_projection_pass=false, overall_3d_improvement_proven=false를 그대로 기록한다. 이는 같은 관측에 대한 적합도이며 실제 3D 정확도 또는 접촉 개선의 증명이 아니다.

프레임별 신뢰도 0.6 이상 관측 비율(양 선수 합산):

| 관절 | 비율 |
|---|---|
| pelvis | 58.8% |
| chest | 58.8% |
| neck | 58.8% |
| head | 58.6% |
| left_shoulder | 58.8% |
| left_elbow | 30.5% |
| left_wrist | 27.3% |
| right_shoulder | 58.8% |
| right_elbow | 23.0% |
| right_wrist | 21.9% |
| left_hip | 58.8% |
| left_knee | 35.5% |
| left_ankle | 38.5% |
| right_hip | 58.8% |
| right_knee | 36.5% |
| right_ankle | 38.4% |
| left_heel | 38.1% |
| left_toe | 35.7% |
| right_heel | 34.7% |
| right_toe | 34.0% |
| nose | 58.7% |
| left_ear | 58.7% |
| right_ear | 58.6% |

이전 기본 파일은 `reports/video_3d_replacement/before/`, 이전 최신 MP4는 `.cache/video_3d_replacement_before/`에 로컬 보존했다. 새 원본 추론 결과는 `output/unified/video_refresh_20261117/`에 있다.

## 재현 순서

원본 작업 폴더에서 설치된 Python/Heavy 모델/Blender/Edge/FFmpeg를 사용한다. 원본 영상은 로컬에 있어야 한다.

```powershell
.\.venv\Scripts\python.exe -X utf8 scripts/track_fighters.py --video input/reference_fight.mp4 --seconds 0 --fps 25 --max-width 1280 --model heavy --output-root output/unified/video_refresh_20261117 --no-preview --no-3d-video --skip-legacy-comparison
.\.venv\Scripts\python.exe -X utf8 scripts/build_video_sensing_reference.py
# analysis-platform에서 npm run dev로 출력된 실제 포트 사용
node tools/render_reference_video.mjs http://127.0.0.1:5201 --candidate
.\.venv\Scripts\python.exe -X utf8 scripts/publish_video_sensing_reference.py
# Blender background --python scripts/export_mma_rig_blender.py
.\.venv\Scripts\python.exe -X utf8 tools/finalize_mma_assets.py
.\.venv\Scripts\python.exe -X utf8 tools/sync_mma_sensing.py
node --experimental-strip-types tools/mma_replay.ts --out reports/video_3d_replacement/source-replay.json
npm --prefix github.f.f test
npm --prefix github.f.f run build
```
