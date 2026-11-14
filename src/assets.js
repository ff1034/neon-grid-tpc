// 模型載入與材質整理（沿用原遊戲 models.js 的規則，改成 three r169 的 ESM 寫法）
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

// 手機與平板讀 _low 版（角色、武器、地圖都有）；找不到再退回電腦版
export const MOBILE = matchMedia('(pointer:coarse)').matches || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
const HAS_LOW = new Set(['mech', 'agent', 'gun_pulse', 'gun_arc', 'gun_rail', 'arena', 'arena_underground', 'arena_skyfort', 'arena_magma', 'arena_coastal']);
const loader = new GLTFLoader();
const cache = new Map();

export function arenaFile(id) { return id === 'city' ? 'arena' : 'arena_' + id; }

/** 讀 models/<name>.glb（手機優先 _low），結果快取；失敗回傳 null。 */
export function loadModel(name) {
  if (cache.has(name)) return cache.get(name);
  const files = MOBILE && HAS_LOW.has(name) ? [name + '_low', name] : [name];
  const p = (async () => {
    for (const f of files) {
      try { const g = await loader.loadAsync(`./models/${f}.glb`); g.file = f; return g; } catch (e) { console.warn('載入失敗', f, e); }
    }
    return null;
  })();
  cache.set(name, p);
  return p;
}

const glowCache = new Map();
export function glowMat(color, k = 2.4) {
  const c = new THREE.Color(color), key = c.getHexString() + k;
  if (!glowCache.has(key)) glowCache.set(key, new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(k), toneMapped: false }));
  return glowCache.get(key);
}
function isGlow(m) {
  if (/glow|neon/i.test(m.name)) return true;
  const e = m.emissive; return !!e && e.r + e.g + e.b > 0.15;
}
/** 依建模規格換材質：TeamColor → 玩家代表色、TeamGlow → 代表色發光、名稱含 Glow/Neon 或有 Emission → 發光。 */
export function prepare(root, { team = null, glowK = 2.4, shadow = true } = {}) {
  root.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = shadow; o.receiveShadow = shadow;
    const conv = m => {
      if (team !== null && m.name === 'TeamColor') { const n = m.clone(); n.color.set(team); return n; }
      if (team !== null && m.name === 'TeamGlow') return glowMat(team, glowK);
      if (isGlow(m)) { const e = m.emissive && m.emissive.getHex() ? m.emissive : m.color; return glowMat(e, /window/i.test(m.name) ? 1.1 : glowK); }
      return m;
    };
    o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
    if ((Array.isArray(o.material) ? o.material : [o.material]).some(m => m.transparent)) o.castShadow = false;
  });
  return root;
}

/** 角色／武器面朝 Blender -Y（glTF +Z）：轉 180° 讓它們面朝 -Z（跟原遊戲相同） */
export function faceForward(obj) { obj.rotation.y = Math.PI; return obj; }

/* ---------- 角色設定檔 ----------
 * mech：Quaternius Universal Animation Library（CC0）的 Mannequin 骨架 + 機甲裝甲（blender/gen_mech_ual.py）
 * agent：原版 agent.glb（17 根骨頭；mech 讀不到時的備援）
 * base：移動動作；aim：上半身一直疊著的持槍姿勢；fire/reload：上半身一次性動作；upper：上半身從哪根骨頭開始（含子孫）；
 * pitch：瞄準俯仰加在哪些骨頭上（骨頭 X 軸，抬頭方向的正負號 sign） */
export const CHARS = {
  mech: { file: 'mech', idle: 'Pistol_Idle_Loop', run: 'Jog_Fwd_Loop', runSpeed: 4.6, jump: 'Jump_Loop', tpcJump: ['Jump_Start', 'Jump_Loop', 'Jump_Land'],
    aim: 'Pistol_Idle_Loop', fire: 'Pistol_Shoot', reload: 'Pistol_Reload', upper: 'spine_03', aimWeight: 6, shotWeight: 14,
    pitch: [['spine_02', .3], ['spine_03', .35], ['neck_01', .3]], sign: -1 },
  agent: { file: 'agent', idle: 'Idle', run: 'Run', runSpeed: 6, jump: 'Jump', tpcJump: 'Jump',
    aim: null, fire: 'Fire', reload: 'Reload', upper: null, aimWeight: 0, shotWeight: 4,
    pitch: [['Spine', .35], ['Chest', .35], ['Neck', .3]], sign: -1 } };

/** 只留 root 骨頭與其子孫的軌道（上半身動作疊在跑步上時不會動到腿） */
function upperClip(clip, model, rootName) {
  const root = model.getObjectByName(rootName); if (!root) return clip;
  const keep = new Set(); root.traverse(o => keep.add(o.name));
  return new THREE.AnimationClip(clip.name + '_upper', clip.duration, clip.tracks.filter(t => keep.has(t.name.split('.')[0])));
}

/** 機器人用的角色：每隻一份骨架與 mixer。 */
export function makeAgent(gltf, color, cfg) {
  const model = faceForward(prepare(SkeletonUtils.clone(gltf.scene), { team: color }));
  return rigAgent(model, gltf.animations, null, cfg);
}
/** mixer 給套件的（本機玩家）時只用疊加層（aim / fire / reload）與俯仰，移動動作交給套件。 */
export function rigAgent(model, animations, mixer = null, cfg = CHARS.agent) {
  mixer = mixer || new THREE.AnimationMixer(model);
  const clip = n => animations.find(c => c.name === n);
  const acts = {};
  for (const k of ['idle', 'run', 'jump']) { const c = clip(cfg[k]); if (c) acts[k] = mixer.clipAction(c); }
  for (const k of ['fire', 'reload']) {
    const c = clip(cfg[k]); if (!c) continue;
    const a = acts[k] = mixer.clipAction(cfg.upper ? upperClip(c, model, cfg.upper) : c);
    a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = false;
  }
  if (cfg.aim && clip(cfg.aim)) { acts.aim = mixer.clipAction(upperClip(clip(cfg.aim), model, cfg.upper)); acts.aim.setEffectiveWeight(cfg.aimWeight).play(); }
  const bones = {};
  model.traverse(o => { if (o.isBone) bones[o.name] = o; });
  let base = null;
  return {
    model, mixer, bones, cfg, muzzle: model.getObjectByName('Muzzle'),
    /** name：'idle' | 'run' | 'jump' */
    setBase(name, timeScale = 1) {
      const a = acts[name]; if (!a) return;
      a.setEffectiveTimeScale(timeScale);
      if (base === name) return;
      if (base && acts[base]) acts[base].fadeOut(.15);
      a.reset().setEffectiveWeight(1).fadeIn(.15).play(); base = name;
    },
    /** name：'fire' | 'reload'；duration 給了就把動作縮放到這個秒數 */
    oneShot(name, duration = 0) {
      const a = acts[name]; if (!a) return;
      const ts = duration ? a.getClip().duration / duration : 1;
      a.reset().setEffectiveTimeScale(ts).setEffectiveWeight(cfg.shotWeight).play();
    },
    /** 瞄準俯仰加在動畫之上 */
    aim(pitch) { for (const [n, k] of cfg.pitch) if (bones[n]) bones[n].rotateX(cfg.sign * pitch * k); },
  };
}

/* ---------- 招牌文字（地圖 glb 在側樓上留了 Sign_1…4 平面） ---------- */
export const ARENA_SIGNS = {
  city: { Sign_1: ['鷺光電機', 'HERON ELECTRIC', '#2ef2ff'], Sign_2: ['霓虹保險', 'NEON SURETY', '#ff2fb4'], Sign_3: ['網咖', 'NET CAFE 24H', '#ffb43a'], Sign_4: ['雨巷拉麵', 'RAIN ALLEY RAMEN', '#ff2fb4'] },
  underground: { Sign_1: ['高壓危險', 'HIGH VOLTAGE', '#ff5a1a'], Sign_2: ['反應爐 07', 'REACTOR 07', '#ffb43a'], Sign_3: ['冷卻迴路', 'COOLANT LOOP', '#ff2a2a'], Sign_4: ['電網核心', 'GRID CORE', '#ffb43a'] },
  skyfort: { Sign_1: ['天穹要塞', 'SKYFORT', '#2ef2ff'], Sign_2: ['A 區', 'SECTOR A', '#ff2fb4'], Sign_3: ['B 區', 'SECTOR B', '#ff2fb4'], Sign_4: ['更高・更快', 'HIGHER FASTER', '#2ef2ff'] },
  magma: { Sign_1: ['熔岩工業區', 'MAGMA WORKS', '#ff5a1a'], Sign_2: ['鍛造明天', 'FORGE TOMORROW', '#ffb43a'], Sign_3: ['高溫危險', 'HEAT HAZARD', '#ff2a2a'], Sign_4: ['B2 熔爐', 'FURNACE B2', '#ffb43a'] },
  coastal: { Sign_1: ['海岸研究站', 'COASTAL LAB', '#2ef2ff'], Sign_2: ['海洋研究', 'OCEAN RESEARCH', '#4ad8ff'], Sign_3: ['A 棟實驗室', 'LAB A', '#2ef2ff'], Sign_4: ['潔淨海洋', 'CLEANER OCEAN', '#4ad8ff'] } };

function signTex(title, sub, col, w = 768, h = 274) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  g.fillStyle = 'rgba(4,8,16,.82)'; g.fillRect(0, 0, w, h);
  g.strokeStyle = col; g.lineWidth = 6; g.shadowColor = col; g.shadowBlur = 18; g.strokeRect(12, 12, w - 24, h - 24);
  g.fillStyle = col; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '900 120px "Noto Sans TC",sans-serif'; g.fillText(title, w / 2, h * .42, w - 60);
  g.shadowBlur = 8; g.font = '700 42px "Chakra Petch",sans-serif'; g.fillText(sub, w / 2, h * .8, w - 60);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; return t;
}
export function paintSigns(root, table) {
  for (const [name, [t, sub, col]] of Object.entries(table || {})) {
    const o = root.getObjectByName(name);
    if (!o) continue;
    o.traverse(m => { if (m.isMesh) { m.material = new THREE.MeshBasicMaterial({ map: signTex(t, sub, col), color: new THREE.Color(1.3, 1.3, 1.3), toneMapped: false, transparent: true }); m.castShadow = false; } });
  }
}

export function nameTag(name, color) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d');
  g.font = '700 30px "Noto Sans TC","Chakra Petch",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const w = Math.min(250, g.measureText(name).width + 30);
  g.fillStyle = 'rgba(4,8,18,.6)'; g.fillRect(128 - w / 2, 10, w, 44);
  g.fillStyle = '#' + new THREE.Color(color).getHexString(); g.fillRect(128 - w / 2, 52, w, 2);
  g.fillStyle = '#fff'; g.fillText(name, 128, 32);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, fog: false }));
  s.scale.set(1.5, .375, 1); return s;
}
