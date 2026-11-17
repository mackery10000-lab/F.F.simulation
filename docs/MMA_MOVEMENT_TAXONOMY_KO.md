# MMA 동작·관측 계약 (구현 기준)

가드와 스탠스는 상태이며, 스위치·스텝·펀치는 시간 구간 이벤트다. 서로 다른 축의 상태는 동시에 존재한다. 이 구현은 합성 시뮬레이션이며 적중·충격력·전술적 의도를 판정하지 않는다. 모든 이벤트는 `simulation_flag=true`, `hit_status=UNKNOWN`, `calibrated=false`다.

| 상태 | 구현한 관절 근거 | 시간·보류 조건 |
|---|---|---|
| HIGH_GUARD | 양손의 턱·귀 상대 거리, 팔 길이 정규화 | 손이 머리 가까이에 있고 0.45초 유지 |
| LONG_GUARD | 양손의 몸통 전방 신전/팔 길이 >0.72 | 낮은 손 속도와 0.45초 유지; 짧은 잽 제외 |
| MIXED_GUARD | 한 손 EXTENDED + 반대 손 HEAD_PROTECT | 좌우 손의 역할을 따로 보존 |
| LOW_GUARD | 양손이 턱보다 0.3 모델 m 이상 낮음 | 레벨 변화와 머리 상대 높이 구분 |
| SHELL_GUARD | HEAD_PROTECT + LOW + 양 어깨 높이 차 >0.075 | 추가 어깨 기울기가 없으면 UNKNOWN; 실제 shoulder roll 확정 아님 |
| CROSS_GUARD | 몸통 측면축에서 좌우 손목의 교차 | 단일 프레임 교차는 승격하지 않음 |
| POSSIBLE_FRAME | 팔 신전 + 상대 골반과 근접 | 접촉 근거가 없으므로 FRAME_OR_POST 확정 금지 |
| TRANSITION / UNKNOWN | 빠른 손, 가림, 발/얼굴 방향 누락 | 유효 관측 만료 0.35초 후 UNKNOWN |

`handFeatures`는 좌우 손 각각 HEAD_PROTECT / EXTENDED / LOW / ATTACKING / UNKNOWN, lead_or_rear, 팔꿈치각(rad), 전완 pitch, 턱/귀 정규화 거리, 전방 신전, 속도, 유지시간, 가시성, 미보정 신뢰도를 출력한다. 순간 전방 손의 위치로 리드손을 바꾸지 않는다.

몸통 전방은 좌우 어깨축과 **관측된 코–머리 방향**으로 결정한다. 상대방 방향은 전방축을 대신하지 않는다. 발꿈치–발끝 중점 차를 몸통 전방에 투영해 +0.12 이상 ORTHODOX, −0.12 이하 SOUTHPAW, 작은 값 SQUARE로 분리한다. 발 높이 차가 크거나 코/발 관절이 없으면 UNKNOWN이다. 모든 임계값은 `sensing/mma-features.ts`의 `MMA_THRESHOLDS`에 모여 있으며 미검증 스케일에 대한 초기 휴리스틱이다.

스탠스는 0.45초 유지 뒤 확정한다. 반대 안정 스탠스로 이어지는 2초 이내 전환을 SWITCH로 기록한다. 전후 리드발/손, 전환 시작·확정 시각과 근거 ID를 보존한다. 장시간 가림 뒤에는 이전 안정 스탠스를 폐기한다. 교차 스텝·상체 회전·잽은 별도 음성 장면으로 검증한다. HOP_SWITCH와 STEP_SWITCH의 메커니즘 구분은 가용 접지 근거에 제한되며 정밀 검증되지 않았다.

풋워크는 **선수 자신의** 관측 골반 속도, 상대 방위, 발꿈치/발끝 높이·속도, 지지발, 몸통 yaw rate를 결합한다. UWB 자신의 속도와 카메라 자신의 속도가 크게 다르면 UNKNOWN이다. 두 선수의 거리 감소만으로 STEP_IN을 만들지 않는다. 구현된 출력은 STEP_IN/OUT/LEFT/RIGHT, PIVOT_LEFT/RIGHT, CIRCLE_LEFT/RIGHT, STATIONARY/UNKNOWN이다. SHUFFLE, L_STEP, HOP의 독립 확정 검출기는 아직 없으며 씬 이름을 검출 라벨로 복사하지 않는다. 발이 뜬 킥/체크는 스텝 근거가 되지 않는다.

카메라는 3D 관절의 FOV·선수 간 가림·잡음에 기반한 **가상 포즈 센서**다. 픽셀 인식이나 멀티뷰 삼각측량이 아니다. 2개 이상 유효 뷰의 관절 중앙값을 사용하며, 누락 관절은 null이다. 16관절 레거시에 코/발끝/발꿈치를 가짜 관측으로 추가하지 않으므로 해당 세부 분류는 UNKNOWN일 수 있다.

UWB는 4개 앵커/허리 태그의 범위로 고정 높이 2D 측위를 수행하고 NLOS·잔차·기하 불확실도를 유지한다. IMU는 저장 모션의 후방 차분으로 만든 세계좌표 선형 가속도·전완축 회전 근사이며 완전한 장착 좌표계 specific force 모델이 아니다. ISAC은 5.8GHz, 16 부반송파, 4 링크의 경로 위상 합성으로 전역 움직임을 보완한다. 어느 것도 단독으로 적중·가드·리드손을 확정하지 않는다.

센서 분류기는 `MovementTracker.ingest(Measurement[], now)`만 받는다. 원본 asset, generation response, scene schedule, 평가 정답은 입력할 수 없다. 장면 인덱스와 LUNA 계획은 생성/평가 도구에만 존재한다. 센싱 import closure에 네트워크·생성 모듈이 없는지 회귀 테스트한다.

검증: `node --experimental-strip-types --test sensing/tests/*.test.ts`. 합성 장면: `assets/sensing/scenes/index.json`. 잔여 접지 미끄러짐·급격한 귀환 동작은 `reports/mma_3d_sensing_upgrade/motion_quality.json`의 WARN으로 공개하며 물리적으로 해결되었다고 주장하지 않는다.
