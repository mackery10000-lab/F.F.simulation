# 현행 탐색 사실

- root: `C:\AI_bsss\FF_VSCode_Agent_Kit_3.1` / branch `main` / HEAD `7f3370ff05aeeae9ca1ae96831a126a85547e9a5`.
- 기존 dirty state와 파일별 변경 전 해시: discovery.json. 기존 사용자 변경을 reset하지 않았으며 수정 대상은 before/에 복사했다.
- git remote: origin https://github.com/mackery10000-lab/F.F.git. worktree는 현재 root 1개. `github.f.f`는 기존 배포 directory이며 별도 git worktree/branch가 아니다. 사용자가 명칭을 확인했다. `F.F.github`는 미발견이며 생성하지 않았다.
- 설계서는 `(1)` 접미사 없이 `FIGHT_FREQUENCY_3D_SENSING_ARCHITECTURE_KO.docx`로 존재한다. zip XML로 읽어 비교했다. docs/PROPOSAL.md 및 sensing/README_KO.md/contracts.ts/sensors.ts/fusion.ts/live.ts와 reports/final_integration/REPORT_KO.md 모두 존재한다.
- 실소비 경로: analysis-platform/src/server.ts의 `/api/sensing-motion` → src/sensing-input.ts readSensingInput → assets/sensing/manifest.json 및 motion.json.gz → useLiveSensing → live-worker.ts → adapters.ts videoMotionSource → motion/sampling.ts → sensors.ts MeasurementSampler → live.ts/fusion.ts/movement.ts.
- 기존 입력은 25 FPS, 4,500프레임, 16관절, 0~179.96초, A=Pereira/B=Strickland, Z-up, metric_valid=false였다. 기존 해시 `91e20395f56d247c83782d8760f1e77db5cb5cedbb9800804eed242d46c680e9`.
- 카메라 8개 꼭짓점+천장1, 손목 IMU4, UWB앵커4/태그2, ISAC 5.8GHz/16 subcarriers/4 MIMO links, camera30/IMU100/UWB20/ISAC64Hz 설정을 코드에서 확인했다. 장치 위치/모든 noise·latency·dropout 값은 assets/sensing/sensor_config.json에 실제 함수 출력으로 저장했다. 옥타곤 치수는 합성 모델 가정이며 독립 검증값이 아니다.
- API adapter: scripts/ff_ai_provider.py PleumTransport. OPENAI_API_KEY 존재 여부만 확인했고 키는 출력하지 않았다. provider `pleumrouter`, 설정 endpoint `https://apirouter.pleum.ai/v1`, model `gpt-6-luna`. /models 카탈로그의 chat.generate/지원 파라미터를 확인해 기존 /chat/completions structured JSON 경로를 사용했다. 직접 mesh/rig 파일 생성, video upload 지원은 확인하지 않았다. timeout120s, retry1(429 등 기존 정책 한정), 응답 2MB 상한, 모델/finish_reason 확인 및 JSON Schema 검증을 재사용했다.
- 원본 input/reference_fight.mp4는 존재하지만 외부 업로드 권한/라이선스가 확인되지 않았다. 영상/개인 생체정보를 전송하지 않고 비식별 합성 시나리오 파라미터만 요청했다. 영상 기반 새 복원 작업은 수행하지 않았다.
- 버전: Node v24.21.0, Python 3.14.6 | packaged by Anaconda, Inc. | (main, Jul  9 2026, 14:29:05) [MSC v.1942 64 bit (AMD64)], Blender는 tools/blender의 5.2.4 LTS 실행파일을 실제 사용했다. 환경변수 이름만 discovery.json에 보관한다.
