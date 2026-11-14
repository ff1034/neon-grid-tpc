// 彈道光束、槍口火光、命中火花、簡單合成音效
import * as THREE from 'three';

let scene;
const beams = [], flashes = [], sparks = [];
const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).rotateX(Math.PI / 2).translate(0, 0, .5);
let spriteTex;
function glowTex() {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.35, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
}
export function initFX(s) {
  scene = s; spriteTex = glowTex();
  for (let i = 0; i < 64; i++) {
    const m = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    m.visible = false; m.frustumCulled = false; scene.add(m); beams.push({ m, t: 0, life: .1, r: .02 });
  }
  for (let i = 0; i < 24; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: spriteTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
    sp.visible = false; scene.add(sp); flashes.push({ s: sp, t: 0, life: .06, size: .4 });
  }
  for (let i = 0; i < 48; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: spriteTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
    sp.visible = false; scene.add(sp); sparks.push({ s: sp, t: 0, life: .25, size: .3 });
  }
}
let bi = 0, fi = 0, si = 0;
const _d = new THREE.Vector3();
export function beam(a, b, color, kind = 0) {
  const B = beams[bi++ % beams.length], len = a.distanceTo(b);
  if (len < .05) return;
  B.m.position.copy(a); B.m.lookAt(b); B.r = kind === 2 ? .045 : kind === 1 ? .012 : .022;
  B.m.scale.set(B.r, B.r, len); B.m.material.color.set(color).multiplyScalar(kind === 2 ? 4 : 3);
  B.t = B.life = kind === 2 ? .35 : kind === 1 ? .09 : .07; B.m.visible = true;
}
export function flash(p, color, size = .45) {
  const F = flashes[fi++ % flashes.length]; F.s.position.copy(p); F.s.material.color.set(color).multiplyScalar(3);
  F.size = size; F.t = F.life = .06; F.s.visible = true;
}
export function spark(p, color, size = .35) {
  const S = sparks[si++ % sparks.length]; S.s.position.copy(p); S.s.material.color.set(color).multiplyScalar(2.5);
  S.size = size; S.t = S.life = .22; S.s.visible = true;
}
/* ---------- 戰敗消失特效：沿身體高度爆出代表色碎片 + 白色閃光 + 光柱 + 地面擴散環 ---------- */
const shards = [], bursts = [];
let shi = 0;
function initDeathFX() {
  const g = new THREE.BoxGeometry(.075, .075, .075);
  for (let i = 0; i < 180; i++) {
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ transparent: true, toneMapped: false, depthWrite: false }));
    m.visible = false; m.frustumCulled = false; scene.add(m);
    shards.push({ m, v: new THREE.Vector3(), r: new THREE.Vector3(), t: 0, life: 1 });
  }
  const colGeo = new THREE.CylinderGeometry(.45, .45, 1, 20, 1, true).translate(0, .5, 0);
  const ringGeo = new THREE.RingGeometry(.8, 1, 40).rotateX(-Math.PI / 2);
  for (let i = 0; i < 6; i++) {
    const col = new THREE.Mesh(colGeo, new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
    col.visible = ring.visible = false; col.frustumCulled = ring.frustumCulled = false; scene.add(col, ring);
    bursts.push({ col, ring, t: 0, life: .9 });
  }
}
let bsi = 0;
/** pos：腳底位置；color：玩家代表色 */
export function deathBurst(pos, color) {
  if (!shards.length) initDeathFX();
  const c = new THREE.Color(color);
  for (let i = 0; i < 44; i++) {
    const S = shards[shi++ % shards.length], h = Math.random() * 1.8, a = Math.random() * Math.PI * 2, rr = .1 + Math.random() * .25;
    S.m.position.set(pos.x + Math.cos(a) * rr, pos.y + h, pos.z + Math.sin(a) * rr);
    S.v.set(Math.cos(a) * (1 + Math.random() * 3), 1.5 + Math.random() * 3.5, Math.sin(a) * (1 + Math.random() * 3));
    S.r.set(Math.random() * 10, Math.random() * 10, Math.random() * 10);
    S.m.material.color.copy(i % 4 === 0 ? new THREE.Color(1, 1, 1) : c).multiplyScalar(2.6);
    S.t = S.life = .7 + Math.random() * .6; S.m.scale.setScalar(.6 + Math.random() * .9); S.m.visible = true;
  }
  const B = bursts[bsi++ % bursts.length];
  B.col.position.set(pos.x, pos.y, pos.z); B.ring.position.set(pos.x, pos.y + .04, pos.z);
  B.col.material.color.copy(c).multiplyScalar(2); B.ring.material.color.copy(c).multiplyScalar(2.5);
  B.t = B.life; B.col.visible = B.ring.visible = true;
  flash(new THREE.Vector3(pos.x, pos.y + 1, pos.z), 0xffffff, 1.6);
}
function updateDeathFX(dt) {
  for (const S of shards) if (S.m.visible) {
    S.t -= dt; if (S.t <= 0) { S.m.visible = false; continue; }
    S.v.y -= 9 * dt; S.m.position.addScaledVector(S.v, dt);
    S.m.rotation.x += S.r.x * dt; S.m.rotation.y += S.r.y * dt;
    S.m.material.opacity = Math.min(1, S.t / S.life * 1.6);
  }
  for (const B of bursts) if (B.col.visible) {
    B.t -= dt; if (B.t <= 0) { B.col.visible = B.ring.visible = false; continue; }
    const k = 1 - B.t / B.life;
    B.col.scale.set(1 - k * .8, 2.2 + k * 3, 1 - k * .8); B.col.material.opacity = (1 - k) * .55;
    B.ring.scale.setScalar(.3 + k * 2.6); B.ring.material.opacity = 1 - k;
  }
}

export function updateFX(dt) {
  updateDeathFX(dt);
  for (const B of beams) if (B.m.visible) { B.t -= dt; if (B.t <= 0) B.m.visible = false; else { const k = B.t / B.life; B.m.material.opacity = k; B.m.scale.x = B.m.scale.y = B.r * (.4 + .6 * k); } }
  for (const F of flashes) if (F.s.visible) { F.t -= dt; if (F.t <= 0) F.s.visible = false; else { F.s.scale.setScalar(F.size * (.6 + F.t / F.life)); F.s.material.rotation = Math.random() * 6; } }
  for (const S of sparks) if (S.s.visible) { S.t -= dt; if (S.t <= 0) S.s.visible = false; else { const k = S.t / S.life; S.s.scale.setScalar(S.size * (1.5 - k)); S.s.material.opacity = k; } }
}

/* ---------- 音效：WebAudio 即時合成，不需要音檔 ---------- */
let ac = null, master = null;
export function audioUnlock() {
  if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
  try { ac = new (window.AudioContext || window.webkitAudioContext)(); master = ac.createGain(); master.gain.value = .35; master.connect(ac.destination); } catch (e) { ac = null; }
}
function tone(type, f0, f1, dur, vol, when = 0) {
  if (!ac) return; const t = ac.currentTime + when, o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur); o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + .02);
}
function noise(dur, vol, hp = 800) {
  if (!ac) return; const n = ac.sampleRate * dur | 0, buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(); s.buffer = buf; f.type = 'highpass'; f.frequency.value = hp; g.gain.value = vol;
  s.connect(f); f.connect(g); g.connect(master); s.start();
}
export const SFX = {
  fire(wi, near = 1) {
    const v = .5 * near;
    if (wi === 0) { tone('square', 900, 180, .09, .18 * v); noise(.05, .12 * v, 1500); }
    else if (wi === 1) { tone('sawtooth', 420, 60, .2, .22 * v); noise(.16, .25 * v, 500); }
    else { tone('sawtooth', 1600, 90, .45, .22 * v); tone('sine', 120, 40, .4, .35 * v); noise(.3, .2 * v, 300); }
  },
  hit() { tone('triangle', 1800, 1500, .05, .2); },
  kill() { tone('triangle', 900, 1800, .12, .25); tone('triangle', 1350, 2400, .14, .2, .08); },
  hurt() { tone('sine', 220, 90, .15, .3); noise(.08, .1, 400); },
  reload() { tone('square', 300, 500, .06, .08); tone('square', 500, 300, .06, .08, .12); },
  pickup() { tone('sine', 600, 1200, .18, .25); },
  beep(hi = false) { tone('sine', hi ? 1320 : 880, hi ? 1320 : 880, .12, .2); },
};
