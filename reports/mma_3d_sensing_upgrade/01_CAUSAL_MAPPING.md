# 3D → sampler → Measurement → classifier 연결

| 변수 | source adapter | sampler | downstream |
|---|---|---|---|
| heel/toe | sensing/adapters.ts:26 | sensing/sensors.ts:47 | sensing/movement.ts:72, 85 |
| torso/head orientation | sensing/adapters.ts:26 | sensing/sensors.ts:48 | sensing/mma-features.ts:6, 15 |
| wrist/elbow/head | sensing/adapters.ts:29 | sensing/sensors.ts:47, 52 | sensing/mma-features.ts:22 |
| root/UWB | sensing/adapters.ts:39 | sensing/sensors.ts:71 | sensing/movement.ts:91 |
| wrist accel/gyro | sensing/adapters.ts:27 | sensing/sensors.ts:60 | sensing/fusion.ts:25 |
| moving RF proxies | sensing/adapters.ts:27 | sensing/sensors.ts:83, 91 | sensing/fusion.ts:27 |

누락 foot/nose는 null/UNKNOWN. measurement_id·asset hash·seed·coordinate frame·단위·품질·arrival timestamp를 전달한다. joint_quality/root_rotations/generation plan/scene label은 분석기에 전달하지 않는다. root quaternion은 검증/자산 메타데이터이며 분류가 직접 소비한다고 주장하지 않는다.

입력은 읽은 gzip 바이트의 SHA-256을 서버에서 계산한다. no-store HTTP, 새 worker 세대, source hash 기반 분석 cache로 구 자산 재사용을 방지한다. 샘플러는 truth를 사용할 수 있으나 classifier는 Measurement만 받는다. 16→v2 adapter는 누락된 발/얼굴 관절을 관측으로 생성하지 않는다.
