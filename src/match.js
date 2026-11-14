// 單人對戰的規則核心：從原遊戲 core.js（GameCore）搬過來，拿掉連線／排隊／延遲補償，
// 數值、傷害、重生、道具、佔領中繼站全部直接呼叫原本的 shared.js，機器人用原本的 bot.js。
import * as SH from './shared.js';
import { buildNav, botInput, newBotAI } from './bot.js';

const navCache = new Map();
export const COUNTDOWN = 3;

export class Match {
  /** o: { arena, mode:'ffa'|'koth', diff, bots, C, myName, myColor, hooks } */
  constructor(o) {
    this.o = o; this.arena = o.arena; this.mode = o.mode; this.C = o.C;
    if (!navCache.has(o.arena)) navCache.set(o.arena, buildNav(o.C, o.arena));
    this.nav = navCache.get(o.arena);
    this.h = o.hooks || {};
    this.limit = SH.MODES[this.mode].score;
    this.state = 'countdown'; this.t = COUNTDOWN; this.acc = 0; this.clock = 0;
    this.spawnState = SH.SPAWNS.map(() => ({ uses: 0, last: -99 }));
    this.pickups = SH.PICKUPS.map(p => Object.assign({ on: true, at: 0 }, p));
    this.zone = { owner: 0, contested: 0, acc: 0 };
    let id = 1;
    this.me = SH.newPlayer(id++, o.myName || '你', o.myColor ?? SH.PLAYER_COLORS[0]);
    this.me.isMe = true;
    this.bots = [];
    const colors = SH.PLAYER_COLORS.filter(c => c !== this.me.color);
    for (let i = 0; i < o.bots; i++) {
      const b = SH.newPlayer(id++, SH.BOT_NAMES[i % SH.BOT_NAMES.length], colors[i % colors.length]);
      b.bot = true; b.ai = newBotAI(); this.bots.push(b);
    }
    this.players = [this.me, ...this.bots];
    for (const p of this.players) this.spawn(p);
  }
  now() { return this.clock; }
  spawn(p) {
    const i = SH.pickSpawn(this.C, p, this.players, this.spawnState, this.clock);
    SH.placeAt(p, i, this.spawnState, this.clock);
    if (p.ai) p.ai.path = [];
    this.h.onSpawn && this.h.onSpawn(p);
  }
  get live() { return this.state === 'playing'; }

  /** 一發（或電弧 8 束）從 o 沿 dirs 射出；回傳每束終點給特效用 */
  shoot(a, o, dirs) {
    const w = SH.WEAPONS[a.wi], dmg = new Map(), ends = [];
    const targets = this.players.filter(p => p !== a && p.alive);
    for (const d of dirs) {
      const r = SH.traceShot(this.C, targets, null, o, d, w.range);
      ends.push({ x: o.x + d.x * r.t, y: o.y + d.y * r.t, z: o.z + d.z * r.t, hit: r.hit, n: r.n });
      if (r.hit) dmg.set(r.hit, (dmg.get(r.hit) || 0) + SH.dmgAt(w, r.t));   // 距離傷害：原規則 dmgAt
    }
    a.shots++; if (dmg.size) a.hits++;
    this.h.onShot && this.h.onShot(a, o, ends);
    // 附近的機器人聽到槍聲會轉頭
    for (const b of this.bots) if (b !== a && b.alive && !b.ai.target && Math.hypot(b.pos.x - a.pos.x, b.pos.z - a.pos.z) < 26) { b.ai.hurtBy = a; b.ai.hurtT = 1.2; }
    for (const [t, d] of dmg) this.damage(t, d, a, a.wi);
    return ends;
  }
  damage(t, d, a, wi) {
    if (!t.alive) return;
    if (t.protect > 0) { this.h.onHit && this.h.onHit(a, t, 0, false); return; }
    t.shield -= d; if (t.bot) { t.ai.hurtBy = a; t.ai.hurtT = 2.5; }
    const kill = t.shield <= 0;
    this.h.onHit && this.h.onHit(a, t, d, kill);
    if (!kill) return;
    this.kill(t, a, wi);
  }
  kill(t, a, wi) {
    t.shield = 0; t.alive = false; t.respawnT = SH.P.respawn; t.streak = 0;
    if (this.live) { t.deaths++; if (a && a !== t) { a.kills++; a.streak++; a.best = Math.max(a.best, a.streak); if (this.mode === 'ffa') a.score++; } }
    this.h.onKill && this.h.onKill(a, t, wi);
    if (this.live && this.mode === 'ffa' && a && a.score >= this.limit) this.end('score');
  }
  end(reason) {
    if (this.state !== 'playing') return;
    this.state = 'results'; this.t = 0;
    this.h.onEnd && this.h.onEnd(reason, SH.rankPlayers(this.players));
  }

  /** 每個畫面呼叫一次；me 的位置已由玩家控制器同步進 this.me.pos */
  update(dt) {
    this.clock += dt;
    if (this.state === 'countdown') { const before = Math.ceil(this.t); this.t -= dt; if (Math.ceil(this.t) !== before && this.t > 0) this.h.onCount && this.h.onCount(Math.ceil(this.t));
      if (this.t <= 0) { this.state = 'playing'; this.t = SH.MATCH.time; this.h.onStart && this.h.onStart(); } }
    else if (this.state === 'playing') { this.t -= dt; if (this.t <= 0) { this.t = 0; this.end('time'); } }
    if (this.state === 'results') return;
    SH.weaponTimers(this.me, dt);
    // 機器人：固定 60 Hz，跟原版伺服器一樣用 shared.js 的方塊物理
    this.acc = Math.min(this.acc + dt, .25);
    const X = { C: this.C, nav: this.nav, players: this.players, diff: this.o.diff, frozen: !this.live, mode: this.mode, pickups: this.pickups };
    while (this.acc >= SH.TICK) {
      this.acc -= SH.TICK;
      for (const b of this.bots) {
        const was = b.ws[b.wi].reload;
        const fired = SH.stepPlayer(b, botInput(b, X, SH.TICK), SH.TICK, this.C, this.live);
        if (fired) this.shoot(b, SH.eye(b), SH.shotDirs(b));
        if (!was && b.ws[b.wi].reload > 0) this.h.onReload && this.h.onReload(b);
      }
    }
    for (const p of this.players) {
      if (!p.alive) { p.respawnT -= dt; if (p.respawnT <= 0) this.spawn(p); }
      else if (p.pos.y < -12) this.kill(p, null, -1);
    }
    this.tickPickups();
    if (this.live && this.mode === 'koth') this.tickZone(dt); else { this.zone.owner = 0; this.zone.contested = 0; }
  }
  tickPickups() {
    const now = this.clock;
    this.pickups.forEach((pk, i) => {
      if (!pk.on) { if (now >= pk.at) pk.on = true; return; }
      for (const p of this.players) {
        if (!p.alive || Math.hypot(p.pos.x - pk.x, p.pos.z - pk.z) > 1.1 || Math.abs(p.pos.y - pk.y) > 1.2) continue;
        if (pk.type === 'shield') { if (p.shield >= SH.P.shield) continue; p.shield = Math.min(SH.P.shield, p.shield + SH.PICKUP_TYPES.shield.amount); }
        else p.boostT = SH.PICKUP_TYPES.boost.time;
        pk.on = false; pk.at = now + SH.PICKUP_TYPES[pk.type].respawn;
        this.h.onPickup && this.h.onPickup(p, pk); break;
      }
    });
  }
  tickZone(dt) {
    const occ = this.players.filter(p => SH.inZone(p)), Z = this.zone;
    if (occ.length === 1) {
      const p = occ[0]; if (Z.owner !== p.id) Z.acc = 0; Z.owner = p.id; Z.contested = 0; Z.acc += dt; p.hold += dt;
      while (Z.acc >= 1) { Z.acc -= 1; p.score++; }
      if (p.score >= this.limit) this.end('score');
    } else { Z.owner = 0; Z.contested = occ.length > 1 ? 1 : 0; }
  }
}
