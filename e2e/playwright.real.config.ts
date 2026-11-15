import { join } from 'node:path';
import { defineConfig } from '@playwright/test';
import { BUNDLES_COMMAND, shared } from './playwright.shared';

// Local only: needs a pack from `AOE1_DIR=<install> npm run assets:import` (assets-local/pack).
// Own ports so it never collides with the synthetic run or a `npm run dev`. Served from the built bundles, with the
// main run's (load-proof) timeouts, one worker at a time.
const clientPort = 5274;
const serverPort = 8888;
const baseURL = `http://localhost:${clientPort}`;

export default defineConfig({
  timeout: shared.timeout,
  expect: shared.expect,
  testDir: './real',
  reporter: 'list',
  workers: 1,
  use: { baseURL },
  webServer: {
    command: BUNDLES_COMMAND,
    cwd: '..',
    url: baseURL,
    // Every player starts the lobby Egyptian (the main config's reason).
    env: { CLIENT_PORT: String(clientPort), PORT: String(serverPort), ASSETS_DIR: join(import.meta.dirname, '..', 'assets-local', 'pack'), LOBBY_CIV: '1' },
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
