import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DEFAULT_CONFIG,generateMeasurements,MeasurementSampler,torsoBlocksLink} from '../sensors.ts';
import {createScenario} from '../scenario.ts';
import {distanceSeries,fusePunches} from '../fusion.ts';
import {MovementTracker} from '../movement.ts';
import {TagFilter} from '../tag-tracking.ts';
import {keyedRandom,gaussian,horizontal} from '../math.ts';
import type {Arena,CameraValue,Measurement,MotionSource,UwbValue,Vec3} from '../contracts.ts';
const o=JSON.parse(fs.readFileSync(new URL('../../data/scene.json',import.meta.url),'utf8')).octagon;
const arena:Arena={vertices:o.inside_vertices_xy_m,canvasZ:o.canvas_z_m,fenceHeight:o.fence_height_above_canvas_m};
function config(duration=3){const c=structuredClone(DEFAULT_CONFIG);c.duration=duration;for(const s of Object.values(c.sensors)){s.noise=0;s.dropout=0;s.jitter_ms=0;s.latency_ms=0}return c}
function tag(t:number,fighter:'A'|'B'='A',x=t,error=.2):Measurement{
  return {timestamp:t,sensor_timestamp:t,arrival_timestamp:t,timestamp_uncertainty:0,sensor_type:'uwb',sensor_id:`TAG-${fighter}`,fighter_id:fighter,
    measurement_type:'tag_position',measurement_value:{position:[x,0,1],ranges:[],residual_m:0,error_radius_m:error,method:'DS-TWR'},
    measurement_unit:'display units',confidence:.9,data_quality:.9,source_type:'simulated_sensor',simulation_flag:true,input_mode:'video_derived',measurement_id:`${fighter}:${t}`};
}
test('changing only identity cannot change RF ranges, NLOS, IMU or camera visibility quality',()=>{
  const source=createScenario('clinch',3,arena),altered:MotionSource={...source,at(t){const s=source.at(t);s.actors.forEach(a=>a.identity=1);return s}};
  const c=config(),first=generateMeasurements(source,arena,c).measurements,second=generateMeasurements(altered,arena,c).measurements;
  assert.deepEqual(first.filter(m=>m.sensor_type!=='camera'),second.filter(m=>m.sensor_type!=='camera'));
  const a=first.filter(m=>m.sensor_type==='camera'),b=second.filter(m=>m.sensor_type==='camera');
  assert.ok(horizontal(...source.at(1).actors.map(a=>a.pose.pelvis) as [Vec3,Vec3])<.6);
  assert.deepEqual(a.map(m=>[m.confidence,(m.measurement_value as CameraValue).occluded]),b.map(m=>[m.confidence,(m.measurement_value as CameraValue).occluded]));
  assert.equal(torsoBlocksLink([0,0,1],[5,0,1],[2,0,.8],[2,0,1.5]),true);
  assert.equal(torsoBlocksLink([0,0,1],[5,0,1],[2,1,.8],[2,1,1.5]),false);
});
test('tag filter predicts only short gaps, increases uncertainty and expires each tag independently',()=>{
  const f=new TagFilter();assert.equal(f.at(0,.1).status,'UNAVAILABLE');
  for(let k=0;k<=10;k++)f.update(tag(k/20));
  const observed=f.at(.55,.1),predicted=f.at(.8,.1),later=f.at(1,.1);
  assert.equal(observed.status,'FILTERED');assert.equal(predicted.status,'PREDICTED');
  assert.ok(later.uncertainty!>predicted.uncertainty!);assert.ok(predicted.confidence<observed.confidence);
  assert.equal(f.at(1.2,.1).status,'EXPIRED');assert.equal(f.at(1.2,.1).position,null);
  f.update(tag(1.3));assert.equal(f.at(1.3,.1).status,'FILTERED');
});
test('distance and tag positions share status, missing tags do not freeze the graph and future packets stay hidden',()=>{
  const c=config(2),rows:Measurement[]=[];
  for(let k=0;k<=30;k++){const t=k/20;rows.push(tag(t,'B',2));if(t<=.5||t>=1.3)rows.push(tag(t,'A',t))}
  rows.push({...tag(10,'A',100),arrival_timestamp:.1});
  const series=distanceSeries(rows,c),at=(t:number)=>series.find(p=>p.time===t)!;
  assert.equal(at(.8).method,'PREDICTED');assert.equal(at(.8).tags!.A.status,'PREDICTED');
  assert.equal(at(1.2).distance,null);assert.equal(at(1.2).tags!.A.status,'EXPIRED');
  assert.equal(at(1.3).tags!.A.status,'FILTERED');
  for(const p of series)if(p.distance!==null){assert.equal(p.distance,horizontal(p.tags!.A.position!,p.tags!.B.position!));assert.equal(p.confidence,Math.min(p.tags!.A.confidence,p.tags!.B.confidence));}
  assert.ok(series.every(p=>!p.positions.A||p.positions.A[0]<3));
});
test('filter reduces seeded noisy constant-velocity error and rejects an isolated outlier',()=>{
  const f=new TagFilter(),rng=keyedRandom(42,'filter-eval');let raw=0,filtered=0,n=0;
  for(let k=0;k<120;k++){const t=k/20,x=t*.3,measured=x+gaussian(rng)*.1;f.update(tag(t,'A',measured));if(k>10){raw+=(measured-x)**2;filtered+=(f.at(t,.1).position![0]-x)**2;n++}}
  assert.ok(Math.sqrt(filtered/n)<Math.sqrt(raw/n)*.8);
  f.update(tag(6,'A',100));assert.ok(f.at(6,.1).position![0]<3);
});
test('25 FPS observations retain native uncertainty while 30/100 Hz timestamps remain correctly spaced',()=>{
  const base=createScenario('single',1,arena),source:MotionSource={...base,at(t){const s=base.at(t);for(const a of s.actors)a.motion_provenance={kind:'INTERPOLATED',source_frames:[0,1],source_fps:25,interpolation:'test',metric_valid:false,observed_new_frames:0,root_interpolation:'linear',inferred_joint_count:0};return s}};
  const rows=new MeasurementSampler(source,arena,config(1)).advance(1);
  for(const [sensor,hz] of [['A-L',100],['CAM-09',30]] as const){const r=rows.filter(m=>m.sensor_id===sensor&&(sensor==='A-L'||m.fighter_id==='A'));
    assert.equal(r.length,hz+1);for(let k=1;k<r.length;k++)assert.ok(Math.abs(r[k].timestamp-r[k-1].timestamp-1/hz)<1e-10);
    assert.ok(r.every(m=>m.timestamp_uncertainty>=.02));}
});
test('missing elbow landmarks remove hand classification evidence',()=>{
  const base=createScenario('single',3,arena),source:MotionSource={...base,at(t){const s=base.at(t);s.actors.forEach(a=>a.joint_confidence={left_elbow:0,right_elbow:0});return s}};
  const rows=generateMeasurements(source,arena,config()).measurements;
  assert.ok(rows.filter(m=>m.sensor_type==='camera').every(m=>(m.measurement_value as CameraValue).wrists.length===0));
  assert.ok(fusePunches(rows,config()).every(e=>e.verification_status==='WITHHELD'));
});
test('brief missing wrists hold stable guard but prolonged gaps expire it',()=>{
  const c=config(),base=createScenario('approach',3,arena),rows=generateMeasurements(base,arena,c).measurements;
  const tracker=new MovementTracker(c,arena.canvasZ);
  tracker.ingest(rows.filter(m=>m.arrival_timestamp<=1.5),1.5);
  assert.ok(tracker.states.every(s=>s.guard==='HIGH_GUARD'));
  const missing=rows.filter(m=>m.arrival_timestamp>1.5).map(m=>{
    if(m.sensor_type!=='camera')return m;const value=structuredClone(m.measurement_value as CameraValue);
    value.observed_joints!.left_wrist=null;value.observed_joints!.right_wrist=null;return {...m,measurement_value:value};
  });
  tracker.ingest(missing.filter(m=>m.arrival_timestamp<=1.7),1.7);
  assert.ok(tracker.states.every(s=>s.guard==='HIGH_GUARD'));
  assert.ok(tracker.states.every(s=>s.confidence===0&&s.abstention_reason==='RECENT_STATE_HELD_OBSERVATION_GAP'));
  tracker.ingest(missing.filter(m=>m.arrival_timestamp>1.7),3);
  assert.ok(tracker.states.every(s=>s.guard==='UNKNOWN'));
});
test('scaled punches preserve action types; insufficient lead-side evidence stays Uncertain',()=>{
  const c=config(6),base=createScenario('combination',6,arena);
  const get=(factor:number)=>generateMeasurements({...base,at(t){const s=base.at(t);for(const a of s.actors)for(const [key,p] of Object.entries(a.pose))a.pose[key as keyof typeof a.pose]=p.map(v=>v*factor) as Vec3;return s}},arena,c).measurements;
  const types=(rows:Measurement[])=>fusePunches(rows,c).filter(e=>e.verification_status==='SIMULATED_FUSED').map(e=>e.detected_action);
  assert.deepEqual(types(get(1)),['Jab','Cross','Hook']);assert.deepEqual(types(get(.5)),types(get(1)));
  const uncertain=get(1).map(m=>m.sensor_type==='camera'?{...m,measurement_value:{...(m.measurement_value as CameraValue),stance:'UNKNOWN' as const}}:m);
  assert.deepEqual(types(uncertain),['Uncertain','Uncertain','Hook']);
});
