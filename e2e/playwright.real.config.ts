import { defineConfig } from '@playwright/test';

// Local only: needs a pack from `AOE1_DIR=<install> npm run assets:import` (assets-local/pack).
// Own ports so it never collides with the synthetic run or a `npm run dev`.
const clientPort = 5274;
const serverPort = 8888;
const baseURL = `http://localhost:${clientPort}`;

export default defineConfig({
  testDir: './real',
  reporter: 'list',
  use: { baseURL },
  webServer: {
    command: 'npm run dev',
    cwd: '..',
    url: baseURL,
    env: { CLIENT_PORT: String(clientPort), PORT: String(serverPort) },
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
