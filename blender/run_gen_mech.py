"""背景執行：產生 mech.glb / mech_low.glb 並輸出預覽圖。
blender.exe -b --factory-startup --python run_gen_mech.py -- [--q pc|low|both] [--norender] [--tag v1] [--noexport]
"""
import json
import math
import os
import runpy
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
q = argv[argv.index("--q") + 1] if "--q" in argv else "both"
tag = argv[argv.index("--tag") + 1] if "--tag" in argv else "v1"
HERE = os.path.dirname(os.path.abspath(__file__))
G = runpy.run_path(os.path.join(HERE, "gen_mech_ual.py"), run_name="mech")
report = {}
for quality in (["low", "pc"] if q == "both" else [q]):   # 電腦版最後建，留在場景裡算預覽
    arm, man, armor, muzzle = G["build"](quality)
    r = {"mannequin_tris": G["tris"](man), "armor_tris": G["tris"](armor),
         "actions": sorted(a.name for a in bpy.data.actions), "muzzle": [round(v, 3) for v in muzzle.matrix_world.translation]}
    if "--noexport" not in argv:
        name = "mech.glb" if quality == "pc" else "mech_low.glb"
        path = os.path.join(G["OUT_DIR"], name)
        r["kb"] = G["export"](arm, path)
        r["glb"] = path
    report[quality] = r
print("REPORT", json.dumps(report, ensure_ascii=False))
json.dump(report, open(os.path.join(G["OUT_DIR"], "mech_report.json"), "w"), ensure_ascii=False, indent=1)

if "--norender" in argv:
    sys.exit(0)

scene = bpy.context.scene
try:
    scene.render.engine = "BLENDER_EEVEE_NEXT"
except TypeError:
    scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x, scene.render.resolution_y = 560, 760
cam_data = bpy.data.cameras.new("PrevCam"); cam_data.lens = 55
cam = bpy.data.objects.new("PrevCam", cam_data); scene.collection.objects.link(cam); scene.camera = cam
for rot, energy in (((50, 0, -30), 3.2), ((60, 0, 150), 1.6), ((-20, 0, 60), 0.8)):
    ld = bpy.data.lights.new("Sun", "SUN"); ld.energy = energy
    lo = bpy.data.objects.new("Sun", ld); lo.rotation_euler = [math.radians(a) for a in rot]; scene.collection.objects.link(lo)
world = scene.world or bpy.data.worlds.new("World"); scene.world = world
world.use_nodes = True
bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
bg.inputs[0].default_value = (0.09, 0.1, 0.12, 1); bg.inputs[1].default_value = 0.8


def set_pose(action, frame):
    arm.animation_data_create()
    if action:
        act = bpy.data.actions[action]; arm.animation_data.action = act
        try:
            arm.animation_data.action_slot = act.slots[0]
        except Exception:
            pass
        scene.frame_set(int(frame))
    else:
        arm.animation_data.action = None
        for pb in arm.pose.bones:
            pb.matrix_basis.identity()
    bpy.context.view_layer.update()


def shot(name, az, el=8, dist=4.6, tz=0.95):
    a, e = math.radians(az), math.radians(el)
    # az 0 = 正面（角色面朝 -Y，所以相機在 -Y）
    cam.location = Vector((math.sin(a) * dist * math.cos(e), -math.cos(a) * dist * math.cos(e), tz + dist * math.sin(e)))
    cam.rotation_euler = (Vector((0, 0, tz)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = os.path.join(G["OUT_DIR"], f"preview_{tag}_{name}.png")
    bpy.ops.render.render(write_still=True)


set_pose("Pistol_Idle_Loop", 0)
for n, az in (("front", 0), ("side", 90), ("back", 180), ("three_quarter", 35)):
    shot(n, az)
set_pose("Jog_Fwd_Loop", 6); shot("jog", 60)
set_pose("Jump_Loop", 10); shot("jump", 35)
set_pose("Pistol_Reload", 18); shot("reload", 40)
set_pose(None, 0); shot("tpose", 25, dist=5.2)
# 頭盔特寫
set_pose("Pistol_Idle_Loop", 0)
cam_data.lens = 85
for n, az in (("helmet_front", 0), ("helmet_side", 90), ("helmet_back", 180)):
    a = math.radians(az)
    cam.location = Vector((math.sin(a) * 1.4, -math.cos(a) * 1.4, 1.62))
    cam.rotation_euler = (Vector((0, 0, 1.55)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = os.path.join(G["OUT_DIR"], f"preview_{tag}_{n}.png")
    bpy.ops.render.render(write_still=True)
