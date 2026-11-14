// 本機玩家：移動、碰撞、跳躍、第一人稱相機都交給 three-player-controller（只用第一人稱，關掉套件的視角切換），
// 這裡只加 FPS 需要的部分：射擊、換彈、換槍、第一人稱槍模、上半身射擊／換彈動作疊加。
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { playerController } from 'three-player-controller';
import * as SH from './shared.js';
import { prepare, faceForward, rigAgent, MOBILE, CHARS } from './assets.js';

const S = .01;              // 套件的基準單位是公分（膠囊高 180）；scale .01 → 1.8 m，跟原版 P.height 一致
export const BASE_SPEED = SH.P.speed / S;   // 6 m/s
const EYE_FALLBACK = SH.P.eye;

export class LocalPlayer {
  constructor(scene, camera, renderer) {
    this.scene = scene; this.camera = camera; this.renderer = renderer;
    this.ctrl = null; this.me = null; this.firing = false; this.dead = false;
    this.ray = new THREE.Raycaster(); this.vmKick = 0; this.vmT = 0;
  }

  async init({ agentGltf, cfg = CHARS.agent, guns, colliderMeshes, color, spawnFeet }) {
    this.cfg = cfg;
    const model = prepare(SkeletonUtils.clone(agentGltf.scene), { team: color });
    this.model = model;
    // 套件把模型放進膠囊並以膠囊 +Z 為前方；agent.glb 本來就面朝 glTF +Z，所以這裡「不」轉 180°
    const ctrl = this.ctrl = new playerController();
    const controls = new OrbitControls(this.camera, this.renderer.domElement);
    await ctrl.init({
      scene: this.scene, camera: this.camera, controls,
      playerModelConfig: {
        model, animations: agentGltf.animations, scale: S,
        idleAnim: cfg.idle, walkAnim: cfg.run, runAnim: cfg.run, jumpAnim: cfg.tpcJump,
        gravity: -SH.P.grav / S,                         // 22 m/s²
        jumpHeight: SH.P.jumpV / S,                      // 套件的 jumpHeight 其實是起跳速度：√(2·22·1.05) ≈ 6.8 m/s，跳 1.05 m
        speed: BASE_SPEED, runSpeed: BASE_SPEED,         // 原版沒有衝刺
        acceleration: 14, deceleration: 18,
        // 第一人稱相機掛在膠囊上（不掛頭骨，跑步時畫面不會跟著動畫晃）：膠囊原點在上球心（腳底 +1.45 m），眼睛 1.62 m → +17 公分；往前 10 公分
        firstPersonCameraOffset: [0, SH.P.eye * 100 - 145, 10],
        capsuleRadiusRatio: SH.P.radius / .3,            // 原版半徑 .35
      },
      initPos: this.capsulePos(spawnFeet),
      colliders: [{ motion: 'static', shape: { kind: 'mesh', source: colliderMeshes } }],
      minCamDistance: 120, maxCamDistance: 320,          // 1.2～3.2 m
      camLookAtHeightRatio: .86,
      thirdMouseMode: 5,                                 // 隱藏滑鼠、人物朝向跟著鏡頭水平方向（射擊遊戲需要）
      isFirstPerson: true,                               // 只有第一人稱
      mouseSensitivity: 5,
      keyMap: { sprint: null, toggleFly: null, toggleVehicle: null, toggleView: null },   // 停用 V 切換視角
      isShowMobileControls: true,
      mobileControls: { joystick: true, fly: false, vehicle: false, view: false,   // 手機也不顯示視角切換鍵
        jump: { right: 24, bottom: 40, size: 62 } },
    });
    this.colliderHandle = null;
    // 上半身射擊／換彈：直接在套件的 mixer 上加權疊加（套件的 playAnimation 會整個換掉下半身動作）
    this.rig = rigAgent(model, agentGltf.animations, ctrl.animation.mixer, cfg);
    this.body = []; model.traverse(o => { if (o.isMesh) this.body.push(o); });
    ctrl.onViewChange = fp => this.onView(fp);
    this.buildViewmodel(guns);
    this.onView(ctrl.getIsFirstPerson());
  }
  /** 腳底 → 膠囊上球心（套件的膠囊 position） */
  capsulePos(feet) { const c = this.ctrl; const off = c && c.modelBaseY ? -c.modelBaseY : 1.8 - .3; return new THREE.Vector3(feet.x, feet.y + off + .02, feet.z); }
  feetY() { return this.ctrl.playerCapsule.position.y + this.ctrl.modelBaseY; }

  setColliders(meshes) {
    this.ctrl.clearColliders({ motion: 'static' });
    this.ctrl.addCollider({ motion: 'static', shape: { kind: 'mesh', source: meshes } });
  }
  get firstPerson() { return this.ctrl.getIsFirstPerson(); }
  onView(fp) {
    for (const m of this.body) m.visible = !fp;    // 第一人稱只看得到槍模
    this.vm.visible = fp;
    this.onViewChange && this.onViewChange(fp);
  }

  /* ---------- 第一人稱槍模（gun_*.glb，含手臂；原點是右手握把） ---------- */
  buildViewmodel(guns) {
    this.vmScene = new THREE.Scene();
    this.vmCam = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, .01, 10);
    this.vmScene.add(new THREE.HemisphereLight(0xdfefff, 0x303848, 2.2));
    const k = new THREE.DirectionalLight(0xffffff, 2.2); k.position.set(-1, 2, 1.5); this.vmScene.add(k);
    const c1 = new THREE.PointLight(0x2ef2ff, 1.2, 2.5, 2); c1.position.set(.7, .3, .1); this.vmScene.add(c1);
    this.vm = new THREE.Group(); this.vmScene.add(this.vm);
    this.vmHolder = new THREE.Group(); this.vm.add(this.vmHolder);
    this.vmGuns = guns.map((g, i) => {
      const G = new THREE.Group();
      if (g) { const m = faceForward(prepare(g.scene.clone(true), { shadow: false })); m.position.set(0, -.065, -.09); G.add(m); G.userData.muzzle = m.getObjectByName('Muzzle'); }
      else { const m = new THREE.Mesh(new THREE.BoxGeometry(.08, .1, .5), new THREE.MeshStandardMaterial({ color: SH.WEAPONS[i].color })); m.position.z = -.25; G.add(m); }
      this.vmHolder.add(G); return G;
    });
    this.vmBase = new THREE.Vector3(.17, -.175, -.36);
  }
  updateViewmodel(dt, me) {
    if (!this.vm.visible) return;
    this.vmGuns.forEach((g, i) => g.visible = me.wi === i);
    const w = SH.WEAPONS[me.wi], st = me.ws[me.wi];
    this.vmKick = Math.max(0, this.vmKick - dt * 8); this.vmT += dt;
    const v = this.ctrl.getVelocity(), sp = Math.hypot(v.x, v.z) * (this.ctrl.getIsOnGround() ? 1 : .2);
    this.bob = (this.bob || 0) + dt * sp * 1.9;
    let ry = 0, rz = 0, dy = 0;
    if (st.reload > 0) { const p = 1 - st.reload / w.reload, r = Math.sin(p * Math.PI); rz = .55 * r; ry = .25 * r; dy = -.09 * r; }
    if (me.switchT > 0) dy -= .32 * (me.switchT / .35);
    if (!me.alive) dy -= .6;
    const b = this.vmBase, k = Math.min(1, sp / 6);
    this.vmHolder.position.set(b.x + Math.sin(this.bob) * .012 * k, b.y - Math.abs(Math.cos(this.bob)) * .012 * k + dy + Math.sin(this.vmT * 1.6) * .003, b.z + this.vmKick * .07);
    this.vmHolder.rotation.set(this.vmKick * .12, ry, rz);
  }
  renderViewmodel() {
    if (!this.vm.visible) return;
    const r = this.renderer; r.autoClear = false; r.clearDepth(); r.render(this.vmScene, this.vmCam); r.autoClear = true;
  }
  resize() { this.vmCam.aspect = innerWidth / innerHeight; this.vmCam.updateProjectionMatrix(); }

  /* ---------- 每畫面：把控制器狀態寫回規則用的 player 物件 ---------- */
  sync(me) {
    const c = this.ctrl, p = c.playerCapsule.position, v = c.getVelocity();
    me.pos.x = p.x; me.pos.y = this.feetY(); me.pos.z = p.z;
    me.vel.x = v.x; me.vel.y = v.y; me.vel.z = v.z; me.onGround = c.getIsOnGround();
    const d = this.camera.getWorldDirection(new THREE.Vector3());
    me.yaw = Math.atan2(-d.x, -d.z); me.pitch = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1));
  }
  eye(out = new THREE.Vector3()) {
    if (this.firstPerson) return this.camera.getWorldPosition(out);
    const p = this.ctrl.playerCapsule.position; return out.set(p.x, this.feetY() + EYE_FALLBACK, p.z);
  }
  muzzle(out = new THREE.Vector3()) {
    if (this.firstPerson) return out.set(.17, -.15, -.8).applyMatrix4(this.camera.matrixWorld);
    if (this.rig.muzzle) return this.rig.muzzle.getWorldPosition(out);
    return this.eye(out);
  }
  /** 準心射線：從鏡頭穿過畫面中央，找出瞄準點，再從眼睛（第三人稱是角色頭部高度）朝瞄準點開槍 */
  aim(match, me) {
    this.camera.updateMatrixWorld();
    this.ray.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    const o = this.ray.ray.origin.clone(), d = this.ray.ray.direction.clone(), eye = this.eye();
    if (!this.firstPerson) { const s = Math.max(0, eye.clone().sub(o).dot(d)); o.addScaledVector(d, s); }  // 跳過鏡頭到角色之間的障礙
    const r = SH.traceShot(match.C, match.players.filter(p => p !== me && p.alive), null, o, d, 200);
    const target = o.addScaledVector(d, r.t);
    const dir = target.sub(eye).normalize();
    me.yaw = Math.atan2(-dir.x, -dir.z); me.pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
    return eye;
  }
  /** 開槍成功回傳 true（彈藥／射速／換彈規則都在 shared.js tryFire） */
  tryShoot(match, me) {
    if (!me.alive || !match.live) return false;
    if (!SH.tryFire(me)) return false;
    const eye = this.aim(match, me);
    match.shoot(me, eye, SH.shotDirs(me));
    this.vmKick = 1;
    if (!this.firstPerson) this.rig.oneShot('fire', Math.max(.22, Math.min(.6, 1 / SH.WEAPONS[me.wi].rate)));
    return true;
  }
  reload(me) { if (SH.startReload(me)) { if (!this.firstPerson) this.rig.oneShot('reload', SH.WEAPONS[me.wi].reload); return true; } return false; }
  switchTo(me, i) { return SH.switchWeapon(me, i); }

  /** 在套件更新（mixer、物理、相機）之後：第三人稱把瞄準俯仰加在脊椎上 */
  afterUpdate(me) {
    if (!this.firstPerson && me.alive) this.rig.aim(me.pitch);
  }
  /** 套件用 attach() 把相機掛到膠囊上；遇過相機縮放算出 NaN（整個畫面變黑），這裡把它修回來 */
  fixCamera() {
    const c = this.camera;
    if (!Number.isFinite(c.scale.x + c.scale.y + c.scale.z)) c.scale.set(1, 1, 1);
    if (!Number.isFinite(c.quaternion.x + c.quaternion.y + c.quaternion.z + c.quaternion.w)) c.quaternion.identity();
    if (!Number.isFinite(c.position.x + c.position.y + c.position.z)) c.position.set(0, SH.P.eye - 1.45, .1);
  }
  setBoost(on) { this.ctrl.setPlayerSpeed(on ? BASE_SPEED * SH.P.boostMul : BASE_SPEED); this.ctrl.setPlayerRunSpeed(on ? BASE_SPEED * SH.P.boostMul : BASE_SPEED); }
  setDead(dead) {
    this.dead = dead; this.model.visible = !dead;
    this.ctrl.setBindKeyboardEvents(!dead);
    if (dead) this.ctrl.setInput({ moveX: 0, moveY: 0, jump: false });
  }
  respawn(me) {
    this.ctrl.reset(this.capsulePos(me.pos));
    // 原版 yaw：前方 = (-sin, -cos)；套件膠囊前方是 +Z，所以轉 yaw + π
    this.ctrl.playerCapsule.rotation.set(0, (Number.isFinite(me.yaw) ? me.yaw : 0) + Math.PI, 0);
    this.ctrl.playerCapsule.updateMatrixWorld(true);
    this.ctrl.cam.setFirstPerson();                                  // 相機重新掛回膠囊（回選單時會拆下來）
    this.fixCamera();
    this.setDead(false);
  }
}
