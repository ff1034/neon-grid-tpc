// 連線版的瀏覽器端：跟單人版的 Match（match.js）提供同一組欄位與 hooks，main.js / player.js / hud.js 不用分兩套。
// 自己的移動交給 three-player-controller，每 50 ms 把位置回報給伺服器；其他玩家（真人與機器人）用伺服器快照內插顯示。
// 開槍：瀏覽器先畫彈道與火光，同時送 fire 給伺服器；傷害、擊殺、計分、重生都以伺服器的事件為準。
import * as SH from './shared.js';
import { NET_VERSION, RoomCore } from './netcore.js';

const I = SH.IDX, INTERP = .1, SEND_EVERY = .05;

/** 預設連到同一個網址的 /ws（Cloudflare Worker）；網址加 ?server=wss://... 可以指定別的伺服器 */
export function defaultServerURL() {
  const q = new URLSearchParams(location.search).get('server');
  if (q) return q;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

/** 迴路測試：伺服器核心直接在這個分頁裡跑（不需要 Node 或 Cloudflare），用來測整套連線邏輯 */
export class LoopServer {
  /** manual：不自己計時，由呼叫端 pump()（自動化測試用：訊息即時送達、伺服器跟著測試的幀數走） */
  constructor(opts = {}, manual = false) {
    this.core = new RoomCore(opts); this.manual = manual;
    if (!manual) this.timer = setInterval(() => this.core.tick(), 50);
  }
  pump() { this.core.tick(); }
  socket() {
    const core = this.core, sock = { readyState: 0, onopen: null, onmessage: null, onclose: null, onerror: null }, manual = this.manual;
    let c = null;
    const deliver = s => sock.onmessage && sock.onmessage({ data: s });
    const tr = { send: s => manual ? deliver(s) : setTimeout(() => deliver(s), 0), close: () => { sock.readyState = 3; sock.onclose && sock.onclose({ code: 1000 }); } };
    sock.send = s => { if (c) core.message(c, s); };
    sock.close = () => { if (c) core.disconnect(c); sock.readyState = 3; };
    const open = () => { c = core.connect(tr); sock.readyState = 1; sock.onopen && sock.onopen(); };
    if (manual) Promise.resolve().then(open); else setTimeout(open, 0);
    return sock;
  }
  stop() { clearInterval(this.timer); }
}

export class NetMatch {
  /** o: { url | socket, name, hooks, onStatus } */
  constructor(o) {
    this.o = o; this.h = o.hooks || {}; this.net = true;
    this.players = []; this.byId = new Map(); this.me = null; this.myId = 0;
    this.state = 'connecting'; this.t = 0; this.mode = 'ffa'; this.arena = 'city'; this.limit = SH.MODES.ffa.score;
    this.zone = { owner: 0, contested: 0 }; this.pickups = SH.PICKUPS.map(p => Object.assign({ on: true }, p));
    this.C = SH.buildColliders(SH.buildMap(this.arena));
    this.clock = 0; this.sendT = 0; this.sn = 0; this.lastWi = 0; this.lastReload = 0; this.countShown = -1; this.err = null;
    const ws = this.ws = o.socket || new WebSocket(o.url || defaultServerURL());
    ws.onopen = () => { this.status('已連線，進入房間…'); this.send({ t: 'hello', ver: NET_VERSION, name: o.name }); };
    ws.onmessage = e => this.onMessage(e.data);
    ws.onclose = e => { if (this.state !== 'left') { this.state = 'closed'; this.status(this.err || `連線中斷（${e.code || ''}）`, true); } };
    ws.onerror = () => { this.err = '連不上伺服器：確認網址，或伺服器是否已部署／啟動'; };
    this.status('連線中…');
  }
  status(text, fatal = false) { this.o.onStatus && this.o.onStatus(text, fatal); }
  send(o) { try { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); } catch (e) { } }
  leave() { this.state = 'left'; try { this.ws.close(); } catch (e) { } }
  get live() { return SH.canFire(this.state); }
  get bots() { return this.players.filter(p => p !== this.me); }   // 給畫面：自己以外的人（真人 + 機器人）

  player(id) {
    let p = this.byId.get(id);
    if (!p) { p = SH.newPlayer(id, '…', SH.PLAYER_COLORS[0]); p.buf = []; this.byId.set(id, p); this.players.push(p); if (id === this.myId) { p.isMe = true; this.me = p; } }
    return p;
  }
  roster(list) {
    const keep = new Set(list.map(r => r.id));
    for (const r of list) { const p = this.player(r.id); p.name = r.name; p.color = r.color; p.bot = !!r.bot; }
    this.players = this.players.filter(p => keep.has(p.id) || p === this.me);
    for (const id of [...this.byId.keys()]) if (!keep.has(id) && id !== this.myId) this.byId.delete(id);
    this.h.onRoster && this.h.onRoster();
  }
  matchInfo(m) {
    const prev = this.state;
    this.state = m.s; this.t = m.t; this.mode = m.mode; this.limit = m.limit;
    if (m.arena !== this.arena) { this.arena = m.arena; this.C = SH.buildColliders(SH.buildMap(m.arena)); this.h.onArena && this.h.onArena(m.arena); }
    if (prev !== m.s) {
      if (m.s === 'playing') this.h.onStart && this.h.onStart();
      if (m.s === 'waiting' || m.s === 'countdown') this.h.onNewRound && this.h.onNewRound();
    }
  }

  onMessage(data) {
    let m; try { m = JSON.parse(data); } catch (e) { return; }
    switch (m.t) {
      case 'welcome': this.myId = m.id; this.player(m.id); this.roster(m.roster); this.matchInfo(m.m); this.status(''); break;
      case 'err': this.err = m.code === 'full' ? '房間已滿（最多 8 人）' : m.code === 'version' ? '版本不同，請重新整理頁面' : '伺服器拒絕連線'; break;
      case 'pi': this.send({ t: 'po', c: m.c }); break;
      case 'fix': if (this.me && m.sn === this.sn) { this.me.pos.x = m.p[0]; this.me.pos.y = m.p[1]; this.me.pos.z = m.p[2]; this.h.onFix && this.h.onFix(this.me); } break;
      case 's': this.snapshot(m); break;
    }
  }
  snapshot(m) {
    this.matchInfo(m.m);
    for (const e of m.ev) if (e.k === 'ros') this.roster(e.l);
    const now = this.clock;
    for (const a of m.pl) {
      const p = this.player(a[I.id]), f = a[I.flags];
      p.shield = a[I.shield]; p.score = a[I.score]; p.deaths = a[I.deaths]; p.kills = a[I.kills]; p.protect = a[I.protect];
      p.respawnT = a[I.respawnT]; p.boostT = a[I.boostT];
      if (p === this.me) { p.alive = !!(f & 2); continue; }
      p.alive = !!(f & 2); p.wi = a[I.wi]; p.onGround = !!(f & 1); p.airT = a[I.airT];
      p.ws.forEach((s, k) => { const r = a[I.ammo0 + k * 2 + 1]; if (r > 0 && !(s.reload > 0)) p.reloadStart = true; s.ammo = a[I.ammo0 + k * 2]; s.reload = r; });
      p.buf.push([now, a[I.x], a[I.y], a[I.z], a[I.yaw], a[I.pitch], a[I.vx], a[I.vy], a[I.vz]]);
      if (p.buf.length > 30) p.buf.shift();
    }
    this.zone.owner = m.z[0]; this.zone.contested = m.z[1];
    m.pk.forEach((on, i) => { if (this.pickups[i]) this.pickups[i].on = !!on; });
    for (const e of m.ev) this.event(e);
  }
  event(e) {
    const P = id => this.byId.get(id), me = this.me;
    switch (e.k) {
      case 'sp': {
        const p = P(e.id); if (!p) break;
        p.pos.x = e.p[0]; p.pos.y = e.p[1]; p.pos.z = e.p[2]; p.yaw = e.y; p.alive = true; p.buf = [];
        if (p === me) { this.sn = e.sn; me.vel.x = me.vel.y = me.vel.z = 0; me.ws.forEach((s, k) => { s.ammo = SH.WEAPONS[k].mag; s.reload = 0; }); me.wi = 0; me.protect = SH.P.protect; this.h.onSpawn && this.h.onSpawn(me); }
        break; }
      case 'sh': {
        const a = P(e.a); if (!a || a === me) break;       // 自己的彈道已經先畫了
        a.wi = e.w;
        const o = SH.eye(a), ends = e.e.map(x => ({ x: x[0], y: x[1], z: x[2], hit: x[3] ? P(x[3]) : null, n: !x[3] }));
        this.h.onShot && this.h.onShot(a, o, ends); break; }
      case 'hit': { const a = P(e.a), t = P(e.v); if (a && t) this.h.onHit && this.h.onHit(a, t, e.d, !!e.kill); break; }
      case 'kill': { const t = P(e.v); if (!t) break; t.alive = false; this.h.onKill && this.h.onKill(e.a ? P(e.a) : null, t, e.w); break; }
      case 'pk': if (e.on === 0 && e.a) { const p = P(e.a); if (p) this.h.onPickup && this.h.onPickup(p, this.pickups[e.i]); } break;
      case 'res':
        for (const r of e.rank) { const p = P(r.id); if (p) Object.assign(p, { score: r.score, kills: r.kills, deaths: r.deaths, shots: r.shots, hits: r.hits, hold: r.hold }); }
        this.h.onEnd && this.h.onEnd(e.reason, e.rank); break;
    }
  }

  /** 自己開槍：先畫，再送給伺服器判定（tryFire 已經在 player.js 用同一套規則扣過彈藥） */
  shoot(a, o, dirs) {
    const w = SH.WEAPONS[a.wi], targets = this.players.filter(p => p !== a && p.alive), ends = [];
    for (const d of dirs) { const r = SH.traceShot(this.C, targets, null, o, d, w.range); ends.push({ x: o.x + d.x * r.t, y: o.y + d.y * r.t, z: o.z + d.z * r.t, hit: r.hit, n: r.n }); }
    a.shots++;
    this.h.onShot && this.h.onShot(a, o, ends);
    this.send({ t: 'fire', y: SH.r4(a.yaw), pt: SH.r4(a.pitch) });
    return ends;
  }

  update(dt) {
    this.clock += dt;
    const me = this.me;
    if (this.state === 'countdown') { const n = Math.ceil(this.t - (this.clock - (this.tClock ?? this.clock))); if (n !== this.countShown && n > 0) { this.countShown = n; this.h.onCount && this.h.onCount(n); } }
    if (!me) return;
    SH.weaponTimers(me, dt);
    if (me.wi !== this.lastWi) { this.lastWi = me.wi; this.send({ t: 'sw', i: me.wi }); }
    const r = me.ws[me.wi].reload; if (r > 0 && !(this.lastReload > 0)) this.send({ t: 'rl' }); this.lastReload = r;
    this.sendT -= dt;
    if (this.sendT <= 0 && me.alive) {
      this.sendT = SEND_EVERY; const q = SH.r3;
      this.send({ t: 'st', sn: this.sn, p: [q(me.pos.x), q(me.pos.y), q(me.pos.z)], v: [q(me.vel.x), q(me.vel.y), q(me.vel.z)], y: SH.r4(me.yaw), pt: SH.r4(me.pitch), g: me.onGround ? 1 : 0 });
    }
    // 其他玩家：在 0.1 秒前的兩筆快照之間內插
    const t = this.clock - INTERP;
    for (const p of this.players) {
      if (p === me || !p.buf.length) continue;
      const b = p.buf; let i = b.length - 1;
      while (i > 0 && b[i - 1][0] > t) i--;
      const B = b[i], A = b[i - 1] || B, k = B[0] > A[0] ? Math.min(1, Math.max(0, (t - A[0]) / (B[0] - A[0]))) : 1;
      p.pos.x = A[1] + (B[1] - A[1]) * k; p.pos.y = A[2] + (B[2] - A[2]) * k; p.pos.z = A[3] + (B[3] - A[3]) * k;
      p.yaw = A[4] + SH.angWrap(B[4] - A[4]) * k; p.pitch = A[5] + (B[5] - A[5]) * k;
      p.vel.x = B[6]; p.vel.y = B[7]; p.vel.z = B[8];
      if (p.reloadStart) { p.reloadStart = false; this.h.onReload && this.h.onReload(p); }
    }
  }
}
