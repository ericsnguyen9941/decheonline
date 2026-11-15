import { defineConfig } from 'vite';

const port = Number(process.env.CLIENT_PORT ?? 5173);
const serverPort = Number(process.env.PORT ?? 8787);
// The game server serves the imported pack at /assets and the relay on WebSocket /ws.
const proxy = {
  '/assets': `http://localhost:${serverPort}`,
  '/ws': { target: `ws://localhost:${serverPort}`, ws: true },
};

export default defineConfig({
  // Not the default `assets`: that path belongs to the game server's pack (proxied above), also under `vite preview`.
  build: { assetsDir: 'bundle' },
  server: { port, strictPort: true, proxy },
  preview: { port, strictPort: true, proxy },
});
