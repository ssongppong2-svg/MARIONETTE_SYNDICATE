/**
 * 대전 서버 + 게임 화면 파일 서버. 하나의 프로그램으로 둘 다 돌립니다.
 *   PORT        듣는 포트 (기본 8787)
 *   STATIC_DIR  화면 파일 폴더 (기본 ./dist)
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { RECONNECT_SECONDS, TURN_SECONDS } from '../shared/data';
import { Hub } from './hub';
import type { Timings } from '../shared/match';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ico': 'image/x-icon',
};

export interface ServerOptions {
  port: number;
  staticDir?: string;
  timings?: Partial<Timings>;
  random?: () => number;
}

export function startServer(opts: ServerOptions) {
  const timings: Timings = {
    turnMs: TURN_SECONDS * 1000,
    roundBreakMs: 9000,
    graceMs: RECONNECT_SECONDS * 1000,
    ...opts.timings,
  };
  const hub = new Hub(timings, opts.random);
  const root = resolve(opts.staticDir ?? 'dist');

  const serveStatic = (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, online: hub.online, matches: hub.matches.size }));
      return;
    }
    let file = normalize(join(root, decodeURIComponent(url.pathname)));
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html');
    if (!existsSync(file)) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('게임 화면이 아직 빌드되지 않았습니다. npm run build 를 실행해 주세요.');
      return;
    }
    const type = TYPES[extname(file)] ?? 'application/octet-stream';
    const cache = file.includes(`${join(root, 'assets')}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
    res.writeHead(200, { 'content-type': type, 'cache-control': cache });
    createReadStream(file).pipe(res);
  };

  const http = createServer(serveStatic);
  const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 16 * 1024 });
  const alive = new WeakMap<WebSocket, boolean>();
  wss.on('connection', (ws) => {
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));
    hub.attach(ws);
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.get(ws)) { ws.terminate(); continue; }
      alive.set(ws, false);
      ws.ping();
    }
  }, 15_000);

  return new Promise<{ port: number; close: () => Promise<void>; hub: Hub }>((done) => {
    http.listen(opts.port, () => {
      const address = http.address();
      const port = typeof address === 'object' && address ? address.port : opts.port;
      done({
        port,
        hub,
        close: () => new Promise<void>((ok) => {
          clearInterval(heartbeat);
          hub.close();
          for (const ws of wss.clients) ws.terminate();
          wss.close(() => http.close(() => ok()));
        }),
      });
    });
  });
}

const isEntry = process.argv[1] && /main\.(ts|js)$/.test(process.argv[1]);
if (isEntry) {
  const port = Number(process.env.PORT ?? process.env.MS_PORT ?? 8787);
  startServer({ port, staticDir: process.env.STATIC_DIR }).then(({ port: p }) => {
    console.log(`마리오네트 신디케이트 서버 — http://localhost:${p}  (대전: ws://localhost:${p}/ws)`);
  });
}
