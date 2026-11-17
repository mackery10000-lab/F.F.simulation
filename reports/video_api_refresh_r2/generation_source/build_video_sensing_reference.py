"""Fresh native-video reconstruction -> confidence-bearing motion-v2 candidate.

No synthetic scene plan and no sensing/classification output is an input.
Elevated landmarks use the reconstruction's assumed weak-perspective camera,
never a floor homography. MediaPipe world depth remains an unverified prior.
"""
from __future__ import annotations
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import numpy as np
from ff_tracking import MAP16

ROOT=Path(__file__).resolve().parents[1]
JOINTS=list(MAP16)+['left_heel','left_toe','right_heel','right_toe','nose','left_ear','right_ear']
EXTRA={'left_heel':(29,27,'left_ankle'),'left_toe':(31,27,'left_ankle'),'right_heel':(30,28,'right_ankle'),'right_toe':(32,28,'right_ankle'),'nose':(0,0,'head'),'left_ear':(7,0,'head'),'right_ear':(8,0,'head')}
def digest(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def write(p,v):
    p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(v,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8',newline='\n')
def build(reconstruction_root,output,report_file='reports/video_3d_replacement/reconstruction_run.json'):
    base=ROOT/reconstruction_root;raw=base/'data/reconstructed_motion.json';tracking_file=base/'data/tracking_2d.json';dense_file=base/'data/tracking_33.json'
    source=ROOT/'input/reference_fight.mp4';source_sha=digest(source)
    m=json.loads(raw.read_text(encoding='utf-8'));tracking=json.loads(tracking_file.read_text(encoding='utf-8'));dense=json.loads(dense_file.read_text(encoding='utf-8'))
    report=json.loads((base/'output/reconstruction_report.json').read_text(encoding='utf-8'))
    n=len(m['frames']);fps=m['fps'];z=m['canvas_z_m']
    if dense['source_sha256']!=source_sha or len(dense['records'])!=n or len(tracking['frames'])!=n:raise ValueError('Fresh video/tracking source binding mismatch')
    if n!=4500 or fps!=25 or not np.allclose(m['source_timestamps_seconds'],np.arange(n)/fps):raise ValueError('Full 180s native source coverage required')
    if report.get('inference_cache_reused'):raise ValueError('This replacement requires freshly executed source inference')
    poses=np.asarray(m['frames'],float).reshape(n,2,16,3);frames=np.zeros((n,2,len(JOINTS),3));frames[:,:,:16]=poses
    confidence=np.zeros((n,2,len(JOINTS)));records=[];rotations=[]
    camera=m['camera_model'];B=np.asarray(camera['basis'],float);normal=np.cross(B[0],B[1]);normal/=np.linalg.norm(normal)
    scale=np.asarray(camera['scale_px_per_display_m']);width=tracking['image_width'];height=tracking['image_height'];fallback=0;clamps=0
    for k,row in enumerate(dense['records']):
        rec=[];rots=[]
        for fi,person in enumerate(row['people']):
            meta=tracking['provenance'][k][fi];q=np.asarray(tracking['frames'][k][fi]);codes=meta['joint_sources'];detected=meta['source'].startswith('detected')
            confidence[k,fi,:16]=[float(q[j,2]) if detected and codes[j] in 'DM' else 0. for j in range(16)]
            p=poses[k,fi];positions={name:p[i].copy() for i,name in enumerate(MAP16)}
            landmarks=np.asarray(person['landmarks']) if person else None
            world=np.asarray(person['world_landmarks']) if person and person.get('world_landmarks') is not None else None
            for name,(index,anchor_mp,anchor_name) in EXTRA.items():
                valid=person is not None and person['source'].startswith('detected') and person['joint_sources'][index] in 'DM' and landmarks[index,2]>=.6 and detected
                if valid:
                    delta_image=(landmarks[index,:2]-landmarks[anchor_mp,:2])*[width,height]/scale[k]
                    delta=B.T@delta_image
                    if world is not None:
                        mp=world[index]-world[anchor_mp];prior=np.array([mp[0],-mp[2],-mp[1]])
                        delta+=normal*float(prior@normal)
                    # Anatomical bound is a local fitting prior, not new observation.
                    limit=.35 if 'toe' in name else .25
                    length=np.linalg.norm(delta)
                    if length>limit:delta*=limit/length;clamps+=1
                    point=positions[anchor_name]+delta;confidence[k,fi,JOINTS.index(name)]=float(landmarks[index,2])
                else:
                    fallback+=1;anchor=positions[anchor_name]
                    point=anchor+([-.06,0,-.02] if 'heel' in name else [.12,0,-.02] if 'toe' in name else [0,.07 if name=='left_ear' else -.07 if name=='right_ear' else 0,-.035 if 'ear' in name else 0])
                if 'heel' in name or 'toe' in name:point[2]=max(z,point[2])
                positions[name]=point;frames[k,fi,JOINTS.index(name)]=point
            # Legacy head was MP nose (0). V2 stores an estimated skull centre
            # from the ears and keeps the actual nose estimate as its own joint.
            left=confidence[k,fi,JOINTS.index('left_ear')];right=confidence[k,fi,JOINTS.index('right_ear')]
            if min(left,right)>=.6:
                frames[k,fi,3]=(positions['left_ear']+positions['right_ear'])/2;confidence[k,fi,3]=min(left,right)
            else:
                frames[k,fi,3]=p[3]+[0,0,.035];confidence[k,fi,3]=0
            forward=positions['nose']-frames[k,fi,3];yaw=float(np.arctan2(forward[1],forward[0])) if np.linalg.norm(forward[:2])>.02 else 0.
            rots.append([0.,0.,float(np.sin(yaw/2)),float(np.cos(yaw/2))])
            identity=.85 if detected and np.mean(confidence[k,fi,[0,4,7,10,13]])>.6 else .35 if detected else .15
            rec.append({'track_id':'AB'[fi],'persistent_skeleton_id':'fighter_'+'AB'[fi],'identity_confidence':identity,'identity_status':'video_estimate_unverified' if detected else 'source_occluded_uncertain','source':meta['source'],'joint_sources':codes,'script_prior':{'blocked':not detected}})
        records.append(rec);rotations.append(rots)
    if not np.isfinite(frames).all():raise ValueError('Nonfinite reconstruction')
    out={'schema':'ff_sensing_motion_v2','schema_version':'2.0','asset_id':base.name,'source_kind':'video_derived','source_sha256':source_sha,'axis':'Z-up','fps':fps,'frame_count':n,'joints':JOINTS,'frames':frames.reshape(n,2,-1).tolist(),'records':records,
         'source_timestamps_seconds':m['source_timestamps_seconds'],'canvas_z_m':z,'fighters':['alex_pereira','sean_strickland'],'track_ids':['A','B'],'units':'display_meters_not_measured','metric_valid':False,'sampling_policy':'endpoint_ik_v2',
         'coordinate':{'world_up':'Z','handedness':'right','length_unit':'m','time_unit':'s','quaternion_order':'xyzw','mat_surface_z_m':z},'root_rotations':rotations,
         'joint_quality':{name:{'confidence':float(np.mean(confidence[:,:,j])),'visible':None,'occluded':None,'provenance_kind':'estimated_3d'} for j,name in enumerate(JOINTS)},'joint_observation_confidence':np.round(confidence,6).tolist(),
         'frame_quality':[{'occluded':False,'camera_segment_id':sum(t<=k/fps for t in tracking['cut_times_source_seconds'])} for k in range(n)],
         'calibration_status':'UNVERIFIED_MONOCULAR_DEPTH_AND_SCALE','generator':{'tool':'track_fighters.py + build_video_sensing_reference.py','version':'video_v2','pose_model':report['model'],'external_generation_api_calls':0},
         'input_provenance':{'run_id':base.name,'source_observation_fps':fps,'interpolation_is_unmeasured':True,'sensing_feedback':False,'video_derived':True,'fresh_native_inference':True,'reconstruction_motion_sha256':digest(raw),'tracking_sha256':digest(tracking_file),'tracking33_sha256':digest(dense_file),'extra_joint_depth':'assumed weak-perspective inverse + MediaPipe prior; not measured','head_definition':'ear midpoint estimate; legacy head=MP0 preserved in nose'}}
    output=ROOT/output;output.mkdir(parents=True,exist_ok=True);packed=gzip.compress(json.dumps(out,separators=(',',':'),allow_nan=False).encode(),compresslevel=6,mtime=0);(output/'motion.json.gz').write_bytes(packed)
    result={'status':'CANDIDATE_VALIDATED_NOT_PUBLISHED','asset_sha256':hashlib.sha256(packed).hexdigest(),'source_video_sha256':source_sha,'source_kind':'video_derived','run_id':base.name,'reconstruction_root':base.relative_to(ROOT).as_posix(),'frames':n,'fps':fps,'duration_s':(n-1)/fps,'joints':len(JOINTS),'native_frame_coverage':[0,n-1],
            'fresh_pose_inference':True,'model':report['model'],'width':width,'height':height,'external_generation_api_calls':0,'extra_landmark_fallback_samples':fallback,'extra_offsets_bounded':clamps,
            'observation_coverage':{name:float(np.mean(confidence[:,:,j]>=.6)) for j,name in enumerate(JOINTS)},'tracking_quality':report['tracking_quality'],'geometry_quality':report.get('quality'),
            'difference_from_previous_video_reference':None,'metric_valid':False,'limitations':['Monocular estimated depth and scale','Clothing/temporal IDs not independently verified','Missing image landmarks stay non-observations even when a numeric visual hypothesis exists']}
    old=ROOT/'reports/mma_3d_sensing_upgrade/before/assets/sensing/motion.json.gz'
    if old.exists():
        previous=json.loads(gzip.decompress(old.read_bytes()));pold=np.asarray(previous['frames']).reshape(n,2,16,3);delta=np.linalg.norm(frames[:,:,:16]-pold,axis=-1)
        result['difference_from_previous_video_reference']={'old_sha256':digest(old),'changed_joint_samples':int(np.sum(delta>1e-10)),'changed_frames':int(np.sum(np.any(delta>1e-10,axis=(1,2)))),'maximum_coordinate_delta_display_m':float(delta.max()),'comparison_scope':'Different newly inferred 2D inputs; no independent accuracy claim'}
    write(output/'manifest.json',result);write(ROOT/report_file,result)
    print(json.dumps({k:result[k] for k in ['status','asset_sha256','frames','fps','joints','model','observation_coverage']},ensure_ascii=False))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--reconstruction-root',default='output/unified/video_refresh_20261117');parser.add_argument('--output',default='reports/video_3d_replacement/candidate');parser.add_argument('--report-file',default='reports/video_3d_replacement/reconstruction_run.json');a=parser.parse_args();build(a.reconstruction_root,a.output,a.report_file)
