import type {CameraValue,DistancePoint,Fighter,Hand,ImuValue,IsacValue,MatchEvent,Measurement,Punch,SimulationConfig,UwbValue,Vec3,WristFeature} from './contracts.ts';
import {clamp,horizontal,mean} from './math.ts';
import {TagFilter} from './tag-tracking.ts';
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
      const bodyScale=feature?.body_scale??1;
      if(feature&&bodyScale>.05&&feature.extension/bodyScale>.43&&feature.speed/bodyScale>.45&&v.fov_visible)candidates.push({m,feature});
    }
    const clusters:Candidate[][]=[];
    for(const candidate of candidates){const last=clusters.at(-1);if(last&&candidate.m.timestamp-last.at(-1)!.m.timestamp<=.17)last.push(candidate);else clusters.push([candidate])}
    for(const cluster of clusters){
      const start=cluster[0].m.timestamp,last=cluster.at(-1)!.m.timestamp,center=(start+last)/2;
      const good=cluster.filter(c=>c.m.confidence>=.5&&c.m.timestamp_uncertainty<=config.fusionWindow&&(c.m.measurement_value as CameraValue).identity_confidence>=.65);
      const scales=good.map(c=>c.feature.body_scale??1),bodyScale=scales.length?mean(scales):1;
      const inertial=windowed(imu,start-config.fusionWindow,last+config.fusionWindow).filter(m=>m.fighter_id===fighter&&m.timestamp_uncertainty<=config.fusionWindow&&(m.measurement_value as ImuValue).hand===hand&&m.confidence>=.5&&(m.measurement_value as ImuValue).peak_acceleration/bodyScale>8);
      // Global radio motion supports an event's timing; it never assigns identity or punch type.
      const radio=windowed(isac,center-config.fusionWindow,center+config.fusionWindow).filter(m=>m.confidence>.5&&(m.measurement_value as IsacValue).motion_energy>.1);
      const cameraCoverage=.7+.3*Math.min(1,new Set(good.map(c=>c.m.sensor_id)).size/4);
      const confidence=clamp(.22+.3*cameraCoverage*mean(good.map(c=>c.m.confidence))+.29*mean(inertial.map(m=>m.confidence))+(radio.length?.1*mean(radio.map(m=>m.confidence)):0));
      const features=good.map(c=>c.feature),stances=good.map(c=>(c.m.measurement_value as CameraValue).stance).filter(s=>s!=='UNKNOWN');
      const bins=new Map<number,WristFeature[]>();
      for(const c of good){const key=Math.round(c.m.timestamp*30),row=bins.get(key)??[];row.push(c.feature);bins.set(key,row)}
      const median=(v:number[])=>v.sort((a,b)=>a-b)[Math.floor(v.length/2)];
      const normalized=[...bins.values()].map(row=>Object.fromEntries((['extension','lateral','vertical'] as const).map(key=>[key,median(row.map(f=>f[key]/(f.body_scale??1)))]))) as {extension:number;lateral:number;vertical:number}[];
      const span=(key:'extension'|'lateral'|'vertical')=>normalized.length?Math.max(...normalized.map(f=>f[key]))-Math.min(...normalized.map(f=>f[key])):0;
      const lateral=normalized.length?Math.max(...normalized.map(f=>f.lateral)):0,vertical=normalized.length?Math.max(...normalized.map(f=>f.vertical)):0;
      const dynamic=new Set(good.map(c=>c.m.timestamp)).size>=2&&Math.max(span('extension'),span('lateral'),span('vertical'))>.08;
      const confirmed=good.length>0&&inertial.length>0&&confidence>=.6&&dynamic;
      let action:Punch='Uncertain';
      if(confirmed){if(vertical>.3&&span('vertical')>.12)action='Uppercut';else if(lateral>.3&&span('lateral')>.1)action='Hook';else if(lateral<.3&&vertical<.3&&stances.length&&stances.every(s=>s===stances[0]))action=hand===(stances[0]==='ORTHODOX'?'L':'R')?'Jab':'Cross'}
      const evidence=[...good.map(c=>c.m),...inertial,...radio];
      const fallback=cluster.map(c=>c.m);
      events.push({event_id:`SIM-${fighter}-${hand}-${Math.round(start*1000)}`,event_start:Math.max(0,start),event_end:Math.max(last,...inertial.map(m=>m.timestamp)),available_at:Math.max(...(evidence.length?evidence:fallback).map(m=>m.arrival_timestamp))+ .17,
        fighter_id:fighter,hand,detected_action:action,contributing_sensors:[...new Set(evidence.map(m=>m.sensor_id))],classification_confidence:confidence,verification_status:confirmed?'SIMULATED_FUSED':'WITHHELD',
        type_confidence:action==='Uncertain'?0:confidence*.8,classification_reason:action==='Uncertain'?'TRAJECTORY_OR_LEAD_SIDE_INSUFFICIENT':'BODY_SCALE_NORMALIZED_TEMPORAL_TRAJECTORY; UNCALIBRATED',
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
  const available=(m:Measurement)=>Math.max(m.arrival_timestamp,m.timestamp);
  const rows=measurements.filter(m=>m.sensor_type==='uwb'||m.sensor_type==='camera').sort((a,b)=>available(a)-available(b));
  const latest=new Map<string,Measurement>(),filters={A:new TagFilter(),B:new TagFilter()},result:DistancePoint[]=[];let index=0;
  for(let step=0;step<=Math.floor(config.duration*10);step++){
    const time=step/10;while(index<rows.length&&available(rows[index])<=time){const row=rows[index++],key=row.sensor_id+row.fighter_id,prior=latest.get(key);if(!prior||row.timestamp>=prior.timestamp){latest.set(key,row);if(row.sensor_type==='uwb'&&row.fighter_id)filters[row.fighter_id].update(row)}}
    const maxAge=Math.min(.3,Math.max(.1,1.5/config.sensors.uwb.hz+config.sensors.uwb.latency_ms/1000+3*config.sensors.uwb.jitter_ms/1000));
    const tags={A:filters.A.at(time,maxAge),B:filters.B.at(time,maxAge)};
    const positions:Partial<Record<Fighter,Vec3>>={},qs:number[]=[],errors:number[]=[];let conflict=false;
    for(const fighter of ['A','B'] as Fighter[]){
      const tag=tags[fighter];if(!tag.position)continue;
      positions[fighter]=tag.position;let q=tag.confidence;
      const cameras=[...latest.values()].filter(r=>r.sensor_type==='camera'&&r.fighter_id===fighter&&r.confidence>.65&&r.timestamp<=time+.01&&time-r.timestamp<.2);
      if(cameras.length){const camera=cameras.sort((a,b)=>b.confidence-a.confidence)[0],p=(camera.measurement_value as CameraValue).position;
        if(horizontal(p,tag.position)>Math.max(.3,3*(tag.uncertainty??0))){conflict=true;q*=.45}}
      tag.confidence=q;qs.push(q);errors.push(tag.uncertainty??0);
    }
    const d=positions.A&&positions.B?horizontal(positions.A,positions.B):null,prior=result.at(-1);
    const history=result.filter(p=>p.time>=time-1&&p.distance!==null),average=d===null?null:mean([...history.map(p=>p.distance!),d]);
    const reference=result[Math.max(0,result.length-5)],speed=d!==null&&reference?.distance!==null&&reference?.distance!==undefined?(d-reference.distance)/Math.max(.1,time-reference.time):null;
    const method=d===null?'UNAVAILABLE':Object.values(tags).some(t=>t.status==='PREDICTED')?'PREDICTED':Object.values(tags).every(t=>t.status==='OBSERVED')?'OBSERVED':'FILTERED';
    result.push({time,distance:d,positions,tags,method,change:d!==null&&prior?.distance!==null&&prior?.distance!==undefined?d-prior.distance:null,speed,trend:speed===null?'unknown':speed<-.15?'approach':speed>.15?'retreat':'steady',mean:average,confidence:d===null?0:Math.min(...qs),uncertainty:d===null?null:errors.reduce((sum,e)=>sum+e,0),conflict});
  }
  return result;
}
export function countAttempts(events:MatchEvent[],time=Infinity){
  return (['A','B'] as Fighter[]).map(fighter=>{const rows=events.filter(e=>e.fighter_id===fighter&&e.available_at<=time&&e.verification_status==='SIMULATED_FUSED');return {fighter,total:rows.length,types:Object.fromEntries((['Jab','Cross','Hook','Uppercut','Uncertain'] as Punch[]).map(action=>[action,rows.filter(e=>e.detected_action===action).length])) as Record<Punch,number>}});
}
