import { defineConfig } from 'vite';

const port = Number(process.env.CLIENT_PORT ?? 5173);
const serverPort = Number(process.env.PORT ?? 8787);
// The game server serves the imported pack at /assets and the relay on WebSocket /ws.
const proxy = {
  '/assets': `http://localhost:${serverPort}`,
  '/ws': { target: `ws://localhost:${serverPort}`, ws: true },
};

export default defineConfig({
  server: { port, strictPort: true, proxy },
  preview: { port, strictPort: true, proxy },
});
