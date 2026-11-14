// NEON GRID TPC 連線版：Cloudflare Worker 入口 + 一個 Durable Object 房間（裁判）。
// 網頁本身（index.html、src/、vendor/、models/）由 Workers 靜態資源提供；/ws 轉給房間。
import { DurableObject } from 'cloudflare:workers';
import { RoomCore } from '../src/netcore.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('需要 WebSocket 連線', { status: 426 });
      return env.ROOM.get(env.ROOM.idFromName('main')).fetch(request);
    }
    if (url.pathname === '/status') return env.ROOM.get(env.ROOM.idFromName('main')).fetch(request);
    return env.ASSETS.fetch(request);
  }
};

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.core = new RoomCore();
    this.timer = null;
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/status') return Response.json(this.core.status(), { headers: { 'cache-control': 'no-store' } });
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('not found', { status: 404 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    const c = this.core.connect({ send: s => server.send(s), close: (code, reason) => server.close(code, reason) });
    server.addEventListener('message', e => { try { this.core.message(c, e.data); } catch (err) { } });
    const gone = () => { this.core.disconnect(c); if (!this.core.conns.size) this.stop(); };
    server.addEventListener('close', gone);
    server.addEventListener('error', gone);
    if (!this.timer) this.timer = setInterval(() => { try { this.core.tick(); } catch (err) { } }, 50);
    return new Response(null, { status: 101, webSocket: client });
  }
  stop() { if (this.timer) { clearInterval(this.timer); this.timer = null; } }
}
