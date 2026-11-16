/** Source-time motion processing. No sensors, labels or detector thresholds. */
export interface MotionData {
  fps:number;frames:number[][][];joints:string[];axis:string;
  source_timestamps_seconds?:number[];fighters?:string[];
  sampling_policy?:'linear_legacy'|'bone_hermite_v1'|'endpoint_ik_v1'|'endpoint_ik_v2';
}
export const EDGES=[['pelvis','chest'],['chest','neck'],['neck','head'],
  ['chest','left_shoulder'],['left_shoulder','left_elbow'],['left_elbow','left_wrist'],
  ['chest','right_shoulder'],['right_shoulder','right_elbow'],['right_elbow','right_wrist'],
  ['pelvis','left_hip'],['left_hip','left_knee'],['left_knee','left_ankle'],
  ['pelvis','right_hip'],['right_hip','right_knee'],['right_knee','right_ankle']] as const;
export const worldToGltf=([x,y,z]:readonly number[]):[number,number,number]=>[x,z,-y];
export const gltfToWorld=([x,y,z]:readonly number[]):[number,number,number]=>[x,-z,y];
const lerp=(a:number,b:number,u:number)=>a+(b-a)*u;
// Shape-preserving, C1 scalar tangents. No global smoothing or phase retiming.
function tangent(left:number,right:number){return left*right>0?2*left*right/(left+right):0}
function hermite(a:number,b:number,m0:number,m1:number,u:number){
  const u2=u*u,u3=u2*u;return (2*u3-3*u2+1)*a+(u3-2*u2+u)*m0+(-2*u3+3*u2)*b+(u3-u2)*m1;
}
export function validateMotion(d:MotionData){
  if(!d||d.axis!=='Z-up'||!Number.isFinite(d.fps)||d.fps<=0||d.fps>240||
    !Array.isArray(d.joints)||new Set(d.joints).size!==d.joints.length||!d.joints.includes('pelvis')||
    !Array.isArray(d.frames)||d.frames.length<2||d.frames.length>100000)throw Error('Finite Z-up A/B source motion required');
  if(d.fighters&&JSON.stringify(d.fighters)!=='["alex_pereira","sean_strickland"]')throw Error('Motion fighter ordering must remain A=Pereira, B=Strickland');
  for(const row of d.frames)if(!Array.isArray(row)||row.length!==2||row.some(p=>!Array.isArray(p)||p.length!==d.joints.length*3||p.some(v=>!Number.isFinite(v))))throw Error('Invalid motion frame/actor/joint coordinates');
  const times=d.source_timestamps_seconds;
  if(times&&(times.length!==d.frames.length||times.some((t,i)=>!Number.isFinite(t)||Math.abs(t-i/d.fps)>1e-7)))throw Error('Source timestamps must match the declared uniform FPS');
  if(d.sampling_policy&&!['linear_legacy','bone_hermite_v1','endpoint_ik_v1','endpoint_ik_v2'].includes(d.sampling_policy))throw Error('Unknown motion interpolation policy');
}

export function createMotionSampler(d:MotionData){
  validateMotion(d);
  const n=d.frames.length,joints=d.joints.length,width=joints*3;
  const edges=EDGES.map(([a,b])=>[d.joints.indexOf(a),d.joints.indexOf(b)]).filter(([a,b])=>a>=0&&b>=0);
  const covered=new Set([d.joints.indexOf('pelvis'),...edges.map(e=>e[1])]);
  const policy=d.sampling_policy??'endpoint_ik_v2';
  const chains=[['left_shoulder','left_elbow','left_wrist'],['right_shoulder','right_elbow','right_wrist'],
    ['left_hip','left_knee','left_ankle'],['right_hip','right_knee','right_ankle']].map(c=>c.map(name=>d.joints.indexOf(name))).filter(c=>c.every(i=>i>=0));
  const vectors=policy==='endpoint_ik_v2'?[]:([0,1] as const).map(fi=>{
    const values=new Float64Array(n*width),slopes=new Float64Array(n*width);
    for(let frame=0;frame<n;frame++)for(const [a,b] of edges)for(let k=0;k<3;k++)values[frame*width+b*3+k]=d.frames[frame][fi][b*3+k]-d.frames[frame][fi][a*3+k];
    for(const [,b] of edges)for(let k=0;k<3;k++)for(let frame=0;frame<n;frame++){
      const p=frame*width+b*3+k;
      const left=values[p]-values[Math.max(0,frame-1)*width+b*3+k],right=values[Math.min(n-1,frame+1)*width+b*3+k]-values[p];
      slopes[p]=frame===0?right:frame===n-1?left:tangent(left,right);
    }
    return {values,slopes};
  });
  const computeSample=(time:number,fi:number,report?:{body_fallback?:boolean;unsolved_chains?:string[]})=>{
    if(!Number.isFinite(time)||!Number.isInteger(fi)||fi<0||fi>1)throw Error('Finite source time and A/B actor index required');
    const raw=Math.max(0,Math.min(n-1,time*d.fps)),f=Math.abs(raw-Math.round(raw))<1e-9?Math.round(raw):raw,a=Math.floor(f),b=Math.min(n-1,a+1),u=f-a;
    // Preserve every original source key exactly; no new measurement is created.
    if(u<1e-10)return [...d.frames[a][fi]];
    const p=d.frames[a][fi],q=d.frames[b][fi],linear=p.map((v,k)=>v*(1-u)+q[k]*u);let out=[...linear];
    if(policy==='linear_legacy')return out;
    // Keep pelvis/root translation exactly the same as the existing pipeline.
    if(policy!=='endpoint_ik_v2')for(const [parent,child] of edges){
      const {values,slopes}=vectors[fi];
      const start=a*width+child*3,end=b*width+child*3;
      const v=[0,1,2].map(k=>hermite(values[start+k],values[end+k],slopes[start+k],slopes[end+k],u));
      const la=Math.hypot(...values.subarray(start,start+3)),lb=Math.hypot(...values.subarray(end,end+3));
      const length=lerp(la,lb,u);let norm=Math.hypot(...v);
      const dot=la*lb>1e-12?[0,1,2].reduce((sum,k)=>sum+values[start+k]*values[end+k],0)/(la*lb):1;
      if(dot<-.8&&la>1e-8&&lb>1e-8){
        // Do not normalize a near-zero antipodal chord into an impulse.
        // This minimum-arc display continuation is explicitly unobserved; a
        // source flip remains a quality warning, not an inferred true action.
        const x=[0,1,2].map(k=>values[start+k]/la),y=[0,1,2].map(k=>values[end+k]/lb),theta=Math.acos(Math.max(-1,Math.min(1,dot)));
        const tangent=y.map((value,k)=>value-dot*x[k]);let tn=Math.hypot(...tangent);
        if(tn<1e-8){tangent[0]=x[1];tangent[1]=-x[0];tangent[2]=0;if(Math.hypot(...tangent)<1e-8){tangent[0]=0;tangent[1]=x[2];tangent[2]=-x[1]}tn=Math.hypot(...tangent)}
        for(let k=0;k<3;k++)v[k]=Math.cos(theta*u)*x[k]+Math.sin(theta*u)*tangent[k]/tn;
        norm=Math.hypot(...v);
      }
      for(let k=0;k<3;k++)out[child*3+k]=out[parent*3+k]+(norm>1e-10?v[k]*length/norm:0);
    }
    if(policy==='endpoint_ik_v1'||policy==='endpoint_ik_v2'){
      const wanted=[...out];
      const boneLength=(flat:number[],a:number,b:number)=>Math.hypot(...[0,1,2].map(k=>flat[b*3+k]-flat[a*3+k]));
      const feasible=(pose:number[],a:number,c:number,upper:number,lower:number)=>{
        const span=Math.hypot(...[0,1,2].map(k=>linear[c*3+k]-pose[a*3+k]));
        return span>1e-9&&span>=Math.abs(upper-lower)-1e-8&&span<=upper+lower+1e-8;
      };
      // Wrist/ankle trajectories and their speed/acceleration remain the ORIGINAL
      // linear source path. Length correction must not manufacture sensor peaks.
      const lengths=chains.map(([a,b,c])=>[lerp(boneLength(p,a,b),boneLength(q,a,b),u),lerp(boneLength(p,b,c),boneLength(q,b,c),u)]);
      // V2 only changes the four hinges. All source body anchors, roots and
      // endpoints stay linear, preventing a feasibility-dependent body switch.
      if(policy==='endpoint_ik_v2')out=[...linear];
      const fallback=chains.some(([a,,c],i)=>!feasible(out,a,c,lengths[i][0],lengths[i][1]));
      if(fallback)out=[...linear];
      if(report){report.body_fallback=fallback;report.unsolved_chains=[]}
      for(let i=0;i<chains.length;i++){
        const [a,b,c]=chains[i],[upper,lower]=lengths[i];
        for(let k=0;k<3;k++)out[c*3+k]=linear[c*3+k];
        if(!feasible(out,a,c,upper,lower)){
          for(let k=0;k<3;k++)out[b*3+k]=linear[b*3+k];
          report?.unsolved_chains?.push(d.joints[b]);continue;
        }
        const delta=[0,1,2].map(k=>linear[c*3+k]-out[a*3+k]),span=Math.hypot(...delta),axis=delta.map(v=>v/span);
        const along=(upper*upper-lower*lower+span*span)/(2*span),height=Math.sqrt(Math.max(0,upper*upper-along*along));
        if(policy==='endpoint_ik_v2'){
          const dot=(a:number[],b:number[])=>a.reduce((s,v,k)=>s+v*b[k],0);
          const cross=(a:number[],b:number[])=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
          const normalize=(v:number[])=>{const n=Math.hypot(...v);return n>1e-10?v.map(x=>x/n):null};
          const pole=(flat:number[],targetAxis=axis)=>{
            const oldAxis=normalize([0,1,2].map(k=>flat[c*3+k]-flat[a*3+k]));if(!oldAxis)return null;
            const hinge=[0,1,2].map(k=>flat[b*3+k]-flat[a*3+k]),projection=dot(hinge,oldAxis);
            const oldPole=normalize(hinge.map((v,k)=>v-projection*oldAxis[k]));if(!oldPole)return null;
            // Parallel transport onto the current endpoint axis (Rodrigues).
            const v=cross(oldAxis,targetAxis),cos=dot(oldAxis,targetAxis);if(cos<-.999999)return null;
            const first=cross(v,oldPole),second=cross(v,first);
            return normalize(oldPole.map((value,k)=>value+first[k]+second[k]/(1+cos)));
          };
          let first=pole(p),last=pole(q);
          const midpointAxis=normalize([0,1,2].map(k=>(p[c*3+k]+q[c*3+k]-p[a*3+k]-q[a*3+k])/2));
          const referenceFirst=midpointAxis?pole(p,midpointAxis):null,referenceLast=midpointAxis?pole(q,midpointAxis):null;
          const largeTurn=[[a,b],[b,c]].some(([s,e])=>{
            const left=normalize([0,1,2].map(k=>p[e*3+k]-p[s*3+k])),right=normalize([0,1,2].map(k=>q[e*3+k]-q[s*3+k]));
            return !left||!right||dot(left,right)<0;
          });
          if(largeTurn||!first&&!last||!midpointAxis||referenceFirst&&referenceLast&&dot(referenceFirst,referenceLast)<-.8){
            // Opposing/undefined bend planes are not evidence of a real turn.
            // A >90-degree bone turn in one source frame is underdetermined too.
            // Keep the entire interval's original chain and flag it; this is a
            // geometry eligibility check, never a sensor or action threshold.
            for(let k=0;k<3;k++)out[b*3+k]=linear[b*3+k];
            report?.unsolved_chains?.push(d.joints[b]);continue;
          }
          first??=last!;last??=first;
          const perpendicular=cross(axis,first),angle=Math.atan2(dot(perpendicular,last),dot(first,last));
          const direction=first.map((value,k)=>Math.cos(angle*u)*value+Math.sin(angle*u)*perpendicular[k]);
          for(let k=0;k<3;k++)out[b*3+k]=out[a*3+k]+along*axis[k]+height*direction[k];
          continue;
        }
        let tangent=[0,1,2].map(k=>wanted[b*3+k]-out[a*3+k]);const projection=tangent.reduce((sum,v,k)=>sum+v*axis[k],0);
        tangent=tangent.map((v,k)=>v-projection*axis[k]);let norm=Math.hypot(...tangent);
        if(norm<1e-9){tangent=[-axis[1],axis[0],0];norm=Math.hypot(...tangent);if(norm<1e-9){tangent=[0,-axis[2],axis[1]];norm=Math.hypot(...tangent)}}
        for(let k=0;k<3;k++)out[b*3+k]=out[a*3+k]+along*axis[k]+height*tangent[k]/norm;
      }
    }
    // Unprovided joints are not invented. Unknown extra channels remain linear.
    return out;
  };
  // Cameras and finite differences repeatedly request the same source time.
  // Bound memory, retain exact time keys, and return copies so rendering cannot
  // mutate a later sensor input. Diagnostic requests always recompute reports.
  const cache=[new Map<number,number[]>(),new Map<number,number[]>()];
  const sample=(time:number,fi:number,report?:{body_fallback?:boolean;unsolved_chains?:string[]})=>{
    if(report||!Number.isFinite(time)||!Number.isInteger(fi)||fi<0||fi>1)return computeSample(time,fi,report);
    const prior=cache[fi].get(time);if(prior)return [...prior];
    const result=computeSample(time,fi);cache[fi].set(time,[...result]);
    if(cache[fi].size>256)cache[fi].delete(cache[fi].keys().next().value!);
    return result;
  };
  return {sample,policy,duration:(n-1)/d.fps,sourceFps:d.fps,
    provenance(time:number){const raw=Math.max(0,Math.min(n-1,time*d.fps)),f=Math.abs(raw-Math.round(raw))<1e-9?Math.round(raw):raw,a=Math.floor(f);return {
      kind:Math.abs(f-a)<1e-10?'SOURCE_2_5D_ESTIMATE':'INTERPOLATED_UNMEASURED',
      source_frames:[a,Math.min(n-1,a+1)],source_fps:d.fps,interpolation:policy,metric_valid:false,
      observed_new_frames:0,root_interpolation:'UNCHANGED_LINEAR',inferred_joint_count:covered.size};}};
}
const samplers=new WeakMap<MotionData,ReturnType<typeof createMotionSampler>>();
export function motionSampler(d:MotionData){let value=samplers.get(d);if(!value){value=createMotionSampler(d);samplers.set(d,value)}return value}
