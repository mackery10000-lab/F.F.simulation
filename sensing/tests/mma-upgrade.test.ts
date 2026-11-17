import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {videoMotionSource,validateMotionV2} from '../adapters.ts';
import {DEFAULT_CONFIG,generateMeasurements} from '../sensors.ts';
import {LiveSensingSession} from '../live.ts';
import {MovementTracker} from '../movement.ts';
import {stanceFeature,handFeatures} from '../mma-features.ts';
import type {Landmarks} from '../mma-features.ts';
import type {Measurement,Vec3} from '../contracts.ts';
const root=path.resolve(import.meta.dirname,'../..'),load=(p:string)=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const o=load('data/scene.json').octagon,arena={vertices:o.inside_vertices_xy_m,canvasZ:o.canvas_z_m,fenceHeight:o.fence_height_above_canvas_m};
const scene=(name:string)=>{const data=fs.readFileSync(path.join(root,`assets/sensing/scenes/${name}.json.gz`)),m=JSON.parse(gunzipSync(data).toString());m.input_asset_sha256=createHash('sha256').update(data).digest('hex');return m};
function config(duration=6){const c=structuredClone(DEFAULT_CONFIG);c.duration=duration;c.scenario='mma_v2';for(const s of Object.values(c.sensors)){s.noise=0;s.dropout=0;s.jitter_ms=0}return c}
function replay(name:string,duration=6){const m=scene(name),session=new LiveSensingSession(videoMotionSource(m),arena,config(duration));session.advance(duration);return session.run()}
test('motion-v2 rejects reversed axes, bad units, missing provenance, timestamps and quaternion',()=>{
  const m=scene('orthodox_high');validateMotionV2(m);
  assert.equal(videoMotionSource(m).at(1).actors[0].motion_provenance?.kind,'SYNTHETIC_KEYFRAME');
  for(const change of [(v:any)=>v.coordinate.world_up='Y',(v:any)=>v.coordinate.time_unit='ms',(v:any)=>v.root_rotations[0][0][3]=2,(v:any)=>delete v.joint_quality.left_toe,(v:any)=>v.source_timestamps_seconds[3]=0]){const copy=structuredClone(m);change(copy);assert.throws(()=>videoMotionSource(copy))}
});
test('legacy 16 joints retain missing heel/toe rather than fabricating observations',()=>{
  const m=scene('orthodox_high');delete m.schema_version;delete m.source_kind;m.joints=m.joints.slice(0,16);m.frames=m.frames.map((r:number[][])=>r.map(p=>p.slice(0,48)));
  const source=videoMotionSource(m);assert.equal(source.at(1).actors[0].pose.left_toe,undefined);
  const c=config(1),rows=generateMeasurements(source,arena,c).measurements.filter(m=>m.sensor_type==='camera');
  assert.equal((rows[0].measurement_value as any).observed_joints.left_toe,null);
  assert.ok(rows.every(m=>(m.measurement_value as any).stance==='UNKNOWN'));
});
test('unobserved video joints cannot become camera evidence or guard features',()=>{
  const m=scene('orthodox_high');m.source_kind='video_derived';
  m.joint_observation_confidence=m.frames.map(()=>[m.joints.map(()=>0),m.joints.map(()=>0)]);
  const source=videoMotionSource(m),rows=generateMeasurements(source,arena,config(1)).measurements.filter(r=>r.sensor_type==='camera');
  assert.ok(rows.length>0);
  for(const row of rows){const v=row.measurement_value as any;assert.ok(Object.values(v.observed_joints).every(p=>p===null));assert.deepEqual(v.wrists,[]);assert.equal(v.guard,'UNKNOWN');assert.equal(v.stance,'UNKNOWN')}
  const toe=m.joints.indexOf('left_toe');m.joint_observation_confidence[0][0][toe]=1;
  const interpolation=videoMotionSource(m);assert.equal(interpolation.at(0).actors[0].joint_confidence?.left_toe,1);assert.equal(interpolation.at(.02).actors[0].joint_confidence?.left_toe,0);
  m.joint_observation_confidence[0][0][toe]=2;assert.throws(()=>videoMotionSource(m));
});
test('stance and lead semantics are invariant under 90/180 degree world rotation and anatomical mirror',()=>{
  const j=videoMotionSource(scene('orthodox_high')).at(2).actors[0].pose as Landmarks;
  for(const angle of [0,Math.PI/2,Math.PI]){
    const rotated=Object.fromEntries(Object.entries(j).map(([k,p])=>[k,p?[p[0]*Math.cos(angle)-p[1]*Math.sin(angle),p[0]*Math.sin(angle)+p[1]*Math.cos(angle),p[2]]:null])) as Landmarks;
    assert.equal(stanceFeature(rotated),'ORTHODOX');assert.equal(handFeatures(rotated,'L',0,'ORTHODOX').lead_or_rear,'LEAD');
  }
  const mirrored=structuredClone(j);for(const key of Object.keys(j))if(key.startsWith('left_')){const other=key.replace('left_','right_');mirrored[key]=j[other];mirrored[other]=j[key]}
  assert.equal(stanceFeature(mirrored),'SOUTHPAW');assert.equal(handFeatures(mirrored,'R',0,'SOUTHPAW').lead_or_rear,'LEAD');
});
test('measured high, sustained long, mixed, shell and cross guards have real temporal evidence',()=>{
  for(const [name,want] of [['orthodox_high','HIGH_GUARD'],['both_extended','LONG_GUARD'],['lead_long_rear_high','MIXED_GUARD'],['shell','SHELL_GUARD'],['cross_guard','CROSS_GUARD']]){
    const run=replay(name);assert.ok(run.movement_events!.some(e=>e.actor_id==='A'&&e.state_after===want),`${name} must observe ${want}`);
    assert.ok(run.movement_events!.every(e=>e.available_at>=e.onset_s&&e.hit_status==='UNKNOWN'&&e.calibrated===false));
  }
  assert.ok(!replay('jab_recoil').movement_events!.some(e=>e.actor_id==='A'&&['LONG_GUARD','MIXED_GUARD'].includes(e.state_after)));
});
test('actual stance switch is confirmed after dwell; cross step, torso twist and jab do not switch',()=>{
  assert.ok(replay('step_switch').movement_events!.some(e=>e.event_type==='SWITCH'&&e.state_after==='SOUTHPAW'));
  for(const name of ['cross_step_negative','torso_twist_negative','jab_recoil'])assert.ok(!replay(name).movement_events!.some(e=>e.event_type==='SWITCH'),name);
});
test('own root motion with foot support drives in/out; opponent motion and kick do not become my step',()=>{
  for(const [name,want] of [['step_in','STEP_IN'],['step_out','STEP_OUT'],['pivot','PIVOT_LEFT']])assert.ok(replay(name).movement_events!.some(e=>e.actor_id==='A'&&e.state_after===want),name+' '+want);
  for(const name of ['opponent_only_approach','kick_check_negative','torso_twist_negative'])assert.ok(!replay(name).movement_events!.some(e=>e.actor_id==='A'&&e.state_after==='STEP_IN'),name);
});
test('camera label poisoning cannot alter measurements, hash reaches every sensor, RF carries no action labels',()=>{
  const m=scene('step_switch'),source=videoMotionSource(m),poison={...source,at(t:number){const s=source.at(t);for(const a of s.actors)a.stance=a.stance==='ORTHODOX'?'SOUTHPAW':'ORTHODOX';return s}};
  const a=generateMeasurements(source,arena,config(1)).measurements,b=generateMeasurements(poison,arena,config(1)).measurements;
  assert.deepEqual(a,b);assert.ok(a.every(r=>r.input_asset_sha256===m.input_asset_sha256&&r.seed===42));
  const rf=a.find(m=>m.sensor_type==='isac')!.measurement_value as any;assert.equal(rf.csi_links.length,4);assert.equal(rf.csi_real.length,16);assert.ok(!('stance' in rf)&&!('action' in rf));
  assert.ok(!JSON.stringify(a).includes('root_rotations'));assert.ok(!JSON.stringify(a).includes('joint_quality'));
});
test('future/late packets cannot change past; stale camera evidence becomes unknown; rewind deterministic',()=>{
  const source=videoMotionSource(scene('orthodox_high')),c=config(3),session=new LiveSensingSession(source,arena,c);
  session.advance(2);const first=session.run();session.advance(1);session.advance(2);assert.deepEqual(session.run(),first);
  const rows=first.measurements,tracker=new MovementTracker(c,arena.canvasZ);
  tracker.ingest(rows,2);const before=structuredClone(tracker.events);
  const future=rows.map(m=>({...m,timestamp:m.timestamp+100,arrival_timestamp:m.arrival_timestamp+100}));tracker.ingest(future,2);assert.deepEqual(tracker.events,before);
  tracker.ingest([],3);assert.ok(tracker.states.every(s=>s.guard==='UNKNOWN'&&s.stance==='UNKNOWN'));
});
test('no camera produces abstention; sensing import closure contains no generation or network dependencies',()=>{
  const c=config(2);c.sensors.camera.enabled=false;
  const session=new LiveSensingSession(videoMotionSource(scene('both_extended')),arena,c);session.advance(2);assert.ok(session.run().movement_states!.every(s=>s.guard==='UNKNOWN'&&s.stance==='UNKNOWN'));
  const seen=new Set<string>();function visit(file:string){if(seen.has(file))return;seen.add(file);const text=fs.readFileSync(file,'utf8');assert.ok(!/\bfetch\s*\(|https?:\/\/|ff_ai_provider|generation_manifest|scenes\/index|truthSchedule/.test(text),file);for(const m of text.matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/g))if(m[1].startsWith('.'))visit(path.resolve(path.dirname(file),m[1]))}
  visit(path.join(root,'sensing/live.ts'));
});
