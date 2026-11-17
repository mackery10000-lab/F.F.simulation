"""Independent native/API/numeric/GLB/MP4/runtime binding audit of a real run."""
from pathlib import Path
import argparse
import gzip
import hashlib
import json
import re
import sys
import cv2
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from refine_video_api import validate_response
def verify(run_id):
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}',run_id):raise ValueError('Invalid run ID')
    f=ROOT/'reports'/run_id
    def read(name):return json.loads((f/name).read_text(encoding='utf-8'))
    def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
    api=read('api_refinement/summary.json');plan=read('api_refinement/plan.json');quality=read('candidate/quality.json')
    native=json.loads((ROOT/'output/unified'/run_id/'output/reconstruction_report.json').read_text(encoding='utf-8'))
    assert native['frame_count']==4500 and not native['inference_cache_reused']
    assert api['source_sha256']==sha(ROOT/'input/reference_fight.mp4')
    assert api['new_api_calls_this_run']==api['successful']==len(list((f/'api_refinement').glob('batch-*.json')))
    assert api['cache_hits_this_run']==0
    seen=[];usage=0
    for path in sorted((f/'api_refinement').glob('batch-*.json')):
        r=json.loads(path.read_text(encoding='utf-8'));raw=f/'api_refinement'/path.name.replace('batch-','response-')
        assert r['status']=='VALIDATED_VISUAL_ESTIMATES' and r['request_id']
        assert sha(raw)==r['response_sha256']
        value=validate_response(json.loads(raw.read_text(encoding='utf-8')),api['model'],r['binding']['frames'])
        assert value==r['result'];seen.extend(r['binding']['frames']);usage+=r['usage']['total_tokens']
    assert sorted(seen)==plan['api_frame_indices'] and len(set(seen))==api['validated_frames']
    assert usage==api['usage']['total_tokens']
    active=ROOT/'assets/sensing';packed=(active/'motion.json.gz').read_bytes();motion=json.loads(gzip.decompress(packed))
    fresh=json.loads(gzip.decompress((f/'native_candidate/motion.json.gz').read_bytes()))
    old=json.loads(gzip.decompress((f/'before/assets/sensing/motion.json.gz').read_bytes()))
    assert sha(active/'motion.json.gz')==quality['candidate_sha256']
    assert packed==(f/'candidate/motion.json.gz').read_bytes()==(ROOT/'github.f.f/assets/sensing/motion.json.gz').read_bytes()
    assert motion['joint_observation_confidence']==fresh['joint_observation_confidence']
    assert motion['source_timestamps_seconds']==fresh['source_timestamps_seconds']
    assert np.allclose(motion['source_timestamps_seconds'],np.arange(4500)/25,atol=1e-8,rtol=0)
    assert motion['root_rotations']==fresh['root_rotations'] and not motion['metric_valid']
    difference=abs(np.asarray(motion['frames'])-np.asarray(old['frames']))
    assert np.count_nonzero(difference>1e-12)==quality['difference_from_active']['changed_coordinate_values']>0
    assert np.isfinite(np.asarray(motion['frames'])).all()
    for name in ['motion.json.gz','3d_capture.mp4','mma_joint_rig.glb','manifest.json','reference_video.json']:
        assert (active/name).read_bytes()==(ROOT/'github.f.f/assets/sensing'/name).read_bytes(),name
    render=read('candidate/render_run.json');rig=read('candidate/blender_export.json')
    assert render['asset_sha256']==rig['source_asset_sha256']==quality['candidate_sha256']
    assert sha(active/'3d_capture.mp4')==render['video_sha256'] and sha(active/'mma_joint_rig.glb')==rig['glb_sha256']
    capture=cv2.VideoCapture(str(active/'3d_capture.mp4'));count=0;fps=capture.get(cv2.CAP_PROP_FPS)
    try:
        while True:
            ok,frame=capture.read()
            if not ok:break
            assert frame.shape[:2]==(540,960);count+=1
    finally:capture.release()
    assert count==4500 and fps==25
    source=read('source-full.json');mirror=read('mirror-full.json')
    for k in ['input_asset_sha256','measurement_digest','measurements','per_sensor','events']:assert source[k]==mirror[k],k
    assert source['input_asset_sha256']==quality['candidate_sha256']
    assert source['api_calls_in_sensing']==mirror['api_calls_in_sensing']==0
    result={'status':'PASS','native_inference_frames':4500,'native_cache_reused':False,'new_api_requests':api['new_api_calls_this_run'],
        'api_frame_samples':len(seen),'changed_frames':quality['difference_from_active']['changed_frames'],
        'changed_coordinate_values':int(np.count_nonzero(difference>1e-12)),'decoded_video_frames':count,'video_fps':fps,
        'source_mirror_asset_bytes_identical':True,'source_mirror_full_replay_identical':True,'input_asset_sha256':quality['candidate_sha256'],
        'accuracy_improvement_proven':False}
    (f/'artifact-audit.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8');print(json.dumps(result))
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--run-id',required=True);a=p.parse_args();verify(a.run_id)
