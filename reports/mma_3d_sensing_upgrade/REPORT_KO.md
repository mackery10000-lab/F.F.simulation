# MMA 3D·센싱 업그레이드 실행 보고

> **최신 기준 모델:** 원본 4,500프레임 재추론과 실제 API 60회·360프레임 좌표 추론으로 생성한 `video_api_refresh_r2`가 센싱 및 github.f.f에 적용되었습니다. [R2 실행·교체 보고서](../video_api_refresh_r2/REPORT_KO.md)를 참조하세요. 아래 내용은 이전 생성 이력입니다.

> 현재 기본 입력은 원본 영상을 새로 분석한 결과로 교체했습니다. [이번 영상 교체 보고서](../video_3d_replacement/REPORT_KO.md)를 참조하세요. 아래는 이전 LUNA 합성 생성 이력입니다.

작성: 2026-11-17T13:16:48.929991+09:00 (KST)

## 실제 실행 결과

LUNA structured motion generation **7회 성공**, 토큰 7915, 30개 장면 및 23관절·4,500프레임·25FPS canonical 파일을 생성·교체했다. 실소비 loader가 읽은 최종 SHA-256은 `f6959a2f723ae5010051d7bbabf890ca4d85346ddf1113173c0680da3d6ccce1`다. 18초 smoke와 179.96초 전체 센싱을 실행했으며, 전체 수신 184,842개(camera 95,078, IMU 71,268, UWB 7,076, ISAC 11,420), 기존 punch candidate 61개/보류 55개, MMA 상태·이벤트 전환 145개를 기록했다. 센싱 API 호출 0회다. 수치의 의미는 시뮬레이션 내부 동작이며 실경기 정확도 향상이 아니다.

## 탐색·생성 경계

root `C:\AI_bsss\FF_VSCode_Agent_Kit_3.1`, branch main, 변경 전 HEAD 7f3370ff05aeeae9ca1ae96831a126a85547e9a5. 기존 dirty state와 해시를 discovery.json, 원본 입력과 수정 전 파일을 before/에 보존했다. 실제 배포 대상은 사용자가 확인한 기존 `github.f.f`다. 원격은 F.F.git이며 원격 push/commit을 수행하지 않았다.

기존 `scripts/ff_ai_provider.py`의 pleumrouter 연결 `https://apirouter.pleum.ai/v1` / `gpt-6-luna`를 재사용했다. 카탈로그 확인 뒤 첫 1개 장면으로 소규모 probe+본생성을 겸하고 나머지를 5개 이하 배치로 생성했다. 실제 응답·스키마 검증·토큰·요청/응답 해시는 generation_cache/*.json 및 *.receipt.json, generation_manifest.json에 있다. 가격은 확인되지 않아 N/A다. 로컬 수정 중 캐시만 읽었고 추가 inference는 없었다. 외부 영상 업로드는 0회다.

원래 asset `91e20395f56d247c83782d8760f1e77db5cb5cedbb9800804eed242d46c680e9` → 신규 `f6959a2f723ae5010051d7bbabf890ca4d85346ddf1113173c0680da3d6ccce1`. 기존 16관절 좌표 중 변경 값 432,000개이며 메타데이터만 바꾼 파일이 아니다. 전체 180초는 **명시적 합성** 장면 연결이다. 원본 영상이 존재해도 외부 전송 권한 미확인으로 영상기반 재복원은 하지 않았다. source_sha256=null, source_kind=synthetic, metric_valid=false를 유지한다. 새 합성 행동을 실제 두 선수의 관측 행동으로 읽으면 안 된다.

## 3D 산출물·검증

- 실제 canonical: assets/sensing/motion.json.gz 및 manifest.json; 30개 양 선수 연속 장면은 assets/sensing/scenes/.
- LUNA가 정한 high wrist 위치, long reach, step 거리/시간, switch 시간, pivot 각도를 로컬 FK/IK에 사용했다. 양팔 .32+.30m, 양다리 .54+.54m 길이를 고정하고 발 접지 계획과 IK를 적용했다.
- 별도 `assets/sensing/mma_joint_rig.glb`는 Blender 5.2.4 LTS로 실제 export했다. 12.5Hz의 joint translation armature이며 완전한 관절회전/skin mesh 재구성이 아니다. `.cache/mma_joint_rig.blend`는 로컬 임시 파일이며 배포하지 않는다.
- 리그와 숫자 관절 표본 368개 비교의 최대 차이 0.00001940 모델 m. 25FPS JSON이 센싱 입력이며 12.5Hz GLB는 관절 검수용이다. 기존 skinned mesh를 새 숫자 관절로 retarget하는 viewer 경로를 유지한다.
- bone length span 최대 9.71e-16m, 발바닥 최소 높이 0.0m. 접지/속도 **WARN**: 최대 contact slip 0.2765m/s, 평균 0.000479m/s, 최대 관절 프레임 이동 0.3503m. 일부 에피소드 경계 및 빠른 귀환 구간은 시각 검토가 필요하며 물리 품질 완료로 표시하지 않는다.
- 단순 구체 proxy로 자신의 glove/head 관통 0프레임, torso proxy 겹침 2프레임을 기록했다. 최소 own glove/head gap=0.0150m. 전신 triangle/capsule 접촉 해석은 아니며 작은 torso proxy overlap은 WARN으로 남긴다. collision_proxy_qa.json 참조.

## 센싱·MMA 동작

관절 추가 필드가 camera observed_joints, 몸통·발·손 특징, MeasurementTracker까지 전달되는 실제 source/line은 01_CAUSAL_MAPPING.md에 있다. camera에서 actor.stance를 그대로 보내던 경로를 제거했다. 2개 이상 유효 뷰의 noisy landmark에서 high/long/mixed/low/shell/cross/possible-frame/transition/unknown, orthodox/southpaw/square/unknown, switch와 in/out/lateral/pivot/circle 상태를 시간 유지 조건으로 계산한다. 빠른 잽은 long guard로 즉시 승격하지 않고 손별 lead/rear를 별도 보존한다. UI camera/analysis와 export log에 상태·보류 이유를 표시한다.

UWB는 자신의 root 운동/거리, IMU는 같은 손의 급가속 timing, ISAC은 전역 움직임 timing을 보완한다. RF proxy에 팔꿈치/무릎을 추가했으나 action label은 없다. 카메라는 FOV/가림/잡음을 적용한 가상 관절 센서이며 픽셀 추정/삼각측량이 아니다. IMU는 world-frame 차분 근사이며 25Hz 입력으로 실제 100Hz 고주파 관측을 복원하지 않는다. root quaternion은 QA 메타데이터이며 측정 방향은 어깨/코 관절에서 나온다.

센싱 입력은 Measurement뿐이고 scene index/생성 정답/LUNA 응답은 평가 하네스에 격리했다. network/generation import closure 테스트, stance label poisoning 테스트, 시간 인과성/rewind/누락관절/회전 invariance/부정 장면 시험을 실행했다. 출력은 calibrated=false, simulation_flag=true, hit_status=UNKNOWN이다.

## 실행 명령·근거

```powershell
python scripts/mma_motion_upgrade.py --enable-luna-generation
python scripts/mma_motion_upgrade.py --bake-cached
node tools/verify_mma_rig.mjs
python tools/finalize_mma_assets.py
node --experimental-strip-types tools/mma_replay.ts --duration 18 --out reports/mma_3d_sensing_upgrade/smoke.json
node --experimental-strip-types tools/mma_replay.ts
node --experimental-strip-types tools/mma_scene_report.ts
node --experimental-strip-types --test sensing/tests/*.test.ts
# analysis-platform: npm run build; npm test
python tools/sync_mma_sensing.py
# github.f.f: npm run build; npm test; npm run replay
```

main run date=2026-11-17T04:05:31.152Z, seed=42, duration=179.96, processed frames=4500, runtime=25.806s, errors=[]. process RSS snapshot=1,038,536,704bytes (peak 미측정). event evidence=04_EVENTS.json, sample/hash/run=03_SIMULATION_RUN.json. 30개별 scene replay=scene_evaluation.json. sensing tests=pass=61, fail=0; source tests=pass=51, fail=0; mirror tests=pass=12, fail=0.

## 비교·제한

07_BASELINE_VS_FINAL_KO.md는 old/old, old/new, new/old, new/new를 분리한다. 독립 MMA 전문가 라벨, 실제 장치, metric scale 검증, 원본 영상 권리 확인이 없다. precision/recall/F1/PCK/OKS/MPJPE/실장비 검출률은 N/A다. 30개 장면 결과는 생성기 유래 synthetic consistency evaluation이다. SHUFFLE/L_STEP/HOP 독립 검출, 완전 장착좌표 IMU, 접촉/실제 적중, 전자기 ray tracing, 완전 mesh skinning 개선은 구현 완료로 주장하지 않는다. mixed_head_movement는 mixed-guard와 상체/머리 roll을 합성하지만 독립적인 머리 동작 검출기는 검증하지 않았다. camera_cut은 시뮬레이터 품질 메타데이터이며 방송 영상 컷 재추정이 아니다.

초기 로컬 실패는 IK 도달 범위, 전체 측정 배열 단일 JSON 문자열 제한, GLB 1프레임 시간 오프셋이었다. 각각 다리/접지 계획 보정, 행별 SHA-256 누적, Blender frame0 키로 수정 후 실제 재실행했다. 민감정보나 sensor feedback을 생성 API에 보내지 않았다.

## 배포 상태

06_FF_GITHUB_SYNC.md / sync_manifest.json은 원본→github.f.f 상대경로와 SHA-256, 신규/변경, 제외 이유를 기록한다. 기존 package 의존성과 호스팅 설정을 보존하며 로컬 배포본만 갱신했다. 독립 빌드/시험/replay의 최종 판정은 verification.json 및 mirror 로그에 기록한다. 외부 GitHub 업로드/push는 하지 않았다. 전체 P0 중 실제 API 생성·실물 파일 교체·센서 재생·로컬 배포 동기화는 실행했으며 **동작 물리 품질 경고와 독립 실측 평가 미완료**를 남긴다.

전체 git diff --check는 기존 사용자 수정 파일 analysis-platform/src/domain/04_3d_mma_definitions.ts:826의 trailing whitespace 때문에 실패한다. 이 파일은 이번 작업에서 수정하지 않았다. 이번 작업 범위의 tracked diff 검사는 통과했으며 원래 dirty state/HEAD를 보존했다. 키/영상/weights/대용량 파일 점검 및 원본·배포본 해시 검사는 verification.json을 참조한다. 원본 저장소 밖 별도 패키지에서 offline npm ci, build, 테스트 12개, 최종 자산 18초 replay도 통과했다.

배포 빌드의 npm start/Vite preview도 포트 5200에서 실제 실행하고 Edge로 신규 자산 해시·혼합 가드·숫자 관절/표시 리그 일치·외부 요청 0회를 확인했다. production-browser.json 및 production 캡처 참조. 기존 호스팅 start 포트 3000 설정은 유지했으며 README/Windows 실행 안내의 주소를 이에 맞췄다.
