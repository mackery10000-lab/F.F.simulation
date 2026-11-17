/** Sensor-only contracts. Ground truth deliberately has no place in this API. */
export type Fighter = 'A' | 'B';
export type Hand = 'L' | 'R';
export type SensorType = 'camera' | 'isac' | 'uwb' | 'imu';
export type Vec3 = [number, number, number];
export type Punch = 'Jab' | 'Cross' | 'Hook' | 'Uppercut' | 'Uncertain';
export const SENSOR_TYPES: SensorType[] = ['camera', 'isac', 'uwb', 'imu'];
export const JOINTS = ['pelvis','chest','head','left_shoulder','left_elbow','left_wrist','right_shoulder','right_elbow','right_wrist','left_ankle','right_ankle'] as const;
export const EXTRA_JOINTS=['neck','nose','left_ear','right_ear','left_hip','right_hip','left_knee','right_knee','left_heel','left_toe','right_heel','right_toe'] as const;
export type Pose = Record<typeof JOINTS[number], Vec3>&Partial<Record<typeof EXTRA_JOINTS[number],Vec3>>;
export interface ActorState { id:Fighter; pose:Pose; velocity:Vec3; stance:'ORTHODOX'|'SOUTHPAW'; identity:number; joint_confidence?:Record<string,number>; motion_provenance?:{kind:string;source_frames:number[];source_fps:number;interpolation:string;metric_valid:boolean;observed_new_frames:number;root_interpolation:string;inferred_joint_count:number}; }
export interface WorldState { time:number; actors:[ActorState,ActorState]; }
export interface MotionSource { duration:number; mode:'synthetic'|'video_derived'; description:string; asset_sha256?:string; metric_valid?:boolean; at:(time:number)=>WorldState; qualityAt?:(time:number)=>{occluded?:boolean;camera_segment_id?:number}; }
export interface Arena { vertices:ReadonlyArray<ReadonlyArray<number>>; canvasZ:number; fenceHeight:number; }
export interface Device { id:string; type:SensorType; position:Vec3; target:Vec3; role:string; fighter?:Fighter; hand?:Hand; fov?:number; }
export interface SensorSettings {
  enabled:boolean; hz:number; latency_ms:number; jitter_ms:number; clock_offset_ms:number;
  clock_correction_ms:number; dropout:number; noise:number;
}
export interface SimulationConfig {
  seed:number; duration:number; scenario:string; sensors:Record<SensorType,SensorSettings>;
  disabledDevices:string[]; fusionWindow:number; combinationWindow:number; minPatternSamples:number;
}
export interface WristFeature { hand:Hand; extension:number; lateral:number; vertical:number; speed:number; arm_length?:number; elbow_angle?:number; body_scale?:number; }
export interface CameraValue {
  position:Vec3; joints:Pose; screen_position:[number,number]; wrists:WristFeature[];
  projected_joints?:Record<string,[number,number]>;
  stance:'ORTHODOX'|'SOUTHPAW'|'UNKNOWN'; guard:string; occluded:boolean; identity_confidence:number; fov_visible:boolean;
  observed_joints?:Record<string,Vec3|null>; observation_flags?:string[];
}
export interface ImuValue { hand:Hand; acceleration:Vec3; angular_velocity:Vec3; peak_acceleration:number; angular_speed:number; jerk:number; impact_signature:number; relative_impact_score:number; }
export interface RangeValue { anchor_id:string; range_m:number; tof_ns:number; nlos:boolean; nlos_reason?:'OPPONENT_TORSO_PROXY'|'SCENARIO_OBSTACLE'|null; }
export interface UwbValue { position:Vec3|null; ranges:RangeValue[]; residual_m:number; error_radius_m:number; method:'DS-TWR'; }
export interface IsacValue { csi_real:number[]; csi_imag:number[]; csi_links:{real:number[];imag:number[]}[]; amplitude:number; phase:number; doppler_hz:number; motion_energy:number; snr_db:number; subcarriers:number; mimo_links:number; }
export interface Values { camera:CameraValue; imu:ImuValue; uwb:UwbValue; isac:IsacValue; }
export interface Measurement<T extends SensorType=SensorType> {
  timestamp:number; sensor_timestamp:number; arrival_timestamp:number; timestamp_uncertainty:number;
  sensor_type:T; sensor_id:string; fighter_id:Fighter|null; measurement_type:string;
  measurement_value:Values[T]; measurement_unit:string; confidence:number; data_quality:number;
  source_type:'simulated_sensor'; simulation_flag:true; input_mode:MotionSource['mode'];
  measurement_id?:string; input_asset_sha256?:string; seed?:number; metric_valid?:boolean;
  coordinate_frame?:'world_Z_up'; provenance?:string; validity?:'VALID'|'DEGRADED';
}
export interface MatchEvent {
  event_id:string; event_start:number; event_end:number; available_at:number; fighter_id:Fighter; hand:Hand;
  detected_action:Punch; contributing_sensors:string[]; classification_confidence:number;
  verification_status:'SIMULATED_FUSED'|'WITHHELD'; reason:string; evidence_type:'sensor_fusion';
  hit_status:'UNKNOWN'; relative_impact_score:number|null; peak_acceleration:number|null;
  type_confidence?:number; classification_reason?:string;
}
export type TagStatus='OBSERVED'|'FILTERED'|'PREDICTED'|'EXPIRED'|'UNAVAILABLE';
export interface TagEstimate {status:TagStatus;position:Vec3|null;confidence:number;uncertainty:number|null;age_s:number|null;measurement_id:string|null;}
export interface DistancePoint { time:number; distance:number|null; change:number|null; speed:number|null; trend:'approach'|'retreat'|'steady'|'unknown'; mean:number|null; positions:Partial<Record<Fighter,Vec3>>; confidence:number; uncertainty:number|null; conflict:boolean; tags?:Record<Fighter,TagEstimate>; method?:'OBSERVED'|'FILTERED'|'PREDICTED'|'UNAVAILABLE'; }
export interface PatternEvidence { event_ids:string[]; time:number; intervals:number[]; distance_change:number|null; }
export interface TacticalPattern { id:string; fighter:Fighter; sequence:string; count:number; denominator:number; confidence:number; evidence:PatternEvidence[]; interpretation:string; }
export interface FighterHabit { fighter:Fighter; punches:number; jabs:number; jabCross:number; retreat:number; distanceSamples:number; attackDistance:number|null; byRange:Record<string,number>; byZone:Record<string,number>; }
export interface TacticalReport { patterns:TacticalPattern[]; habits:FighterHabit[]; facts:string[]; suggestions:string[]; limitations:string[]; pastComparison:null; }
export type GuardState='HIGH_GUARD'|'LONG_GUARD'|'MIXED_GUARD'|'LOW_GUARD'|'SHELL_GUARD'|'CROSS_GUARD'|'POSSIBLE_FRAME'|'TRANSITION'|'UNKNOWN';
export type StanceState='ORTHODOX'|'SOUTHPAW'|'SQUARE'|'TRANSITION'|'UNKNOWN';
export interface HandGuardEvidence {state:'HEAD_PROTECT'|'EXTENDED'|'LOW'|'ATTACKING'|'UNKNOWN';lead_or_rear:'LEAD'|'REAR'|'UNKNOWN';elbow_flexion_rad:number|null;forearm_pitch:number|null;wrist_to_chin_normalized:number|null;wrist_to_temple_normalized:number|null;forward_reach_normalized:number|null;hand_speed:number|null;duration_s:number;visibility:number;confidence:number;source_provenance:'virtual_pose_sensor';}
export interface MovementEvent {event_id:string;actor_id:Fighter;event_type:'GUARD'|'STANCE'|'SWITCH'|'FOOTWORK';state_before:string;state_after:string;start_s:number;end_s:number;onset_s:number;available_at:number;lead_foot:'L'|'R'|'UNKNOWN';lead_hand:'L'|'R'|'UNKNOWN';confidence:number;calibrated:false;supporting_measurement_ids:string[];contradictions:string[];abstention_reason:string|null;asset_hash:string|null;seed:number;simulation_flag:true;hit_status:'UNKNOWN';hands?:Record<Hand,HandGuardEvidence>;details?:Record<string,unknown>;}
export interface MovementState {actor_id:Fighter;time:number;guard:GuardState;stance:StanceState;footwork:string;hands:Record<Hand,HandGuardEvidence>;confidence:number;abstention_reason:string|null;}
export interface SimulationRun { config:SimulationConfig; source:{mode:MotionSource['mode'];description:string}; devices:Device[]; measurements:Measurement[]; events:MatchEvent[]; distances:DistancePoint[]; movement_events?:MovementEvent[]; movement_states?:MovementState[]; diagnostics:{generated:number;dropped:number;late:number}; }
