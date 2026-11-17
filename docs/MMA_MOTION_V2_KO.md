# motion-v2 생성·센싱·배포 재현

실제 경로는 `assets/sensing/motion.json.gz` → `readSensingInput` → `/api/sensing-motion` → `useLiveSensing` → `live-worker.ts` → `videoMotionSource` → `MeasurementSampler` → `LiveSensingSession`/`MovementTracker`다. `videoMotionSource`는 호환성을 위한 기존 함수명이며, v2의 source_kind가 synthetic이면 출력도 synthetic이다.

현재 기본 입력은 LUNA 제약을 로컬 FK/2-bone IK로 bake한 **합성** 180초 시나리오 모음이다. 원본 영상에서 복원한 새로운 경기 분석이 아니다. 기존 영상 기반 입력은 `reports/mma_3d_sensing_upgrade/before/assets/sensing/`에 보존했다. reconstruction 레지스트리와 원본 영상은 변경하지 않는다. A/B는 원래 배우 슬롯을 유지하지만 합성 장면은 해당 선수들의 실제 행동이라는 의미가 아니다.

v2는 기존 `frames[frame][actor][joint*3]` 배열을 유지하며 16개 관절에 heel/toe/nose/ears 7개를 추가한다. root_rotations는 xyzw 단위 quaternion, 좌표는 오른손 Z-up, 시간 초, 길이 모델 m이다. metric_valid=false다. joint_quality는 합성 provenance를 명시하며 observed로 표시하지 않는다. root_rotations는 구조 검증/자산 메타데이터이고, 분류의 방향 근거는 관측 어깨·코다. 숫자 관절과 visual mesh는 목적이 다르다. 기존 skinned GLB는 새 관절 좌표로 retarget하며, 별도 `mma_joint_rig.glb`는 동일 입력의 12.5Hz joint translation rig다. 완전한 피부/관절 회전 복원으로 해석하지 않는다.

```powershell
# 실제 외부 생성은 이 명령에만 허용. 캐시가 있으면 재호출하지 않음.
python -m pip install -r requirements-mma-generation.txt
python scripts/mma_motion_upgrade.py --enable-luna-generation
# 저장된 실응답으로 로컬 bake만 다시 실행 (API 0회)
python scripts/mma_motion_upgrade.py --bake-cached
# 로컬 Blender 설치 경로를 지정해 선택적 joint rig export
blender --background --python scripts/export_mma_rig_blender.py
node tools/verify_mma_rig.mjs
# 자산/코드의 해시 갱신 후 로더 검증
python tools/finalize_mma_assets.py
node --experimental-strip-types tools/mma_replay.ts --duration 18 --out reports/mma_3d_sensing_upgrade/smoke.json
node --experimental-strip-types tools/mma_replay.ts
node --experimental-strip-types tools/mma_scene_report.ts
node --experimental-strip-types --test sensing/tests/*.test.ts
cd analysis-platform
npm run build
npm run dev
```

API는 기존 `scripts/ff_ai_provider.py`의 PleumTransport를 그대로 사용한다. 설정의 OPENAI_BASE_URL/OPENAI_MODEL/OPENAI_REASONING_EFFORT와 OPENAI_API_KEY를 읽지만 키는 저장/출력하지 않는다. 제공자의 `/models` 카탈로그로 chat.generate와 structured output 지원을 확인하고 `/chat/completions`를 사용한다. 직접 3D 파일 출력/영상 업로드 기능은 확인되지 않아 사용하지 않았다. 1개 장면 요청이 소규모 기능 확인과 본생성을 겸한다. 429만 제한 재시도하며 불확실한 POST timeout을 재전송하지 않는다. 요청·모델·스키마 해시 캐시로 중복 비용을 막는다. 응답 receipt의 토큰 수를 기록하고 확인되지 않은 가격은 추정하지 않는다.

`tools/sync_mma_sensing.py`는 실제 배포 폴더 `github.f.f`의 기존 호스팅 설정을 보존하면서 필요한 코드·모션·config·문서·시험·생성 도구와 비민감 응답 캐시를 동기화한다. `.env`, 영상, 모델 weights, node_modules, .blend 캐시는 복사하지 않는다. 외부 push는 수행하지 않는다. 배포 폴더는 루트와 별개로 빌드/재생할 수 있으며 Python/키는 합성 시뮬레이션 실행에 필요하지 않다.
