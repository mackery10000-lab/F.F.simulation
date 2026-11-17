/** Offline replay: no network permission is needed or permitted. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {videoMotionSource} from '../sensing/adapters.ts';
import {LiveSensingSession} from '../sensing/live.ts';
import {DEFAULT_CONFIG} from '../sensing/sensors.ts';
const args=process.argv.slice(2),arg=(key:string,fallback:string)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const root=path.resolve(arg('--root',path.resolve(import.meta.dirname,'..')));
const file=path.resolve(root,arg('--asset','assets/sensing/motion.json.gz'));
const out=path.resolve(root,arg('--out','reports/mma_3d_sensing_upgrade/03_SIMULATION_RUN.json'));
let networkCalls=0;globalThis.fetch=async()=>{networkCalls++;throw Error('External network forbidden in local sensing')};
const bytes=fs.readFileSync(file),sha=createHash('sha256').update(bytes).digest('hex');
const motion=JSON.parse((file.endsWith('.gz')?gunzipSync(bytes):bytes).toString('utf8'));
motion.input_asset_sha256=sha;
const source=videoMotionSource(motion),o=JSON.parse(fs.readFileSync(path.join(root,'data/scene.json'),'utf8')).octagon;
const config={...structuredClone(DEFAULT_CONFIG),scenario:arg('--scenario','video_model'),duration:Math.min(source.duration,Number(arg('--duration',String(source.duration))))};
const started=performance.now(),session=new LiveSensingSession(source,{vertices:o.inside_vertices_xy_m,canvasZ:o.canvas_z_m,fenceHeight:o.fence_height_above_canvas_m},config,motion.fps);
session.advance(config.duration);const run=session.run(true);
const counts=Object.fromEntries(['camera','imu','uwb','isac'].map(type=>[type,run.measurements.filter(m=>m.sensor_type===type).length]));
const digest=createHash('sha256');for(const row of run.measurements)digest.update(JSON.stringify(row)+'\n');
const output={status:'PASS',date:new Date().toISOString(),input_asset:path.relative(root,file).replaceAll('\\','/'),input_asset_sha256:sha,seed:config.seed,mode:source.mode,duration_s:config.duration,
  source_frames:motion.frames.length,processed_source_frames:Math.floor(config.duration*motion.fps)+1,measurements:run.measurements.length,per_sensor:counts,
  events:run.events.length,withheld:run.events.filter(e=>e.verification_status==='WITHHELD').length,distances:run.distances.length,
  runtime_ms:performance.now()-started,api_calls_in_sensing:networkCalls,diagnostics:run.diagnostics,
  movement_events:run.movement_events??[],warnings:['SIMULATION ONLY; metric_valid=false; no independent expert labels or physical sensors'],errors:[],
  measurement_digest:digest.digest('hex'),digest_encoding:'JSON row + newline',process_memory_bytes:process.memoryUsage(),sample_measurement:run.measurements.find(m=>m.sensor_type==='camera'),sample_events:run.events.slice(0,5)};
fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(output,null,2)+'\n');
fs.writeFileSync(out.replace(/\.json$/,'.events.json'),JSON.stringify({input_asset_sha256:sha,events:run.events,movement_events:run.movement_events??[]},null,2)+'\n');
console.log(JSON.stringify({...output,movement_events:output.movement_events.length,sample_measurement:undefined,sample_events:undefined}));
