"""Install only independently gated numeric/video/rig artifacts; keep originals."""
from pathlib import Path
import argparse
import datetime
import hashlib
import json
import shutil

ROOT=Path(__file__).resolve().parents[1]
FOLDER=ROOT/'reports/autonomous_execution'
def read(p):return json.loads(p.read_text(encoding='utf-8'))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(p,v):p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')

def publish(report_root=None):
    global FOLDER
    if report_root is not None:FOLDER=ROOT/report_root
    folder=FOLDER/'candidate';quality=read(folder/'quality.json');render=read(folder/'render_run.json');rig=read(folder/'blender_export.json')
    if quality['status']!='PASS_BOUNDED_REFINEMENT' or not quality['confidence_unchanged'] or not quality['changed_frames']:raise ValueError('Numeric acceptance failed')
    digest=sha(folder/'motion.json.gz')
    if digest!=quality['candidate_sha256'] or digest!=render['asset_sha256'] or digest!=rig['source_asset_sha256']:raise ValueError('Candidate artifact binding mismatch')
    if render['status']!='PASS' or render['encoded_frames']!=4500 or render['video_duration_s']!=180 or render['maximum_visual_joint_error_m']>1e-8:raise ValueError('Render acceptance failed')
    if sha(folder/'3d_capture.mp4')!=render['video_sha256'] or sha(folder/'mma_joint_rig.glb')!=rig['glb_sha256']:raise ValueError('Artifact hash mismatch')
    active=ROOT/'assets/sensing'
    if sha(active/'motion.json.gz')!=quality.get('active_baseline_sha256',quality['baseline_sha256']):raise ValueError('Active input changed; no overwrite allowed')
    backup=ROOT/'.cache'/((FOLDER.name+'_before') if report_root is not None else 'autonomous_before')
    api=read(FOLDER/'api_refinement/summary.json')
    changes=[]
    for name in ['motion.json.gz','3d_capture.mp4','mma_joint_rig.glb','manifest.json','reference_video.json','motion_v2_contract.json']:
        path=active/name;prior=backup/path.relative_to(ROOT)
        if prior.exists() and sha(prior)!=sha(path):raise ValueError('Original backup mismatch')
        prior.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(path,prior)
    for name in ['motion.json.gz','3d_capture.mp4','mma_joint_rig.glb']:shutil.copyfile(folder/name,active/name)
    manifest=read(active/'manifest.json')
    manifest.update(run_id=FOLDER.name if report_root is not None else 'video_api_refined_20261117',source_motion_sha256=digest,external_visual_refinement=True,quality_status='WARN')
    manifest['quality_notes']=[f'External {api.get("api_sampling_hz",1)}Hz image inference; {quality["accepted_updates"]} bounded updates over {quality["changed_frames"]} native frames passed independent gates',
        'Monocular depth/scale and identity unverified; substantial 3D improvement unproven']
    write(active/'manifest.json',manifest)
    reference={**render,'schema':'ff_reference_video_v1','video_file':'assets/sensing/3d_capture.mp4','native_timestamps':[0,179.96],
        'frame_alignment':'video frame k = refined numeric motion frame k at k/25 seconds','metric_valid':False,
        'external_api_calls_in_generation':api['requests_dispatched_total'],'sensing_feedback':False}
    write(active/'reference_video.json',reference)
    contract=read(active/'motion_v2_contract.json');contract['api_refinement']={'model':api['model'],'source_images':api['validated_frames'],'coordinate_updates':quality['accepted_updates'],'confidence_unchanged':True,'depth_measured':False};write(active/'motion_v2_contract.json',contract)
    latest=ROOT/'output/runs/latest/3d_capture.mp4'
    if latest.is_file():
        if not latest.resolve().is_relative_to(ROOT.resolve()):raise ValueError('Latest video target leaves workspace')
        old=backup/'output/runs/latest/3d_capture.mp4';old.parent.mkdir(parents=True,exist_ok=True)
        if not old.exists():shutil.copyfile(latest,old)
        shutil.copyfile(active/'3d_capture.mp4',latest)
    for name in ['motion.json.gz','3d_capture.mp4','mma_joint_rig.glb','manifest.json','reference_video.json','motion_v2_contract.json']:
        changes.append({'path':'assets/sensing/'+name,'before_sha256':sha(backup/'assets/sensing'/name),'after_sha256':sha(active/name)})
    result={'status':'PUBLISHED_LOCALLY_WITH_QUALITY_WARNINGS','time':datetime.datetime.now(datetime.timezone.utc).isoformat(),'changes':changes,
        'substantial_3d_improvement_proven':False,'remote_push':False}
    write(FOLDER/'publication.json',result);print(json.dumps(result))
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--report-root');args=parser.parse_args();publish(args.report_root)
