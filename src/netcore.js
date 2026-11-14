// NEON GRID TPC 連線版的房間核心（跟傳輸方式無關）：Cloudflare Durable Object 跑它，瀏覽器的「迴路測試」也跑它。
// 從原版 core.js（GameCore）改寫。真人玩家的移動與碰撞由各自的瀏覽器（three-player-controller）計算後回報位置，
// 伺服器只檢查位置合不合理；開槍、命中、傷害、擊殺、計分、重生、道具、佔領全部由伺服器用原版 shared.js 判定。
// 機器人跟原版一樣在伺服器上用 shared.js 的方塊物理跑。
import * as SH from './shared.js';
import { buildNav, botInput, newBotAI } from './bot.js';

export const NET_VERSION = 1;
const HZ = 20, DT = 1 / HZ, MAX_MSG_BYTES = 2048, MAX_MSGS_PER_SEC = 60;
const MAX_SPEED = SH.P.speed * SH.P.boostMul + 1.5;   // 水平最快速度（含加速道具）＋容許誤差
const COUNTDOWN = 5, RESULTS = 10;

export class RoomCore {
  constructor(opts = {}) {
    this.o = Object.assign({ maxPlayers: SH.MAX_PLAYERS, fillTo: 4, diff: 'normal', time: SH.MATCH.time,
      scores: { ffa: SH.MODES.ffa.score, koth: SH.MODES.koth.score }, modes: ['ffa', 'koth'], arenas: SH.ARENA_ORDER,
      idleTimeout: 15, now: () => Date.now() / 1000 }, opts);
    this.layouts = {};
    this.conns = new Map(); this.bots = []; this.nextId = 1;
    this.match = { state: 'waiting', t: 0, id: 0, tick: 0, mode: this.o.modes[0], arena: this.o.arenas[Math.floor(Math.random() * this.o.arenas.length)] };
    this.useArena(this.match.arena);
    this.spawnState = SH.SPAWNS.map(() => ({ uses: 0, last: -99 }));
    this.pickups = SH.PICKUPS.map(p => Object.assign({ on: true, at: 0 }, p));
    this.zone = { owner: 0, contested: 0, acc: 0 };
    this.events = []; this.lastPing = 0;
  }
  clock() { return this.o.now(); }

  /* ---------------- 連線 ---------------- */
  connect(tr) {
    const now = this.clock();
    const c = { tr, id: this.nextId++, name: '', where: 'new', last: now, win: 0, winT: now, rtt: 0, p: null };
    this.conns.set(c.id, c);
    return c;
  }
  disconnect(c) {
    if (!this.conns.has(c.id)) return;
    this.conns.delete(c.id);
    if (c.where === 'arena') this.events.push({ k: 'part', id: c.id });
    c.where = 'gone'; c.p = null; this.syncBots(); this.events.push({ k: 'ros', l: this.roster() });
  }
  send(c, obj) { try { c.tr.send(typeof obj === 'string' ? obj : JSON.stringify(obj)); } catch (e) { } }
  humans() { return [...this.conns.values()].filter(c => c.where === 'arena' && c.p); }
  players() { return [...this.humans().map(c => c.p), ...this.bots]; }
  status() { return { state: this.match.state, mode: this.match.mode, arena: this.match.arena, timeLeft: Math.ceil(this.match.t), humans: this.humans().length, bots: this.bots.length, max: this.o.maxPlayers }; }

  message(c, data) {
    if (typeof data !== 'string' || data.length > MAX_MSG_BYTES) return;
    const now = this.clock(); c.last = now;
    if (now - c.winT >= 1) { c.winT = now; c.win = 0; }
    if (++c.win > MAX_MSGS_PER_SEC) return;
    let m; try { m = JSON.parse(data); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;
    const p = c.p;
    switch (m.t) {
      case 'hello':
        if (c.where !== 'new') return;
        if (m.ver !== NET_VERSION) { this.send(c, { t: 'err', code: 'version', ver: NET_VERSION }); try { c.tr.close(1008, 'version'); } catch (e) { } return; }
        if (this.humans().length >= this.o.maxPlayers) { this.send(c, { t: 'err', code: 'full' }); try { c.tr.close(1013, 'full'); } catch (e) { } return; }
        c.name = SH.sanitizeName(m.name); this.enter(c); break;
      case 'st': if (p) this.onState(c, p, m); break;
      case 'fire': if (p) this.onFire(c, p, m); break;
      case 'rl': if (p) SH.startReload(p); break;
      case 'sw': if (p && Number.isInteger(m.i)) SH.switchWeapon(p, m.i); break;
      case 'po': if (Number.isFinite(m.c)) c.rtt = Math.max(0, Math.min(5000, Math.round(now * 1000 - m.c))); break;
    }
  }
  pickColor() { const used = new Set(this.players().map(p => p.color)); return SH.PLAYER_COLORS.find(col => !used.has(col)) ?? SH.PLAYER_COLORS[0]; }
  enter(c) {
    this.syncBots(1);                                   // 機器人先讓位，再挑顏色
    c.where = 'arena'; c.p = SH.newPlayer(c.id, c.name, this.pickColor()); c.p.sn = 0; c.p.lastSt = this.clock();
    if (this.match.state !== 'results') this.spawn(c.p);
    this.send(c, { t: 'welcome', id: c.id, ver: NET_VERSION, roster: this.roster(), m: this.matchInfo() });
    this.events.push({ k: 'ros', l: this.roster() }, { k: 'join', id: c.id });
  }
  /** 房間補滿到 fillTo 人；有真人進來時機器人讓位，沒有真人時全部撤掉 */
  syncBots(extraHumans = 0) {
    const h = this.humans().length + extraHumans;
    const want = h > 0 ? Math.max(0, Math.min(this.o.fillTo, this.o.maxPlayers) - h) : 0;
    let changed = false;
    while (this.bots.length < want) {
      const used = new Set(this.bots.map(b => b.name)), name = SH.BOT_NAMES.find(n => !used.has(n)) || 'BOT';
      const b = SH.newPlayer(this.nextId++, name, this.pickColor()); b.bot = true; b.ai = newBotAI();
      this.bots.push(b); if (this.match.state !== 'results') this.spawn(b); changed = true;
    }
    while (this.bots.length > want) { const [b] = this.bots.splice(0, 1); this.events.push({ k: 'part', id: b.id }); changed = true; }
    if (changed) this.events.push({ k: 'ros', l: this.roster() });
    if (h === 0 && this.match.state !== 'waiting') { this.match.state = 'waiting'; this.match.t = 0; }
  }
  roster() { return [...this.humans().map(c => ({ id: c.id, name: c.name, color: c.p.color })), ...this.bots.map(b => ({ id: b.id, name: b.name, color: b.color, bot: 1 }))]; }
  matchInfo() { const M = this.match; return { s: M.state, t: Math.max(0, Math.round(M.t * 10) / 10), id: M.id, mode: M.mode, arena: M.arena, limit: this.o.scores[M.mode] }; }

  /* ---------------- 真人玩家的回報 ---------------- */
  /** st：{ sn, p:[x,y,z], v:[x,y,z], y, pt, g } —— 位置由瀏覽器算，伺服器只擋不合理的移動 */
  onState(c, p, m) {
    const now = this.clock();
    if (!p.alive || m.sn !== p.sn || !Array.isArray(m.p) || m.p.length !== 3) return;   // 重生前的舊位置不收
    const [x, y, z] = m.p.map(Number), v = Array.isArray(m.v) ? m.v.map(Number) : [0, 0, 0];
    if (![x, y, z, ...v, +m.y, +m.pt].every(Number.isFinite)) return;
    const dt = Math.max(DT, Math.min(1, now - p.lastSt)), horiz = Math.hypot(x - p.pos.x, z - p.pos.z);
    const out = Math.abs(x) > 26 || Math.abs(z) > 26 || y > 14 || y < -20;
    if (out || horiz > MAX_SPEED * dt + 1 || y - p.pos.y > 4 + 8 * dt) {
      // 太遠：不採用，叫瀏覽器退回伺服器的位置
      p.fixes = (p.fixes || 0) + 1;
      this.send(c, { t: 'fix', sn: p.sn, p: [p.pos.x, p.pos.y, p.pos.z] }); return;
    }
    p.pos.x = x; p.pos.y = y; p.pos.z = z; p.vel.x = v[0]; p.vel.y = v[1]; p.vel.z = v[2];
    p.yaw = SH.angWrap(+m.y); p.pitch = SH.clamp(+m.pt, -1.52, 1.52); p.onGround = !!m.g; p.lastSt = now;
    p.airT = p.onGround ? 0 : p.airT + dt;
    this.record(p, now);
  }
  /** fire：{ y, pt } —— 射速、彈藥、換彈、換槍時間都用伺服器自己的計時檢查 */
  onFire(c, p, m) {
    if (!SH.canFire(this.match.state) || !p.alive) return;
    if (![+m.y, +m.pt].every(Number.isFinite)) return;
    p.yaw = SH.angWrap(+m.y); p.pitch = SH.clamp(+m.pt, -1.52, 1.52);
    // 伺服器 20 Hz 計時比瀏覽器粗，給 60 ms 寬限，避免正常連射被擋
    if (p.cd > 0 && p.cd < .06) p.cd = 0;
    if (p.switchT > 0 && p.switchT < .06) p.switchT = 0;
    if (SH.tryFire(p)) this.shoot(p, .1 + c.rtt / 2000);
  }
  record(p, now) { const h = p.hist; h.push([now, p.pos.x, p.pos.y, p.pos.z]); while (h.length > 2 && now - h[0][0] > 1) h.shift(); }
  posAt(p, t) {
    const h = p.hist; if (!h.length || t >= h[h.length - 1][0]) return p.pos;
    if (t <= h[0][0]) return { x: h[0][1], y: h[0][2], z: h[0][3] };
    for (let i = h.length - 1; i > 0; i--) if (h[i - 1][0] <= t) { const a = h[i - 1], b = h[i], k = (t - a[0]) / ((b[0] - a[0]) || 1);
      return { x: a[1] + (b[1] - a[1]) * k, y: a[2] + (b[2] - a[2]) * k, z: a[3] + (b[3] - a[3]) * k }; }
    return p.pos;
  }
  /** 延遲補償：目標退回開槍者當時看到的位置（最多 0.3 秒）。射線、傷害都用原版 shared.js */
  shoot(a, rewind = 0) {
    const w = SH.WEAPONS[a.wi], o = SH.eye(a), t0 = this.clock() - Math.min(.3, Math.max(0, rewind));
    const ghosts = this.players().filter(p => p !== a && p.alive).map(p => ({ ref: p, alive: true, pos: rewind > 0 ? this.posAt(p, t0) : p.pos }));
    const dmg = new Map(), ends = [];
    for (const d of SH.shotDirs(a)) {
      const r = SH.traceShot(this.C, ghosts, null, o, d, w.range), hit = r.hit ? r.hit.ref : null;
      ends.push([SH.r3(o.x + d.x * r.t), SH.r3(o.y + d.y * r.t), SH.r3(o.z + d.z * r.t), hit ? hit.id : 0]);
      if (hit) dmg.set(hit, (dmg.get(hit) || 0) + SH.dmgAt(w, r.t));
    }
    a.shots++; if (dmg.size) a.hits++;
    this.events.push({ k: 'sh', a: a.id, w: a.wi, e: ends });
    for (const b of this.bots) if (b !== a && b.alive && !b.ai.target && Math.hypot(b.pos.x - a.pos.x, b.pos.z - a.pos.z) < 26) { b.ai.hurtBy = a; b.ai.hurtT = 1.2; }
    for (const [t, d] of dmg) this.damage(t, d, a, a.wi);
  }
  damage(t, d, a, wi) {
    if (!t.alive) return;
    if (t.protect > 0) { this.events.push({ k: 'hit', a: a.id, v: t.id, d: 0 }); return; }
    t.shield -= d; if (t.bot) { t.ai.hurtBy = a; t.ai.hurtT = 2.5; }
    const kill = t.shield <= 0;
    this.events.push({ k: 'hit', a: a.id, v: t.id, d: Math.round(d * 10) / 10, kill: kill ? 1 : 0 });
    if (kill) this.kill(t, a, wi);
  }
  kill(t, a, wi) {
    t.shield = 0; t.alive = false; t.respawnT = SH.P.respawn; t.streak = 0;
    const live = this.match.state === 'playing';
    if (live) { t.deaths++; if (a && a !== t) { a.kills++; a.streak++; a.best = Math.max(a.best, a.streak); if (this.match.mode === 'ffa') a.score++; } }
    this.events.push({ k: 'kill', a: a ? a.id : 0, v: t.id, w: wi });
    if (live && this.match.mode === 'ffa' && a && a.score >= this.o.scores.ffa) this.endMatch('score');
  }
  spawn(p) {
    const i = SH.pickSpawn(this.C, p, this.players(), this.spawnState, this.clock());
    SH.placeAt(p, i, this.spawnState, this.clock());
    if (p.ai) p.ai.path = [];
    if (!p.bot) { p.sn = (p.sn || 0) + 1; p.lastSt = this.clock(); }
    this.events.push({ k: 'sp', id: p.id, sn: p.sn || 0, p: [p.pos.x, p.pos.y, p.pos.z], y: SH.r4(p.yaw) });
  }

  /* ---------------- 比賽流程 ---------------- */
  pickArena() { const A = this.o.arenas, rest = A.length > 1 ? A.filter(a => a !== this.match.arena) : A; return rest[Math.floor(Math.random() * rest.length)]; }
  useArena(a) {
    if (!this.layouts[a]) { const C = SH.buildColliders(SH.buildMap(a)); this.layouts[a] = { C, nav: buildNav(C, a) }; }
    this.C = this.layouts[a].C; this.nav = this.layouts[a].nav;
  }
  startCountdown() {
    const M = this.match; M.state = 'countdown'; M.t = COUNTDOWN; M.mode = this.o.modes[M.id % this.o.modes.length];
    const arena = M.id ? this.pickArena() : M.arena;   // 每場隨機地圖、不連續重複
    if (arena !== M.arena) { M.arena = arena; this.useArena(arena); }
    for (const p of this.players()) { p.ai && (p.ai.path = []); this.spawn(p); }   // 新地圖：全部人移到新重生點
    this.events.push({ k: 'm', m: this.matchInfo() });
  }
  startMatch() {
    const M = this.match; M.state = 'playing'; M.t = this.o.time; M.id++;
    this.spawnState.forEach(s => { s.uses = 0; s.last = -99; });
    this.pickups.forEach(p => { p.on = true; p.at = 0; }); this.zone = { owner: 0, contested: 0, acc: 0 };
    for (const p of this.players()) { Object.assign(p, { score: 0, deaths: 0, kills: 0, shots: 0, hits: 0, streak: 0, best: 0, hold: 0 }); this.spawn(p); }
    this.events.push({ k: 'm', m: this.matchInfo() });
  }
  endMatch(reason) {
    if (this.match.state !== 'playing') return;
    this.match.state = 'results'; this.match.t = RESULTS;
    const rank = SH.rankPlayers(this.players()).map(p => ({ id: p.id, name: p.name, color: p.color, bot: p.bot ? 1 : 0, score: p.score, deaths: p.deaths,
      kills: p.kills, shots: p.shots, hits: p.hits, best: p.best, hold: Math.round(p.hold) }));
    this.events.push({ k: 'm', m: this.matchInfo() }, { k: 'res', reason, mode: this.match.mode, arena: this.match.arena, rank });
  }

  /* ---------------- 每秒 20 次 ---------------- */
  tick() {
    const now = this.clock(), M = this.match; M.tick++;
    for (const c of [...this.conns.values()]) if (now - c.last > this.o.idleTimeout) { try { c.tr.close(1001, 'timeout'); } catch (e) { } this.disconnect(c); }
    const humans = this.humans().length;
    if (M.state === 'waiting') { if (humans >= 1) this.startCountdown(); }
    else if (M.state === 'countdown') { M.t -= DT; if (humans < 1) M.state = 'waiting'; else if (M.t <= 0) this.startMatch(); }
    else if (M.state === 'playing') { M.t -= DT; if (M.t <= 0) { M.t = 0; this.endMatch('time'); } else if (humans < 1) this.endMatch('players'); }
    else if (M.state === 'results') { M.t -= DT; if (M.t <= 0) { M.state = 'waiting'; M.t = 0; this.events.push({ k: 'm', m: this.matchInfo() }); } }
    const live = M.state !== 'results';
    for (const c of this.humans()) SH.weaponTimers(c.p, DT);   // 真人的射速／換彈／換槍／保護／加速計時
    if (this.bots.length) {
      const X = { C: this.C, nav: this.nav, players: this.players(), diff: this.o.diff, frozen: M.state === 'countdown' || !live, mode: M.state === 'waiting' ? 'ffa' : M.mode, pickups: this.pickups };
      for (let k = 0; k < 3; k++) for (const b of this.bots) {
        const fired = SH.stepPlayer(b, botInput(b, X, SH.TICK), SH.TICK, this.C, SH.canFire(M.state));
        if (fired) this.shoot(b, 0);
      }
    }
    for (const p of this.players()) {
      if (live && !p.alive) { p.respawnT -= DT; if (p.respawnT <= 0) this.spawn(p); }
      else if (p.alive && p.pos.y < -12) this.kill(p, null, -1);
      if (p.bot) this.record(p, now);
    }
    if (live) this.tickPickups(now);
    if (M.state === 'playing' && M.mode === 'koth') this.tickZone(); else { this.zone.owner = 0; this.zone.contested = 0; }
    const viewers = this.humans();
    if (viewers.length) {
      const snap = JSON.stringify({ t: 's', tk: M.tick, m: this.matchInfo(), pl: this.players().map(p => SH.packPlayer(p, 0)),
        pk: this.pickups.map(p => p.on ? 1 : 0), z: [this.zone.owner, this.zone.contested], ev: this.events });
      for (const c of viewers) this.send(c, snap);
    }
    this.events = [];
    if (now - this.lastPing > 2) { this.lastPing = now; const msg = JSON.stringify({ t: 'pi', c: Math.round(now * 1000) }); for (const c of this.conns.values()) this.send(c, msg); }
  }
  tickPickups(now) {
    this.pickups.forEach((pk, i) => {
      if (!pk.on) { if (now >= pk.at) { pk.on = true; this.events.push({ k: 'pk', i, on: 1 }); } return; }
      for (const p of this.players()) {
        if (!p.alive || Math.hypot(p.pos.x - pk.x, p.pos.z - pk.z) > 1.1 || Math.abs(p.pos.y - pk.y) > 1.2) continue;
        if (pk.type === 'shield') { if (p.shield >= SH.P.shield) continue; p.shield = Math.min(SH.P.shield, p.shield + SH.PICKUP_TYPES.shield.amount); }
        else p.boostT = SH.PICKUP_TYPES.boost.time;
        pk.on = false; pk.at = now + SH.PICKUP_TYPES[pk.type].respawn;
        this.events.push({ k: 'pk', i, on: 0, a: p.id }); break;
      }
    });
  }
  tickZone() {
    const occ = this.players().filter(p => SH.inZone(p)), Z = this.zone;
    if (occ.length === 1) {
      const p = occ[0]; if (Z.owner !== p.id) Z.acc = 0; Z.owner = p.id; Z.contested = 0; Z.acc += DT; p.hold += DT;
      while (Z.acc >= 1) { Z.acc -= 1; p.score++; }
      if (p.score >= this.o.scores.koth) this.endMatch('score');
    } else { Z.owner = 0; Z.contested = occ.length > 1 ? 1 : 0; }
  }
}
