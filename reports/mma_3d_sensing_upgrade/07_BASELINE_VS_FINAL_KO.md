# Baseline / final (동일 seed=42, rates/noise 기본 설정)

원본 motion과 새 합성 scenario는 내용이 다르므로 이벤트 개수 차이는 정확도 개선 수치가 아니다. old+old와 old+new는 알고리즘 ablation이며, new 조합은 합성 기능 동작 평가다. 실측/전문가 정답이 없으므로 precision/recall/F1/MPJPE는 N/A다.

| 조합 | input hash | mode | seconds | samples | punch events / withheld | MMA transitions |
|---|---|---|---|---|---|---|
| baseline.json | 91e20395f56d247c83782d8760f1e77db5cb5cedbb9800804eed242d46c680e9 | video_derived | 179.96 | 185019 | 489 / 339 | 0 |
| ablation_old_motion_new_sensing.json | 91e20395f56d247c83782d8760f1e77db5cb5cedbb9800804eed242d46c680e9 | video_derived | 179.96 | 184915 | 31 / 31 | 0 |
| ablation_new_motion_old_sensing.json | f6959a2f723ae5010051d7bbabf890ca4d85346ddf1113173c0680da3d6ccce1 | video_derived | 179.96 | 185042 | 73 / 55 | 0 |
| 03_SIMULATION_RUN.json | f6959a2f723ae5010051d7bbabf890ca4d85346ddf1113173c0680da3d6ccce1 | synthetic | 179.96 | 184842 | 61 / 55 | 145 |

구 sensing은 v2 source_kind를 인식하지 않아 new+old 출력 mode가 video_derived로 남는다. 이는 레거시 경로의 메타데이터 한계이고 새로운 합성 입력을 실제 관측으로 인정하는 근거가 아니다.

구조 QA: minimum foot penetration=0.0m, maximum chain-length span=9.71e-16m. contact slip max=0.276517m/s, mean=0.000479m/s; contact quality=WARN, motion speed=WARN. 이 경고를 품질 개선 성공으로 치환하지 않는다.

검증 로그: sensing pass=61, fail=0; source tests pass=51, fail=0; mirror tests pass=12, fail=0. source-build.log/mirror-build.log에 실제 빌드 기록. 각 명령의 종료 상태는 verification.json에 기록한다.
