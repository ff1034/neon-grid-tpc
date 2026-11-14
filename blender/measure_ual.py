import bpy, json
from mathutils import Vector
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=r"C:\esp\neon-grid-tpc\blender\src\ual.glb")
me=bpy.data.objects['Mannequin']; arm=bpy.data.objects['Armature']
V=[me.matrix_world@v.co for v in me.data.vertices]
out={'verts':len(V),'faces':len(me.data.polygons),'tris':sum(len(p.vertices)-2 for p in me.data.polygons),
 'bb':[[round(min(v[i] for v in V),3) for i in range(3)],[round(max(v[i] for v in V),3) for i in range(3)]]}
# torso / head slices (|x|<0.3)
sl={}
for z in [x/100 for x in range(80,186,4)]:
    pts=[v for v in V if abs(v.z-z)<0.02 and abs(v.x)<(0.30 if z>1.0 else 0.06)]
    if pts: sl[z]=[round(max(abs(v.x) for v in pts),3), round(min(v.y for v in pts),3), round(max(v.y for v in pts),3), len(pts)]
out['torso']=sl
legs={}
for z in [x/100 for x in range(2,96,6)]:
    pts=[v for v in V if abs(v.z-z)<0.02 and v.x>0.0]
    if pts: legs[z]=[round(min(v.x for v in pts),3),round(max(v.x for v in pts),3), round(min(v.y for v in pts),3), round(max(v.y for v in pts),3)]
out['leg_l']=legs
armsl={}
for x in [i/100 for i in range(20,84,6)]:
    pts=[v for v in V if abs(v.x-x)<0.02 and v.z>1.2]
    if pts: armsl[x]=[round(min(v.z for v in pts),3),round(max(v.z for v in pts),3), round(min(v.y for v in pts),3), round(max(v.y for v in pts),3)]
out['arm_l']=armsl
out['mats']=[m.name for m in me.data.materials]
out['mat_count']={m.name: sum(1 for p in me.data.polygons if p.material_index==i) for i,m in enumerate(me.data.materials)}
json.dump(out,open(r"C:\esp\neon-grid-tpc\blender\out\ual_measure.json","w"),indent=0)
