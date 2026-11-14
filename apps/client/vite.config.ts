import { defineConfig } from 'vite';

const port = Number(process.env.CLIENT_PORT ?? 5173);

export default defineConfig({
  server: { port, strictPort: true },
  preview: { port, strictPort: true },
});
