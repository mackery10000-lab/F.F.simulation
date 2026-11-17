"""Independent geometric proxy checks; not contact/hit adjudication."""
from pathlib import Path
import gzip
import hashlib
import json
import math
ROOT=Path(__file__).resolve().parents[1];path=ROOT/'assets/sensing/motion.json.gz';raw=path.read_bytes();m=json.loads(gzip.decompress(raw))
head_radius=.10;glove_radius=.065;torso_radius=.18
head_glove=[];torso_overlap=[];max_coord=0;min_head_gap=math.inf;max_quat_error=0
for k,row in enumerate(m['frames']):
    poses=[{n:p[i*3:i*3+3] for i,n in enumerate(m['joints'])} for p in row]
    for fi,p in enumerate(poses):
        max_coord=max(max_coord,*(abs(v) for j in p.values() for v in j))
        for hand in ['left_wrist','right_wrist']:
            gap=math.dist(p[hand],p['head'])-head_radius-glove_radius;min_head_gap=min(min_head_gap,gap)
            if gap<0:head_glove.append({'frame':k,'actor':'AB'[fi],'hand':hand,'gap_m':gap})
        q=m['root_rotations'][k][fi];max_quat_error=max(max_quat_error,abs(math.sqrt(sum(v*v for v in q))-1))
    separation=math.dist(poses[0]['chest'][:2],poses[1]['chest'][:2])
    if separation<torso_radius*2:torso_overlap.append({'frame':k,'gap_m':separation-torso_radius*2})
assert max_coord<100 and max_quat_error<1e-6
result={'status':'WARN' if head_glove or torso_overlap else 'PASS','input_asset_sha256':hashlib.sha256(raw).hexdigest(),'proxy_model':'spherical head/glove and horizontal torso circle; no triangle mesh/capsule contact solver','head_radius_m':head_radius,'glove_radius_m':glove_radius,'torso_radius_m':torso_radius,'own_head_glove_penetration_frames':len(head_glove),'minimum_own_head_glove_gap_m':min_head_gap,'torso_proxy_overlap_frames':len(torso_overlap),'examples':head_glove[:5]+torso_overlap[:5],'max_abs_coordinate_m':max_coord,'max_quaternion_norm_error':max_quat_error,'metric_valid':False,'hit_status':'UNKNOWN','scope':'synthetic internal plausibility only; proxy overlap may be an ambiguous clinch and cannot prove contact/hit'}
(ROOT/'reports/mma_3d_sensing_upgrade/collision_proxy_qa.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8');print(json.dumps(result))
