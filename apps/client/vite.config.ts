import { defineConfig } from 'vite';

const port = Number(process.env.CLIENT_PORT ?? 5173);
const serverPort = Number(process.env.PORT ?? 8787);

export default defineConfig({
  // The game server serves the imported pack at /assets.
  server: { port, strictPort: true, proxy: { '/assets': `http://localhost:${serverPort}` } },
  preview: { port, strictPort: true, proxy: { '/assets': `http://localhost:${serverPort}` } },
});
