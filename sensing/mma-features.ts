/** Geometric features from observed landmarks only. No source asset or labels. */
import type {Hand,HandGuardEvidence,Vec3} from './contracts.ts';
import {distance,dot,norm,sub,unit} from './math.ts';
export const MMA_THRESHOLDS={guard_dwell_s:.45,stance_dwell_s:.45,footwork_dwell_s:.18,stale_s:.35,lead_delta_m:.12,step_speed_m_s:.16,contact_height_m:.035,foot_speed_m_s:.20,pivot_yaw_rad_s:.20,hand_speed_m_s:.65,extended_reach:.72,head_distance:.58};
export type Landmarks=Record<string,Vec3|null|undefined>;
export function bodyFrame(j:Landmarks):{forward:Vec3;side:Vec3}|null{
  if(!j.left_shoulder||!j.right_shoulder||!j.head||!j.nose)return null;
  const side=unit([j.left_shoulder[0]-j.right_shoulder[0],j.left_shoulder[1]-j.right_shoulder[1],0]);
  if(norm(side)<.5)return null;
  let forward:Vec3=[side[1],-side[0],0];
  if(dot(forward,sub(j.nose,j.head))<0)forward=forward.map(v=>-v) as Vec3;
  if(Math.abs(dot(forward,sub(j.nose,j.head)))<.025)return null;
  return {forward,side};
}
export function stanceFeature(j:Landmarks):'ORTHODOX'|'SOUTHPAW'|'SQUARE'|'UNKNOWN'{
  const b=bodyFrame(j);if(!b||!j.left_heel||!j.left_toe||!j.right_heel||!j.right_toe)return 'UNKNOWN';
  const left=j.left_heel.map((v,i)=>(v+j.left_toe![i])/2) as Vec3,right=j.right_heel.map((v,i)=>(v+j.right_toe![i])/2) as Vec3;
  if(Math.abs(left[2]-right[2])>.1)return 'UNKNOWN';
  const delta=dot(sub(left,right),b.forward);
  return delta>MMA_THRESHOLDS.lead_delta_m?'ORTHODOX':delta< -MMA_THRESHOLDS.lead_delta_m?'SOUTHPAW':'SQUARE';
}
export function handFeatures(j:Landmarks,hand:Hand,speed:number|null,stance:string):HandGuardEvidence{
  const side=hand==='L'?'left':'right',shoulder=j[side+'_shoulder'],elbow=j[side+'_elbow'],wrist=j[side+'_wrist'],head=j.head,b=bodyFrame(j);
  const result:HandGuardEvidence={state:'UNKNOWN',lead_or_rear:stance==='ORTHODOX'?(hand==='L'?'LEAD':'REAR'):stance==='SOUTHPAW'?(hand==='R'?'LEAD':'REAR'):'UNKNOWN',elbow_flexion_rad:null,forearm_pitch:null,wrist_to_chin_normalized:null,wrist_to_temple_normalized:null,forward_reach_normalized:null,hand_speed:speed,duration_s:0,visibility:0,confidence:0,source_provenance:'virtual_pose_sensor'};
  if(!shoulder||!elbow||!wrist||!head||!b)return result;
  const upper=distance(shoulder,elbow),lower=distance(elbow,wrist),arm=upper+lower;
  if(arm<.2)return result;
  const flex=Math.acos(Math.max(-1,Math.min(1,dot(unit(sub(shoulder,elbow)),unit(sub(wrist,elbow)))))),reach=dot(sub(wrist,shoulder),b.forward)/arm;
  const chin:Vec3=[head[0],head[1],head[2]-.1],dhead=distance(wrist,chin)/arm;
  Object.assign(result,{elbow_flexion_rad:flex,forearm_pitch:Math.asin((wrist[2]-elbow[2])/Math.max(.001,lower)),wrist_to_chin_normalized:dhead,wrist_to_temple_normalized:distance(wrist,j[side+'_ear']??head)/arm,forward_reach_normalized:reach,visibility:1,confidence:.75});
  result.state=speed!==null&&speed>MMA_THRESHOLDS.hand_speed_m_s?'ATTACKING':reach>MMA_THRESHOLDS.extended_reach?'EXTENDED':dhead<MMA_THRESHOLDS.head_distance?'HEAD_PROTECT':wrist[2]<chin[2]-.3?'LOW':'UNKNOWN';
  return result;
}
