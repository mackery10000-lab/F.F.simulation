import type {Arena,CameraValue,Device,ImuValue,IsacValue,Measurement,MotionSource,Pose,SensorType,SimulationConfig,UwbValue,Vec3} from './contracts.ts';
import {add,clamp,distance,dot,gaussian,horizontal,keyedRandom,mean,multilaterate,noisy,norm,scale,sub,unit} from './math.ts';
import {bodyFrame,stanceFeature,handFeatures} from './mma-features.ts';
import {EXTRA_JOINTS} from './contracts.ts';
export const DEFAULT_CONFIG:SimulationConfig={seed:42,duration:60,scenario:'combination',disabledDevices:[],fusionWindow:.16,combinationWindow:1.2,minPatternSamples:3,
  sensors:{camera:{enabled:true,hz:30,latency_ms:55,jitter_ms:5,clock_offset_ms:12,clock_correction_ms:12,dropout:.02,noise:.018},
    isac:{enabled:true,hz:64,latency_ms:25,jitter_ms:2,clock_offset_ms:-8,clock_correction_ms:-8,dropout:.01,noise:.025},
    uwb:{enabled:true,hz:20,latency_ms:35,jitter_ms:3,clock_offset_ms:20,clock_correction_ms:20,dropout:.02,noise:.04},
    imu:{enabled:true,hz:100,latency_ms:18,jitter_ms:2,clock_offset_ms:-15,clock_correction_ms:-15,dropout:.01,noise:.25}}};
export function makeDevices(arena:Arena):Device[]{
  const z=arena.canvasZ,center:Vec3=[0,0,z+1];
  return [...arena.vertices.map((p,i):Device=>({id:`CAM-${String(i+1).padStart(2,'0')}`,type:'camera',position:[p[0],p[1],z+arena.fenceHeight+.25],target:[...center],fov:100,role:'옥타곤 꼭짓점 · 안쪽/아래 관측'})),
    {id:'CAM-09',type:'camera',position:[0,0,z+6.5],target:[0,0,z],fov:95,role:'천장 중앙 수직 관측'},
    {id:'ISAC-TX',type:'isac',position:[-5.2,0,z+1.5],target:[0,0,z+1],role:'2×2 MIMO-OFDM 송수신기 · 5.8 GHz 개념 모델'},
    {id:'ISAC-RX',type:'isac',position:[0,5.2,z+1.5],target:[0,0,z+1],role:'보조 수신 노드 · 비공선 링크'},
    ...[[-5,-5],[5,-5],[5,5],[-5,5]].map((p,i):Device=>({id:`ANCHOR-${i+1}`,type:'uwb',position:[p[0],p[1],z+1.4],target:[...center],role:'좌표가 알려진 고정 앵커 · DS-TWR'})),
    ...(['A','B'] as const).flatMap(fighter=>[
      {id:`TAG-${fighter}`,type:'uwb' as const,position:[0,0,z+1] as Vec3,target:[...center] as Vec3,role:'허리 이동형 태그',fighter},
      ...(['L','R'] as const).map((hand):Device=>({id:`${fighter}-${hand}`,type:'imu',position:[0,0,z+1.5],target:[...center],role:'손목 3축 가속도 + 3축 자이로',fighter,hand})),
    ])] as Device[];
}
export function validateConfig(c:SimulationConfig){
  if(!Number.isInteger(c.seed)||!Number.isFinite(c.duration)||c.duration<1||c.duration>180)throw Error('Duration must be 1–180 seconds; seed must be an integer');
  if(!Number.isFinite(c.fusionWindow)||c.fusionWindow<.02||c.fusionWindow>.5||!Number.isFinite(c.combinationWindow)||c.combinationWindow<.1||c.combinationWindow>3||!Number.isInteger(c.minPatternSamples)||c.minPatternSamples<2)throw Error('Invalid analysis windows');
  for(const type of ['camera','imu','uwb','isac'] as const){const s=c.sensors[type];
    if(!s||Object.values(s).some(v=>typeof v==='number'&&!Number.isFinite(v))||s.hz<1||s.hz>240||s.dropout<0||s.dropout>1||s.noise<0||s.noise>5||s.latency_ms<0||s.latency_ms>2000||s.jitter_ms<0||s.jitter_ms>500||Math.abs(s.clock_offset_ms)>2000||Math.abs(s.clock_correction_ms)>2000)throw Error('Invalid sensor configuration: '+type);
  }
}
export function activeDevice(d:Device,c:SimulationConfig){return c.sensors[d.type].enabled&&!c.disabledDevices.includes(d.id);}
export function projectCameraPoint(device:Device,point:Vec3):[number,number]{
  const f=unit(sub(device.target,device.position)),cross=(a:Vec3,b:Vec3):Vec3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const right=unit(cross(f,Math.abs(f[2])>.99?[0,1,0]:[0,0,1])),up=unit(cross(right,f)),delta=sub(point,device.position),depth=dot(delta,f),tan=Math.tan((device.fov??100)*Math.PI/360);
  if(depth<=.01)return [-1,-1];
  return [.5+dot(delta,right)/(2*depth*tan*1.3),.5-dot(delta,up)/(2*depth*tan)];
}
function cameraValue(device:Device,source:MotionSource,t:number,fi:number,c:SimulationConfig,rng:()=>number):{value:CameraValue;q:number}{
  const state=source.at(t),actor=state.actors[fi],other=state.actors[1-fi],settings=c.sensors.camera;
  const forward=unit(sub(device.target,device.position)),toActor=unit(sub(actor.pose.chest,device.position));
  const inFov=dot(forward,toActor)>Math.cos((device.fov??100)/2*Math.PI/180);
  const toOther=unit(sub(other.pose.chest,device.position));
  const geometricOcclusion=dot(toActor,toOther)>.996&&distance(device.position,other.pose.chest)<distance(device.position,actor.pose.chest);
  const stress=c.scenario==='occlusion'&&t%12>1&&t%12<5&&device.id!=='CAM-09';
  const occluded=geometricOcclusion||stress||!!source.qualityAt?.(t).occluded;
  // Visibility and track association are separate quantities. Identity is checked
  // by consumers that associate anatomy with a fighter, never by the RF model.
  const q=clamp((inFov?(occluded?.18:.97):.05)-settings.noise*.3);
  const joints=Object.fromEntries(Object.entries(actor.pose).map(([key,p])=>[key,noisy(p,settings.noise*(occluded?4:1),rng)])) as Pose;
  const previous=source.at(Math.max(0,t-.08)).actors[fi],prev=previous.pose;
  const observed_joints=Object.fromEntries([...new Set([...Object.keys(joints),...EXTRA_JOINTS])].map(key=>[key,q>.5&&(actor.joint_confidence?.[key]??1)>=.6?(joints as Record<string,Vec3>)[key]??null:null]));
  const frame=bodyFrame(observed_joints),facing=frame?.forward??[0,0,0] as Vec3,side=frame?.side??[0,0,0] as Vec3;
  const wrists=(['L','R'] as const).flatMap(hand=>{
    const wrist=hand==='L'?'left_wrist':'right_wrist',shoulder=hand==='L'?'left_shoulder':'right_shoulder',relative=sub(joints[wrist],joints[shoulder]);
    const elbow=hand==='L'?'left_elbow':'right_elbow';
    if(!observed_joints[wrist]||!observed_joints[shoulder]||!observed_joints[elbow]||!frame)return [];
    // Both endpoints are noisy virtual observations; source stance/guard labels never cross this boundary.
    const before=noisy(prev[wrist],settings.noise,rng);
    const upper=sub(joints[shoulder],joints[elbow]),lower=sub(joints[wrist],joints[elbow]);
    const body_scale=distance(joints.left_shoulder,joints.right_shoulder)/.44;
    return [{hand,extension:dot(relative,facing),lateral:Math.abs(dot(relative,side)),vertical:relative[2],speed:t<.08||(previous.joint_confidence?.[wrist]??1)<.6?0:norm(scale(sub(joints[wrist],before),1/.08)),arm_length:norm(upper)+norm(lower),elbow_angle:Math.acos(clamp(dot(unit(upper),unit(lower)),-1,1)),body_scale}];
  });
  const projected=Object.fromEntries(Object.entries(joints).map(([name,p])=>[name,projectCameraPoint(device,p)]));
  const stance=q>.55?stanceFeature(observed_joints):'UNKNOWN',hands=wrists.map(w=>handFeatures(observed_joints,w.hand,w.speed,stance));
  const guard=hands.length===2&&hands.every(h=>h.state==='HEAD_PROTECT')?'HIGH_GUARD':hands.some(h=>h.state==='EXTENDED')?'TRANSITION':'UNKNOWN';
  return {q,value:{position:joints.pelvis,joints,observed_joints,observation_flags:['VIRTUAL_POSE_SENSOR_NOT_PIXEL_INFERENCE','NO_TRIANGULATION','UNVERIFIED_SCALE',...(!frame?['BODY_ORIENTATION_AMBIGUOUS']:[]),...(source.qualityAt?.(t).camera_segment_id?['CAMERA_SEGMENT_CHANGE']:[])],wrists,screen_position:projectCameraPoint(device,joints.pelvis),projected_joints:projected,stance:stance==='SQUARE'?'UNKNOWN':stance,guard,occluded,identity_confidence:actor.identity,fov_visible:inFov}};
}
function imuValue(device:Device,source:MotionSource,t:number,noise:number,rng:()=>number):ImuValue{
  const fi=device.fighter==='A'?0:1,key=device.hand==='L'?'left_wrist':'right_wrist',h=.01;
  const p=source.at(t).actors[fi].pose[key],before=source.at(Math.max(0,t-h)).actors[fi].pose[key],older=source.at(Math.max(0,t-2*h)).actors[fi].pose[key],oldest=source.at(Math.max(0,t-3*h)).actors[fi].pose[key];
  const acceleration=noisy(scale(add(sub(p,scale(before,2)),older),1/h**2),noise,rng);
  const jerk=norm(scale(sub(add(sub(p,scale(before,3)),scale(older,3)),oldest),1/h**3));
  const actor=source.at(t).actors[fi],elbow=actor.pose[device.hand==='L'?'left_elbow':'right_elbow'];
  const forearm=unit(sub(p,elbow)),prevArm=unit(sub(before,source.at(Math.max(0,t-h)).actors[fi].pose[device.hand==='L'?'left_elbow':'right_elbow']));
  const delta=scale(sub(forearm,prevArm),1/h),rotation:Vec3=[forearm[1]*delta[2]-forearm[2]*delta[1],forearm[2]*delta[0]-forearm[0]*delta[2],forearm[0]*delta[1]-forearm[1]*delta[0]];
  const angular_velocity=noisy(rotation,noise*.08,rng),peak=norm(acceleration),impact=clamp((jerk-500)/4500);
  return {hand:device.hand!,acceleration,angular_velocity,peak_acceleration:peak,angular_speed:norm(angular_velocity),jerk,impact_signature:impact,relative_impact_score:clamp(.65*peak/80+.35*impact)*100};
}
/** Segment/capsule proximity. A coarse RF obstacle, not electromagnetic tracing. */
export function torsoBlocksLink(start:Vec3,end:Vec3,pelvis:Vec3,chest:Vec3,radius=.22){
  const u=sub(end,start),v=sub(chest,pelvis),w=sub(start,pelvis),a=dot(u,u),b=dot(u,v),c=dot(v,v),d=dot(u,w),e=dot(v,w),den=a*c-b*b;
  let s=den>1e-10?clamp((b*e-c*d)/den):0,t=c>1e-10?clamp((b*s+e)/c):0;
  s=a>1e-10?clamp((b*t-d)/a):0;t=c>1e-10?clamp((b*s+e)/c):0;
  return distance(add(start,scale(u,s)),add(pelvis,scale(v,t)))<radius;
}
function uwbValue(device:Device,devices:Device[],source:MotionSource,t:number,c:SimulationConfig,rng:()=>number):{value:UwbValue;q:number}{
  const fi=device.fighter==='A'?0:1,state=source.at(t),actor=state.actors[fi],other=state.actors[1-fi],p=actor.pose.pelvis,noise=c.sensors.uwb.noise;
  const anchors=devices.filter(d=>d.id.startsWith('ANCHOR')&&activeDevice(d,c));
  const ranges=anchors.map((a,i)=>{const obstacle=c.scenario==='nlos'&&i<2,body=torsoBlocksLink(p,a.position,other.pose.pelvis,other.pose.chest),nlos=obstacle||body,bias=nlos?.35+Math.abs(gaussian(rng))*.2:0;
    const range=Math.max(.01,distance(a.position,p)+gaussian(rng)*noise+bias);return {anchor_id:a.id,range_m:range,tof_ns:range/299792458*1e9,nlos,nlos_reason:obstacle?'SCENARIO_OBSTACLE' as const:body?'OPPONENT_TORSO_PROXY' as const:null};});
  const fit=anchors.length>=3?multilaterate(anchors.map(a=>a.position),ranges.map(r=>r.range_m),ranges.map(r=>r.nlos?.15:1),p[2]):null;
  const error=fit?Math.max(noise,fit.residual)*(1+fit.geometry)+ranges.filter(r=>r.nlos).length*.12:Infinity;
  return {q:fit?clamp(.98-error*.8):0,value:{position:fit?.position??null,ranges,residual_m:fit?.residual??0,error_radius_m:Number.isFinite(error)?error:0,method:'DS-TWR'}};
}
function isacValue(devices:Device[],source:MotionSource,t:number,noise:number,rng:()=>number):IsacValue{
  const tx=devices.find(d=>d.id==='ISAC-TX')!,rx=devices.find(d=>d.id==='ISAC-RX')!,state=source.at(t),wavelength=299792458/5.8e9;
  const real:number[]=[],imag:number[]=[],links=Array.from({length:4},()=>({real:[] as number[],imag:[] as number[]}));let doppler=0,motion=0;
  const proxies=(actor:typeof state.actors[number])=>[actor.pose.pelvis,actor.pose.left_wrist,actor.pose.right_wrist,actor.pose.left_elbow,actor.pose.right_elbow,...[actor.pose.left_knee,actor.pose.right_knee].filter((v):v is Vec3=>!!v)];
  const paths=state.actors.flatMap(proxies);
  const prev=source.at(Math.max(0,t-.002)).actors.flatMap(proxies);
  paths.forEach((p,i)=>{const rate=((distance(tx.position,p)+distance(rx.position,p))-(distance(tx.position,prev[i])+distance(rx.position,prev[i])))/.002;motion+=Math.abs(rate);doppler+=rate/wavelength});
  for(let k=0;k<16;k++){
    for(let link=0;link<4;link++){
      let re=1+.12*Math.cos(k*.4+link*.2),im=.12*Math.sin(k*.4+link*.2); // static multipath
      const txElement=add(tx.position,[0,(Math.floor(link/2)-.5)*wavelength/2,0]),rxElement=add(rx.position,[0,(link%2-.5)*wavelength/2,0]);
      paths.forEach((p,i)=>{const length=distance(txElement,p)+distance(rxElement,p),phase=-2*Math.PI*(5.8e9+k*312500)*length/299792458+i*.37,amp=(i%3===0?.22:.12)/(1+length*.02);re+=amp*Math.cos(phase);im+=amp*Math.sin(phase)});
      links[link].real.push(re+gaussian(rng)*noise);links[link].imag.push(im+gaussian(rng)*noise);
    }
    real.push(mean(links.map(l=>l.real[k])));imag.push(mean(links.map(l=>l.imag[k])));
  }
  return {csi_real:real,csi_imag:imag,csi_links:links,amplitude:mean(real.map((r,i)=>Math.hypot(r,imag[i]))),phase:Math.atan2(imag[0],real[0]),doppler_hz:doppler/paths.length,motion_energy:motion/paths.length,snr_db:clamp(-20*Math.log10(Math.max(.001,noise)),0,60),subcarriers:16,mimo_links:4};
}
/** Incremental acquisition: sample cursors and device RNGs survive each live tick. */
export class MeasurementSampler {
  readonly devices:Device[];
  readonly diagnostics={generated:0,dropped:0,late:0};
  private streams:{device:Device;index:number;rng:()=>number}[];
  private source:MotionSource;
  private config:SimulationConfig;
  constructor(source:MotionSource,arena:Arena,config:SimulationConfig){
    this.source=source;this.config=config;
    validateConfig(config);this.devices=makeDevices(arena);
    this.streams=this.devices.filter(device=>activeDevice(device,config)&&!device.id.startsWith('ANCHOR')&&device.id!=='ISAC-RX'&&
      (device.type!=='isac'||activeDevice(this.devices.find(d=>d.id==='ISAC-RX')!,config)))
      .map(device=>({device,index:0,rng:keyedRandom(config.seed,device.id)}));
  }
  advance(until:number):Measurement[]{
    const measurements:Measurement[]=[],c=this.config,source=this.source,devices=this.devices;
    for(const stream of this.streams){
      const {device,rng}=stream,settings=c.sensors[device.type];
      const last=Math.floor(Math.min(until,source.duration,c.duration)*settings.hz+1e-8);
      for(;stream.index<=last;stream.index++){
        const t=stream.index/settings.hz;this.diagnostics.generated++;
        if(rng()<settings.dropout){this.diagnostics.dropped++;continue}
        const sensorTime=t+settings.clock_offset_ms/1000+gaussian(rng)*settings.jitter_ms/1000,commonTime=sensorTime-settings.clock_correction_ms/1000;
        const arrival=t+Math.max(0,settings.latency_ms+gaussian(rng)*settings.jitter_ms)/1000;
        const sourceFps=source.at(t).actors[0].motion_provenance?.source_fps;
        const base={timestamp:commonTime,sensor_timestamp:sensorTime,arrival_timestamp:arrival,timestamp_uncertainty:settings.jitter_ms/1000+Math.max(.5/settings.hz,sourceFps ? .5/sourceFps : 0),sensor_type:device.type,sensor_id:device.id,fighter_id:device.fighter??null,confidence:.95,data_quality:.95,source_type:'simulated_sensor' as const,simulation_flag:true as const,input_mode:source.mode,input_asset_sha256:source.asset_sha256,seed:c.seed,metric_valid:source.metric_valid??source.mode==='synthetic',measurement_id:`${device.id}:${stream.index}`,coordinate_frame:'world_Z_up' as const,provenance:device.type==='imu'?'synthetic position differences; world-frame linear acceleration, forearm-axis gyro approximation; no recovered high-frequency observation':'local geometric virtual sensor',validity:'VALID' as const};
        const video=source.metric_valid===false||source.mode==='video_derived';
        if(device.type==='camera')for(const fi of [0,1]){const {value,q}=cameraValue(device,source,t,fi,c,rng);measurements.push({...base,measurement_id:`${device.id}:${stream.index}:${fi?'B':'A'}`,fighter_id:fi?'B':'A',measurement_type:'synthetic_pose',measurement_value:value,measurement_unit:video?'display units / normalized image':'m / normalized image',confidence:q,data_quality:q,validity:q>.5?'VALID':'DEGRADED'})}
        else if(device.type==='imu')measurements.push({...base,measurement_type:'wrist_kinematics',measurement_value:imuValue(device,source,t,settings.noise,rng),measurement_unit:video?'display units/s²; rad/s (model)':'m/s²; rad/s',confidence:clamp(.98-settings.noise*.03),data_quality:clamp(.98-settings.noise*.03)});
        else if(device.type==='uwb'){const {value,q}=uwbValue(device,devices,source,t,c,rng);measurements.push({...base,measurement_type:'tag_position',measurement_value:value,measurement_unit:video?'display units; model ToF ns (assumed scale)':'m; ns',confidence:q,data_quality:q})}
        else measurements.push({...base,measurement_type:'complex_csi',measurement_value:isacValue(devices,source,t,settings.noise,rng),measurement_unit:video?'complex a.u.; model Doppler Hz (assumed scale)':'complex a.u.; Hz',confidence:clamp(.94-settings.noise),data_quality:clamp(.94-settings.noise)});
      }
    }
    measurements.sort((a,b)=>a.arrival_timestamp-b.arrival_timestamp||a.timestamp-b.timestamp||a.sensor_id.localeCompare(b.sensor_id));
    this.diagnostics.late+=measurements.filter(m=>m.arrival_timestamp-m.timestamp>.25).length;
    return measurements;
  }
}
export function generateMeasurements(source:MotionSource,arena:Arena,c:SimulationConfig){
  const sampler=new MeasurementSampler(source,arena,c),measurements=sampler.advance(Math.min(source.duration,c.duration));
  return {devices:sampler.devices,measurements,diagnostics:{...sampler.diagnostics}};
}
