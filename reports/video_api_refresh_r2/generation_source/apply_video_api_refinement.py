"""Fit bounded external image proposals to independent native observations.

Preserve unknown joints, depth ambiguity, source timestamps and all confidence.
Only local reprojection/bone/acceleration non-regression permits a correction.
"""
from __future__ import annotations
import copy
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import numpy as np
from scipy.optimize import minimize
from ff_reconstruction import project
from ff_tracking import MAP16, BONES

ROOT=Path(__file__).resolve().parents[1]
FOLDER=ROOT/'reports/autonomous_execution'
def read(p): return json.loads(p.read_text(encoding='utf-8'))
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def write(p,v):
    p.parent.mkdir(parents=True,exist_ok=True)
    p.write_text(json.dumps(v,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8')

def build(baseline_motion='assets/sensing/motion.json.gz',report_root=None,reconstruction_root=None,active_baseline_motion=None):
    global FOLDER
    if report_root is not None:FOLDER=ROOT/report_root
    asset=ROOT/baseline_motion;summary=read(FOLDER/'api_refinement/summary.json')
    if sha(asset)!=summary['baseline_motion_sha256']: raise ValueError('Baseline asset has changed')
    motion=json.loads(gzip.decompress(asset.read_bytes()));baseline=copy.deepcopy(motion)
    source=ROOT/(reconstruction_root or summary.get('reconstruction_root','output/unified/video_refresh_20261117'))/'data'
    native=read(source/'reconstructed_motion.json');tracking=read(source/'tracking_2d.json')
    camera=native['camera_model'];basis=np.asarray(camera['basis']);scales=np.asarray(camera['scale_px_per_display_m'])
    before=np.asarray(motion['frames']).reshape(4500,2,23,3);out=before.copy()
    observed=np.asarray(tracking['frames']);pixels=observed[:,:,:,:2]*[tracking['image_width'],tracking['image_height']]
    confidence=np.asarray(motion['joint_observation_confidence'])
    protected=(observed[:,:,:,2]>=.6)&(confidence[:,:,:16]>=.6)
    lengths=np.stack([np.linalg.norm(before[:,:,b]-before[:,:,a],axis=-1) for a,b in BONES],axis=-1)
    targets=np.median(lengths,axis=0)
    receipts=sorted((FOLDER/'api_refinement').glob('batch-*.json'))
    accepted=[];rejected={};attempted=0
    def reject(reason): rejected[reason]=rejected.get(reason,0)+1
    def score(p,s,e,fi,j):
        projection=project(p,camera)
        error=np.linalg.norm(projection[s:e,fi,j]-pixels[s:e,fi,j],axis=-1)
        bone=sum(np.sum((np.linalg.norm(p[s:e,fi,b]-p[s:e,fi,a],axis=-1)-targets[fi,bi])**2)
            for bi,(a,b) in enumerate(BONES) if j in (a,b))
        acceleration=np.sum(np.diff(p[max(0,s-2):min(4500,e+2),fi,j],n=2,axis=0)**2)
        return float(np.sum(error**2)),float(bone),float(acceleration)
    for receipt in receipts:
        response=read(receipt)
        if response['status']!='VALIDATED_VISUAL_ESTIMATES': continue
        if response['binding']['source_sha256']!=motion['source_sha256']: raise ValueError('Inference source mismatch')
        for frame in response['result']['frames']:
            k=frame['frame']
            for person in frame['people']:
                fi='AB'.index(person['slot'])
                for point in person['points']:
                    name=point['joint'];attempted+=1
                    if name not in ['left_elbow','right_elbow','left_wrist','right_wrist','left_ankle','right_ankle']: reject('ANCHOR_PRESERVED');continue
                    j=list(MAP16).index(name)
                    if person['identity_confidence']<.85 or not point['visible'] or point['confidence']<.8 or not protected[k,fi,j]:reject('INSUFFICIENT_INDEPENDENT_EVIDENCE');continue
                    image=np.array([point['x']*tracking['image_width'],point['y']*tracking['image_height']])
                    if np.linalg.norm(image-pixels[k,fi,j])>24:reject('EXTERNAL_NATIVE_DISAGREEMENT');continue
                    projected=project(out,camera)[k,fi,j]
                    # Independent observations dominate the weak external
                    # proposal. Test both a direct and an observation-anchored
                    # direction under exactly the same acceptance gates.
                    proposals=[image-projected,.8*(pixels[k,fi,j]-projected)+.2*(image-projected)]
                    s=max(0,k-3);e=min(4500,k+4)
                    if not np.all(protected[s:e,fi,j]):reject('GAP_IN_LOCAL_SUPPORT');continue
                    segments={motion['frame_quality'][i]['camera_segment_id'] for i in range(s,e)}
                    if len(segments)!=1:reject('CAMERA_CUT');continue
                    old=score(out,s,e,fi,j)
                    found=False
                    for direction_index,proposal in enumerate(proposals):
                        delta=basis.T@(proposal/scales[k]);size=np.linalg.norm(delta)
                        if size<1e-6:continue
                        delta*=min(1,.015/size)
                        for weight in [.25,.1,.04]:
                            candidate=out.copy()
                            taper=np.array([max(0,1-abs(i-k)/4) for i in range(s,e)])
                            candidate[s:e,fi,j]+=taper[:,None]*delta*weight
                            new=score(candidate,s,e,fi,j)
                            if new[0]<old[0]-1e-7 and new[1]<=old[1]+1e-10 and new[2]<=old[2]+1e-12:
                                out=candidate;accepted.append({'frame':k,'fighter':'AB'[fi],'joint':name,'support_frames':[s,e-1],
                                    'direction':'external' if direction_index==0 else 'native_80_external_20',
                                    'maximum_delta_display_units':float(np.linalg.norm(delta)*weight),'reprojection_sse_before':old[0],
                                    'reprojection_sse_after':new[0],'receipt':receipt.relative_to(ROOT).as_posix()});found=True;break
                        if found:break
                    if not found:
                        # Depth is unobservable: use a tightly bounded anatomical
                        # fit, never an externally "measured" depth coordinate.
                        taper=np.array([max(0,1-abs(i-k)/4) for i in range(s,e)])
                        def trial(d):
                            p=out.copy();p[s:e,fi,j]+=taper[:,None]*np.asarray(d);return p
                        def objective(d):
                            p=trial(d);v=score(p,s,e,fi,j)
                            external=project(p,camera)[k,fi,j]-image
                            return v[0]/max(1,old[0])+.2*float(external@external)/576
                        def constraints(d):
                            v=score(trial(d),s,e,fi,j)
                            return np.array([(old[i]-v[i])/max(old[i],1e-6) for i in range(3)])
                        result=minimize(objective,np.zeros(3),method='SLSQP',bounds=[(-.003,.003)]*3,
                            constraints=[{'type':'ineq','fun':constraints}],options={'maxiter':60,'ftol':1e-10})
                        new=score(trial(result.x),s,e,fi,j)
                        if result.success and new[0]<old[0]-1e-7 and new[1]<=old[1]+1e-10 and new[2]<=old[2]+1e-12:
                            out=trial(result.x);accepted.append({'frame':k,'fighter':'AB'[fi],'joint':name,'support_frames':[s,e-1],
                                'direction':'constrained_native_fit_with_external_2d_term','maximum_delta_display_units':float(np.linalg.norm(result.x)),
                                'reprojection_sse_before':old[0],'reprojection_sse_after':new[0],'receipt':receipt.relative_to(ROOT).as_posix()})
                        else:reject('REPROJECTION_BONE_OR_ACCELERATION_GATE')
    # Use unchanged measured confidence. A refined numeric pose is not a new
    # observed frame, and must not upgrade downstream camera visibility.
    motion['frames']=out.reshape(4500,2,69).tolist()
    motion['asset_id']=FOLDER.name if report_root is not None else 'video_api_refined_20261117'
    motion['generator']['external_generation_api_calls']=summary['requests_dispatched_total']
    motion['generator']['visual_refinement_model']=summary['model']
    motion['input_provenance'].update(api_visual_refinement={'summary_sha256':sha(FOLDER/'api_refinement/summary.json'),
        'validated_api_frames':summary['validated_frames'],'api_sampling_hz':summary.get('api_sampling_hz',1),'coordinate_updates':len(accepted),
        'method':'Bounded image-plane fit with independent native observation, bone and acceleration gates; depth retained',
        'confidence_unchanged':True,'identity_independently_verified':False,'true_3d_accuracy_proven':False})
    def metrics(p):
        errors=np.linalg.norm(project(p[:,:,:16],camera)-pixels,axis=-1)
        lengths=np.stack([np.linalg.norm(p[:,:,b]-p[:,:,a],axis=-1) for a,b in BONES],axis=-1)
        speed=np.linalg.norm(np.diff(p,axis=0)*25,axis=-1)
        return {'observed_reprojection_rms_px':float(np.sqrt(np.mean(errors[protected]**2))),
            'bone_deviation_rms_display_units':float(np.sqrt(np.mean((lengths-targets)**2))),
            'joint_speed_p99_display_units_s':float(np.percentile(speed,99)),
            'acceleration_sse':float(np.sum(np.diff(p,n=2,axis=0)**2)),
            'observed_joint_ratio':float(np.mean(confidence>=.6))}
    a=metrics(before);b=metrics(out)
    passed=bool(accepted) and b['observed_reprojection_rms_px']<=a['observed_reprojection_rms_px'] and b['bone_deviation_rms_display_units']<=a['bone_deviation_rms_display_units']+1e-10 and b['acceleration_sse']<=a['acceleration_sse']+1e-9
    folder=FOLDER/'candidate';folder.mkdir(exist_ok=True)
    packed=gzip.compress(json.dumps(motion,separators=(',',':'),allow_nan=False).encode(),compresslevel=6,mtime=0)
    (folder/'motion.json.gz').write_bytes(packed)
    result={'status':'PASS_BOUNDED_REFINEMENT' if passed else 'REJECTED_KEEP_ACTIVE_INPUT','before':a,'after':b,'attempted_proposals':attempted,
        'accepted_updates':len(accepted),'changed_frames':int(np.sum(np.any(abs(out-before)>1e-12,axis=(1,2,3)))),
        'rejected':rejected,'accepted':accepted,'baseline_sha256':sha(asset),'candidate_sha256':hashlib.sha256(packed).hexdigest(),
        'source_sha256':motion['source_sha256'],'native_frames':4500,'fps':25,'metric_valid':False,'confidence_unchanged':motion['joint_observation_confidence']==baseline['joint_observation_confidence'],
        'true_3d_accuracy_improvement_proven':False,'sensing_feedback':False}
    if active_baseline_motion is not None:
        active_path=ROOT/active_baseline_motion
        active=json.loads(gzip.decompress(active_path.read_bytes()))
        old=np.asarray(active['frames']).reshape(out.shape)
        result['active_baseline_sha256']=sha(active_path)
        result['difference_from_active']={'changed_frames':int(np.sum(np.any(abs(out-old)>1e-12,axis=(1,2,3)))),
            'changed_coordinate_values':int(np.count_nonzero(abs(out-old)>1e-12)),'maximum_delta_display_units':float(np.max(abs(out-old)))}
        if not result['difference_from_active']['changed_coordinate_values']:result['status']='REJECTED_NO_COORDINATE_CHANGE'
    write(folder/'quality.json',result);print(json.dumps({k:v for k,v in result.items() if k!='accepted'},ensure_ascii=False))
    return result
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--baseline-motion',default='assets/sensing/motion.json.gz');parser.add_argument('--report-root');parser.add_argument('--reconstruction-root');parser.add_argument('--active-baseline-motion');args=parser.parse_args();build(args.baseline_motion,args.report_root,args.reconstruction_root,args.active_baseline_motion)
