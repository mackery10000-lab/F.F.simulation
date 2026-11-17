import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {readSensingInput} from '../app/src/sensing-input.ts';
import {videoMotionSource} from '../sensing/adapters.ts';
import {DEFAULT_CONFIG} from '../sensing/sensors.ts';
import {LiveSensingSession} from '../sensing/live.ts';
const root=path.resolve(import.meta.dirname,'..');
test('packaged full-precision input, A/B joints and time drive actual sensing',()=>{
  const motion=readSensingInput(root),source=videoMotionSource(motion);
  assert.equal(motion.input_provenance.run_id,'video_refresh_20261117');
  assert.equal(motion.source_kind,'video_derived');assert.equal(motion.joints.length,23);
  assert.equal(motion.input_provenance.fresh_native_inference,true);
  assert.equal(motion.joint_observation_confidence.length,4500);
  assert.equal(motion.frames.length,4500);assert.equal(motion.fps,25);assert.equal(source.duration,179.96);
  assert.deepEqual(source.at(12.4).actors.map(a=>a.pose.pelvis),motion.frames[310].map((p:number[])=>p.slice(0,3)));
  const scene=JSON.parse(fs.readFileSync(path.join(root,'data/scene.json'),'utf8')).octagon;
  const session=new LiveSensingSession(source,{vertices:scene.inside_vertices_xy_m,canvasZ:scene.canvas_z_m,fenceHeight:scene.fence_height_above_canvas_m},{...structuredClone(DEFAULT_CONFIG),duration:source.duration,scenario:'video_model'},motion.fps);
  session.advance(1);const run=session.run(true);
  assert.ok(run.measurements.length>100);assert.ok(run.distances.length>1);
  assert.deepEqual([...new Set(run.measurements.map(m=>m.sensor_type))].sort(),['camera','imu','isac','uwb']);
  assert.ok(run.measurements.every(m=>m.input_asset_sha256===motion.input_asset_sha256));
});
test('changed runtime input fails integrity validation',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ff-sensing-integrity-'));
  try{
    fs.mkdirSync(path.join(temp,'assets/sensing'),{recursive:true});
    fs.copyFileSync(path.join(root,'assets/sensing/manifest.json'),path.join(temp,'assets/sensing/manifest.json'));
    fs.writeFileSync(path.join(temp,'assets/sensing/motion.json.gz'),'corrupted');
    assert.throws(()=>readSensingInput(temp),/integrity mismatch/);
  }finally{fs.rmSync(temp,{recursive:true,force:true})}
});
test('Git LF/CRLF checkout is accepted, actual text changes are rejected',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ff-sensing-checkout-'));
  try{
    const manifest=JSON.parse(fs.readFileSync(path.join(root,'assets/sensing/manifest.json'),'utf8'));
    for(const name of ['assets/sensing/manifest.json',...Object.keys(manifest.files)]){
      const target=path.join(temp,name);fs.mkdirSync(path.dirname(target),{recursive:true});
      const content=fs.readFileSync(path.join(root,name));
      fs.writeFileSync(target,/\.(json|ts|obj)$/.test(name)?content.toString('utf8').replace(/\r\n/g,'\n').replace(/\n/g,'\r\n'):content);
    }
    assert.equal(readSensingInput(temp).frames.length,4500);
    fs.appendFileSync(path.join(temp,'data/scene.json'),' ');
    assert.throws(()=>readSensingInput(temp),/integrity mismatch/);
  }finally{fs.rmSync(temp,{recursive:true,force:true})}
});
