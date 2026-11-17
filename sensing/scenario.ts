import type {ActorState,Arena,Fighter,Hand,MotionSource,Pose,Punch,Vec3,WorldState} from './contracts.ts';
import {add,clamp,scale,sub,unit} from './math.ts';
export const SCENARIOS = [
  ['combination','반복 콤비네이션'],['single','단발 펀치'],['approach','접근 · 이탈'],
  ['exchange','동시 타격 교환'],['occlusion','카메라 가림'],['clinch','클린치 · 신원 불확실'],
  ['nlos','UWB NLOS · 케이지 압박'],['stance','스탠스 전환'],['feint','페인트 · 일반 움직임'],['kick','킥 · 테이크다운'],
] as const;
export interface TruthAction {time:number; fighter:Fighter;hand:Hand;action:Punch|'Feint'|'Kick'|'Takedown';duration:number;}
/** Evaluation-only action schedule. Never imported by fusion or tactics. */
export function truthSchedule(scenario:string,duration:number):TruthAction[]{
  const rows:TruthAction[]=[];
  for(let t=2;t<duration-.8;t+=6){
    const fighter:Fighter=Math.floor((t-2)/6)%2?'B':'A';
    const south=scenario==='stance'&&Math.floor(t/12)%2===1;
    const lead:Hand=south?'R':'L',rear:Hand=south?'L':'R';
    if(scenario==='approach'||scenario==='clinch')continue;
    if(scenario==='feint'||scenario==='kick'){rows.push({time:t,fighter,hand:lead,action:scenario==='feint'?'Feint':Math.floor(t/6)%2?'Kick':'Takedown',duration:.55});continue}
    rows.push({time:t,fighter,hand:lead,action:'Jab',duration:.38});
    if(scenario!=='single'){
      rows.push({time:t+.55,fighter,hand:rear,action:'Cross',duration:.4});
      rows.push({time:t+1.1,fighter,hand:lead,action:Math.floor(t/6)%3===2?'Uppercut':'Hook',duration:.44});
    }
    if(scenario==='exchange')rows.push({time:t+.03,fighter:fighter==='A'?'B':'A',hand:'L',action:'Jab',duration:.38});
  }
  return rows;
}
export function makePose(position:Vec3,facing:Vec3,stance:ActorState['stance'],action?:TruthAction,phase=0):Pose{
  const side:Vec3=[-facing[1],facing[0],0],at=(f:number,s:number,z:number)=>add(position,add(scale(facing,f),add(scale(side,s),[0,0,z])));
  const pose:Pose={pelvis:[...position],chest:at(0,0,.36),head:at(.04,0,.77),
    left_shoulder:at(0,.22,.48),right_shoulder:at(0,-.22,.48),left_elbow:at(.1,.3,.2),right_elbow:at(.1,-.3,.2),
    left_wrist:at(.18,.18,.56),right_wrist:at(.18,-.18,.56),left_ankle:at(stance==='ORTHODOX'?.2:-.2,.19,-.93),right_ankle:at(stance==='ORTHODOX'?-.2:.2,-.19,-.93)};
  pose.nose=at(.14,0,.77);pose.left_ear=at(.025,.08,.77);pose.right_ear=at(.025,-.08,.77);
  for(const side of ['left','right'] as const){pose[`${side}_heel`]=add(pose[`${side}_ankle`],add(scale(facing,-.075),[0,0,-.07]));pose[`${side}_toe`]=add(pose[`${side}_ankle`],add(scale(facing,.17),[0,0,-.07]))}
  if(action){
    const pulse=Math.sin(Math.PI*clamp(phase))**2,left=action.hand==='L',key=left?'left_wrist':'right_wrist';
    if(['Jab','Cross','Hook','Uppercut'].includes(action.action)){
      const hook=action.action==='Hook',upper=action.action==='Uppercut';
      pose[key]=at(.18+(hook?.43:upper?.41:.76)*pulse,(left?.18:-.18)+(hook?(left?1:-1)*.66*pulse:0),.56+(upper?.65*pulse:0));
      pose[left?'left_elbow':'right_elbow']=at(.1+.24*pulse,left?.3:-.3,.2+.16*pulse);
    }else if(action.action==='Feint')pose[key]=at(.18+.13*pulse,left?.18:-.18,.56);
    else if(action.action==='Kick'){pose.left_ankle=at(.8*pulse,.19,-.93+.8*pulse);pose.left_heel=add(pose.left_ankle,add(scale(facing,-.075),[0,0,-.07]));pose.left_toe=add(pose.left_ankle,add(scale(facing,.17),[0,0,-.07]));pose.left_wrist=at(.18,.18+.04*pulse,.56)}
    else{for(const j of Object.keys(pose) as (keyof Pose)[])pose[j]![2]-=.45*pulse;}
  }
  return pose;
}
export function createScenario(scenario:string,duration:number,arena:Arena):MotionSource{
  if(!SCENARIOS.some(([id])=>id===scenario))throw Error('Unknown scenario');
  const schedule=truthSchedule(scenario,duration);
  const positions=(t:number):[Vec3,Vec3]=>{
    const smooth=(u:number)=>{const x=clamp(u);return x*x*(3-2*x)};
    const cycle=((t%6)+6)%6,after=smooth((cycle-3.5)/1.4),before=smooth((cycle-.5)/1.3);
    let d=scenario==='approach'?2.3+1.1*Math.sin(t*.7):2.5-.8*before+.8*after;
    if(scenario==='clinch')d=.4+.06*Math.sin(t);
    const shift=scenario==='nlos'?2.7:0,angle=.12*Math.sin(t*.25),cx=.25*Math.sin(t*.19),cy=shift+.2*Math.cos(t*.17);
    return [[cx-Math.cos(angle)*d/2,cy-Math.sin(angle)*d/2,arena.canvasZ+1],[cx+Math.cos(angle)*d/2,cy+Math.sin(angle)*d/2,arena.canvasZ+1]];
  };
  return {duration,mode:'synthetic',description:'시드 기반 가상 경기 · 실제 영상/센서 측정 아님',at(time):WorldState{
    const t=clamp(time,0,duration),p=positions(t),prev=positions(t-.005),next=positions(t+.005);
    const actors=([0,1] as const).map(i=>{
      const id:Fighter=i?'B':'A',stance=scenario==='stance'&&Math.floor(t/12)%2===1?'SOUTHPAW':'ORTHODOX';
      const action=schedule.find(e=>e.fighter===id&&t>=e.time&&t<=e.time+e.duration);
      return {id,stance,pose:makePose(p[i],unit(sub(p[1-i],p[i])),stance,action,action?(t-action.time)/action.duration:0),velocity:scale(sub(next[i],prev[i]),100),identity:scenario==='clinch'?.25:1} as ActorState;
    });return {time:t,actors:actors as [ActorState,ActorState]};
  }};
}
