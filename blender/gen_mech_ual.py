"""
NEON GRID TPC 角色：以 Quaternius Universal Animation Library（CC0）的 Mannequin 與骨架為底，
套上「角色機甲設計」的硬殼裝甲，輸出 models/mech.glb（電腦版）與 models/mech_low.glb（手機版）。

- 來源：blender/src/ual.glb（three-player-controller 範例附的檔案；45 個動作 = UAL Standard 免費版，
  另外 8 個 fly* 動作是套件作者加的，授權不明，這裡不使用）。
- 底層身體：Mannequin 原樣保留骨架蒙皮，材質改成黑色作戰服（Suit）與 DarkMetal 關節。
- 裝甲：用 C:\\esp\\blender_weapons\\gen_agent.py 的曲面殼工具（sq / tube / rbox / cyl / PartMesh），
  依 UAL 骨頭位置重新排版；每片 100% 綁單一骨頭（剛體跟著骨頭動）。
- 材質名稱沿用遊戲規格：TeamColor（玩家代表色）、TeamGlow（代表色發光）、DarkMetal、ArmorLight，另加 Suit。
- 槍：短卡賓槍併進裝甲網格、100% 綁 hand_r；擺放位置用 Pistol_Idle_Loop 的手部姿勢反推回 T-pose。
- 座標：面朝 -Y、上 +Z、角色左側 +X（*_l 骨頭在 +X），跟原版建模規格相同。

用法：blender.exe -b --factory-startup --python run_gen_mech.py -- [--q pc|low|both] [--norender]
"""
import math
import os
import runpy

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "src", "ual.glb")
OUT_DIR = os.path.join(HERE, "out")
GAME_MODELS = os.path.normpath(os.path.join(HERE, "..", "models"))
LIB = runpy.run_path(r"C:\esp\blender_weapons\gen_agent.py", run_name="agent_lib")
sq, tube, rbox, cyl, PartMesh, lin = LIB["sq"], LIB["tube"], LIB["rbox"], LIB["cyl"], LIB["PartMesh"], LIB["lin"]
set_quality, Q, make_material, hex_color, build_materials = LIB["set_quality"], LIB["Q"], LIB["make_material"], LIB["hex_color"], LIB["build_materials"]

# 遊戲會用到的動作（其他 UAL 動作不匯出，檔案小很多）
KEEP_ACTIONS = ["Idle_Loop", "Walk_Loop", "Jog_Fwd_Loop", "Sprint_Loop", "Jump_Start", "Jump_Loop", "Jump_Land",
                "Pistol_Idle_Loop", "Pistol_Aim_Neutral", "Pistol_Shoot", "Pistol_Reload", "Hit_Chest", "Death01"]
TC, TG, DM, AL = "TeamColor", "TeamGlow", "DarkMetal", "ArmorLight"
MAT_ORDER = [TC, TG, DM, AL]
LOW_DECIMATE = 0.32   # 手機版 Mannequin 減面比例（13.7k → 約 4.4k 三角面）


def reset_and_import():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=SRC)
    for o in list(bpy.data.objects):
        if o.type == "MESH" and o.name != "Mannequin":   # 檔案裡多一顆 2 m 的 Icosphere，不是角色的一部分
            bpy.data.objects.remove(o, do_unlink=True)
    for a in list(bpy.data.actions):
        if a.name not in KEEP_ACTIONS:
            bpy.data.actions.remove(a)
    arm = bpy.data.objects["Armature"]
    man = bpy.data.objects["Mannequin"]
    if arm.animation_data:
        arm.animation_data.action = None
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()
    return arm, man


def bone_table(arm):
    mw = arm.matrix_world
    return {b.name: (mw @ b.head_local, mw @ b.tail_local) for b in arm.data.bones}


def pose_matrix(arm, action, frame, bone):
    act = bpy.data.actions[action]
    arm.animation_data_create()
    arm.animation_data.action = act
    try:
        arm.animation_data.action_slot = act.slots[0]
    except Exception:
        pass
    bpy.context.scene.frame_set(int(frame))
    bpy.context.view_layer.update()
    m = arm.matrix_world @ arm.pose.bones[bone].matrix
    arm.animation_data.action = None
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()
    return m.copy()


def mirror(fn):
    return lambda bm: [fn(bm, s) for s in (-1, 1)]


def arc(s, a0, a1):
    return (a0, a1) if s > 0 else (-a1, -a0)


def smooth(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


# ---------------------------------------------------------------------------
# 裝甲（T-pose 座標；B[name] = (head, tail)）
# ---------------------------------------------------------------------------

def build_armor(pm, B):
    # --- 骨盆：腰帶、前後擋板、側腰甲 ---
    def hips_dm(bm):
        tube(bm, (0, -0.004, 0.985), (0, -0.004, 1.045), lambda t: (0.124, 0.152), e=0.6, nu=18, nv=2)   # 腰帶
        for s in (-1, 1):
            rbox(bm, (s * 0.1, -0.127, 1.01), (0.055, 0.035, 0.06))                                     # 彈匣袋
        rbox(bm, (0, 0.126, 1.01), (0.12, 0.035, 0.06))

    def hips_al(bm):
        sq(bm, (0, 0.0, 0.95), (0.13, 0.13, 0.1), lon=(-22, 22), lat=(-60, 20), thick=0.012, e1=0.8, e2=0.8, nu=6, nv=5)
        sq(bm, (0, 0.005, 0.95), (0.13, 0.13, 0.1), lon=(152, 208), lat=(-50, 18), thick=0.012, e1=0.8, e2=0.8, nu=6, nv=4)
        for s in (-1, 1):
            sq(bm, (0, -0.004, 0.96), (0.178, 0.14, 0.11), lon=arc(s, 62, 118), lat=(-58, 14), thick=0.012,
               e1=0.8, e2=0.8, nu=7, nv=5)

    def hips_tc(bm):
        for s in (-1, 1):
            sq(bm, (0, -0.004, 0.96), (0.184, 0.146, 0.116), lon=arc(s, 70, 110), lat=(-48, -30), thick=0.008,
               e1=0.8, e2=0.8, nu=6, nv=2)
        sq(bm, (0, 0.0, 0.95), (0.134, 0.136, 0.104), lon=(-10, 10), lat=(-52, -20), thick=0.008, e1=0.8, e2=0.8, nu=3, nv=3)

    pm.add("pelvis", DM, hips_dm)
    pm.add("pelvis", AL, hips_al)
    pm.add("pelvis", TC, hips_tc)
    pm.add("pelvis", TG, lambda bm: rbox(bm, (0, -0.13, 1.022), (0.05, 0.008, 0.022), nu=8, nv=2))

    # --- 腹部（spine_01 / spine_02）：黑色分節腹甲、白色側肋甲、中央燈條 ---
    def abs_dm(bm):
        for z in (1.09, 1.15):
            for s in (-1, 1):
                rbox(bm, (s * 0.045, -0.118, z), (0.074, 0.026, 0.05), e=0.4, nu=10, nv=3)

    pm.add("spine_01", DM, abs_dm)
    pm.add("spine_01", AL, mirror(lambda bm, s: sq(bm, (0, -0.005, 1.13), (0.15, 0.125, 0.1), lon=arc(s, 54, 104),
                                                    lat=(-40, 45), thick=0.01, e1=0.8, e2=0.8, nu=6, nv=5)))
    pm.add("spine_01", TG, lambda bm: rbox(bm, (0, -0.13, 1.12), (0.008, 0.006, 0.09), nu=6, nv=2))

    # --- 胸腔（spine_03）：兩層胸甲、藍色中央面板、護頸圈、背包 ---
    CC, CR = (0, 0.018, 1.37), (0.196, 0.166, 0.15)

    def cr(d):
        return (CR[0] + d, CR[1] + d, CR[2] + d)

    def chest_dm(bm):
        tube(bm, (0, 0.012, 1.47), (0, 0.012, 1.53), lin((0.092, 0.11), (0.084, 0.10)), e=0.8, nu=14, nv=2)  # 護頸圈
        rbox(bm, (0, 0.225, 1.33), (0.27, 0.12, 0.30), e=0.3, nu=14, nv=4)                                 # 背包

    def chest_al(bm):
        for s in (-1, 1):
            sq(bm, CC, CR, lon=arc(s, 6, 82), lat=(-38, 55), thick=0.014, e1=0.75, e2=0.8, nu=9, nv=7)        # 胸甲
            sq(bm, CC, cr(0.009), lon=arc(s, 12, 60), lat=(16, 50), thick=0.012, e1=0.75, e2=0.8, nu=6, nv=4)  # 上層胸甲
            sq(bm, CC, cr(0.012), lon=arc(s, 96, 170), lat=(-32, 62), thick=0.012, e1=0.75, e2=0.8, nu=7, nv=6)  # 背甲
            rbox(bm, (s * 0.115, 0.04, 1.5), (0.12, 0.22, 0.05), e=0.4, rot=(0, s * 14, 0))                     # 斜方肌甲
            rbox(bm, (s * 0.15, 0.225, 1.33), (0.035, 0.125, 0.27), e=0.4)                                  # 背包側板
        rbox(bm, (0, 0.283, 1.33), (0.18, 0.02, 0.24), e=0.3, nu=10, nv=3)                                  # 背包外蓋

    def chest_tc(bm):
        sq(bm, CC, cr(0.004), lon=(-7, 7), lat=(-32, 50), thick=0.014, e1=0.75, e2=0.8, nu=3, nv=6)          # 胸口藍板
        rbox(bm, (0, 0.225, 1.49), (0.23, 0.105, 0.03), e=0.35)                                             # 背包頂蓋
        rbox(bm, (0, 0.27, 1.195), (0.21, 0.06, 0.05), e=0.35)                                              # 背包底座
        for s in (-1, 1):
            sq(bm, CC, cr(0.006), lon=arc(s, 18, 62), lat=(-42, -29), thick=0.01, e1=0.75, e2=0.8, nu=5, nv=2)  # 胸甲下緣

    def chest_tg(bm):
        sq(bm, CC, cr(0.012), lon=(-4, 4), lat=(6, 22), thick=0.006, e1=0.75, e2=0.8, nu=2, nv=3)
        rbox(bm, (0, 0.295, 1.33), (0.03, 0.006, 0.2), nu=6, nv=2)
        for s in (-1, 1):
            rbox(bm, (s * 0.06, 0.295, 1.34), (0.012, 0.006, 0.14), nu=6, nv=2)

    pm.add("spine_03", DM, chest_dm)
    pm.add("spine_03", AL, chest_al)
    pm.add("spine_03", TC, chest_tc)
    pm.add("spine_03", TG, chest_tg)

    # --- 肩甲：綁鎖骨（clavicle），手臂抬起時跟著聳肩；沿前後方向的弧形殼，三層 ---
    for side, s in (("l", 1), ("r", -1)):
        sh = B[f"upperarm_{side}"][0]
        px, py, pz = s * 0.262, sh.y, sh.z + 0.02
        o = Vector((px, py, pz))
        pm.add(f"clavicle_{side}", AL, lambda bm, o=o, s=s: (
            tube(bm, o + Vector((0, -0.125, 0.0)), o + Vector((0, 0.125, 0.0)),
                 lambda t: (0.094 * (0.86 + 0.14 * math.sin(math.pi * t)), 0.1 * (0.9 + 0.1 * math.sin(math.pi * t))),
                 arc=(-84, 36) if s > 0 else (-36, 84), thick=0.015, ref=(0, 0, 1), e=0.8, nu=10, nv=4),
            tube(bm, o + Vector((s * 0.014, -0.106, -0.075)), o + Vector((s * 0.014, 0.106, -0.075)),
                 lambda t: (0.068, 0.076 * (0.9 + 0.1 * math.sin(math.pi * t))),
                 arc=(-130, -60) if s > 0 else (60, 130), thick=0.012, ref=(0, 0, 1), e=0.8, nu=5, nv=3)))
        pm.add(f"clavicle_{side}", TC, lambda bm, o=o, s=s: tube(
            bm, o + Vector((s * 0.007, -0.115, -0.035)), o + Vector((s * 0.007, 0.115, -0.035)),
            lambda t: (0.085, 0.093 * (0.9 + 0.1 * math.sin(math.pi * t))),
            arc=(-122, -58) if s > 0 else (58, 122), thick=0.013, ref=(0, 0, 1), e=0.8, nu=6, nv=3))
        pm.add(f"clavicle_{side}", TG, lambda bm, o=o, s=s: tube(
            bm, o + Vector((0, -0.11, 0)), o + Vector((0, 0.11, 0)), lambda t: (0.096, 0.102),
            arc=(-86, -82) if s > 0 else (82, 86), thick=0.004, ref=(0, 0, 1), nu=2, nv=3, t=(0.12, 0.88)))
        pm.add(f"clavicle_{side}", DM, lambda bm, o=o: sq(bm, o + Vector((0, 0, -0.02)), (0.072, 0.085, 0.06),
                                                         e1=0.8, e2=0.8, nu=10, nv=4))  # 肩甲底下的墊

    # --- 頸 / 頭盔（極軸轉到 X 的超橢球殼：lon 0 前、90 頂、180 後；lat 往左右） ---
    nh, nt = B["neck_01"]
    pm.add("neck_01", DM, lambda bm: (tube(bm, nh, nt + Vector((0, 0, 0.03)), lambda t: (0.066, 0.07), nu=12, nv=2),
                                      tube(bm, nh + Vector((0, 0, 0.03)), nh + Vector((0, 0, 0.05)), lambda t: (0.075, 0.08), nu=12, nv=2)))
    HC = Vector((0, -0.008, 1.705))
    HR = (0.142, 0.142, 0.112)   # (上下, 前後, 左右)
    HROT = (0, -90, 0)

    def head_shape(v):
        k = smooth(-v.z / 0.11) * smooth(-v.y / 0.11)
        v = Vector((v.x * (1 - 0.26 * k), v.y - 0.014 * k * (1 - smooth(abs(v.x) / 0.06)), v.z))
        b = smooth(v.y / 0.1) * smooth(-v.z / 0.1)
        return Vector((v.x * (1 + 0.06 * b), v.y + 0.012 * b, v.z))

    def helm(bm, dr, lon, lat, thick=0.009, nu=6, nv=4, deform=None):
        sq(bm, HC, (HR[0] + dr, HR[1] + dr, HR[2] + dr), lon=lon, lat=lat, thick=thick, e1=0.8, e2=0.82,
           nu=nu, nv=nv, rot=HROT, deform=deform or head_shape)

    EAR = lambda s, x: (s * x, HC.y + 0.004, HC.z - 0.01)

    def head_dm(bm):
        sq(bm, HC, HR, lat=(-78, 78), e1=0.8, e2=0.82, nu=20, nv=9, rot=HROT, deform=head_shape)   # 盔體
        helm(bm, 0.008, (-82, -50), (-72, 72), nu=4, nv=10)                                          # 下顎
        for k in range(4):                                                                            # 口部通氣柵
            rbox(bm, (0, HC.y - HR[1] - 0.004, HC.z - 0.085 - k * 0.013), (0.05 - k * 0.006, 0.012, 0.006), e=0.5, nu=6, nv=2)
        for s in (-1, 1):
            cyl(bm, EAR(s, HR[2] + 0.008), 0.056, 0.034, axis="X", seg=12)                            # 耳機座

    def head_al(bm):
        helm(bm, 0.01, (12, 27), (-74, 74), nu=3, nv=12)                                               # 眉甲
        for s in (-1, 1):
            helm(bm, 0.009, (30, 196), arc(s, 12, 70), nu=10, nv=4)                                    # 頭頂兩側
            cyl(bm, EAR(s, HR[2] + 0.038), 0.04, 0.008, axis="X", seg=14)                              # 耳機外環（白）
            rbox(bm, (s * 0.098, HC.y - 0.1, HC.z - 0.07), (0.03, 0.045, 0.05), e=0.45, nu=8, nv=3)  # 頰側小甲
        helm(bm, 0.01, (199, 229), (-74, 74), nu=4, nv=12)                                             # 後腦上層
        helm(bm, 0.013, (226, 262), (-70, 70), nu=4, nv=12)                                            # 後腦下層

    def head_tc(bm):
        def mouth_ridge(v):
            v = head_shape(v)
            return Vector((v.x, v.y - 0.01 * smooth(1 - abs(v.x) / 0.05), v.z))
        helm(bm, 0.013, (34, 120), (-10, 10), nu=8, nv=2)                                              # 頂部藍脊（前段）
        helm(bm, 0.01, (-48, -9), (-26, 26), nu=5, nv=5, deform=mouth_ridge)                          # 護口
        helm(bm, 0.017, (150, 214), (-34, 34), thick=0.007, nu=5, nv=6)                                # 後腦藍板
        for s in (-1, 1):
            helm(bm, 0.009, (-44, -9), arc(s, 29, 76), nu=4, nv=4)                                     # 頰板
            helm(bm, 0.011, (60, 150), arc(s, 56, 74), nu=6, nv=2)                                     # 側面藍帶
            cyl(bm, EAR(s, HR[2] + 0.026), 0.06, 0.014, axis="X", seg=14)                              # 耳機藍環

    def head_tg(bm):
        helm(bm, 0.005, (-6, 10), (-66, 66), thick=0.005, nu=2, nv=14)                                 # 護目鏡
        for s in (-1, 1):
            cyl(bm, EAR(s, HR[2] + 0.043), 0.028, 0.004, axis="X", seg=14)                             # 耳機燈環

    pm.add("Head", DM, head_dm)
    pm.add("Head", AL, head_al)
    pm.add("Head", TC, head_tc)
    pm.add("Head", TG, head_tg)

    # --- 手臂（T-pose 沿 ±X；ref=+Z 是手臂垂下時的外側） ---
    for side, s in (("l", 1), ("r", -1)):
        ua, el = B[f"upperarm_{side}"]
        _, wr = B[f"lowerarm_{side}"]
        hd, ht = B[f"hand_{side}"]
        up = (0, 0, 1)
        pm.add(f"upperarm_{side}", AL, lambda bm, a=ua, b=el: tube(
            bm, a, b, lin((0.075, 0.072), (0.066, 0.064)), arc=(-105, 105), thick=0.012, ref=up, e=0.8, nu=9, nv=3, t=(0.22, 0.82)))
        pm.add(f"upperarm_{side}", TC, lambda bm, a=ua, b=el: tube(
            bm, a, b, lin((0.08, 0.077), (0.071, 0.069)), arc=(-16, 16), thick=0.008, ref=up, e=0.8, nu=3, nv=3, t=(0.3, 0.74)))
        pm.add(f"lowerarm_{side}", DM, lambda bm, a=el: sq(bm, a, (0.062, 0.062, 0.062), nu=10, nv=5))     # 肘關節
        pm.add(f"lowerarm_{side}", AL, lambda bm, a=el, b=wr: tube(
            bm, a, b, lambda t: (0.066 + 0.008 * math.sin(math.pi * t) - 0.012 * t, 0.064 + 0.006 * math.sin(math.pi * t) - 0.01 * t),
            arc=(-128, 128), thick=0.012, ref=up, e=0.72, nu=12, nv=4, t=(0.16, 0.9)))                    # 護臂
        pm.add(f"lowerarm_{side}", TC, lambda bm, a=el, b=wr, s=s: (
            tube(bm, a, b, lambda t: (0.077 + 0.006 * math.sin(math.pi * t) - 0.012 * t, 0.07),
                 arc=(-28, 28), thick=0.009, ref=up, e=0.72, nu=4, nv=4, t=(0.24, 0.8)),
            rbox(bm, a + Vector((0, 0.05, 0.0)), (0.07, 0.05, 0.07), e=0.5)))                              # 肘墊（在後方）
        pm.add(f"lowerarm_{side}", TG, lambda bm, a=el, b=wr: tube(
            bm, a, b, lambda t: (0.072, 0.074), arc=(-92, -88), thick=0.004, ref=up, nu=2, nv=2, t=(0.32, 0.74)))
        pm.add(f"hand_{side}", AL, lambda bm, h=hd, s=s: rbox(
            bm, h + Vector((s * 0.07, 0.0, 0.03)), (0.09, 0.075, 0.022), e=0.4, nu=8, nv=3))                # 手背甲

    # --- 腿：大腿前甲 + 外側藍甲、護膝、脛甲 + 藍條、小腿肚、靴 ---
    for side, s in (("l", 1), ("r", -1)):
        hip, knee = B[f"thigh_{side}"]
        _, ankle = B[f"calf_{side}"]
        fh, ft = B[f"foot_{side}"]
        x = hip.x
        th = lambda t: (0.108 - 0.022 * t, 0.098 - 0.02 * t)
        pm.add(f"thigh_{side}", AL, lambda bm, a=hip, b=knee, s=s: (
            tube(bm, a, b, th, arc=(-72, 58) if s > 0 else (-58, 72), thick=0.014, e=0.8, nu=9, nv=4, t=(0.12, 0.8), off=(0, -0.008, 0)),
            tube(bm, a, b, lambda t: (0.104 - 0.02 * t, 0.094), arc=(140, 220), thick=0.012, e=0.8, nu=5, nv=3, t=(0.2, 0.7))))
        pm.add(f"thigh_{side}", TC, lambda bm, a=hip, b=knee, s=s: tube(
            bm, a, b, lambda t: (0.113 - 0.022 * t, 0.104 - 0.02 * t), arc=(62, 124) if s > 0 else (-124, -62),
            thick=0.013, e=0.8, nu=5, nv=4, t=(0.1, 0.74), off=(0, -0.004, 0)))
        pm.add(f"thigh_{side}", TG, lambda bm, a=hip, b=knee, s=s: tube(
            bm, a, b, lambda t: (0.117 - 0.022 * t, 0.108 - 0.02 * t), arc=(90, 94) if s > 0 else (-94, -90),
            thick=0.004, e=0.8, nu=2, nv=2, t=(0.24, 0.6), off=(0, -0.004, 0)))
        pm.add(f"calf_{side}", DM, lambda bm, a=knee: sq(bm, a, (0.06, 0.06, 0.06), nu=10, nv=5))
        pm.add(f"calf_{side}", TC, lambda bm, a=knee: sq(
            bm, a + Vector((0, -0.04, 0.0)), (0.064, 0.06, 0.08), lon=(-75, 75), lat=(-55, 68), thick=0.014,
            e1=0.8, e2=0.85, nu=9, nv=7, rot=(-10, 0, 0)))                                                  # 護膝
        pm.add(f"calf_{side}", AL, lambda bm, a=knee, b=ankle: (
            tube(bm, a, b, lambda t: (0.07 - 0.014 * t, 0.064 - 0.01 * t), arc=(-82, 82), thick=0.014,
                 e=0.75, nu=10, nv=4, t=(0.16, 0.84)),                                                       # 脛甲
            tube(bm, a, b, lambda t: (0.075 + 0.04 * math.sin(math.pi * min(1, t * 1.25)), 0.066), arc=(118, 242),
                 thick=0.012, e=0.8, nu=7, nv=4, t=(0.12, 0.62))))                                           # 小腿肚
        pm.add(f"calf_{side}", TC, lambda bm, a=knee, b=ankle: tube(
            bm, a, b, lambda t: (0.075 - 0.014 * t, 0.066), arc=(-15, 15), thick=0.008, e=0.75, nu=3, nv=3, t=(0.26, 0.72)))
        pm.add(f"foot_{side}", DM, lambda bm, x=x: rbox(bm, (x, -0.0, 0.026), (0.125, 0.23, 0.052), e=0.35, nu=14))   # 鞋底後段
        pm.add(f"foot_{side}", AL, lambda bm, x=x, a=fh: (
            rbox(bm, (x, -0.04, 0.085), (0.122, 0.17, 0.08), e=0.45, nu=14),                                 # 鞋面
            rbox(bm, (x, 0.07, 0.085), (0.11, 0.05, 0.1), e=0.45),                                            # 後跟
            tube(bm, (x, 0.02, 0.1), (x, 0.02, 0.18), lambda t: (0.064, 0.064), arc=(-115, 115), thick=0.011, e=0.8, nu=7, nv=2)))
        pm.add(f"ball_{side}", DM, lambda bm, x=x: rbox(bm, (x, -0.18, 0.024), (0.12, 0.16, 0.048), e=0.35, nu=12))  # 鞋底前段
        pm.add(f"ball_{side}", TC, lambda bm, x=x: sq(bm, (x, -0.165, 0.045), (0.064, 0.105, 0.05),
                                                       lon=(-88, 88), lat=(-15, 80), thick=0.012, e1=0.7, e2=0.7, nu=10, nv=5))  # 鞋頭
        pm.add(f"foot_{side}", TG, lambda bm, x=x, s=s: rbox(bm, (x + s * 0.062, -0.03, 0.09), (0.004, 0.08, 0.012), nu=6, nv=2))


# ---------------------------------------------------------------------------
# 槍：區域座標原點 = 握把、-Y 前、+Z 上；最後轉到 T-pose 的 hand_r 位置
# ---------------------------------------------------------------------------
GUN_MUZZLE = Vector((0, -0.4, 0.075))


def build_gun(pm, xf):
    def put(fn):
        return lambda bm: fn(bm)

    def dm(bm):
        rbox(bm, (0, 0.012, -0.03), (0.034, 0.045, 0.1), e=0.45, rot=(-14, 0, 0))     # 握把
        tube(bm, (0, -0.26, 0.075), (0, -0.39, 0.075), lambda t: (0.019, 0.019), nu=10, nv=2)   # 槍管
        rbox(bm, (0, -0.1, 0.02), (0.03, 0.035, 0.06), e=0.45)                          # 彈匣
        rbox(bm, (0, -0.2, 0.035), (0.04, 0.08, 0.03), e=0.4)                           # 前握護木下緣

    def al(bm):
        rbox(bm, (0, -0.1, 0.07), (0.054, 0.3, 0.075), e=0.35, nu=12, nv=4)              # 機匣
        rbox(bm, (0, 0.085, 0.06), (0.042, 0.1, 0.06), e=0.4)                            # 短槍托

    def tc(bm):
        rbox(bm, (0, -0.07, 0.112), (0.046, 0.16, 0.018), e=0.4)                         # 上蓋藍板
        tube(bm, (0, -0.375, 0.075), (0, -0.395, 0.075), lambda t: (0.027, 0.027), nu=12, nv=2)  # 槍口環
        rbox(bm, (0, -0.02, 0.135), (0.02, 0.05, 0.03), e=0.4)                           # 瞄具

    def tg(bm):
        for s in (-1, 1):
            rbox(bm, (s * 0.028, -0.13, 0.07), (0.004, 0.16, 0.01), nu=6, nv=2)          # 側面燈條
        rbox(bm, (0, -0.02, 0.152), (0.012, 0.012, 0.004), nu=4, nv=2)

    for mat, fn in ((DM, dm), (AL, al), (TC, tc), (TG, tg)):
        pm.add("hand_r", mat, fn, xform=xf)


def gun_rest_matrix(arm, B):
    """Pistol_Idle_Loop 第 0 幀：右手握把位置、槍口朝正前方（-Y）且水平；換算回 T-pose 下 hand_r 的座標。"""
    P = pose_matrix(arm, "Pistol_Idle_Loop", 0, "hand_r")
    rest = arm.matrix_world @ arm.data.bones["hand_r"].matrix_local
    y, z = P.col[1].xyz.normalized(), P.col[2].xyz.normalized()
    grip = P.translation + y * 0.075 - z * 0.005 + Vector((0.006, 0, -0.03))
    G_pose = Matrix.Translation(grip)            # 世界座標的槍：-Y 前、+Z 上（不轉向）
    return rest @ P.inverted() @ G_pose


# ---------------------------------------------------------------------------

def setup_materials(man):
    mats = build_materials()
    suit = make_material("Suit", hex_color("#15171C"), 0.15, 0.72)
    mats["Suit"] = suit
    # Mannequin 原本 M_Main / M_Joints → 作戰服 / 關節（DarkMetal）
    for i, m in enumerate(man.data.materials):
        man.data.materials[i] = suit if m.name.startswith("M_Main") else mats[DM]
    return mats


def tris(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def build(quality):
    arm, man = reset_and_import()
    B = bone_table(arm)
    set_quality(quality)
    mats = setup_materials(man)
    pm = PartMesh(MAT_ORDER)
    build_armor(pm, B)
    xf = gun_rest_matrix(arm, B)
    build_gun(pm, xf)
    armor = pm.to_object("Armor", mats, bpy.context.scene.collection)
    armor.parent = arm
    mod = armor.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    muzzle = bpy.data.objects.new("Muzzle", None)
    bpy.context.scene.collection.objects.link(muzzle)
    muzzle.parent = arm
    muzzle.parent_type = "BONE"
    muzzle.parent_bone = "hand_r"
    bpy.context.view_layer.update()
    muzzle.matrix_world = xf @ Matrix.Translation(GUN_MUZZLE) @ Matrix.Rotation(math.radians(90), 4, "X")
    if quality == "low":
        d = man.modifiers.new("Decimate", "DECIMATE")
        d.ratio = LOW_DECIMATE
        bpy.context.view_layer.objects.active = man
        man.select_set(True)
        with bpy.context.temp_override(object=man, active_object=man):
            bpy.ops.object.modifier_move_to_index(modifier="Decimate", index=0)
            bpy.ops.object.modifier_apply(modifier="Decimate")
    bpy.context.view_layer.update()
    return arm, man, armor, muzzle


def export(arm, path):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in [arm] + list(arm.children_recursive):
        o.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True,
                              export_animations=True, export_animation_mode="ACTIONS",
                              export_skins=True, export_influence_nb=4, export_force_sampling=True,
                              export_extras=False, export_yup=True)
    return round(os.path.getsize(path) / 1024)
