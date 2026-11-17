import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {AnimationMixer,Vector3} from '../vendor/three/build/three.module.js';
import {GLTFLoader} from '../vendor/three/examples/jsm/loaders/GLTFLoader.js';
const raw=fs.readFileSync(new URL('../assets/sensing/mma_joint_rig.glb',import.meta.url));
const gltf=await new GLTFLoader().parseAsync(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),'');
const motion=JSON.parse(gunzipSync(fs.readFileSync(new URL('../assets/sensing/motion.json.gz',import.meta.url))).toString());
const mixer=new AnimationMixer(gltf.scene);for(const clip of gltf.animations)mixer.clipAction(clip).play();
let maxError=0,count=0;
for(const time of [0,.8,12.4,30,72,100,149.44,179.84]){
  mixer.setTime(time);gltf.scene.updateMatrixWorld(true);
  for(let fi=0;fi<2;fi++){
    const rig=gltf.scene.getObjectByName('MMA_'+'AB'[fi]);assert.ok(rig,'Armature actor missing');
    for(let ji=0;ji<motion.joints.length;ji++){
      const name=motion.joints[ji],node=rig.children.find(n=>n.name===name||n.name===name+'_1');assert.ok(node,name);
      const p=node.getWorldPosition(new Vector3()),actual=[p.x,-p.z,p.y],expected=motion.frames[Math.round(time*25)][fi].slice(ji*3,ji*3+3);
      const error=Math.hypot(...actual.map((v,i)=>v-expected[i]));maxError=Math.max(maxError,error);count++;
    }
  }
}
assert.ok(maxError<.0001,`Joint rig must match numeric input; maximum error ${maxError}`);
const report={status:'PASS',tested_joint_positions:count,maximum_joint_position_error_m:maxError,scope:'12.5 Hz joint rig at exact decimated sample times; not visual mesh skinning accuracy'};
fs.writeFileSync(new URL(`../reports/${motion.source_kind==='video_derived'?'video_3d_replacement':'mma_3d_sensing_upgrade'}/rig_numeric_parity.json`,import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(report);
