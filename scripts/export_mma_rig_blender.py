"""Blender background export of the *same* numeric sensing motion, Z-up -> glTF Y-up.
An inspectable joint rig animation, separate from the existing skinned visual mesh.
No inferred skinning/face detail, no RF or collision accuracy claim.
"""
import bpy
import gzip
import hashlib
import json
import sys
from pathlib import Path
from mathutils import Vector, Matrix

ROOT=Path(__file__).resolve().parents[1]
folder=ROOT/('reports/autonomous_execution/candidate' if '--api-candidate' in sys.argv else 'assets/sensing')
raw=(folder/'motion.json.gz').read_bytes();motion=json.loads(gzip.decompress(raw));names=motion['joints']
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene;scene.render.fps=25;scene.frame_start=0;scene.frame_end=4499
rigs=[]
for fi,actor in enumerate(['A','B']):
    arm=bpy.data.armatures.new('MMA_'+actor);rig=bpy.data.objects.new('MMA_'+actor,arm);scene.collection.objects.link(rig);bpy.context.view_layer.objects.active=rig;rig.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    # Independent translation bones have exact joint centres; this is a joint rig,
    # not an invented anatomical rotation solution from endpoint positions.
    for i,name in enumerate(names):
        bone=arm.edit_bones.new(name);p=motion['frames'][0][fi][i*3:i*3+3];bone.head=p;bone.tail=Vector(p)+Vector((0,0,.025))
    bpy.ops.object.mode_set(mode='OBJECT');rig['input_asset_sha256']=hashlib.sha256(raw).hexdigest();rig['metric_valid']=False;rig['source_kind']=motion.get('source_kind','video_derived')
    for i,name in enumerate(names):
        bone=rig.pose.bones[name];bone.rotation_mode='QUATERNION';rest=Vector(motion['frames'][0][fi][i*3:i*3+3]);inverse_rest=arm.bones[name].matrix_local.to_3x3().inverted()
        for k in range(0,len(motion['frames']),2):
            # 12.5 Hz visual bake is explicitly decimated. Full 25 Hz JSON drives sensors.
            p=Vector(motion['frames'][k][fi][i*3:i*3+3]);bone.location=inverse_rest @ (p-rest);bone.keyframe_insert(data_path='location',frame=k,group=name)
    rigs.append(rig);rig.select_set(False)
for rig in rigs:rig.select_set(True)
scene.frame_set(0)
target=folder/'mma_joint_rig.glb'
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'.cache/mma_joint_rig.blend'))
bpy.ops.export_scene.gltf(filepath=str(target),export_format='GLB',use_selection=True,export_animations=True,export_frame_range=True,export_force_sampling=False,export_skins=True)
report={'status':'PASS','source_asset_sha256':hashlib.sha256(raw).hexdigest(),'glb_sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'path':target.relative_to(ROOT).as_posix(),'blender_version':bpy.app.version_string,'rig_type':'independent joint translation armatures (not anatomical rotation/skinning reconstruction)','actors':['A','B'],'joint_count':len(names),'native_motion_fps':25,'visual_bake_fps':12.5,'visual_bake_decimation':True,'blend_local_only':'.cache/mma_joint_rig.blend','metric_valid':False}
(folder if '--api-candidate' in sys.argv else ROOT/('reports/video_3d_replacement' if motion.get('source_kind')=='video_derived' else 'reports/mma_3d_sensing_upgrade')).joinpath('blender_export.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report),flush=True)
