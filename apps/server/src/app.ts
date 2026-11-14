import { createServer, type Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { decodeClientMessage, encode } from '@aoe/protocol';
import { DEFAULT_ASSETS_DIR, serveAsset } from './assets';
import { RoomRegistry, type Peer } from './rooms';

const MAX_FRAME_BYTES = 64 * 1024;

export interface AppOptions {
  rooms?: RoomRegistry;
  /** Folder served at `/assets/` (the pack from `npm run assets:import`). */
  assetsDir?: string;
}

/** HTTP server with `/health`, `/assets/*` and the game relay on WebSocket path `/ws`. */
export function createApp({
  rooms = new RoomRegistry(),
  assetsDir = process.env.ASSETS_DIR ?? DEFAULT_ASSETS_DIR,
}: AppOptions = {}): Server {
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    if (req.method === 'GET' && req.url?.startsWith('/assets/')) {
      void serveAsset(req.url, assetsDir, res);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });

  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_FRAME_BYTES });
  wss.on('connection', (socket: WebSocket) => {
    const peer: Peer = {
      send(message) {
        if (socket.readyState === socket.OPEN) socket.send(encode(message));
      },
    };
    socket.on('message', (data, isBinary) => {
      const decoded = isBinary
        ? ({ ok: false, error: 'binary frames not supported' } as const)
        : decodeClientMessage(data.toString());
      if (decoded.ok) rooms.handle(peer, decoded.message);
      else peer.send({ t: 'error', code: 'bad-message', message: decoded.error });
    });
    socket.on('close', () => rooms.disconnect(peer));
    socket.on('error', () => socket.terminate());
  });
  server.on('close', () => {
    for (const client of wss.clients) client.terminate();
    wss.close();
  });
  return server;
}
