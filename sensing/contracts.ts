/** Sensor-only contracts. Ground truth deliberately has no place in this API. */
export type Fighter = 'A' | 'B';
export type Hand = 'L' | 'R';
export type SensorType = 'camera' | 'isac' | 'uwb' | 'imu';
export type Vec3 = [number, number, number];
export type Punch = 'Jab' | 'Cross' | 'Hook' | 'Uppercut' | 'Uncertain';
export const SENSOR_TYPES: SensorType[] = ['camera', 'isac', 'uwb', 'imu'];
export const JOINTS = ['pelvis','chest','head','left_shoulder','left_elbow','left_wrist','right_shoulder','right_elbow','right_wrist','left_ankle','right_ankle'] as const;
export type Pose = Record<typeof JOINTS[number], Vec3>;
export interface ActorState { id:Fighter; pose:Pose; velocity:Vec3; stance:'ORTHODOX'|'SOUTHPAW'; identity:number; motion_provenance?:{kind:string;source_frames:number[];source_fps:number;interpolation:string;metric_valid:boolean;observed_new_frames:number;root_interpolation:string;inferred_joint_count:number}; }
export interface WorldState { time:number; actors:[ActorState,ActorState]; }
export interface MotionSource { duration:number; mode:'synthetic'|'video_derived'; description:string; at:(time:number)=>WorldState; }
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
export interface WristFeature { hand:Hand; extension:number; lateral:number; vertical:number; speed:number; }
export interface CameraValue {
  position:Vec3; joints:Pose; screen_position:[number,number]; wrists:WristFeature[];
  projected_joints?:Record<string,[number,number]>;
  stance:'ORTHODOX'|'SOUTHPAW'|'UNKNOWN'; guard:string; occluded:boolean; identity_confidence:number; fov_visible:boolean;
}
export interface ImuValue { hand:Hand; acceleration:Vec3; angular_velocity:Vec3; peak_acceleration:number; angular_speed:number; jerk:number; impact_signature:number; relative_impact_score:number; }
export interface RangeValue { anchor_id:string; range_m:number; tof_ns:number; nlos:boolean; }
export interface UwbValue { position:Vec3|null; ranges:RangeValue[]; residual_m:number; error_radius_m:number; method:'DS-TWR'; }
export interface IsacValue { csi_real:number[]; csi_imag:number[]; csi_links:{real:number[];imag:number[]}[]; amplitude:number; phase:number; doppler_hz:number; motion_energy:number; snr_db:number; subcarriers:number; mimo_links:number; }
export interface Values { camera:CameraValue; imu:ImuValue; uwb:UwbValue; isac:IsacValue; }
export interface Measurement<T extends SensorType=SensorType> {
  timestamp:number; sensor_timestamp:number; arrival_timestamp:number; timestamp_uncertainty:number;
  sensor_type:T; sensor_id:string; fighter_id:Fighter|null; measurement_type:string;
  measurement_value:Values[T]; measurement_unit:string; confidence:number; data_quality:number;
  source_type:'simulated_sensor'; simulation_flag:true; input_mode:MotionSource['mode'];
}
export interface MatchEvent {
  event_id:string; event_start:number; event_end:number; available_at:number; fighter_id:Fighter; hand:Hand;
  detected_action:Punch; contributing_sensors:string[]; classification_confidence:number;
  verification_status:'SIMULATED_FUSED'|'WITHHELD'; reason:string; evidence_type:'sensor_fusion';
  hit_status:'UNKNOWN'; relative_impact_score:number|null; peak_acceleration:number|null;
}
export interface DistancePoint { time:number; distance:number|null; change:number|null; speed:number|null; trend:'approach'|'retreat'|'steady'|'unknown'; mean:number|null; positions:Partial<Record<Fighter,Vec3>>; confidence:number; uncertainty:number|null; conflict:boolean; }
export interface PatternEvidence { event_ids:string[]; time:number; intervals:number[]; distance_change:number|null; }
export interface TacticalPattern { id:string; fighter:Fighter; sequence:string; count:number; denominator:number; confidence:number; evidence:PatternEvidence[]; interpretation:string; }
export interface FighterHabit { fighter:Fighter; punches:number; jabs:number; jabCross:number; retreat:number; distanceSamples:number; attackDistance:number|null; byRange:Record<string,number>; byZone:Record<string,number>; }
export interface TacticalReport { patterns:TacticalPattern[]; habits:FighterHabit[]; facts:string[]; suggestions:string[]; limitations:string[]; pastComparison:null; }
export interface SimulationRun { config:SimulationConfig; source:{mode:MotionSource['mode'];description:string}; devices:Device[]; measurements:Measurement[]; events:MatchEvent[]; distances:DistancePoint[]; diagnostics:{generated:number;dropped:number;late:number}; }
