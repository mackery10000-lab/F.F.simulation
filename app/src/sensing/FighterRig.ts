import * as THREE from 'three';
export interface FighterSpec {bones:string[];primary_child:Record<string,string>}
/** Existing 20 bones; rigid visual pieces are driven by those bones only. */
export function prepareFighter(scene:THREE.Group,spec:FighterSpec,parent:THREE.Group,index:number){
  const wrapper=new THREE.Group();wrapper.name=index?'B_SEAN_STRICKLAND_EXISTING_GLB':'A_ALEX_PEREIRA_EXISTING_GLB';
  wrapper.rotation.x=Math.PI/2;wrapper.add(scene);parent.add(wrapper);parent.updateMatrixWorld(true);
  const bones=new Map<string,THREE.Bone>();
  wrapper.traverse(node=>{if(node instanceof THREE.Bone)bones.set(node.name,node);if(node instanceof THREE.SkinnedMesh)node.frustumCulled=false;if(node.userData.ff_shell_legacy_rig_only)node.visible=false});
  if(bones.size!==20||spec.bones.some(name=>!bones.has(name)))throw Error('기존 20-bone 리그 대응이 다릅니다.');
  const binds=new Map(spec.bones.map(name=>[name,{position:bones.get(name)!.getWorldPosition(new THREE.Vector3()),quaternion:bones.get(name)!.getWorldQuaternion(new THREE.Quaternion())}]));
  const shells:{mesh:THREE.Mesh;kind:string;start:string;end?:string;radius:number}[]=[];
  wrapper.traverse(node=>{
    if(!(node instanceof THREE.Mesh)||!node.userData.ff_shell_kind)return;
    const {ff_shell_kind:kind,ff_shell_start:start,ff_shell_end:end,ff_shell_joint:joint,ff_shell_radius:radius}=node.userData;
    const a=binds.get(kind==='joint'?joint:start)?.position,b=end?binds.get(end)?.position:undefined;
    if(!a||kind==='segment'&&!b)throw Error('시각 메시의 기존 관절 연결 누락');
    const q=new THREE.Quaternion(),scale=new THREE.Vector3(1,1,1);
    if(b){const direction=b.clone().sub(a);scale.y=direction.length();q.setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize())}
    const frame=new THREE.Matrix4().compose(a,q,scale),transform=frame.clone().invert().multiply(node.matrixWorld);
    node.geometry=node.geometry.clone().applyMatrix4(transform);node.geometry.computeVertexNormals();node.matrixAutoUpdate=false;node.frustumCulled=false;
    shells.push({mesh:node,kind,start:kind==='joint'?joint:start,end,radius});
  });
  const update=(flat:number[],joints:string[])=>{
    if(flat.length!==joints.length*3||flat.some(v=>!Number.isFinite(v)))throw Error('유효한 모델 관절 좌표가 필요합니다.');
    const targets=new Map(joints.map((name,i)=>[name,new THREE.Vector3().fromArray(flat,i*3)]));
    for(const side of ['left','right'])for(const point of ['heel','toe']){
      const name=side+'_'+point,ankle=side+'_ankle';if(!targets.has(ankle))throw Error('발목 관절 누락');
      // Original rig-only foot offsets are unobserved visual geometry.
      targets.set(name,targets.get(ankle)!.clone().add(binds.get(name)!.position.clone().sub(binds.get(ankle)!.position)));
    }
    wrapper.updateMatrixWorld(true);
    for(const name of spec.bones){
      const bone=bones.get(name)!,bind=binds.get(name)!,target=targets.get(name);if(!target)throw Error('모션 관절 누락: '+name);
      const global=bind.quaternion.clone(),child=spec.primary_child[name];
      if(child){const rest=binds.get(child)!.position.clone().sub(bind.position),direction=targets.get(child)!.clone().sub(target);if(rest.lengthSq()>1e-10&&direction.lengthSq()>1e-10)global.premultiply(new THREE.Quaternion().setFromUnitVectors(rest.normalize(),direction.normalize()))}
      bone.position.copy(bone.parent!.worldToLocal(target.clone()));bone.quaternion.copy(bone.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(global));
      bone.scale.set(1,1,1);bone.updateMatrix();bone.updateMatrixWorld(true);
    }
    let jointError=0,shellEndpointError=0;const world=new THREE.Matrix4();
    for(const name of spec.bones)jointError=Math.max(jointError,bones.get(name)!.getWorldPosition(new THREE.Vector3()).distanceTo(targets.get(name)!));
    for(const shell of shells){
      const a=bones.get(shell.start)!.getWorldPosition(new THREE.Vector3()),q=new THREE.Quaternion(),scale=new THREE.Vector3(1,1,1);
      const b=shell.end?bones.get(shell.end)!.getWorldPosition(new THREE.Vector3()):undefined;
      if(b){const direction=b.clone().sub(a);scale.y=direction.length();if(scale.y<1e-8){shell.mesh.visible=false;continue}q.setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize())}
      shell.mesh.visible=true;world.compose(a,q,scale);shell.mesh.matrix.copy(shell.mesh.parent!.matrixWorld).invert().multiply(world);shell.mesh.updateMatrixWorld(true);
      shellEndpointError=Math.max(shellEndpointError,new THREE.Vector3().applyMatrix4(shell.mesh.matrixWorld).distanceTo(a));
      if(b)shellEndpointError=Math.max(shellEndpointError,new THREE.Vector3(0,1,0).applyMatrix4(shell.mesh.matrixWorld).distanceTo(b));
    }
    return {jointError,shellEndpointError,targets};
  };
  return {wrapper,bones,binds,shells,spec,index,update};
}
