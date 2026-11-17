/** Strictly causal MMA state/event inference. Public inputs are Measurements only. */
import type {CameraValue,Fighter,GuardState,Hand,HandGuardEvidence,Measurement,MovementEvent,MovementState,SimulationConfig,StanceState,UwbValue,Vec3} from './contracts.ts';
import {bodyFrame,handFeatures,MMA_THRESHOLDS as T,stanceFeature} from './mma-features.ts';
import type {Landmarks} from './mma-features.ts';
import {distance,dot,horizontal,norm,scale,sub} from './math.ts';
type Stable={value:string;candidate:string;since:number;lastChange:number;lastEvidence?:number;stableStance?:string;transitionStart?:number};
type Sample={time:number;joints:Landmarks;uwb:Vec3|null;yaw:number|null};
type Track={guard:Stable;stance:Stable;footwork:Stable;history:Sample[];lastGood:number;hands:Record<Hand,HandGuardEvidence>};
const stable=(value:string):Stable=>({value,candidate:value,since:0,lastChange:0});
const median=(v:number[])=>{v.sort((a,b)=>a-b);return v[Math.floor(v.length/2)]};
function handUnknown(hand:Hand){return handFeatures({},hand,null,'UNKNOWN')}
export class MovementTracker {
  readonly events:MovementEvent[]=[];
  states:MovementState[]=[];
  private latest=new Map<string,Measurement>();
  private tracks:Record<Fighter,Track>;
  private next=0;
  constructor(privateConfig:SimulationConfig,matSurfaceZ:number){
    this.config=privateConfig;this.floor=matSurfaceZ;
    const makeTrack=():Track=>({guard:stable('UNKNOWN'),stance:stable('UNKNOWN'),footwork:stable('UNKNOWN'),history:[],lastGood:-Infinity,hands:{L:handUnknown('L'),R:handUnknown('R')}});
    this.tracks={A:makeTrack(),B:makeTrack()};
  }
  private config:SimulationConfig;private floor:number;
  ingest(rows:Measurement[],now:number){
    // Arrival time orders availability; sensor timestamps beyond now cannot influence now.
    const sorted=rows.filter(m=>m.arrival_timestamp<=now&&m.timestamp<=now).sort((a,b)=>a.arrival_timestamp-b.arrival_timestamp);
    let index=0;
    for(;this.next<=now+1e-8;this.next=Math.round((this.next+.1)*10)/10){
      while(index<sorted.length&&sorted[index].arrival_timestamp<=this.next){const m=sorted[index++],key=m.sensor_id+':'+m.fighter_id,old=this.latest.get(key);if(!old||m.timestamp>=old.timestamp)this.latest.set(key,m)}
      this.update(this.next);
    }
    // Retain packets arriving after the last decisecond for the following update.
    while(index<sorted.length){const m=sorted[index++],key=m.sensor_id+':'+m.fighter_id,old=this.latest.get(key);if(!old||m.timestamp>=old.timestamp)this.latest.set(key,m)}
  }
  private transition(f:Fighter,kind:'GUARD'|'STANCE'|'FOOTWORK',candidate:string,t:number,dwell:number,evidence:Measurement[],hands:Record<Hand,HandGuardEvidence>,reason:string|null,details:Record<string,unknown>={}){
    const track=this.tracks[f],state=kind==='GUARD'?track.guard:kind==='STANCE'?track.stance:track.footwork;
    // A short gap does not erase an established state or manufacture fresh
    // evidence. Each analysis has its own expiry; missing feet still expire.
    if(candidate!=='UNKNOWN')state.lastEvidence=t;
    else if(state.value!=='UNKNOWN'&&t-(state.lastEvidence??-Infinity)<.3){state.candidate=state.value;state.since=t;return}
    if(candidate!==state.candidate){state.candidate=candidate;state.since=t;if(kind==='STANCE'&&state.value!==candidate)state.transitionStart??=t}
    if(candidate===state.value||candidate!=='UNKNOWN'&&t-state.since<dwell)return;
    const before=state.value;state.value=candidate;state.lastChange=t;
    const stance=track.stance.value,lead=stance==='ORTHODOX'?'L':stance==='SOUTHPAW'?'R':'UNKNOWN';
    const base:MovementEvent={event_id:`MMA-${f}-${kind}-${Math.round(t*1000)}`,actor_id:f,event_type:kind,state_before:before,state_after:candidate,start_s:state.since,end_s:t,onset_s:state.since,available_at:t,lead_foot:lead,lead_hand:lead,confidence:candidate==='UNKNOWN'?0:.7,calibrated:false,supporting_measurement_ids:evidence.map(m=>m.measurement_id??`${m.sensor_id}:${m.timestamp}`),contradictions:reason?[reason]:[],abstention_reason:reason,asset_hash:evidence.find(m=>m.input_asset_sha256)?.input_asset_sha256??null,seed:this.config.seed,simulation_flag:true,hit_status:'UNKNOWN',hands,details};
    this.events.push(base);
    if(kind==='STANCE'&&(candidate==='ORTHODOX'||candidate==='SOUTHPAW')){
      if(state.stableStance&&state.stableStance!==candidate&&t-(state.transitionStart??t)<2){
        const prev=state.stableStance==='ORTHODOX'?'L':'R';
        this.events.push({...base,event_id:base.event_id+'-SWITCH',event_type:'SWITCH',state_before:state.stableStance,start_s:state.transitionStart??state.since,details:{leadFootBefore:prev,leadFootAfter:lead,leadHandBefore:prev,leadHandAfter:lead,transition_start:state.transitionStart,transition_end:t,switch_mechanism:details.support_foot==='AIRBORNE'?'HOP_SWITCH':'STEP_SWITCH',temporal_confidence:.7,occlusion_flags:[],old_state:state.stableStance,new_state:candidate}});
      }
      state.stableStance=candidate;state.transitionStart=undefined;
    }
    if(kind==='STANCE'&&candidate==='UNKNOWN'&&reason==='NO_RECENT_VISIBLE_POSE'){state.stableStance=undefined;state.transitionStart=undefined}
  }
  private update(t:number){
    const observations=Object.fromEntries((['A','B'] as Fighter[]).map(f=>{
      const rows=[...this.latest.values()].filter(m=>m.sensor_type==='camera'&&m.fighter_id===f&&m.timestamp<=t&&t-m.timestamp<T.stale_s&&m.arrival_timestamp<=t&&m.confidence>=.55&&m.data_quality>=.55&&(m.measurement_value as CameraValue).identity_confidence>=.65&&!(m.measurement_value as CameraValue).occluded);
      const joints:Landmarks={};
      for(const key of new Set(rows.flatMap(m=>Object.keys((m.measurement_value as CameraValue).observed_joints??{})))){
        const points=rows.map(m=>(m.measurement_value as CameraValue).observed_joints?.[key]).filter((v):v is Vec3=>!!v);
        joints[key]=points.length>=2?[0,1,2].map(i=>median(points.map(p=>p[i]))) as Vec3:null;
      }
      const uwb=[...this.latest.values()].find(m=>m.sensor_type==='uwb'&&m.fighter_id===f&&m.timestamp<=t&&t-m.timestamp<T.stale_s&&m.confidence>.5);
      return [f,{rows,joints,uwb:uwb?(uwb.measurement_value as UwbValue).position:null}];
    })) as Record<Fighter,{rows:Measurement[];joints:Landmarks;uwb:Vec3|null}>;
    this.states=[];
    for(const f of ['A','B'] as Fighter[]){
      const {rows,joints:j,uwb}=observations[f],track=this.tracks[f],other=observations[f==='A'?'B':'A'].joints,b=bodyFrame(j);
      const prior=track.history.filter(h=>t-h.time>=.2).at(-1),dt=prior?t-prior.time:0;
      const visible=rows.length>=2&&!!j.head&&!!j.pelvis&&!!b;
      let guard:GuardState='UNKNOWN',stance:StanceState='UNKNOWN',footwork='UNKNOWN',reason:string|null=visible?null:'NO_RECENT_VISIBLE_POSE',support='UNCERTAIN';
      const hands={} as Record<Hand,HandGuardEvidence>;
      for(const hand of ['L','R'] as Hand[]){const key=hand==='L'?'left_wrist':'right_wrist',p=j[key],old=prior?.joints[key];hands[hand]=handFeatures(j,hand,p&&old&&dt>0?distance(p,old)/dt:null,track.stance.value);hands[hand].duration_s=t-track.guard.since}
      if(visible){
        track.lastGood=t;stance=stanceFeature(j);
        const states=Object.values(hands).map(h=>h.state),chest=j.chest!,left=j.left_wrist!,right=j.right_wrist!;
        if(states.includes('ATTACKING'))guard='TRANSITION';
        else if(left&&right&&dot(sub(left,chest),b!.side)<-.035&&dot(sub(right,chest),b!.side)>.035)guard='CROSS_GUARD';
        else if(states.every(v=>v==='HEAD_PROTECT'))guard='HIGH_GUARD';
        else if(states.includes('EXTENDED')&&states.includes('HEAD_PROTECT'))guard='MIXED_GUARD';
        else if(states.every(v=>v==='EXTENDED'))guard='LONG_GUARD';
        else if(states.every(v=>v==='LOW'))guard='LOW_GUARD';
        // Shell requires observed shoulder/torso configuration beyond hand height.
        else if(states.includes('LOW')&&states.includes('HEAD_PROTECT')){guard=j.left_shoulder&&j.right_shoulder&&Math.abs(j.left_shoulder[2]-j.right_shoulder[2])>.075?'SHELL_GUARD':'UNKNOWN';reason=guard==='UNKNOWN'?'SHELL_STYLE_NEEDS_SHOULDER_ROLL_EVIDENCE':null}
        else if(states.includes('EXTENDED')&&other.pelvis&&horizontal(j.pelvis!,other.pelvis)<.9){guard='POSSIBLE_FRAME';reason='CONTACT_UNVERIFIED'}
        if(prior&&j.pelvis&&prior.joints.pelvis&&b&&dt>0){
          const vel=scale(sub(j.pelvis,prior.joints.pelvis),1/dt),speed=Math.hypot(vel[0],vel[1]);
          const feet=['left','right'].map(side=>{const p=j[side+'_heel'],toe=j[side+'_toe'],old=prior.joints[side+'_heel'];return p&&toe&&old?{speed:distance(p,old)/dt,height:Math.min(p[2],toe[2])-this.floor}:null});
          const contacts=feet.map(v=>!!v&&Math.abs(v.height)<T.contact_height_m&&v.speed<T.foot_speed_m_s);
          support=contacts.every(Boolean)?'DOUBLE_SUPPORT':contacts[0]?'L_SUPPORT':contacts[1]?'R_SUPPORT':feet.every(v=>v&&v.height>.08)?'AIRBORNE':'UNCERTAIN';
          const bearing=other.pelvis?sub(other.pelvis,j.pelvis):null,bl=bearing?Math.hypot(bearing[0],bearing[1]):0;
          const toward=bearing&&bl>.1?(vel[0]*bearing[0]+vel[1]*bearing[1])/bl:0;
          const yaw=Math.atan2(b.forward[1],b.forward[0]),oldyaw=prior.yaw,yawRate=oldyaw===null?0:Math.atan2(Math.sin(yaw-oldyaw),Math.cos(yaw-oldyaw))/dt;
          const uwbVel=uwb&&prior.uwb?scale(sub(uwb,prior.uwb),1/dt):null;
          const conflict=uwbVel&&Math.hypot(vel[0]-uwbVel[0],vel[1]-uwbVel[1])>.9;
          if(conflict){footwork='UNKNOWN';reason='CAMERA_UWB_MOTION_CONFLICT'}
          else if(feet.some(v=>!v)){footwork='UNKNOWN';reason='FOOT_LANDMARKS_MISSING'}
          else if(support==='AIRBORNE'){footwork='UNKNOWN';reason='AIRBORNE_KICK_OR_HOP_UNRESOLVED'}
          else if(Math.abs(yawRate)>T.pivot_yaw_rad_s&&contacts.filter(Boolean).length===1&&speed<.25)footwork=yawRate>0?'PIVOT_LEFT':'PIVOT_RIGHT';
          else if(speed<T.step_speed_m_s)footwork='STATIONARY';
          else if(!feet.some(v=>v&&v.speed>.22)||!contacts.some(Boolean)){footwork='UNKNOWN';reason='NO_CONFIRMED_SUPPORT_TRANSFER'}
          else if(Math.abs(yawRate)>.15&&Math.abs(toward)<speed*.65)footwork=yawRate>0?'CIRCLE_LEFT':'CIRCLE_RIGHT';
          else if(Math.abs(toward)>speed*.65&&bl>.1)footwork=toward>0?'STEP_IN':'STEP_OUT';
          else footwork=dot(vel,b.side)>0?'STEP_LEFT':'STEP_RIGHT';
        }
        if(stance==='UNKNOWN'&&reason===null)reason='FOOT_HEIGHT_OR_ORIENTATION_AMBIGUOUS';
      }
      if(t-track.lastGood>T.stale_s){guard='UNKNOWN';stance='UNKNOWN';footwork='UNKNOWN';reason='NO_RECENT_VISIBLE_POSE'}
      this.transition(f,'GUARD',guard,t,T.guard_dwell_s,rows,hands,guard==='UNKNOWN'?reason:null);
      this.transition(f,'STANCE',stance,t,T.stance_dwell_s,rows,hands,stance==='UNKNOWN'?reason:null,{support_foot:support});
      this.transition(f,'FOOTWORK',footwork,t,T.footwork_dwell_s,rows,hands,footwork==='UNKNOWN'?reason:null,{support_foot:support});
      const held=guard==='UNKNOWN'&&track.guard.value!=='UNKNOWN'||stance==='UNKNOWN'&&track.stance.value!=='UNKNOWN'||footwork==='UNKNOWN'&&track.footwork.value!=='UNKNOWN';
      track.hands=hands;track.history.push({time:t,joints:j,uwb,yaw:b?Math.atan2(b.forward[1],b.forward[0]):null});track.history=track.history.filter(h=>t-h.time<=.6);
      this.states.push({actor_id:f,time:t,guard:track.guard.value as GuardState,stance:track.stance.value as StanceState,footwork:track.footwork.value,hands,confidence:visible&&!held?.7:0,abstention_reason:held?'RECENT_STATE_HELD_OBSERVATION_GAP':reason});
    }
  }
}
