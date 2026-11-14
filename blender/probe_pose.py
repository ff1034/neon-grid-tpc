import bpy, json, math
from mathutils import Vector
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=r"C:\esp\neon-grid-tpc\blender\src\ual.glb")
arm=bpy.data.objects['Armature']
if arm.animation_data is None: arm.animation_data_create()
out={'actions':[a.name for a in bpy.data.actions][:5], 'slots': [ [s.identifier for s in a.slots] for a in bpy.data.actions][:2]}
def pose(name, f):
    act=bpy.data.actions[name]; arm.animation_data.action=act
    try: arm.animation_data.action_slot=act.slots[0]
    except Exception as e: pass
    bpy.context.scene.frame_set(int(f)); bpy.context.view_layer.update()
    r={}
    for b in ['hand_r','hand_l','lowerarm_r','Head','pelvis','foot_l','spine_03']:
        pb=arm.pose.bones[b]; m=arm.matrix_world@pb.matrix
        r[b]=dict(p=[round(v,3) for v in m.translation], y=[round(v,3) for v in m.col[1].xyz], z=[round(v,3) for v in m.col[2].xyz], x=[round(v,3) for v in m.col[0].xyz])
    return r
for n,f in [('Pistol_Idle_Loop',0),('Pistol_Aim_Neutral',2),('Pistol_Shoot',3),('Jog_Fwd_Loop',0),('Jog_Fwd_Loop',11),('Sprint_Loop',0),('Idle_Loop',0)]:
    out[n+'@'+str(f)]=pose(n,f)
json.dump(out,open(r"C:\esp\neon-grid-tpc\blender\out\probe.json","w"),indent=0)
