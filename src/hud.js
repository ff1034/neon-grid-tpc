// HUD、計分板、擊殺訊息、結算
import * as SH from './shared.js';

const $ = s => document.querySelector(s);
const hex = c => '#' + c.toString(16).padStart(6, '0');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const HUD = {
  init() {
    $('#wslots').innerHTML = SH.WEAPONS.map((w, i) => `<span data-i="${i}">${i + 1} ${w.short}</span>`).join('');
  },
  show(on) { $('#hud').classList.toggle('hidden', !on); },
  msg(text, sec = 1.4) { const el = $('#center-msg'); el.textContent = text; clearTimeout(this._mt); if (sec) this._mt = setTimeout(() => { el.textContent = ''; }, sec * 1000); },
  feed(html) {
    const f = $('#feed'), d = document.createElement('div'); d.innerHTML = html; f.prepend(d);
    while (f.children.length > 5) f.lastChild.remove();
    setTimeout(() => d.remove(), 5000);
  },
  name(p) { return `<span style="color:${hex(p.color)}">${esc(p.name)}</span>`; },
  hit(kill) {
    const h = $('#hitmark'); h.classList.toggle('kill', !!kill);
    h.animate([{ opacity: 1, transform: 'scale(1.2)' }, { opacity: 0, transform: 'scale(.9)' }], { duration: kill ? 420 : 220 });
  },
  hurt() { $('#dmgflash').animate([{ opacity: .9 }, { opacity: 0 }], { duration: 450 }); },
  update(m, me) {
    const w = SH.WEAPONS[me.wi], st = me.ws[me.wi];
    const sh = Math.max(0, Math.ceil(me.shield));
    $('#shieldNum').textContent = sh; const bar = $('#shieldBar'); bar.style.width = sh + '%'; bar.classList.toggle('low', sh <= 30);
    $('#boostTag').classList.toggle('hidden', !(me.boostT > 0));
    $('#wname').textContent = w.name; $('#wname').style.color = hex(w.color);
    $('#ammoNow').textContent = st.ammo; $('#ammoMax').textContent = w.mag;
    document.querySelectorAll('#wslots span').forEach((s, i) => { s.classList.toggle('on', i === me.wi); s.style.color = i === me.wi ? hex(SH.WEAPONS[i].color) : ''; });
    const rb = $('#reloadBar'); rb.style.opacity = st.reload > 0 ? 1 : 0; if (st.reload > 0) rb.firstElementChild.style.width = (100 * (1 - st.reload / w.reload)) + '%';
    $('#cross').classList.toggle('arc', me.wi === 1);
    const t = Math.max(0, Math.ceil(m.state === 'countdown' ? SH.MATCH.time : m.t));
    $('#timer').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    $('#mode').textContent = `${SH.MODES[m.mode].name}・${SH.ARENAS[m.arena].name}`;
    const best = SH.rankPlayers(m.players)[0];
    $('#scoreline').innerHTML = `你 <b>${me.score}</b> ／ 領先 ${best.score}（目標 ${m.limit}）`;
    const z = $('#zone');
    if (m.mode === 'koth') {
      z.classList.remove('hidden', 'mine', 'enemy', 'cont');
      const owner = m.players.find(p => p.id === m.zone.owner);
      if (m.zone.contested) { z.textContent = '中繼站爭奪中'; z.classList.add('cont'); }
      else if (owner === me) { z.textContent = '你正在佔領中繼站 +1/秒'; z.classList.add('mine'); }
      else if (owner) { z.innerHTML = `${this.name(owner)} 佔領中繼站`; z.classList.add('enemy'); }
      else z.textContent = '中繼站（中央塔頂）無人佔領';
    } else z.classList.add('hidden');
  },
  board(m, show) {
    const b = $('#board'); b.classList.toggle('hidden', !show); if (!show) return;
    b.innerHTML = table(m);
  },
  death(on, killer, t) {
    $('#death').classList.toggle('hidden', !on); if (!on) return;
    $('#deathBy').innerHTML = killer ? `擊殺者：${this.name(killer)}` : '掉出場外';
    $('#deathT').textContent = `${Math.max(0, t).toFixed(1)} 秒後重生`;
  },
  results(m, reason) {
    const rank = SH.rankPlayers(m.players), me = m.me, place = rank.indexOf(me) + 1;
    $('#resTitle').textContent = place === 1 ? '勝利！第 1 名' : `對戰結束・第 ${place} 名`;
    $('#resTable').innerHTML = `<p style="color:var(--muted);margin:0 0 6px">${reason === 'time' ? '時間到' : '達到目標分數'}・${SH.MODES[m.mode].name}・${SH.ARENAS[m.arena].name}</p>` + table(m, true);
  },
};
function table(m, full = false) {
  const rows = SH.rankPlayers(m.players).map((p, i) => `<tr class="${p.isMe ? 'me' : ''}"><td>${i + 1}</td><td><span class="dot" style="background:${hex(p.color)}"></span>${esc(p.name)}${p.bot ? '' : '（你）'}</td>
    <td>${p.score}</td><td>${p.kills}</td><td>${p.deaths}</td>${m.mode === 'koth' ? `<td>${Math.round(p.hold)}s</td>` : ''}${full ? `<td>${p.shots ? Math.round(100 * p.hits / p.shots) : 0}%</td>` : ''}</tr>`).join('');
  return `<table class="sb"><tr><th>#</th><th>玩家</th><th>分數</th><th>擊殺</th><th>陣亡</th>${m.mode === 'koth' ? '<th>佔領</th>' : ''}${full ? '<th>命中率</th>' : ''}</tr>${rows}</table>`;
}
