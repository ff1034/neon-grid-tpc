// 地圖：載入 arena*.glb、外觀（霧／燈／天空）、挑出拿來做 BVH 碰撞的物件
import * as THREE from 'three';
import * as SH from './shared.js';
import { loadModel, arenaFile, prepare, paintSigns, ARENA_SIGNS, MOBILE } from './assets.js';

// 每張地圖的氣氛（取自原遊戲 game.js ARENA_LOOK）
export const ARENA_LOOK = {
  city: { fog: 0xc9d9ea, fogD: .0075, hemi: [0xd6e8ff, 0x6e6655, 1.25], sun: [0xfff1dc, 2.4], sky: [0x6d8fbd, 0xc9d9ea, 0x8a9099] },
  underground: { fog: 0x140a06, fogD: .012, hemi: [0xffb27a, 0x2a120a, .6], sun: [0xff9a5a, 1], sky: [0x0a0503, 0x140a06, 0x0a0503] },
  skyfort: { fog: 0x9fb6de, fogD: .0036, hemi: [0xc4d6f6, 0x4a5878, .95], sun: [0xfff0dc, 2.2], sky: [0x1f4fb8, 0xb0c8ec, 0xdfe7f4] },
  magma: { fog: 0x2a0e06, fogD: .0105, hemi: [0xff9a6a, 0x3a0c04, .7], sun: [0xff8a4a, 1.4], sky: [0x12060a, 0x7a240c, 0x3a0a04] },
  coastal: { fog: 0xa9cbe4, fogD: .0032, hemi: [0xdcecff, 0x7a7262, .85], sun: [0xfff3e0, 2.0], sky: [0x2a6fd0, 0xc0dcf2, 0x1d5f8c] } };

/**
 * 碰撞物件：原遊戲的碰撞唯一來源是 shared.js buildMap()，每個方塊第 9 欄就是它在 Blender 裡的物件名稱，
 * glb 也是照這些數字建出來的。所以 glb 裡「名稱出現在 buildMap 的物件 + 地板 Ground」才拿來碰撞；
 * *_Decor、Detail_Fine_Decor、Sign_*、Backdrop_*（遠景）這些裝飾物件只看不碰。
 */
export function collisionNames(arena) {
  const s = new Set(SH.buildMap(arena).map(m => m[8])); s.add('Ground'); return s;
}

const arenas = new Map();   // id -> { root, colliderMeshes, C, fromBoxes }

function boxesFallback(arena) {
  // glb 讀不到時用碰撞方塊本身當外觀與碰撞（跟原遊戲缺檔時一樣）
  const g = new THREE.Group(), mat = { conc: 0x9aa0a8, concD: 0x858b95, metal: 0x6a7686, grate: 0x55606e, crate: 0x7a6a50, dark: 0x2a3240, tower: 0x2b3646, bldg: 0x8d929b };
  const mats = {};
  const ground = new THREE.Mesh(new THREE.BoxGeometry(60, 1, 60), new THREE.MeshStandardMaterial({ color: 0x3a3f48, roughness: .9 }));
  ground.position.y = -.5; ground.name = 'Ground'; ground.receiveShadow = true; g.add(ground);
  for (const m of SH.buildMap(arena)) {
    const k = m[6]; mats[k] = mats[k] || new THREE.MeshStandardMaterial({ color: mat[k] || 0x777777, roughness: .7, metalness: .2 });
    const b = new THREE.Mesh(new THREE.BoxGeometry(m[1] - m[0], m[3] - m[2], m[5] - m[4]), mats[k]);
    b.position.set((m[0] + m[1]) / 2, (m[2] + m[3]) / 2, (m[4] + m[5]) / 2); b.name = m[8]; b.castShadow = b.receiveShadow = true; g.add(b);
  }
  return g;
}

export async function loadArena(scene, arena) {
  if (arenas.has(arena)) return arenas.get(arena);
  const gltf = await loadModel(arenaFile(arena));
  let root, fromBoxes = false;
  if (gltf) {
    root = prepare(gltf.scene);
    paintSigns(root, ARENA_SIGNS[arena]);
    root.traverse(o => { if (/Backdrop|Ceiling_Decor/.test(o.name)) o.traverse(m => { m.castShadow = false; }); });
  } else { root = boxesFallback(arena); fromBoxes = true; }
  root.visible = false; scene.add(root); root.updateMatrixWorld(true);
  // 挑碰撞網格：頂層物件名稱比對 buildMap 的群組名
  const names = collisionNames(arena), colliderMeshes = [], used = new Set(), skipped = [];
  for (const child of root.children[0] && root.children.length === 1 && !root.children[0].isMesh ? root.children[0].children : root.children) {
    if (names.has(child.name)) { used.add(child.name); child.traverse(o => { if (o.isMesh) colliderMeshes.push(o); }); }
    else skipped.push(child.name);
  }
  const missing = [...names].filter(n => !used.has(n));
  const info = { root, colliderMeshes, fromBoxes, used: [...used], skipped, missing,
    C: SH.buildColliders(SH.buildMap(arena)) };   // 機器人與命中判定用的方塊（跟 glb 同一組數字）
  if (missing.length) console.warn(`[${arena}] glb 缺少碰撞物件`, missing);
  arenas.set(arena, info);
  return info;
}

/* ---------- 燈光／天空 ---------- */
let hemi, sun, sky, envGroup;
export function setupLook(scene, renderer) {
  scene.fog = new THREE.FogExp2(0x000000, .008);
  hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1); scene.add(hemi);
  sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(-18, 34, 14); sun.target.position.set(0, 0, 0);
  if (!MOBILE) {
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    const c = sun.shadow.camera; c.left = -32; c.right = 32; c.top = 32; c.bottom = -32; c.near = 1; c.far = 90;
    sun.shadow.bias = -.0005; sun.shadow.normalBias = .03;
  }
  scene.add(sun, sun.target);
  // 漸層天空球（不吃霧）
  sky = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uC: { value: [new THREE.Color(), new THREE.Color(), new THREE.Color()] } },
    vertexShader: 'varying vec3 p;void main(){p=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: 'uniform vec3 uC[3];varying vec3 p;void main(){float h=normalize(p).y;vec3 c=mix(uC[1],uC[0],smoothstep(0.,.6,h));c=mix(uC[2],c,smoothstep(-.2,0.,h));gl_FragColor=vec4(c,1.);}' }));
  sky.renderOrder = -1; scene.add(sky);
  envGroup = new THREE.Group(); scene.add(envGroup);
}
export function applyLook(scene, arena) {
  const L = ARENA_LOOK[arena] || ARENA_LOOK.city;
  scene.fog.color.set(L.fog); scene.fog.density = L.fogD;
  // r155 之後燈光改用物理單位，原版（r128 legacy lights）的強度要乘 π 才接近原本亮度
  hemi.color.set(L.hemi[0]); hemi.groundColor.set(L.hemi[1]); hemi.intensity = L.hemi[2] * Math.PI;
  sun.color.set(L.sun[0]); sun.intensity = L.sun[1] * Math.PI * .8;
  L.sky.forEach((c, i) => sky.material.uniforms.uC.value[i].set(c));
  for (const [id, a] of arenas) a.root.visible = id === arena;
}

/* ---------- 道具與中繼站外觀 ---------- */
export function buildPickups(scene, shieldG, boostG) {
  const items = [];
  for (const p of SH.PICKUPS) {
    const src = p.type === 'shield' ? shieldG : boostG, g = new THREE.Group();
    let core;
    if (src) { const m = prepare(src.scene.clone(true)); g.add(m); core = m.getObjectByName('Core') || m; }
    else { core = new THREE.Mesh(new THREE.OctahedronGeometry(.35), new THREE.MeshBasicMaterial({ color: p.type === 'shield' ? 0x2ef2ff : 0xffb43a, toneMapped: false })); core.position.y = .85; g.add(core); }
    g.position.set(p.x, p.y, p.z); scene.add(g);
    items.push({ g, core, baseY: core.position.y });
  }
  return items;
}
export function buildZone(scene) {
  const Z = SH.KOTH_ZONE, w = Z.x1 - Z.x0;
  const mat = new THREE.MeshBasicMaterial({ color: 0x2ef2ff, transparent: true, opacity: .14, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  const g = new THREE.Group();
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(w * .72, w * .72, 2.4, 40, 1, true), mat); wall.position.y = Z.y0 + 1.4; g.add(wall);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(w * .72, .04, 6, 64), new THREE.MeshBasicMaterial({ color: 0x2ef2ff, toneMapped: false }));
  ring.rotation.x = Math.PI / 2; ring.position.y = Z.y0 + .45; g.add(ring);
  g.visible = false; scene.add(g);
  return { g, mat, ring };
}
