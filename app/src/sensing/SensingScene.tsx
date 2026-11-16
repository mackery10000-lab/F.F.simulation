import {useEffect,useMemo,useRef,useState} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {OBJLoader} from 'three/examples/jsm/loaders/OBJLoader.js';
import referenceObj from '../../../data/octagon_approx.obj?raw';
import type {CameraValue,SensorType,SimulationRun,Vec3} from '../../../sensing/contracts.ts';
import {observationsAt} from '../../../sensing/engine.ts';
import {activeDevice} from '../../../sensing/sensors.ts';
import {distanceAt} from '../../../sensing/tactics.ts';
import {videoMotionSource} from '../../../sensing/adapters.ts';
import type {ExistingMotion} from '../../../sensing/adapters.ts';
import {loadExistingFighters} from './ExistingFighters.ts';
export const COLORS:Record<SensorType,string>={camera:'#77b7ff',isac:'#b79aff',uwb:'#69ddc0',imu:'#ffbc73'};
export interface Layers {camera:boolean;isac:boolean;uwb:boolean;imu:boolean;fov:boolean;trails:boolean;}
const EDGES=[['pelvis','chest'],['chest','head'],['chest','left_shoulder'],['left_shoulder','left_elbow'],['left_elbow','left_wrist'],['chest','right_shoulder'],['right_shoulder','right_elbow'],['right_elbow','right_wrist'],['pelvis','left_ankle'],['pelvis','right_ankle']] as const;
function dispose(group:THREE.Object3D){const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>();group.traverse(node=>{if(node instanceof THREE.Mesh||node instanceof THREE.Line||node instanceof THREE.Sprite){if('geometry'in node)geometries.add(node.geometry);for(const material of Array.isArray(node.material)?node.material:[node.material]){materials.add(material);if('map'in material&&material.map instanceof THREE.Texture)textures.add(material.map)}}});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose())}
function label(text:string,color:string){
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=64;
  const c=canvas.getContext('2d')!,tex=new THREE.CanvasTexture(canvas);
  const paint=()=>{c.clearRect(0,0,256,64);c.font='600 28px Paperlogy';c.textAlign='center';c.fillStyle=color;c.fillText(text,128,40);tex.needsUpdate=true};
  paint();void document.fonts.load('600 28px Paperlogy',text).then(paint,()=>{});
  tex.colorSpace=THREE.SRGBColorSpace;const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,depthTest:false}));
  sprite.userData.fontFamily='Paperlogy';sprite.scale.set(1.25,.31,1);return sprite;
}
function line(points:Vec3[],color:string,opacity=1){return new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map(p=>new THREE.Vector3(...p))),new THREE.LineBasicMaterial({color,transparent:opacity<1,opacity}))}
function signature(group:THREE.Group){let h=2166136261,count=0;group.traverse(node=>{if(node instanceof THREE.Mesh){const a=node.geometry.attributes.position.array;for(const v of a){h=Math.imul(h^Math.round(v*1e5),16777619);count++}for(const v of node.matrix.elements)h=Math.imul(h^Math.round(v*1e5),16777619)}});return `${count}:${(h>>>0).toString(16)}`}
export function SensingScene({run,time,layers,selected,onSelect,motion,cameraView=false}:{run:SimulationRun;time:number;layers:Layers;selected:string;onSelect:(id:string)=>void;motion?:ExistingMotion;cameraView?:boolean}){
  const source=useMemo(()=>motion?videoMotionSource(motion):null,[motion]);
  const [follow,setFollow]=useState(false);
  const mount=useRef<HTMLDivElement>(null),engine=useRef<{update:()=>void;reset:()=>void;top:()=>void}|null>(null),props=useRef({run,time,layers,selected,onSelect,motion,source,cameraView,follow});props.current={run,time,layers,selected,onSelect,motion,source,cameraView,follow};
  const [error,setError]=useState('');
  useEffect(()=>{
    const container=mount.current!;let renderer:THREE.WebGLRenderer;
    try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:true})}catch(e){setError('WebGL을 사용할 수 없습니다. 아래 수치·미니맵으로 계속 분석할 수 있습니다. '+String(e));return}
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.7));container.appendChild(renderer.domElement);
    const scene=new THREE.Scene();scene.background=new THREE.Color('#111525');
    const camera=new THREE.PerspectiveCamera(43,1,.1,100);camera.up.set(0,0,1);camera.position.set(12,-15,15);
    const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,0,2);controls.minDistance=5;controls.maxDistance=35;controls.update();
    scene.add(new THREE.HemisphereLight(0xe3f3ff,0x445566,2.8));const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(3,-4,14);scene.add(light);
    // Load the repository's existing static OBJ verbatim. No geometry, material,
    // transform, texture or visibility edits are made to this reference group.
    const reference=new OBJLoader().parse(referenceObj);reference.name='STATIC_REFERENCE_UNCHANGED';scene.add(reference);
    const originalSignature=signature(reference);
    const fighterGroup=new THREE.Group();fighterGroup.name='EXISTING_PEREIRA_STRICKLAND_MODELS';scene.add(fighterGroup);
    let fighters:Awaited<ReturnType<typeof loadExistingFighters>>|null=null,alive=true;
    void loadExistingFighters(fighterGroup).then(value=>{if(!alive){dispose(fighterGroup);return}fighters=value;container.dataset.models='existing-glb-loaded';engine.current?.update()}).catch(e=>{if(alive)setError('가상 경기장 연결 오류: '+String(e))});
    const overlays=new THREE.Group();overlays.name='INDEPENDENT_SENSOR_OVERLAY';scene.add(overlays);
    const fixed=new THREE.Group(),moving=new THREE.Group();overlays.add(fixed,moving);
    let lastDevices:SimulationRun['devices']|null=null,lastView='';const deviceNodes=new Map<string,THREE.Group>(),fovs=new Map<string,THREE.Object3D>();
    const draw=()=>renderer.render(scene,camera);
    const rebuild=()=>{dispose(fixed);fixed.clear();deviceNodes.clear();fovs.clear();const {run}=props.current;
      for(const d of run.devices.filter(d=>!d.fighter)){
        const group=new THREE.Group();group.userData.id=d.id;const color=COLORS[d.type];
        const mesh=new THREE.Mesh(d.type==='camera'?new THREE.BoxGeometry(.24,.35,.22):new THREE.SphereGeometry(.14,10,8),new THREE.MeshStandardMaterial({color,emissive:color,emissiveIntensity:.35}));group.add(mesh);group.position.set(...d.position);
        const caption=label(d.id,color);caption.position.z=.4;group.add(caption);fixed.add(group);deviceNodes.set(d.id,group);
        if(d.type==='camera'){
          const c=new THREE.PerspectiveCamera(d.fov??100,1.3,.1,5.5);c.up.set(0,0,1);c.position.set(...d.position);c.lookAt(...d.target);c.updateMatrixWorld();
          const helper=new THREE.CameraHelper(c),fovGroup=new THREE.Group();fovGroup.add(helper);fixed.add(fovGroup);fovs.set(d.id,fovGroup);
          const pts=[[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]].map(p=>new THREE.Vector3(...p).unproject(c)),vertices:number[]=[];
          pts.forEach((p,i)=>vertices.push(...d.position,...p.toArray(),...pts[(i+1)%4].toArray()));
          const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));const volume=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color,transparent:true,opacity:.045,side:THREE.DoubleSide,depthWrite:false}));fovGroup.add(volume);
        }
      }lastDevices=run.devices;
    };
    const update=()=>{
      const {run,time,layers,selected,motion,source,cameraView,follow}=props.current;if(lastDevices!==run.devices)rebuild();
      if(motion&&fighters){fighters.update(motion,time);container.dataset.modelJointError=String(fighters.maximumJointError);container.dataset.shellEndpointError=String(fighters.maximumShellEndpointError);container.dataset.visualVersion=fighters.visualVersion}
      const state=source?.at(time),viewKey=cameraView?selected:follow?'follow':'arena';
      controls.enabled=!cameraView;
      if(viewKey!==lastView){const d=run.devices.find(d=>d.id===selected);if(cameraView&&d?.type==='camera'){camera.up.set(...(d.id==='CAM-09'?[0,1,0]:[0,0,1]) as [number,number,number]);camera.position.set(...d.position);camera.lookAt(...d.target);camera.fov=d.fov??100;camera.updateProjectionMatrix()}else{camera.up.set(0,0,1);camera.fov=43;camera.position.set(8,-11,11);controls.target.set(0,-1.5,2);controls.update();camera.updateProjectionMatrix()}lastView=viewKey}
      if(follow&&!cameraView&&state){const [a,b]=state.actors.map(a=>a.pose.pelvis),center=new THREE.Vector3((a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2+.15);camera.position.copy(center).add(new THREE.Vector3(3.3,-4.2,3));controls.target.copy(center);controls.update()}
      deviceNodes.forEach((group,id)=>{const d=run.devices.find(d=>d.id===id)!;group.visible=layers[d.type];group.scale.setScalar(id===selected?1.4:1);const mesh=group.children[0] as THREE.Mesh;(mesh.material as THREE.MeshStandardMaterial).opacity=activeDevice(d,run.config)?1:.25;(mesh.material as THREE.MeshStandardMaterial).transparent=true});
      fovs.forEach((group,id)=>group.visible=layers.camera&&layers.fov&&activeDevice(run.devices.find(d=>d.id===id)!,run.config));
      dispose(moving);moving.clear();
      const observations=observationsAt(run,time),point=distanceAt(run.distances,time);
      for(const fighter of ['A','B'] as const){
        const color=fighter==='A'?'#ff986f':'#58c8ee',observation=observations.filter(m=>m.sensor_type==='camera'&&m.fighter_id===fighter&&m.confidence>.45).sort((a,b)=>b.confidence-a.confidence)[0];
        const pose=state?.actors[fighter==='A'?0:1].pose??(observation?.measurement_value as CameraValue|undefined)?.joints;
        if(pose){
          if(!motion){for(const [a,b] of EDGES)moving.add(line([pose[a],pose[b]],color,.9));const head=new THREE.Mesh(new THREE.SphereGeometry(.12,12,10),new THREE.MeshBasicMaterial({color}));head.position.set(...pose.head);moving.add(head)}
          const name=label(fighter==='A'?'A · PEREIRA':'B · STRICKLAND',color);name.position.set(pose.head[0],pose.head[1],pose.head[2]+.35);name.scale.multiplyScalar(1.3);moving.add(name);
          if(layers.camera){const d=run.devices.find(d=>d.id===(selected.startsWith('CAM')?selected:'CAM-09'))!;if(activeDevice(d,run.config))moving.add(line([d.position,pose.chest],COLORS.camera,.3))}
          for(const [hand,key] of [['L','left_wrist'],['R','right_wrist']] as const)if(layers.imu&&activeDevice(run.devices.find(d=>d.id===`${fighter}-${hand}`)!,run.config)){const marker=new THREE.Mesh(new THREE.SphereGeometry(.075,10,8),new THREE.MeshBasicMaterial({color:COLORS.imu}));marker.position.set(...pose[key]);marker.userData.id=`${fighter}-${hand}`;moving.add(marker)}
        }
        const p=point?.positions[fighter];
        if(p&&layers.uwb){const marker=new THREE.Mesh(new THREE.SphereGeometry(.12,12,10),new THREE.MeshBasicMaterial({color:COLORS.uwb}));marker.position.set(...p);marker.userData.id=`TAG-${fighter}`;moving.add(marker);const tag=label(`TAG-${fighter}`,color);tag.position.set(p[0],p[1],p[2]+1);moving.add(tag);
          const radius=point?.uncertainty?point.uncertainty/2:.05,ring=new THREE.Mesh(new THREE.RingGeometry(Math.max(.12,radius),Math.max(.14,radius+.035),40),new THREE.MeshBasicMaterial({color:COLORS.uwb,side:THREE.DoubleSide,transparent:true,opacity:.5}));ring.position.set(p[0],p[1],1.27);moving.add(ring);
          if(layers.trails){const trail=run.distances.filter(d=>d.time<=time&&d.time>time-5&&d.positions[fighter]).map(d=>{const v=d.positions[fighter]!;return [v[0],v[1],1.28] as Vec3});if(trail.length>1)moving.add(line(trail,color,.6))}
        }
      }
      if(layers.uwb&&point?.positions.A&&point.positions.B)moving.add(line([point.positions.A,point.positions.B],COLORS.uwb));
      if(layers.isac&&run.devices.filter(d=>d.type==='isac').every(d=>activeDevice(d,run.config))){const tx=run.devices.find(d=>d.id==='ISAC-TX')!,rx=run.devices.find(d=>d.id==='ISAC-RX')!;moving.add(line([tx.position,rx.position],COLORS.isac,.3));
        for(let i=1;i<=5;i++){const radius=i*.85+(time*.5)% .85,ring=new THREE.Mesh(new THREE.RingGeometry(radius,radius+.025,64),new THREE.MeshBasicMaterial({color:COLORS.isac,side:THREE.DoubleSide,transparent:true,opacity:.18}));ring.position.set(-3,0,1.3);moving.add(ring)}}
      container.dataset.referenceSignature=originalSignature;container.dataset.currentReferenceSignature=signature(reference);container.dataset.sensorTime=time.toFixed(2);container.dataset.sourceFrame=String(motion?Math.round(time*motion.fps):0);container.dataset.sourcePelvis=JSON.stringify(state?.actors.map(a=>a.pose.pelvis));container.dataset.poseTime=String(state?.time);container.dataset.sourceDuration=String(source?.duration);container.dataset.rawPelvis=JSON.stringify(motion?.frames[Math.round(time*motion.fps)]?.map(f=>f.slice(0,3)));draw();
    };
    const resize=()=>{const w=container.clientWidth,h=container.clientHeight;renderer.setSize(w,h);camera.aspect=w/Math.max(h,1);camera.updateProjectionMatrix();draw()};
    const observer=new ResizeObserver(resize);observer.observe(container);controls.addEventListener('change',draw);
    const click=(e:MouseEvent)=>{const bounds=renderer.domElement.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((e.clientX-bounds.left)/bounds.width*2-1,-(e.clientY-bounds.top)/bounds.height*2+1),camera);for(const hit of ray.intersectObjects(overlays.children,true)){let node:THREE.Object3D|null=hit.object;while(node){if(node.userData.id){props.current.onSelect(node.userData.id);return}node=node.parent}}};renderer.domElement.addEventListener('click',click);
    engine.current={update,reset(){camera.position.set(12,-15,15);controls.target.set(0,0,2);controls.update();draw()},top(){camera.position.set(0,-.01,24);controls.target.set(0,0,1.2);controls.update();draw()}};update();resize();
    void document.fonts.load('600 28px Paperlogy').then(()=>{if(alive)engine.current?.update()},()=>{});
    return ()=>{alive=false;engine.current=null;observer.disconnect();controls.dispose();renderer.domElement.removeEventListener('click',click);dispose(scene);renderer.dispose();renderer.domElement.remove()};
  },[]);
  useEffect(()=>engine.current?.update(),[run,time,layers,selected,motion,cameraView,follow]);
  return <div className="sn-stage"><div className="sn-stage-label"><span className="sn-live-dot"/> {cameraView?'LIVE CAMERA VIEW':'PEREIRA × STRICKLAND'} <b>LIVE SENSOR STREAM</b></div><div className="sn-scene" ref={mount} aria-label="가상 경기 센서 배치 및 실시간 관측"/>{error&&<p role="alert" className="sn-webgl-error">{error}</p>}<div className="sn-stage-bottom"><span>{cameraView?selected+' · 카메라 관측 시점':'드래그 회전 · 휠 확대 · 센서 클릭'}</span><div>{!cameraView&&<button aria-pressed={follow} onClick={()=>setFollow(v=>!v)}>{follow?'전체 센서':'선수 추적 확대'}</button>}<button onClick={()=>engine.current?.top()}>천장</button><button onClick={()=>{setFollow(false);engine.current?.reset()}}>시점 초기화</button></div></div><span className="sn-scale">센싱 시뮬레이션</span></div>;
}
