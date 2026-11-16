import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import manifest from '../../../assets/fighters/minimal_shell_v1/manifest.json';
import assetA from '../../../assets/fighters/minimal_shell_v1/fighter_A.glb?url';
import assetB from '../../../assets/fighters/minimal_shell_v1/fighter_B.glb?url';
import type {ExistingMotion} from '../../../sensing/adapters.ts';
import {sampleFlatMotion} from '../../../sensing/adapters.ts';
import {prepareFighter} from './FighterRig.ts';
/** Separate minimal visual version; original GLBs, bones and motion stay intact. */
export async function loadExistingFighters(parent:THREE.Group){
  const loader=new GLTFLoader();
  const actors=await Promise.all([assetA,assetB].map(async(url,index)=>{
    const gltf=await loader.loadAsync(url);return prepareFighter(gltf.scene,manifest.models[index],parent,index);
  }));
  let maximumJointError=0,maximumShellEndpointError=0;
  return {actors,visualVersion:manifest.model_style,get maximumJointError(){return maximumJointError},get maximumShellEndpointError(){return maximumShellEndpointError},update(motion:ExistingMotion,time:number){
    maximumJointError=0;maximumShellEndpointError=0;parent.updateMatrixWorld(true);
    for(const actor of actors){const result=actor.update(sampleFlatMotion(motion,time,actor.index),motion.joints);maximumJointError=Math.max(maximumJointError,result.jointError);maximumShellEndpointError=Math.max(maximumShellEndpointError,result.shellEndpointError)}
  }};
}
