/** Generator labels live only in this evaluation harness, outside sensing imports. */
import fs from 'node:fs';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {videoMotionSource} from '../sensing/adapters.ts';
import {LiveSensingSession} from '../sensing/live.ts';
import {DEFAULT_CONFIG} from '../sensing/sensors.ts';
const root=path.resolve(import.meta.dirname,'..'),read=(n:string)=>JSON.parse(fs.readFileSync(path.join(root,n),'utf8'));
const index=read('assets/sensing/scenes/index.json'),o=read('data/scene.json').octagon;
const results=[];globalThis.fetch=async()=>{throw Error('No external API in evaluation')};
for(const item of index.scenes){
  const bytes=fs.readFileSync(path.join(root,item.file));if(createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw Error('Scene hash mismatch');
  const motion=JSON.parse(gunzipSync(bytes).toString());motion.input_asset_sha256=item.sha256;
  const config={...structuredClone(DEFAULT_CONFIG),duration:6,scenario:'mma_v2'};
  const session=new LiveSensingSession(videoMotionSource(motion),{vertices:o.inside_vertices_xy_m,canvasZ:o.canvas_z_m,fenceHeight:o.fence_height_above_canvas_m},config);
  session.advance(6);const run=session.run(),events=run.movement_events!;
  results.push({scene:item.name,input_sha256:item.sha256,seed:config.seed,measurements:run.measurements.length,guards:[...new Set(events.filter(e=>e.actor_id==='A'&&e.event_type==='GUARD').map(e=>e.state_after))],stances:[...new Set(events.filter(e=>e.actor_id==='A'&&e.event_type==='STANCE').map(e=>e.state_after))],footwork:[...new Set(events.filter(e=>e.actor_id==='A'&&e.event_type==='FOOTWORK').map(e=>e.state_after))],switches:events.filter(e=>e.event_type==='SWITCH').length,withheld:events.filter(e=>e.abstention_reason).length,events:events.map(e=>({actor_id:e.actor_id,time:e.available_at,type:e.event_type,value:e.state_after,reason:e.abstention_reason})),sensor_counts:Object.fromEntries(['camera','imu','uwb','isac'].map(s=>[s,run.measurements.filter(m=>m.sensor_type===s).length]))});
}
fs.writeFileSync(path.join(root,'reports/mma_3d_sensing_upgrade/scene_evaluation.json'),JSON.stringify({status:'EXECUTED',scope:'Synthetic consistency evaluation; generator-derived scenarios, no independent labels. Missing classes are visible in per-scene results.',external_api_calls:0,results},null,2)+'\n');
console.log(JSON.stringify({scenes:results.length,measurements:results.reduce((s,r)=>s+r.measurements,0),results:results.map(({scene,guards,stances,footwork,switches})=>({scene,guards,stances,footwork,switches}))}));
