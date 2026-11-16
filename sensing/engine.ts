import type {Arena,Measurement,MotionSource,SimulationConfig,SimulationRun} from './contracts.ts';
import {generateMeasurements,DEFAULT_CONFIG} from './sensors.ts';
import {createScenario} from './scenario.ts';
import {distanceSeries,fusePunches} from './fusion.ts';
import {analyzeTactics} from './tactics.ts';
export function simulate(arena:Arena,config:SimulationConfig=structuredClone(DEFAULT_CONFIG),input?:MotionSource):SimulationRun{
  const c=structuredClone(config),source=input??createScenario(c.scenario,c.duration,arena);
  c.duration=Math.min(c.duration,source.duration);
  const data=generateMeasurements(source,arena,c);
  return {config:c,source:{mode:source.mode,description:source.description},...data,events:fusePunches(data.measurements,c),distances:distanceSeries(data.measurements,c)};
}
export function observationsAt(run:SimulationRun,time:number){
  const latest=new Map<string,Measurement>();
  for(const m of run.measurements){if(m.arrival_timestamp>time)break;const key=m.sensor_id+':'+(m.fighter_id??'global'),prior=latest.get(key);if(!prior||prior.timestamp<m.timestamp)latest.set(key,m)}
  return [...latest.values()].filter(m=>m.timestamp<=time+.01&&time-m.timestamp<Math.min(.5,2/run.config.sensors[m.sensor_type].hz+.15));
}
export function exportRun(run:SimulationRun,time=run.config.duration){
  const end=Math.max(0,Math.min(time,run.config.duration));
  return {schema:'ff_sensing_run_v1',simulation_flag:true,config:run.config,source:run.source,units:run.source.mode==='video_derived'?'uncalibrated display coordinates; seconds; Z-up':'metres; seconds; Z-up',devices:run.devices,
    measurements:run.measurements.filter(m=>m.arrival_timestamp<=end),events:run.events.filter(e=>e.available_at<=end),distances:run.distances.filter(d=>d.time<=end),tactics:analyzeTactics(run.events,run.distances,run.config,end),
    limitations:['Simulated Data only; video-derived source is an uncalibrated estimate','No measured hit count or force in N','Simplified CSI / bistatic Doppler; no electromagnetic solver']};
}
