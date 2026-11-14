// NEON GRID TPC：開機、選單、對戰流程、主迴圈
import * as THREE from 'three';
import * as SH from './shared.js';
import { MOBILE, loadModel, makeAgent, nameTag, CHARS } from './assets.js';
import { loadArena, setupLook, applyLook, buildPickups, buildZone } from './arena.js';
import { Match } from './match.js';
import { LocalPlayer } from './player.js';
import { HUD } from './hud.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { initFX, updateFX, beam, flash, spark, deathBurst, SFX, audioUnlock } from './fx.js';
import { NetMatch, LoopServer } from './net.js';

const $ = s => document.querySelector(s);
if (MOBILE) document.body.classList.add('touch');

/* ---------- 設定（記在 localStorage，讀寫失敗也照常運作） ---------- */
const S = Object.assign({ arena: 'random', mode: 'ffa', diff: 'normal', bots: 3, name: '' }, (() => { try { return JSON.parse(localStorage.getItem('ngtpc') || '{}'); } catch (e) { return {}; } })());
const saveS = () => { try { localStorage.setItem('ngtpc', JSON.stringify(S)); } catch (e) { } };

/* ---------- three ---------- */
const TEST = new URLSearchParams(location.search).has('test');
const renderer = new THREE.WebGLRenderer({ antialias: !MOBILE, powerPreference: 'high-performance', preserveDrawingBuffer: TEST });
renderer.setPixelRatio(Math.min(devicePixelRatio, MOBILE ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = !MOBILE; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('#game').appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, .05, 700);
camera.position.set(18, 9, 18); camera.lookAt(0, 3, 0);
setupLook(scene, renderer); initFX(scene);
// 霓虹泛光（電腦版）：發光材質是 toneMapped:false 的 HDR 顏色，亮度超過門檻的部分會暈開
let composer = null;
if (!MOBILE) {
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), .55, .4, 1.05));
  composer.addPass(new OutputPass());
}
const player = new LocalPlayer(scene, camera, renderer);
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight); composer && composer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  if (player.ctrl) player.resize();
});

/* ---------- 資產 ---------- */
const A = {};
let pickupViews = [], zoneView = null;
async function boot() {
  const bar = $('#boot .bar i'), names = ['mech', 'gun_pulse', 'gun_arc', 'gun_rail', 'pickup_shield', 'pickup_boost'];
  let n = 0;
  await Promise.all(names.map(async k => { A[k] = await loadModel(k); bar.style.width = (++n / (names.length + 1) * 100) + '%'; }));
  // 角色：mech.glb（UAL 骨架機甲），讀不到就退回原版 agent.glb
  A.cfg = CHARS.mech; A.char = A.mech;
  if (!A.char) { A.cfg = CHARS.agent; A.char = await loadModel('agent'); }
  if (!A.char) { $('#bootText').textContent = '角色模型載入失敗（models/mech.glb、agent.glb）'; return; }
  await loadArena(scene, 'city'); bar.style.width = '100%';
  applyLook(scene, 'city');
  pickupViews = buildPickups(scene, A.pickup_shield, A.pickup_boost);
  zoneView = buildZone(scene);
  HUD.init(); buildMenu();
  $('#boot').classList.add('hidden'); showMenu();
}

/* ---------- 選單 ---------- */
function seg(el, items, key) {
  el.innerHTML = items.map(([v, t]) => `<button data-v="${v}">${t}</button>`).join('');
  const mark = () => el.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === String(S[key])));
  el.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S[key] = typeof S[key] === 'number' ? +b.dataset.v : b.dataset.v; saveS(); mark(); });
  mark();
}
function buildMenu() {
  seg($('#optArena'), [['random', '隨機'], ...SH.ARENA_ORDER.map(a => [a, SH.ARENAS[a].name])], 'arena');
  seg($('#optMode'), Object.values(SH.MODES).map(m => [m.id, `${m.name}<small style="color:var(--muted)">・${m.desc}</small>`]), 'mode');
  seg($('#optDiff'), [['easy', '簡單'], ['normal', '普通'], ['hard', '困難']], 'diff');
  seg($('#optBots'), [1, 2, 3, 5, 7].map(n => [n, String(n)]), 'bots');
  $('#startBtn').onclick = () => startMatch();
  $('#onlineBtn').onclick = () => startOnline();
  $('#nameInput').value = S.name;
  $('#nameInput').addEventListener('input', e => { S.name = e.target.value.slice(0, 16); saveS(); });
  $('#againBtn').onclick = () => { if (match && match.net) $('#results').classList.add('hidden'); else startMatch(true); };
  $('#menuBtn').onclick = () => { $('#results').classList.add('hidden'); quit(); };
  $('#resumeBtn').onclick = () => resume();
  $('#quitBtn').onclick = () => { $('#pause').classList.add('hidden'); quit(); };
}
let state = 'menu';   // menu | loading | match | results
function showMenu() { state = 'menu'; $('#netStatus').textContent = ''; if (camera.parent !== scene) scene.attach(camera); camera.rotation.set(0, 0, 0); camera.clearViewOffset(); $('#menu').classList.remove('hidden'); HUD.show(false); HUD.death(false); }

/* ---------- 對戰 ---------- */
let match = null, lastArena = null, killer = null, paused = false, loopServer = null, shownArena = null;
const views = new Map();   // 自己以外每位玩家（機器人、連線的真人）的角色模型
function clearViews() { for (const v of views.values()) scene.remove(v.g); views.clear(); }
function viewOf(p) {
  let v = views.get(p);
  if (v && v.name !== p.name + p.color) { scene.remove(v.g); v = null; }   // 連線時名字／顏色晚一點才知道
  if (!v) {
    const g = new THREE.Group(), rig = makeAgent(A.char, p.color, A.cfg), tag = nameTag(p.name, p.color);
    tag.position.y = 2.2; g.add(rig.model, tag); scene.add(g);
    v = { p, g, rig, name: p.name + p.color }; views.set(p, v);
  }
  return v;
}
function syncViews() {
  const others = new Set(match.players.filter(p => p !== match.me));
  for (const [p, v] of views) if (!others.has(p)) { scene.remove(v.g); views.delete(p); }
  for (const p of others) viewOf(p);
}
async function startMatch(again = false) {
  audioUnlock();
  $('#menu').classList.add('hidden'); $('#results').classList.add('hidden');
  let arena = S.arena;
  if (arena === 'random') { const rest = SH.ARENA_ORDER.filter(a => a !== lastArena); arena = rest[Math.floor(Math.random() * rest.length)]; }
  lastArena = arena;
  state = 'loading'; HUD.show(true); HUD.msg('載入地圖…', 0);
  if (!MOBILE) renderer.domElement.requestPointerLock?.()?.catch?.(() => { });
  const info = await loadArena(scene, arena);
  applyLook(scene, arena);
  if (match && match.net) match.leave();
  clearViews();
  match = new Match({ arena, mode: S.mode, diff: S.diff, bots: S.bots, C: info.C, myColor: SH.PLAYER_COLORS[0], hooks });
  if (!player.ctrl) {
    await player.init({ agentGltf: A.char, cfg: A.cfg, guns: [A.gun_pulse, A.gun_arc, A.gun_rail], colliderMeshes: info.colliderMeshes, color: match.me.color, spawnFeet: match.me.pos });
  } else {
    player.setColliders(info.colliderMeshes);
  }
  player.respawn(match.me);
  syncViews();
  killer = null; paused = false; HUD.death(false);
  state = 'match'; HUD.msg(String(Math.ceil(match.t)), 1);
  SFX.beep();
}
/* ---------- 連線對戰 ---------- */
async function startOnline() {
  audioUnlock();
  const st = $('#netStatus');
  if (!S.name.trim()) { st.textContent = '先輸入暱稱'; $('#nameInput').focus(); return; }
  // ?loop：伺服器核心直接在這個分頁裡跑（不需要 Cloudflare），用來測試
  const qs = new URLSearchParams(location.search), loop = qs.has('loop');
  if (loop && !loopServer) loopServer = new LoopServer({}, qs.get('loop') === 'sync');   // ?loop=sync：測試用，伺服器跟著 __NG.tick 走
  if (match && match.net) match.leave();
  clearViews();
  let fatal = '';
  match = new NetMatch({ socket: loop ? loopServer.socket() : null, name: S.name, hooks,
    onStatus: (text, isFatal) => { st.textContent = text; if (isFatal) { fatal = text; if (state === 'match' || state === 'results' || state === 'loading') { quit(); $('#netStatus').textContent = text; } } } });
  const m = match;
  // 等伺服器把自己放到重生點（welcome + 第一筆 sp 事件）
  for (let i = 0; i < 100 && !fatal && !(m.me && m.sn > 0); i++) { if (loopServer && loopServer.manual) loopServer.pump(); await new Promise(r => setTimeout(r, 80)); }
  if (match !== m) return;
  if (!(m.me && m.sn > 0)) { m.leave(); match = null; st.textContent = fatal || '伺服器沒有回應'; return; }
  $('#menu').classList.add('hidden'); $('#results').classList.add('hidden');
  state = 'loading'; HUD.show(true); HUD.msg('載入地圖…', 0);
  if (!MOBILE) renderer.domElement.requestPointerLock?.()?.catch?.(() => { });
  const info = await loadArena(scene, m.arena); shownArena = m.arena;
  if (match !== m) return;
  applyLook(scene, m.arena);
  if (!player.ctrl) await player.init({ agentGltf: A.char, cfg: A.cfg, guns: [A.gun_pulse, A.gun_arc, A.gun_rail], colliderMeshes: info.colliderMeshes, color: m.me.color, spawnFeet: m.me.pos });
  else player.setColliders(info.colliderMeshes);
  player.respawn(m.me); syncViews();
  killer = null; paused = false; HUD.death(false);
  state = m.state === 'results' ? 'results' : 'match';
  HUD.msg(m.state === 'waiting' || m.state === 'countdown' ? '準備開始' : '加入對戰', 1.2);
}
function quit() {
  if (match && match.net) match.leave();
  match = null; clearViews();
  if (document.pointerLockElement) document.exitPointerLock();
  showMenu();
}
function pause() { if (state !== 'match' || paused) return; paused = true; player.firing = false; $('#pause').classList.remove('hidden'); HUD.board(match, false); }
function resume() {
  $('#pause').classList.add('hidden'); paused = false; audioUnlock();
  if (!MOBILE) renderer.domElement.requestPointerLock?.()?.catch?.(() => { });
}
// ?test：自動化測試時沒有滑鼠鎖定，不要因為沒鎖定就暫停
document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement && !MOBILE && !TEST && state === 'match') pause(); });

const hooks = {
  // 連線版：伺服器換地圖、換回合、退回位置、名單變動
  onArena(a) {
    const m = match;
    loadArena(scene, a).then(info => { if (match !== m || m.arena !== a) return; shownArena = a; applyLook(scene, a); if (player.ctrl) { player.setColliders(info.colliderMeshes); player.respawn(m.me); } });
  },
  onNewRound() { if (match && match.net && state === 'results') { state = 'match'; $('#results').classList.add('hidden'); } },
  onFix(me) { if (player.ctrl && !player.dead) player.respawn(me); },
  onRoster() { if (state === 'match' || state === 'results') syncViews(); },
  onCount(n) { HUD.msg(String(n), 1); SFX.beep(); },
  onStart() { HUD.msg('開戰！', 1.2); SFX.beep(true); },
  onSpawn(p) { if (p === match?.me && player.ctrl && state === 'match') { player.respawn(p); HUD.death(false); killer = null; } },
  onShot(a, o, ends) {
    const w = SH.WEAPONS[a.wi], me = match.me;
    const from = a === me ? player.muzzle() : (() => { const v = viewOf(a); if (v && v.rig.muzzle) { v.g.updateMatrixWorld(true); return v.rig.muzzle.getWorldPosition(new THREE.Vector3()); } return new THREE.Vector3(o.x, o.y - .3, o.z); })();
    flash(from, w.color, [.35, .55, .5][a.wi] * (a === me && player.firstPerson ? .35 : 1));   // 第一人稱槍口就在眼前，火光縮小
    for (const e of ends) { const to = new THREE.Vector3(e.x, e.y, e.z); beam(from, to, w.color, a.wi); if (e.hit || e.n) spark(to, e.hit ? 0xffffff : w.color, e.hit ? .45 : .3); }
    if (a === me) SFX.fire(a.wi, 1);
    else { const d = Math.hypot(a.pos.x - me.pos.x, a.pos.z - me.pos.z); SFX.fire(a.wi, Math.max(.08, 1 - d / 45)); const v = viewOf(a); v && v.rig.oneShot('fire', Math.max(.22, Math.min(.6, 1 / w.rate))); }
  },
  onReload(b) { const v = viewOf(b); v && v.rig.oneShot('reload', SH.WEAPONS[b.wi].reload); },
  onHit(a, t, d, kill) {
    if (a === match.me && t !== a) { HUD.hit(kill); if (!kill) SFX.hit(); }
    if (t === match.me && d > 0) { HUD.hurt(); SFX.hurt(); }
  },
  onKill(a, t, wi) {
    const w = SH.WEAPONS[wi];
    if (t !== match.me) deathBurst(t.pos, t.color);   // 戰敗消失特效（自己的在第一人稱看不到，不放）
    HUD.feed(a && a !== t ? `${HUD.name(a)} <span style="color:var(--muted)">[${w ? w.short : ''}]</span> ${HUD.name(t)}` : `${HUD.name(t)} 掉出場外`);
    if (a === match.me && t !== a) { SFX.kill(); if (match.mode === 'ffa') HUD.msg(`淘汰 ${t.name}`, 1.1); }
    if (t === match.me) { killer = a; player.setDead(true); player.firing = false; }
  },
  onPickup(p, pk) { if (p === match.me) { SFX.pickup(); HUD.msg(pk.type === 'shield' ? '護盾 +50' : '加速 6 秒', .9); } },
  onEnd(reason) {
    state = 'results'; player.firing = false; HUD.death(false); HUD.board(match, false);
    if (document.pointerLockElement) document.exitPointerLock();
    HUD.results(match, reason);
    $('#againBtn').textContent = match.net ? '繼續（等下一場）' : '再來一場';
    $('#menuBtn').textContent = match.net ? '離開房間' : '回主選單';
    setTimeout(() => { if (state === 'results') $('#results').classList.remove('hidden'); }, 600);
  },
};

/* ---------- 輸入（移動／跳躍／視角由套件處理；這裡只管射擊相關） ---------- */
let boardHeld = false;
addEventListener('mousedown', e => { if (e.button === 0 && (document.pointerLockElement || TEST) && e.target === renderer.domElement && state === 'match' && !paused) { player.firing = true; audioUnlock(); } });
addEventListener('mouseup', e => { if (e.button === 0) player.firing = false; });
addEventListener('keydown', e => {
  if (state !== 'match' || !match) return;
  const me = match.me;
  if (e.code === 'Tab') { e.preventDefault(); boardHeld = true; }
  else if (e.code === 'KeyR') { if (player.reload(me)) SFX.reload(); }
  else if (/^Digit[123]$/.test(e.code)) player.switchTo(me, +e.code.slice(5) - 1);
  else if (e.code === 'KeyQ') player.switchTo(me, (me.wi + 1) % 3);
});
addEventListener('keyup', e => { if (e.code === 'Tab') boardHeld = false; });
addEventListener('wheel', e => { if (state === 'match' && match && document.pointerLockElement) player.switchTo(match.me, (match.me.wi + (e.deltaY > 0 ? 1 : 2)) % 3); }, { passive: true });
// 手機：射擊鍵按住開火，按住時拖曳也能轉視角；換彈、換槍、暫停
(function touchButtons() {
  const fire = $('#tFire');
  fire.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); audioUnlock(); fire.classList.add('down'); player.firing = true; fire._id = e.pointerId; fire._x = e.clientX; fire._y = e.clientY; try { fire.setPointerCapture(e.pointerId); } catch (er) { } });
  fire.addEventListener('pointermove', e => { if (e.pointerId !== fire._id || !player.ctrl) return; player.ctrl.setInput({ lookDeltaX: e.clientX - fire._x, lookDeltaY: e.clientY - fire._y }); fire._x = e.clientX; fire._y = e.clientY; });
  const up = e => { if (e.pointerId !== fire._id) return; fire._id = null; fire.classList.remove('down'); player.firing = false; };
  fire.addEventListener('pointerup', up); fire.addEventListener('pointercancel', up);
  const tap = (id, fn) => $(id).addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); if (match && state === 'match') fn(match.me); });
  tap('#tReload', me => { if (player.reload(me)) SFX.reload(); });
  tap('#tSwap', me => player.switchTo(me, (me.wi + 1) % 3));
  tap('#pauseBtn', () => pause());
  for (const ev of ['selectstart', 'contextmenu']) document.addEventListener(ev, e => e.preventDefault());
})();

/* ---------- 主迴圈 ---------- */
const clock = new THREE.Clock();
let menuT = 0, lastBoost = false, lastReload = 0, tickN = 0;
function frame(dt) {
  dt = Math.min(dt, .05);
  if (state === 'match' && match && !(paused && !match.net)) {   // 連線時暫停選單不會讓遊戲停下
    const me = match.me;
    if (!player.dead && dt > 1e-4) {
      player.ctrl.update(dt);
      // 保險：控制器位置若出現 NaN（測試時遇過一次），退回上一個正常位置，避免整個畫面變黑
      if (!Number.isFinite(player.ctrl.playerCapsule.position.x + player.ctrl.playerCapsule.position.y)) { console.warn('capsule NaN，退回上一個位置'); player.respawn(me); }
      player.fixCamera();
      player.sync(me);
    }
    if (player.firing && !player.dead && !paused) player.tryShoot(match, me);
    const r = me.ws[me.wi].reload; if (r > 0 && lastReload <= 0) SFX.reload(); lastReload = r;
    match.update(dt);
    if (!player.dead) player.afterUpdate(me);
    if ((me.boostT > 0) !== lastBoost) { lastBoost = me.boostT > 0; player.setBoost(lastBoost); }
    player.updateViewmodel(dt, me);
    if (!me.alive) HUD.death(true, killer, me.respawnT);
    HUD.update(match, me); HUD.board(match, boardHeld);
  } else if (state === 'results' && match && match.net) {
    match.update(dt);   // 連線版結算時也要繼續收快照、回報
  } else if (state === 'menu' && camera.parent === scene) {   // 第一人稱時相機掛在頭骨上，不能拿來做選單運鏡
    menuT += dt; const t = menuT * .05 + .6, R = 22;
    camera.position.set(Math.sin(t) * R, 8 + Math.sin(menuT * .1) * 1.5, Math.cos(t) * R); camera.lookAt(0, 3, 0);
  }
  if (match && state !== 'loading') {
    if (match.net) syncViews();
    zoneView.g.visible = match.mode === 'koth';
    for (const v of views.values()) {
      const b = v.p; v.g.visible = b.alive; if (!b.alive) continue;
      v.g.position.set(b.pos.x, b.pos.y, b.pos.z); v.g.rotation.y = b.yaw;
      const sp = Math.hypot(b.vel.x, b.vel.z);
      if (!b.onGround && b.airT > .15) v.rig.setBase('jump'); else if (sp > .5) v.rig.setBase('run', sp / A.cfg.runSpeed); else v.rig.setBase('idle');
      v.rig.mixer.update(paused ? 0 : dt); v.rig.aim(b.pitch);
    }
    match.pickups.forEach((p, i) => { const pv = pickupViews[i]; if (!pv) return; pv.core.visible = p.on; pv.core.rotation.y += dt * 1.5; pv.core.position.y = pv.baseY + Math.sin(performance.now() / 400 + i) * .08; });
    if (zoneView.g.visible) { const owner = match.zone.owner, col = match.zone.contested ? 0xffb43a : owner === match.me.id ? 0x2ef2ff : owner ? 0xff2fb4 : 0x8fb4ff; zoneView.mat.color.set(col); zoneView.ring.material.color.set(col); zoneView.ring.rotation.z += dt * .5; }
  }
  updateFX(dt);
  if (composer) composer.render(dt); else renderer.render(scene, camera);
  if (state === 'match' || state === 'results') player.renderViewmodel();
}
renderer.setAnimationLoop(() => frame(clock.getDelta()));

// 測試用：瀏覽器面板隱藏時 rAF 會停，可用 __NG.tick(n) 手動推進
window.__NG = { get match() { return match; }, get loopServer() { return loopServer; }, player, scene, camera, renderer, S, startMatch, startOnline, views, tick(n = 60, dt = 1 / 60) { for (let i = 0; i < n; i++) { frame(dt); if (loopServer && loopServer.manual && (tickN = (tickN + 1) % 3) === 0) loopServer.pump(); } },
  // 面板隱藏時 WebGL 畫面不會送出合成，把目前畫面複製成 <img> 疊在上面，截圖才看得到（?test 才有 preserveDrawingBuffer）
  snap(on = true) { let im = document.getElementById('snap'); if (!on) { im && im.remove(); return; }
    if (!im) { im = document.createElement('img'); im.id = 'snap'; im.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:1;pointer-events:none'; document.body.appendChild(im); }
    im.src = renderer.domElement.toDataURL('image/jpeg', .9); } };
boot();
