import type {CameraValue,DistancePoint,Fighter,Hand,ImuValue,IsacValue,MatchEvent,Measurement,Punch,SimulationConfig,UwbValue,Vec3,WristFeature} from './contracts.ts';
import {clamp,horizontal,mean} from './math.ts';
/** All fusion inputs are measurements. No scenario schedule or truth labels. */
function windowed(rows:Measurement[],start:number,end:number){
  let lo=0,hi=rows.length;while(lo<hi){const mid=(lo+hi)>>>1;if(rows[mid].timestamp<start)lo=mid+1;else hi=mid}
  const result:Measurement[]=[];for(let i=lo;i<rows.length&&rows[i].timestamp<=end;i++)result.push(rows[i]);return result;
}
interface Candidate {m:Measurement;feature:WristFeature;}
export function fusePunches(measurements:Measurement[],config:SimulationConfig):MatchEvent[]{
  const camera=measurements.filter(m=>m.sensor_type==='camera').sort((a,b)=>a.timestamp-b.timestamp);
  const imu=measurements.filter(m=>m.sensor_type==='imu').sort((a,b)=>a.timestamp-b.timestamp);
  const isac=measurements.filter(m=>m.sensor_type==='isac').sort((a,b)=>a.timestamp-b.timestamp);
  const events:MatchEvent[]=[];
  for(const fighter of ['A','B'] as Fighter[])for(const hand of ['L','R'] as Hand[]){
    const candidates:Candidate[]=[];
    for(const m of camera){if(m.fighter_id!==fighter)continue;const v=m.measurement_value as CameraValue;
      const feature=v.wrists.find(w=>w.hand===hand);
      if(feature&&feature.extension>.43&&feature.speed>.45&&v.fov_visible)candidates.push({m,feature});
    }
    const clusters:Candidate[][]=[];
    for(const candidate of candidates){const last=clusters.at(-1);if(last&&candidate.m.timestamp-last.at(-1)!.m.timestamp<=.17)last.push(candidate);else clusters.push([candidate])}
    for(const cluster of clusters){
      const start=cluster[0].m.timestamp,last=cluster.at(-1)!.m.timestamp,center=(start+last)/2;
      const good=cluster.filter(c=>c.m.confidence>=.5&&c.m.timestamp_uncertainty<=config.fusionWindow&&(c.m.measurement_value as CameraValue).identity_confidence>=.65);
      const inertial=windowed(imu,start-config.fusionWindow,last+config.fusionWindow).filter(m=>m.fighter_id===fighter&&m.timestamp_uncertainty<=config.fusionWindow&&(m.measurement_value as ImuValue).hand===hand&&m.confidence>=.5&&(m.measurement_value as ImuValue).peak_acceleration>8);
      // Global radio motion supports an event's timing; it never assigns identity or punch type.
      const radio=windowed(isac,center-config.fusionWindow,center+config.fusionWindow).filter(m=>m.confidence>.5&&(m.measurement_value as IsacValue).motion_energy>.1);
      const cameraCoverage=.7+.3*Math.min(1,new Set(good.map(c=>c.m.sensor_id)).size/4);
      const confidence=clamp(.22+.3*cameraCoverage*mean(good.map(c=>c.m.confidence))+.29*mean(inertial.map(m=>m.confidence))+(radio.length?.1*mean(radio.map(m=>m.confidence)):0));
      const confirmed=good.length>0&&inertial.length>0&&confidence>=.6;
      const features=good.map(c=>c.feature),stances=good.map(c=>(c.m.measurement_value as CameraValue).stance).filter(s=>s!=='UNKNOWN');
      const lateral=features.length?Math.max(...features.map(f=>f.lateral)):0,vertical=features.length?Math.max(...features.map(f=>f.vertical)):0;
      let action:Punch='Uncertain';
      if(confirmed){if(vertical>.3)action='Uppercut';else if(lateral>.3)action='Hook';else if(stances.length&&stances.every(s=>s===stances[0]))action=hand===(stances[0]==='ORTHODOX'?'L':'R')?'Jab':'Cross'}
      const evidence=[...good.map(c=>c.m),...inertial,...radio];
      const fallback=cluster.map(c=>c.m);
      events.push({event_id:`SIM-${fighter}-${hand}-${Math.round(start*1000)}`,event_start:Math.max(0,start),event_end:Math.max(last,...inertial.map(m=>m.timestamp)),available_at:Math.max(...(evidence.length?evidence:fallback).map(m=>m.arrival_timestamp))+ .17,
        fighter_id:fighter,hand,detected_action:action,contributing_sensors:[...new Set(evidence.map(m=>m.sensor_id))],classification_confidence:confidence,verification_status:confirmed?'SIMULATED_FUSED':'WITHHELD',
        reason:confirmed?'카메라 팔 궤적 + 같은 손목 IMU의 시간 일치'+(radio.length?' + ISAC 움직임 보완':' · ISAC 보완 없음'):'카메라/IMU의 시간 일치 또는 선수 식별 근거 부족',evidence_type:'sensor_fusion',hit_status:'UNKNOWN',
        relative_impact_score:inertial.length?Math.max(...inertial.map(m=>(m.measurement_value as ImuValue).relative_impact_score)):null,peak_acceleration:inertial.length?Math.max(...inertial.map(m=>(m.measurement_value as ImuValue).peak_acceleration)):null});
    }
    // IMU-only bursts remain withheld. They cannot increase punch attempt counts.
    const bursts:Measurement[][]=[];
    for(const m of imu.filter(m=>m.fighter_id===fighter&&(m.measurement_value as ImuValue).hand===hand&&(m.measurement_value as ImuValue).peak_acceleration>12)){
      const last=bursts.at(-1);if(last&&m.timestamp-last.at(-1)!.timestamp<.22)last.push(m);else bursts.push([m]);
    }
    for(const burst of bursts){const start=burst[0].timestamp,end=burst.at(-1)!.timestamp;
      if(events.some(e=>e.fighter_id===fighter&&e.hand===hand&&e.event_start<=end+.35&&e.event_end>=start-.35))continue;
      events.push({event_id:`SIM-WITHHELD-${fighter}-${hand}-${Math.round(start*1000)}`,event_start:Math.max(0,start),event_end:end,available_at:Math.max(...burst.map(m=>m.arrival_timestamp))+.22,fighter_id:fighter,hand,detected_action:'Uncertain',contributing_sensors:[...new Set(burst.map(m=>m.sensor_id))],classification_confidence:.25,verification_status:'WITHHELD',reason:'손목 급가속만 관측 · 킥/레벨 변화/일반 움직임과 구분 불충분',evidence_type:'sensor_fusion',hit_status:'UNKNOWN',relative_impact_score:null,peak_acceleration:Math.max(...burst.map(m=>(m.measurement_value as ImuValue).peak_acceleration))});
    }
  }
  return events.sort((a,b)=>a.event_start-b.event_start||a.fighter_id.localeCompare(b.fighter_id));
}
export function distanceSeries(measurements:Measurement[],config:SimulationConfig):DistancePoint[]{
  const rows=measurements.filter(m=>m.sensor_type==='uwb'||m.sensor_type==='camera').sort((a,b)=>a.arrival_timestamp-b.arrival_timestamp);
  const latest=new Map<string,Measurement>(),result:DistancePoint[]=[];let index=0;
  for(let step=0;step<=Math.floor(config.duration*10);step++){
    const time=step/10;while(index<rows.length&&rows[index].arrival_timestamp<=time){const row=rows[index++],key=row.sensor_id+row.fighter_id,prior=latest.get(key);if(!prior||row.timestamp>=prior.timestamp)latest.set(key,row)}
    const positions:Partial<Record<Fighter,Vec3>>={},qs:number[]=[],errors:number[]=[];let conflict=false;
    for(const fighter of ['A','B'] as Fighter[]){
      const m=latest.get(`TAG-${fighter}${fighter}`),maxAge=Math.min(.5,2/config.sensors.uwb.hz+.12);
      if(!m||m.timestamp>time+.01||time-m.timestamp>maxAge||m.confidence<.25)continue;
      const value=m.measurement_value as UwbValue;if(!value.position)continue;
      positions[fighter]=value.position;let q=m.confidence;
      const cameras=[...latest.values()].filter(r=>r.sensor_type==='camera'&&r.fighter_id===fighter&&r.confidence>.65&&r.timestamp<=time+.01&&time-r.timestamp<.2);
      if(cameras.length){const camera=cameras.sort((a,b)=>b.confidence-a.confidence)[0],p=(camera.measurement_value as CameraValue).position;
        if(horizontal(p,value.position)>Math.max(.3,3*value.error_radius_m)){conflict=true;q*=.45}}
      qs.push(q);errors.push(value.error_radius_m);
    }
    const d=positions.A&&positions.B?horizontal(positions.A,positions.B):null,prior=result.at(-1);
    const history=result.filter(p=>p.time>=time-1&&p.distance!==null),average=d===null?null:mean([...history.map(p=>p.distance!),d]);
    const reference=result[Math.max(0,result.length-5)],speed=d!==null&&reference?.distance!==null&&reference?.distance!==undefined?(d-reference.distance)/Math.max(.1,time-reference.time):null;
    result.push({time,distance:d,positions,change:d!==null&&prior?.distance!==null&&prior?.distance!==undefined?d-prior.distance:null,speed,trend:speed===null?'unknown':speed<-.15?'approach':speed>.15?'retreat':'steady',mean:average,confidence:d===null?0:Math.min(...qs),uncertainty:d===null?null:errors.reduce((sum,e)=>sum+e,0),conflict});
  }
  return result;
}
export function countAttempts(events:MatchEvent[],time=Infinity){
  return (['A','B'] as Fighter[]).map(fighter=>{const rows=events.filter(e=>e.fighter_id===fighter&&e.available_at<=time&&e.verification_status==='SIMULATED_FUSED');return {fighter,total:rows.length,types:Object.fromEntries((['Jab','Cross','Hook','Uppercut','Uncertain'] as Punch[]).map(action=>[action,rows.filter(e=>e.detected_action===action).length])) as Record<Punch,number>}});
}
