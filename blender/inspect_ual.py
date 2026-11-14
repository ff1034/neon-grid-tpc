import bpy, json, sys
from mathutils import Vector
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=r"C:\esp\neon-grid-tpc\blender\src\ual.glb")
out={}
for o in bpy.data.objects:
    out.setdefault('objs',[]).append([o.name,o.type,[round(v,3) for v in o.dimensions],[round(v,3) for v in o.location],[round(v,3) for v in o.rotation_euler], o.parent.name if o.parent else None])
arm=[o for o in bpy.data.objects if o.type=='ARMATURE'][0]
mw=arm.matrix_world
B={}
for b in arm.data.bones:
    if any(k in b.name for k in ('index','middle','pinky','ring','thumb')): continue
    B[b.name]=[[round(v,3) for v in mw@b.head_local],[round(v,3) for v in mw@b.tail_local], round(b.length,3)]
out['bones']=B
me=[o for o in bpy.data.objects if o.type=='MESH'][0]
bb=[me.matrix_world@Vector(c) for c in me.bound_box]
out['mesh_bb']=[[round(min(v[i] for v in bb),3) for i in range(3)],[round(max(v[i] for v in bb),3) for i in range(3)]]
out['verts']=len(me.data.vertices); out['faces']=len(me.data.polygons)
out['acts']={a.name:[round(a.frame_range[0]),round(a.frame_range[1])] for a in bpy.data.actions if a.name.split('|')[-1] in ('Idle_Loop','Jog_Fwd_Loop','Sprint_Loop','Walk_Loop','Jump_Start','Jump_Loop','Jump_Land','Pistol_Shoot','Pistol_Reload','Pistol_Idle_Loop','Pistol_Aim_Neutral') or a.name in ('Idle_Loop','Jog_Fwd_Loop','Sprint_Loop','Walk_Loop','Jump_Start','Jump_Loop','Jump_Land','Pistol_Shoot','Pistol_Reload','Pistol_Idle_Loop','Pistol_Aim_Neutral')}
out['fps']=bpy.context.scene.render.fps
out['vgroups']=len(me.vertex_groups)
json.dump(out,open(r"C:\esp\neon-grid-tpc\blender\out\ual_inspect.json","w"),indent=1,ensure_ascii=False)
