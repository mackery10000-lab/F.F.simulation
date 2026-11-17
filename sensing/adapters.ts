import type {ActorState,Fighter,MotionSource,Pose,Vec3} from './contracts.ts';
import {JOINTS,EXTRA_JOINTS} from './contracts.ts';
import {clamp,scale,sub} from './math.ts';
import {motionSampler} from '../motion/sampling.ts';
import type {MotionData} from '../motion/sampling.ts';
export interface ExistingMotion extends MotionData {schema_version?:string;source_kind?:'synthetic'|'video_derived';coordinate?:{world_up:string;handedness:string;length_unit:string;time_unit:string;quaternion_order:string;mat_surface_z_m:number};root_rotations?:number[][][];joint_quality?:Record<string,{confidence:number;provenance_kind:string}>;joint_observation_confidence?:number[][][];frame_quality?:{occluded?:boolean;camera_segment_id?:number}[];input_asset_sha256?:string;canvas_z_m?:number;source_sha256?:string|null;records?:{track_id?:string;persistent_skeleton_id?:string;script_prior?:{blocked?:boolean};identity_status?:string;identity_confidence?:number}[][];}
export function validateMotionV2(d:ExistingMotion){
  if(!d.schema_version)return; // Legacy joints stay absent rather than fabricated.
  if(d.schema_version!=='2.0'||d.coordinate?.world_up!=='Z'||d.coordinate.handedness!=='right'||d.coordinate.length_unit!=='m'||d.coordinate.time_unit!=='s'||d.coordinate.quaternion_order!=='xyzw'||!Number.isFinite(d.coordinate.mat_surface_z_m)||d.coordinate.mat_surface_z_m!==d.canvas_z_m||!['synthetic','video_derived'].includes(d.source_kind??''))throw Error('Invalid motion-v2 coordinate/provenance contract');
  if(!d.root_rotations||d.root_rotations.length!==d.frames.length||d.root_rotations.some(row=>row.length!==2||row.some(q=>q.length!==4||q.some(v=>!Number.isFinite(v))||Math.abs(Math.hypot(...q)-1)>.0001)))throw Error('Invalid motion-v2 quaternion');
  if(!d.joint_quality||d.joints.some(j=>!d.joint_quality![j]||!Number.isFinite(d.joint_quality![j].confidence)||d.joint_quality![j].confidence<0||d.joint_quality![j].confidence>1||!['observed_2d','estimated_3d','interpolated','hand_fixed','luna_generated','synthetic'].includes(d.joint_quality![j].provenance_kind)))throw Error('Invalid motion-v2 joint provenance');
  if(!d.source_timestamps_seconds||d.source_timestamps_seconds.length!==d.frames.length||d.source_timestamps_seconds.some((t,i)=>!Number.isFinite(t)||Math.abs(t-i/d.fps)>1e-7))throw Error('Invalid motion-v2 timestamps');
  if(d.joint_observation_confidence&&(d.joint_observation_confidence.length!==d.frames.length||d.joint_observation_confidence.some(row=>row.length!==2||row.some(p=>p.length!==d.joints.length||p.some(v=>!Number.isFinite(v)||v<0||v>1)))))throw Error('Invalid per-frame observed joint confidence');
}
/** Shared model-time sampling; original 25 FPS source coordinates stay exact. */
export function sampleFlatMotion(d:ExistingMotion,time:number,fi:number):number[]{
  return motionSampler(d).sample(time,fi);
}
/** Read-only adapter: video-derived coordinates are never edited or metric calibrated. */
export function videoMotionSource(value:unknown):MotionSource{
  const d=value as ExistingMotion;
  validateMotionV2(d);
  if(!d||d.axis!=='Z-up'||!Array.isArray(d.joints)||new Set(d.joints).size!==d.joints.length||!JOINTS.every(j=>d.joints.includes(j))||!Number.isFinite(d.fps)||d.fps<=0||d.fps>240||!Array.isArray(d.frames)||d.frames.length<2||d.frames.length>100000)throw Error('Z-up 선수 A/B 관절 모션 형식이 필요합니다.');
  if(d.frames.some(frame=>frame.length!==2||frame.some(p=>p.length!==d.joints.length*3||p.some(n=>!Number.isFinite(n)))))throw Error('유효한 독립 선수 A/B 좌표가 필요합니다.');
  const sampler=motionSampler(d);
  if(d.records&&(d.records.length!==d.frames.length||d.records.some(row=>!Array.isArray(row)||row.length!==2||row.some((r,fi)=>!r||r.track_id!==undefined&&r.track_id!=='AB'[fi]||r.persistent_skeleton_id!==undefined&&r.persistent_skeleton_id!=='fighter_'+'AB'[fi]))))throw Error('모션 신원 provenance의 A/B 슬롯이 다릅니다.');
  const names=[...JOINTS,...EXTRA_JOINTS.filter(j=>d.joints.includes(j))],indices=names.map(j=>d.joints.indexOf(j)*3),duration=(d.frames.length-1)/d.fps;
  const poseAt=(time:number,fi:number):Pose=>{
    const flat=sampler.sample(time,fi);
    return Object.fromEntries(names.map((j,i)=>[j,[flat[indices[i]],flat[indices[i]+1],flat[indices[i]+2]]])) as Pose;
  };
  return {duration,mode:d.source_kind==='synthetic'?'synthetic':'video_derived',asset_sha256:d.input_asset_sha256,metric_valid:false,qualityAt(time){return d.frame_quality?.[Math.min(d.frames.length-1,Math.max(0,Math.round(time*d.fps)))]??{}},description:d.source_kind==='synthetic'?'LUNA 제약 + 로컬 IK 합성 MMA 모션 · 실측/영상 복원 아님 · 스케일 미검증':'25 FPS 키프레임·손목·발목 궤적 보존 · 국소 두 뼈 IK는 미관측 보간 · 센서 Simulation · 미터 보정 없음',at(time){
    const t=clamp(time,0,duration);
    const actors=([0,1] as const).map(fi=>{const pose=poseAt(t,fi),record=d.records?.[Math.min(d.frames.length-1,Math.round(t*d.fps))]?.[fi];
      // Pose geometry can suggest a lead side; it is a simulation assumption, not a verified video label.
      const opponent=poseAt(t,1-fi).pelvis,dx=opponent[0]-pose.pelvis[0],dy=opponent[1]-pose.pelvis[1];
      const left=(pose.left_ankle[0]-pose.right_ankle[0])*dx+(pose.left_ankle[1]-pose.right_ankle[1])*dy;
      const provenance=sampler.provenance(t);
      const frame=Math.min(d.frames.length-1,Math.floor(t*d.fps)),next=Math.min(d.frames.length-1,Math.ceil(t*d.fps));
      const joint_confidence=d.joint_observation_confidence?Object.fromEntries(d.joints.map((j,i)=>[j,Math.min(d.joint_observation_confidence![frame][fi][i],d.joint_observation_confidence![next][fi][i])])):undefined;
      if(d.source_kind==='synthetic')provenance.kind=provenance.source_frames[0]===Math.round(t*d.fps)&&Math.abs(t*d.fps-Math.round(t*d.fps))<1e-8?'SYNTHETIC_KEYFRAME':'INTERPOLATED_SYNTHETIC';
      return {id:('AB'[fi]) as Fighter,pose,joint_confidence,velocity:scale(sub(pose.pelvis,poseAt(Math.max(0,t-.02),fi).pelvis),1/Math.max(.001,Math.min(t,.02))),stance:left>=0?'ORTHODOX':'SOUTHPAW',identity:record?.identity_confidence??(record?.script_prior?.blocked||record?.identity_status?.includes('uncertain')?.35:.8),motion_provenance:provenance} as ActorState;
    });return {time:t,actors:actors as [ActorState,ActorState]};
  }};
}
