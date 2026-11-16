import type {ActorState,Fighter,MotionSource,Pose,Vec3} from './contracts.ts';
import {JOINTS} from './contracts.ts';
import {clamp,scale,sub} from './math.ts';
import {motionSampler} from '../motion/sampling.ts';
import type {MotionData} from '../motion/sampling.ts';
export interface ExistingMotion extends MotionData {canvas_z_m?:number;source_sha256?:string;records?:{track_id?:string;persistent_skeleton_id?:string;script_prior?:{blocked?:boolean};identity_status?:string}[][];}
/** Shared model-time sampling; original 25 FPS source coordinates stay exact. */
export function sampleFlatMotion(d:ExistingMotion,time:number,fi:number):number[]{
  return motionSampler(d).sample(time,fi);
}
/** Read-only adapter: video-derived coordinates are never edited or metric calibrated. */
export function videoMotionSource(value:unknown):MotionSource{
  const d=value as ExistingMotion;
  if(!d||d.axis!=='Z-up'||!Array.isArray(d.joints)||new Set(d.joints).size!==d.joints.length||!JOINTS.every(j=>d.joints.includes(j))||!Number.isFinite(d.fps)||d.fps<=0||d.fps>240||!Array.isArray(d.frames)||d.frames.length<2||d.frames.length>100000)throw Error('Z-up 선수 A/B 관절 모션 형식이 필요합니다.');
  if(d.frames.some(frame=>frame.length!==2||frame.some(p=>p.length!==d.joints.length*3||p.some(n=>!Number.isFinite(n)))))throw Error('유효한 독립 선수 A/B 좌표가 필요합니다.');
  const sampler=motionSampler(d);
  if(d.records&&(d.records.length!==d.frames.length||d.records.some(row=>!Array.isArray(row)||row.length!==2||row.some((r,fi)=>!r||r.track_id!==undefined&&r.track_id!=='AB'[fi]||r.persistent_skeleton_id!==undefined&&r.persistent_skeleton_id!=='fighter_'+'AB'[fi]))))throw Error('모션 신원 provenance의 A/B 슬롯이 다릅니다.');
  const indices=JOINTS.map(j=>d.joints.indexOf(j)*3),duration=(d.frames.length-1)/d.fps;
  const poseAt=(time:number,fi:number):Pose=>{
    const flat=sampler.sample(time,fi);
    return Object.fromEntries(JOINTS.map((j,i)=>[j,[flat[indices[i]],flat[indices[i]+1],flat[indices[i]+2]]])) as Pose;
  };
  return {duration,mode:'video_derived',description:'25 FPS 키프레임·손목·발목 궤적 보존 · 국소 두 뼈 IK는 미관측 보간 · 센서 Simulation · 미터 보정 없음',at(time){
    const t=clamp(time,0,duration);
    const actors=([0,1] as const).map(fi=>{const pose=poseAt(t,fi),record=d.records?.[Math.min(d.frames.length-1,Math.round(t*d.fps))]?.[fi];
      // Pose geometry can suggest a lead side; it is a simulation assumption, not a verified video label.
      const opponent=poseAt(t,1-fi).pelvis,dx=opponent[0]-pose.pelvis[0],dy=opponent[1]-pose.pelvis[1];
      const left=(pose.left_ankle[0]-pose.right_ankle[0])*dx+(pose.left_ankle[1]-pose.right_ankle[1])*dy;
      return {id:('AB'[fi]) as Fighter,pose,velocity:scale(sub(pose.pelvis,poseAt(Math.max(0,t-.02),fi).pelvis),1/Math.max(.001,Math.min(t,.02))),stance:left>=0?'ORTHODOX':'SOUTHPAW',identity:Math.hypot(dx,dy)<.6?.3:record?.script_prior?.blocked||record?.identity_status?.includes('uncertain')?.35:.8,motion_provenance:sampler.provenance(t)} as ActorState;
    });return {time:t,actors:actors as [ActorState,ActorState]};
  }};
}
