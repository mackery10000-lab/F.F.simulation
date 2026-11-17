import type {Arena,DistancePoint,MatchEvent,Measurement,MotionSource,SimulationConfig,SimulationRun,WorldState} from './contracts.ts';
import {MeasurementSampler} from './sensors.ts';
import {distanceSeries,fusePunches} from './fusion.ts';
import {MovementTracker} from './movement.ts';
export interface LiveSnapshot extends SimulationRun {time:number;received_count:number;source_frame:number;processing_ms:number;}
/** Generates only elapsed samples; fusion receives only packets that have arrived. */
export class LiveSensingSession {
  private sampler:MeasurementSampler;
  private pending:Measurement[]=[];
  private received:Measurement[]=[];
  private events:MatchEvent[]=[];
  private distances:DistancePoint[]=[];
  private time=-1;
  readonly config:SimulationConfig;
  private source:MotionSource;
  private arena:Arena;
  private fps:number;
  private movement:MovementTracker;
  constructor(source:MotionSource,arena:Arena,config:SimulationConfig,fps=25){
    this.arena=arena;this.fps=fps;
    this.config=structuredClone(config);this.config.duration=Math.min(source.duration,config.duration);
    this.movement=new MovementTracker(this.config,arena.canvasZ);
    // Cameras and four wrist devices read the same source pose many times per tick.
    const cache=new Map<string,WorldState>();
    this.source={...source,at(t){const key=t.toFixed(7);let state=cache.get(key);if(!state){state=source.at(t);cache.set(key,state);if(cache.size>10000){const first=cache.keys().next().value;if(first!==undefined)cache.delete(first)}}return state}};
    this.sampler=new MeasurementSampler(this.source,arena,this.config);
  }
  advance(target:number):LiveSnapshot{
    const started=performance.now();
    if(!Number.isFinite(target)||target<0)throw Error('Invalid live time');
    const time=Math.min(target,this.config.duration);
    if(this.time<0&&time>0)this.advance(0);
    if(time+1e-8<this.time){this.sampler=new MeasurementSampler(this.source,this.arena,this.config);this.movement=new MovementTracker(this.config,this.arena.canvasZ);this.pending=[];this.received=[];this.events=[];this.distances=[];this.time=-1}
    if(this.time<0&&time>0)this.advance(0);
    while(this.time>=0&&time-this.time>.25)this.advance(Math.min(time,this.time+.2));
    this.pending.push(...this.sampler.advance(time));this.pending.sort((a,b)=>a.arrival_timestamp-b.arrival_timestamp||a.timestamp-b.timestamp||a.sensor_id.localeCompare(b.sensor_id));
    let n=0;while(n<this.pending.length&&this.pending[n].arrival_timestamp<=time)n++;
    const arrived=this.pending.splice(0,n);this.received.push(...arrived);this.movement.ingest(arrived,time);
    const offset=Math.max(0,Math.floor((time-5)*10)/10),recent=this.received.filter(m=>m.arrival_timestamp>=offset-.5);
    const candidates=fusePunches(recent,this.config);
    for(const event of candidates){
      if(event.available_at>time||event.event_end+.27>time||event.event_start<offset+.1&&offset>0)continue;
      if(this.events.some(prior=>prior.fighter_id===event.fighter_id&&prior.hand===event.hand&&prior.event_start<=event.event_end+.25&&prior.event_end>=event.event_start-.25))continue;
      this.events.push(event);
    }
    this.events.sort((a,b)=>a.event_start-b.event_start);
    const local=recent.map(m=>({...m,timestamp:m.timestamp-offset,arrival_timestamp:m.arrival_timestamp-offset}));
    const distances=distanceSeries(local,{...this.config,duration:time-offset});
    const last=this.distances.at(-1)?.time??-1;
    this.distances.push(...distances.map(d=>({...d,time:Math.round((d.time+offset)*10)/10})).filter(d=>d.time>last+1e-7&&d.time<=time));
    this.time=time;
    return {...this.run(false),time,received_count:this.received.length,source_frame:Math.round(time*this.fps),processing_ms:performance.now()-started};
  }
  run(full=true):SimulationRun{
    return {config:this.config,source:{mode:this.source.mode,description:this.source.description},devices:this.sampler.devices,
      measurements:full?[...this.received]:this.received.filter(m=>m.arrival_timestamp>this.time-8),events:[...this.events],distances:[...this.distances],movement_events:[...this.movement.events],movement_states:structuredClone(this.movement.states),diagnostics:{...this.sampler.diagnostics}};
  }
}
