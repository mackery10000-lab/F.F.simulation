"""Generation boundary only. LUNA plans -> local FK/IK -> real sensing asset.

No video upload, sensor output, classification result or evaluation enters prompts.
Re-running with --enable-luna-generation uses content-addressed validated plans.
Without that flag only existing validated plans or explicit synthetic fallback bake.
"""
from __future__ import annotations
import argparse
import gzip
import hashlib
import json
import math
import shutil
import time
from pathlib import Path
import jsonschema
from ff_ai_provider import PleumTransport, ProviderError

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / 'reports/mma_3d_sensing_upgrade'
ASSETS = ROOT / 'assets/sensing'
SCENES = [
    'orthodox_high','southpaw_high','lead_long_rear_high','rear_long_lead_high',
    'both_extended','mixed_head_movement','low_to_high','shell','cross_guard',
    'jab_recoil','sustained_long','step_switch','hop_switch','cross_step_negative',
    'torso_twist_negative','opponent_only_approach','step_in','step_out',
    'lateral_shuffle','pivot','circling','step_in_jab','angle_out_cross',
    'kick_check_negative','clinch_ambiguous','heavy_occlusion','id_crossing',
    'camera_cut','level_change','fast_combo',
]
RANGES = {'high_forward_m':(.08,.18),'high_height_m':(.66,.74),
          'long_reach_m':(.50,.57),'step_distance_m':(.30,.48),
          'pivot_angle_rad':(.45,.75),'switch_start_s':(1.2,1.8),
          'switch_duration_s':(.55,.8),'step_start_s':(1.1,1.7),
          'step_duration_s':(.65,1.0)}
DEFAULTS = {k:(a+b)/2 for k,(a,b) in RANGES.items()}
PROPERTIES = {'scene':{'type':'string','enum':SCENES},**{k:{'type':'number','minimum':a,'maximum':b} for k,(a,b) in RANGES.items()}}
PLAN_SCHEMA = {'type':'object','properties':{'plans':{'type':'array','items':{'type':'object','properties':PROPERTIES,'required':list(PROPERTIES),'additionalProperties':False},'minItems':1,'maxItems':5}},'required':['plans'],'additionalProperties':False}
JOINTS = ['pelvis','chest','neck','head','left_shoulder','left_elbow','left_wrist',
          'right_shoulder','right_elbow','right_wrist','left_hip','left_knee',
          'left_ankle','right_hip','right_knee','right_ankle','left_heel','left_toe',
          'right_heel','right_toe','nose','left_ear','right_ear']
EDGES = [('pelvis','chest'),('chest','neck'),('neck','head')]+[(f'{s}_{a}',f'{s}_{b}') for s in ['left','right'] for a,b in [('shoulder','elbow'),('elbow','wrist'),('hip','knee'),('knee','ankle'),('heel','toe')]]

def sha(data): return hashlib.sha256(data).hexdigest()
def write(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8',newline='\n')
def smooth(x):
    x=max(0,min(1,x));return x*x*x*(10+x*(-15+6*x))
def add(a,b):return [x+y for x,y in zip(a,b)]
def sub(a,b):return [x-y for x,y in zip(a,b)]
def mul(a,k):return [x*k for x in a]
def norm(a):return math.sqrt(sum(x*x for x in a))
def unit(a):return mul(a,1/max(1e-12,norm(a)))
def cross(a,b):return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]
def ik(a,b,l1,l2,pole):
    delta=sub(b,a);d=norm(delta)
    if not abs(l1-l2)+1e-6<d<l1+l2-1e-6:raise ValueError(f'IK endpoint unreachable: d={d:.6f}, max={l1+l2:.3f}')
    axis=unit(delta);v=sub(pole,mul(axis,sum(x*y for x,y in zip(pole,axis))));v=unit(v)
    x=(l1*l1-l2*l2+d*d)/(2*d);h=math.sqrt(max(0,l1*l1-x*x))
    return add(a,add(mul(axis,x),mul(v,h)))

def generate(enabled):
    cache=REPORT/'generation_cache';cache.mkdir(parents=True,exist_ok=True)
    audit={'enable_luna_generation':enabled,'provider':'pleumrouter','generation_calls':0,'successful_calls':0,'cache_hits':0,'calls':[],'errors':[],'source_kind':'synthetic','video_uploaded':False,'sensing_feedback':False,'cost_estimate':None,'cost_note':'Configured provider exposes no verified price; token usage recorded, no invented price.'}
    plans={};transport=None
    try:
        if enabled:
            transport=PleumTransport(timeout=120,retries=1);audit['model']=transport.model;audit['base_url']=transport.base
            entry=transport.entry(transport.model,'chat.generate')
            audit['capabilities']={k:entry.get(k) for k in ['id','operations','supported_parameters','revision','created']}
        batches=[SCENES[:1]]+[SCENES[i:i+5] for i in range(1,len(SCENES),5)]
        for ids in batches:
            prompt={'task':'Generate constrained synthetic MMA motion parameters for local two-bone IK, not fight labels or sensor analysis. Each scene is 6 seconds with fighters A/B. Z-up metres are modeling units only; metric calibration unverified. No video supplied. Arms lengths .32+.30m, high wrist close to chin, long wrist sustained, switching new lead must dwell, step has alternating support; pivot one planted foot; kick and torso-only twist are hard negatives. Select physically plausible, distinct parameters within supplied JSON schema. These values directly control wrist endpoints, foot displacement, transition timing and pelvis orientation in the baked real asset.', 'scene_ids':ids,'constraints':RANGES,'output':'One complete parameter object per requested scene; no extra scene.'}
            key=sha(json.dumps({'prompt':prompt,'schema':PLAN_SCHEMA,'model':transport.model if transport else 'configured'},sort_keys=True).encode())
            target=cache/(key+'.json')
            if target.exists():
                response=json.loads(target.read_text(encoding='utf-8'));audit['cache_hits']+=1
            elif enabled:
                audit['generation_calls']+=1;started=time.perf_counter()
                result,usage=transport.chat({'model':transport.model,'stream':False,'messages':[{'role':'user','content':json.dumps(prompt)}],'format':PLAN_SCHEMA,'options':{'num_predict':2500}})
                response=json.loads(result['message']['content']);jsonschema.validate(response,PLAN_SCHEMA)
                if sorted(p['scene'] for p in response['plans'])!=sorted(ids):raise ValueError('Response scene set mismatch')
                write(target,response);audit['successful_calls']+=1
                receipt={'request_sha256':key,'scenes':ids,'response_file':target.relative_to(ROOT).as_posix(),'response_sha256':sha(target.read_bytes()),'model':transport.model,**usage,'runtime_s':time.perf_counter()-started}
                write(target.with_suffix('.receipt.json'),receipt);audit['calls'].append(receipt)
                write(REPORT/'generation_manifest.json',audit)
                print(json.dumps({'generation_batch':ids,'status':'GENERATED','usage':usage},ensure_ascii=False),flush=True)
            else:
                response={'plans':[{'scene':name,**DEFAULTS} for name in ids]}
            jsonschema.validate(response,PLAN_SCHEMA)
            if sorted(p['scene'] for p in response['plans'])!=sorted(ids):raise ValueError('Cached scene set mismatch')
            plans.update({p['scene']:p for p in response['plans']})
    except (ProviderError,ValueError,jsonschema.ValidationError) as error:
        audit['errors'].append({'kind':getattr(error,'kind',type(error).__name__),'message':str(error)[:400]})
    for scene in SCENES:
        if scene not in plans:plans[scene]={'scene':scene,**DEFAULTS,'fallback':True}
    audit['status']='PASS' if len(plans)==len(SCENES) and not audit['errors'] and (audit['successful_calls']+audit['cache_hits']>0) else 'PARTIAL_LOCAL_SYNTHETIC'
    audit['model']=audit.get('model');audit['output_scenes']=len(plans);audit['capability_probe']='First scene production request also used as small structured-output probe; no redundant inference.'
    audit['plans']=plans
    audit['generation_calls_this_run']=audit['generation_calls'];audit['successful_calls_this_run']=audit['successful_calls']
    receipts=[json.loads(p.read_text(encoding='utf-8')) for p in cache.glob('*.receipt.json')]
    if receipts:
        audit['calls']=receipts;audit['generation_calls']=len(receipts);audit['successful_calls']=len(receipts)
        audit['total_tokens']=sum(r.get('usage',{}).get('total_tokens',0) for r in receipts)
    write(REPORT/'generation_manifest.json',audit);return plans,audit

def pose(scene,p,t,fi,z):
    """Continuous local FK body and exact-length two-bone arm/leg IK."""
    active=fi==0;u=smooth((t-.3)/.6)*smooth((5.9-t)/.6)
    step=smooth((t-p['step_start_s'])/p['step_duration_s'])*smooth((5.8-t)/.8)
    if scene=='id_crossing':step=smooth((t-1)/2)*smooth((6-t)/1.8)
    switch=smooth((t-p['switch_start_s'])/p['switch_duration_s'])*smooth((5.8-t)/.8)
    yaw0=0 if fi==0 else math.pi;yaw=yaw0;root=[-1.35 if fi==0 else 1.35,0,z+1.0]
    delta=.4;guard='high';lift=[0.,0.];body_yaw=0.;root_offset=[0.,0.]
    if active:
        if scene=='southpaw_high':delta=.4-.8*u
        if scene in ['lead_long_rear_high','mixed_head_movement','sustained_long']:guard='mixed'
        if scene=='rear_long_lead_high':guard='rear_long'
        if scene=='both_extended':guard='long'
        if scene=='low_to_high':guard='low';u*=1-smooth((t-2)/1)
        if scene=='shell':guard='shell'
        if scene=='cross_guard':guard='cross'
        if scene=='step_switch':delta=.4-.8*switch
        if scene=='hop_switch':
            delta=.4-.8*u+.8*switch
            lift=[.09*(math.sin(math.pi*smooth((t-p['switch_start_s'])/p['switch_duration_s']))+math.sin(math.pi*smooth((t-.3)/.6))+math.sin(math.pi*smooth((t-5.0)/.9))) ]*2
        if scene=='cross_step_negative':
            transient=math.exp(-((t-2)/.10)**2);delta=.4-.65*transient;lift=[.12*transient]*2
        if scene=='torso_twist_negative':body_yaw=p['pivot_angle_rad']*math.sin(t*1.5)*u
        if scene in ['step_in','step_out','step_in_jab']:root_offset[0]=p['step_distance_m']*step*(-1 if scene=='step_out' else 1)
        if scene=='lateral_shuffle':root_offset[1]=p['step_distance_m']*step
        if scene=='angle_out_cross':root_offset=[-.25*step,p['step_distance_m']*step]
        if scene=='pivot':yaw+=p['pivot_angle_rad']*step
        if scene=='circling':
            yaw+=p['pivot_angle_rad']*step;root_offset=[1.35*(1-math.cos(p['pivot_angle_rad']*step)),1.35*math.sin(p['pivot_angle_rad']*step)]
        if scene=='clinch_ambiguous':root_offset[0]=1.16*step
        if scene=='id_crossing':root_offset=[1.65*step,.22*step]
        if scene=='level_change':root[2]-=.25*step
        if scene=='kick_check_negative':lift[0]=.35*math.sin(math.pi*step)
    elif scene=='opponent_only_approach':root_offset[0]=p['step_distance_m']*step
    elif scene=='clinch_ambiguous':root_offset[0]=1.16*step
    elif scene=='id_crossing':root_offset=[1.65*step,.22*step]
    if norm(root_offset)>.01:root[2]-=.12*math.sin(math.pi*step)
    if fi==0:root=add(root,[root_offset[0],root_offset[1],0])
    else:root=add(root,[-root_offset[0],-root_offset[1],0])
    f=[math.cos(yaw),math.sin(yaw),0];s=[-f[1],f[0],0]
    torso_yaw=yaw+body_yaw;tf=[math.cos(torso_yaw),math.sin(torso_yaw),0];ts=[-tf[1],tf[0],0]
    roll=.3*u if active and scene=='shell' else .12*math.sin(t*2)*u if active and scene=='mixed_head_movement' else 0.
    def at(forward,side,height):
        side,height=side*math.cos(roll)-(height-.35)*math.sin(roll),.35+side*math.sin(roll)+(height-.35)*math.cos(roll)
        return add(root,add(mul(tf,forward),add(mul(ts,side),[0,0,height])))
    joints={'pelvis':root,'chest':at(0,0,.35),'neck':at(0,0,.63),'head':at(.04,0,.78),'nose':at(.14,0,.78),'left_ear':at(.025,.08,.78),'right_ear':at(.025,-.08,.78)}
    pulse=0.;hand=0
    if active and scene in ['jab_recoil','step_in_jab','angle_out_cross','fast_combo']:
        centers=[2.,2.7,3.4] if scene=='fast_combo' else [2.6]
        for i,center in enumerate(centers):
            v=max(0,1-abs(t-center)/.22)
            if v>pulse:pulse=math.sin(math.pi*v/2)**2;hand=i%2 if scene=='fast_combo' else int(scene=='angle_out_cross')
    for index,(side,sign) in enumerate([('left',1),('right',-1)]):
        shoulder=at(0,sign*.22,.48);w=[.13,sign*.17,.70]
        w=[a+(b-a)*u for a,b in zip(w,[p['high_forward_m'],sign*.17,p['high_height_m']])]
        target=list(w)
        if guard=='mixed' and index==0 or guard=='rear_long' and index==1 or guard=='long':target=[p['long_reach_m'],sign*.19,.54]
        if guard=='low':target=[.16,sign*.19,.12]
        if guard=='cross':target=[.13,-sign*.14,.65 if index==0 else .55]
        if guard=='shell':target=[.04,sign*.13,.65] if index==0 else [.14,-.12,.24]
        w=[a+(b-a)*u for a,b in zip(w,target)]
        if index==hand and pulse:w=[a+(b-a)*pulse for a,b in zip(w,[.57,sign*.17,.59])]
        wrist=at(*w)
        separation=sub(wrist,joints['head'])
        if norm(separation)<.18:wrist=add(joints['head'],mul(unit(separation),.18))
        joints[side+'_shoulder']=shoulder;joints[side+'_wrist']=wrist
        joints[side+'_elbow']=ik(shoulder,wrist,.32,.30,add(mul(ts,sign*.4),[0,0,-1]))
        hip=add(root,add(mul(s,sign*.16),[0,0,-.02]))
        # Root shifts transfer support sequentially. Feet are fixed until their swing.
        foot_shift=root_offset[:]
        if active and scene in ['step_in','step_out','step_in_jab','lateral_shuffle','angle_out_cross'] or not active and scene=='opponent_only_approach':
            start=p['step_start_s']+(0 if index==0 else .45);phase=max(0,min(1,(t-start)/p['step_duration_s']))
            amount=smooth(phase)*smooth((5.8-t)/.8)
            final=[x/max(step,1e-8) for x in root_offset] if step>0 else [0,0]
            foot_shift=[x*amount for x in final];lift[index]=.07*math.sin(math.pi*phase)*smooth((5.8-t)/.8)
        footroot=[(-1.35 if fi==0 else 1.35)+(foot_shift[0] if fi==0 else -foot_shift[0]),(foot_shift[1] if fi==0 else -foot_shift[1]),z+.07+lift[index]]
        ankle=add(footroot,add(mul(f,sign*delta/2),mul(s,sign*.19)))
        if active and scene=='step_switch':
            start=p['switch_start_s']+(0 if index==0 else p['switch_duration_s']*.45)
            phase=max(0,min(1,(t-start)/(p['switch_duration_s']*.55)))
            back=max(0,min(1,(t-5.0-index*.25)/.45))
            amount=smooth(phase)*(1-smooth(back))
            ankle=add([-1.35,0,z+.07],[sign*(.2-.4*amount),sign*.19,.09*(math.sin(math.pi*phase)+math.sin(math.pi*back))])
        if scene=='pivot' and active:
            # Rear ankle is the stationary pivot; other foot follows an arc.
            pivot=[-1.35-.2,-.19,z+.07]
            offset=[sign*.2+.2,sign*.19+.19,0]
            a=yaw-yaw0;ankle=add(pivot,[offset[0]*math.cos(a)-offset[1]*math.sin(a),offset[0]*math.sin(a)+offset[1]*math.cos(a),0])
        joints[side+'_hip']=hip;joints[side+'_ankle']=ankle
        joints[side+'_knee']=ik(hip,ankle,.54,.54,add(f,[0,0,.1]))
        joints[side+'_heel']=add(ankle,add(mul(f,-.075),[0,0,-.07]))
        joints[side+'_toe']=add(ankle,add(mul(f,.17),[0,0,-.07]))
    identity=.3 if scene=='clinch_ambiguous' and step>.6 or scene=='id_crossing' and step>.5 else 1.
    return joints,yaw,identity

def motion_for(name,plans,z,canonical=False):
    count=4500 if canonical else 151;frames=[];rotations=[];records=[];quality=[]
    for k in range(count):
        absolute=k/25;scene=SCENES[min(29,int(absolute//6))] if canonical else name;t=absolute%6 if canonical else absolute
        row=[];rotation=[];rec=[]
        for fi in [0,1]:
            j,yaw,identity=pose(scene,plans[scene],t,fi,z)
            row.append([v for key in JOINTS for v in j[key]]);rotation.append([0,0,math.sin(yaw/2),math.cos(yaw/2)])
            rec.append({'track_id':'AB'[fi],'persistent_skeleton_id':'fighter_'+'AB'[fi],'identity_confidence':identity,'identity_status':'synthetic_uncertain' if identity<.5 else 'synthetic_stable','script_prior':{'blocked':False}})
        frames.append(row);rotations.append(rotation);records.append(rec)
        quality.append({'occluded':scene=='heavy_occlusion' and 1<t<5,'camera_segment_id':int(t>3) if scene=='camera_cut' else 0})
    result={'schema':'ff_sensing_motion_v2','schema_version':'2.0','asset_id':'mma_v2_'+('canonical' if canonical else name),'source_kind':'synthetic',
            'source_sha256':None,'axis':'Z-up','fps':25,'frame_count':count,'joints':JOINTS,'frames':frames,'records':records,
            'source_timestamps_seconds':[k/25 for k in range(count)],'canvas_z_m':z,'fighters':['alex_pereira','sean_strickland'],'track_ids':['A','B'],
            'units':'m (synthetic modeling assumption, not independently calibrated)','metric_valid':False,'sampling_policy':'endpoint_ik_v2',
            'coordinate':{'world_up':'Z','handedness':'right','length_unit':'m','time_unit':'s','quaternion_order':'xyzw','mat_surface_z_m':z},
            'root_rotations':rotations,'frame_quality':quality,'joint_quality':{j:{'confidence':.8,'visible':None,'occluded':None,'provenance_kind':'synthetic'} for j in JOINTS},
            'calibration_status':'UNVERIFIED_SYNTHETIC_SCALE','generator':{'tool':'mma_motion_upgrade.py','version':'2','external_api_stage':'generation_only'},
            'input_provenance':{'run_id':'mma_motion_v2','source_observation_fps':0,'interpolation_is_unmeasured':True,'sensing_feedback':False,'video_derived':False}}
    plant_feet(result,name,canonical)
    return result

def plant_feet(m,name,canonical):
    """Offline contact planner: alternating planted support and raised foot swings.

    Entirely geometry-driven, before sensing. Preserve explicit kick/hop negatives.
    Re-solve exact-length legs and lower the pelvis when a support leg needs flexion.
    """
    for start in range(0,len(m['frames']),150 if canonical else len(m['frames'])):
        end=min(len(m['frames']),start+(150 if canonical else len(m['frames'])))
        scene=SCENES[start//150] if canonical else name
        if scene in ['kick_check_negative','hop_switch','cross_step_negative']:continue
        for fi in [0,1]:
            desired=[{n:row[fi][i*3:i*3+3] for i,n in enumerate(JOINTS)} for row in m['frames'][start:end]]
            anchors={s:list(desired[0][s+'_ankle']) for s in ['left','right']};swing=None;previous_side='right'
            duration=5 # 0.20s per foot swing at 25FPS; never frame based in sensing inference.
            for k,j in enumerate(desired):
                if swing is None:
                    errors={s:norm(sub(j[s+'_ankle'],anchors[s])) for s in anchors}
                    side='left' if previous_side=='right' else 'right'
                    if errors[side]<.025:side=max(errors,key=errors.get)
                    if errors[side]>.025:
                        stop=min(len(desired)-1,k+duration)
                        target=list(desired[-1 if k>=len(desired)-1-2*duration else stop][side+'_ankle']);target[2]=m['canvas_z_m']+.07
                        swing={'side':side,'start':k,'stop':stop,'from':anchors[side][:],'to':target};previous_side=side
                positions={s:list(v) for s,v in anchors.items()}
                if swing:
                    phase=(k-swing['start'])/(swing['stop']-swing['start']) if swing['stop']>swing['start'] else 1.;u=smooth(phase)
                    positions[swing['side']]=[a+(b-a)*u for a,b in zip(swing['from'],swing['to'])]
                    positions[swing['side']][2]+=.08*math.sin(math.pi*phase)
                    if k>=swing['stop']:anchors[swing['side']]=swing['to'];swing=None
                # Both planted endpoints can require a brief natural level change.
                drop=0.
                for side,ankle in positions.items():
                    hip=j[side+'_hip'];horizontal=math.hypot(hip[0]-ankle[0],hip[1]-ankle[1]);max_height=math.sqrt(max(.01,1.065**2-horizontal**2))
                    drop=max(drop,hip[2]-ankle[2]-max_height)
                if drop>0:
                    for n in JOINTS:
                        if not any(n.endswith('_'+part) for part in ['ankle','knee','heel','toe']):j[n][2]-=drop
                for side,ankle in positions.items():
                    old=j[side+'_ankle'];heading=unit(sub(j[side+'_toe'],j[side+'_heel']))
                    j[side+'_ankle']=ankle;j[side+'_heel']=add(ankle,add(mul(heading,-.075),[0,0,-.07]));j[side+'_toe']=add(ankle,add(mul(heading,.17),[0,0,-.07]))
                    j[side+'_knee']=ik(j[side+'_hip'],ankle,.54,.54,add(heading,[0,0,.1]))
                m['frames'][start+k][fi]=[v for n in JOINTS for v in j[n]]
            # Finish each episode at the shared neutral feet through a raised swing,
            # rather than snapping a planted foot at the concatenation boundary.
            terminal=max(0,len(desired)-11)
            first={n:m['frames'][start+terminal][fi][i*3:i*3+3] for i,n in enumerate(JOINTS)}
            for k in range(terminal,len(desired)):
                j={n:m['frames'][start+k][fi][i*3:i*3+3] for i,n in enumerate(JOINTS)}
                phase=(k-terminal)/max(1,len(desired)-1-terminal);u=smooth(phase)
                for side in ['left','right']:
                    target=desired[-1][side+'_ankle']
                    # desired[-1] may already have been retargeted; neutral foot is fixed by scene end.
                    target=[(-1.35 if fi==0 else 1.35)+(1 if fi==0 else -1)*(.2 if side=='left' else -.2),(1 if fi==0 else -1)*(.19 if side=='left' else -.19),m['canvas_z_m']+.07]
                    origin=first[side+'_ankle'];ankle=[a+(b-a)*u for a,b in zip(origin,target)]
                    if norm(sub(origin,target))>.005:ankle[2]+=.05*math.sin(math.pi*phase)
                    heading=unit(sub(j[side+'_toe'],j[side+'_heel']))
                    j[side+'_ankle']=ankle;j[side+'_heel']=add(ankle,add(mul(heading,-.075),[0,0,-.07]));j[side+'_toe']=add(ankle,add(mul(heading,.17),[0,0,-.07]));j[side+'_knee']=ik(j[side+'_hip'],ankle,.54,.54,add(heading,[0,0,.1]))
                m['frames'][start+k][fi]=[v for n in JOINTS for v in j[n]]

def qa(m):
    lengths={a+'-'+b:[] for a,b in EDGES};min_z=100;max_step=0;slip=[]
    previous=None
    for row in m['frames']:
        current=[]
        for flat in row:
            j={name:flat[i*3:i*3+3] for i,name in enumerate(JOINTS)};current.append(j)
            for a,b in EDGES:lengths[a+'-'+b].append(norm(sub(j[a],j[b])))
            min_z=min(min_z,*(j[n][2]-m['canvas_z_m'] for n in ['left_heel','left_toe','right_heel','right_toe']))
        if previous:
            for fi,j in enumerate(current):
                for name in JOINTS:max_step=max(max_step,norm(sub(j[name],previous[fi][name])))
                for name in ['left_heel','right_heel']:
                    if abs(j[name][2]-m['canvas_z_m'])<.005 and abs(previous[fi][name][2]-m['canvas_z_m'])<.005:slip.append(norm(sub(j[name],previous[fi][name]))*25)
        previous=current
    spans={key:max(values)-min(values) for key,values in lengths.items()}
    return {'status':'PASS' if min_z>=-1e-8 and max(spans.values())<1e-6 else 'FAILED','structural_gate':'finite coordinates, constant chain lengths, nonpenetrating foot soles','bone_length_span_m':spans,'minimum_foot_height_above_floor_m':min_z,'maximum_joint_frame_step_m':max_step,'contact_slip_max_m_s':max(slip,default=0),'contact_slip_mean_m_s':sum(slip)/max(1,len(slip)),'contact_quality':'WARN' if max(slip,default=0)>.25 else 'PASS','motion_speed_quality':'WARN' if max_step>.2 else 'PASS','contact_model_limitation':'Alternating foot planting uses a procedural support plan; rapid negatives and episode boundaries require visual review. Not a physics solver.','independent_3d_error':None}

def bake(plans,audit):
    before=REPORT/'before/assets/sensing/motion.json.gz'
    if not before.exists():
        before.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(ASSETS/'motion.json.gz',before)
    legacy=json.loads(gzip.decompress(before.read_bytes()));z=legacy['canvas_z_m']
    library=ASSETS/'scenes';library.mkdir(parents=True,exist_ok=True);index=[]
    for name in SCENES:
        m=motion_for(name,plans,z);m['generator']['model']=audit.get('model');quality=qa(m)
        if quality['status']!='PASS':raise ValueError('Motion quality gate failed: '+name)
        data=gzip.compress(json.dumps(m,separators=(',',':'),allow_nan=False).encode(),mtime=0);target=library/(name+'.json.gz');target.write_bytes(data)
        sidecar={'scene':name,'source_kind':'synthetic','evaluation_scope':'generator-derived consistency only','coverage_s':[0,6],'actors':['A','B'],'quality':quality,'motion_sha256':sha(data),'plan':plans[name],'generation_status':audit['status']}
        write(library/(name+'.quality.json'),sidecar);index.append({'name':name,'file':target.relative_to(ROOT).as_posix(),'sha256':sha(data),'source_kind':'synthetic'})
    m=motion_for('',plans,z,True);m['generator']['model']=audit.get('model');quality=qa(m)
    if quality['status']!='PASS':raise ValueError('Canonical motion quality gate failed')
    data=gzip.compress(json.dumps(m,separators=(',',':'),allow_nan=False).encode(),mtime=0);(ASSETS/'motion.json.gz').write_bytes(data)
    # Physically separate evaluation labels, never present in classifier input.
    write(library/'index.json',{'scenes':index,'schedule':[{'start_s':i*6,'end_s':(i+1)*6,'scene':name} for i,name in enumerate(SCENES)]})
    write(REPORT/'motion_quality.json',quality)
    write(ASSETS/'motion_v2_contract.json',{'schema_version':'2.0','layout':'legacy-compatible flat frames with extended joints; root_rotations xyzw and joint_quality metadata','required_joints':JOINTS,'coordinate':m['coordinate'],'provenance':m['joint_quality'],'canonical_sha256':sha(data),'visual_rig':'assets/fighters/minimal_shell_v1/manifest.json','joint_rig':'assets/sensing/mma_joint_rig.glb','joint_rig_visual_fps':12.5,'collision_proxy':'head/glove spheres and horizontal torso circles; QA approximation, not a contact solver','rf_proxy_joints':['pelvis','left_wrist','right_wrist','left_elbow','right_elbow','left_knee','right_knee']})
    manifest=json.loads((ASSETS/'manifest.json').read_text(encoding='utf-8'))
    manifest.update(run_id='mma_motion_v2',source_sha256=None,source_motion_file='assets/sensing/motion.json.gz',source_motion_sha256=sha(data),frame_count=4500,source_kind='synthetic',source_coordinates_modified=True,coordinate_precision='float64_json',units=m['units'],generation_status=audit['status'])
    manifest['files']['assets/sensing/motion.json.gz']=sha(data)
    manifest['files']['assets/sensing/motion_v2_contract.json']=sha((ASSETS/'motion_v2_contract.json').read_bytes())
    write(ASSETS/'manifest.json',manifest)
    old=legacy['frames'][310][0];new=m['frames'][310][0]
    write(REPORT/'02_ASSET_REPLACEMENT.json',{'old_sha256':sha(before.read_bytes()),'new_sha256':sha(data),'path':'assets/sensing/motion.json.gz','old_joint_count':len(legacy['joints']),'new_joint_count':len(JOINTS),'old_sample_frame_310_A':old,'new_sample_frame_310_A':new,'changed_legacy_coordinates':sum(a!=b for row1,row2 in zip(legacy['frames'],m['frames']) for a1,a2 in zip(row1,row2) for a,b in zip(a1,a2)),'coverage_s':[0,179.96],'scenes':len(index),'source_kind':'synthetic','original_video_reconstruction':'Not performed: video upload rights unverified; original retained in backup.','generation_status':audit['status']})
    print(json.dumps({'bake':'PASS','frames':4500,'joints':len(JOINTS),'scenes':len(index),'sha256':sha(data),'generation_status':audit['status']}),flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--enable-luna-generation',action='store_true');parser.add_argument('--bake-cached',action='store_true');args=parser.parse_args()
    if args.bake_cached:
        audit=json.loads((REPORT/'generation_manifest.json').read_text(encoding='utf-8'));plans=audit['plans']
    else:plans,audit=generate(args.enable_luna_generation)
    bake(plans,audit)
