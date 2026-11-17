"""Refresh explicit byte/text-normalized hashes after an authorized bake/export."""
from pathlib import Path
import json
import hashlib
import subprocess
ROOT=Path(__file__).resolve().parents[1]
folder=ROOT/'assets/sensing';manifest=json.loads((folder/'manifest.json').read_text(encoding='utf-8'))
config_script="import fs from 'node:fs';import {DEFAULT_CONFIG,makeDevices} from './sensing/sensors.ts';const o=JSON.parse(fs.readFileSync('data/scene.json')).octagon;console.log(JSON.stringify({default_config:DEFAULT_CONFIG,devices:makeDevices({vertices:o.inside_vertices_xy_m,canvasZ:o.canvas_z_m,fenceHeight:o.fence_height_above_canvas_m}),rf:{carrier_hz:5800000000,subcarriers:16,mimo_links:4},metric_valid:false}));"
config=json.loads(subprocess.check_output(['node','--experimental-strip-types','--input-type=module','-e',config_script],cwd=ROOT,text=True,encoding='utf-8'))
(folder/'sensor_config.json').write_text(json.dumps(config,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
extra=['assets/sensing/motion_v2_contract.json','motion/sampling.ts','sensing/contracts.ts','sensing/adapters.ts','sensing/sensors.ts','sensing/fusion.ts','sensing/tag-tracking.ts','sensing/live.ts','sensing/movement.ts','sensing/mma-features.ts','assets/sensing/sensor_config.json']
if (folder/'mma_joint_rig.glb').exists():extra.append('assets/sensing/mma_joint_rig.glb')
for name in ['3d_capture.mp4','reference_video.json']:
    if (folder/name).exists():extra.append('assets/sensing/'+name)
for name in set(manifest['files'])|set(extra):
    path=ROOT/name
    if not path.exists():continue
    data=path.read_bytes()
    if path.suffix in ['.json','.ts','.obj']:data=data.decode('utf-8').replace('\r\n','\n').encode('utf-8')
    manifest['files'][name]=hashlib.sha256(data).hexdigest()
manifest.update(motion_schema_version='2.0',runtime_hash_binding=True)
(folder/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
print(json.dumps({'status':'PASS','asset_sha256':manifest['files']['assets/sensing/motion.json.gz'],'bound_files':len(manifest['files'])}))
