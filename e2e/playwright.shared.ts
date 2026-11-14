import { type PlaywrightTestConfig } from '@playwright/test';
import { syntheticPackDir } from './synthetic-pack';

// Own ports so the e2e run never collides with a `npm run dev` left running.
const clientPort = 5273;
const serverPort = 8887;
const baseURL = `http://localhost:${clientPort}`;

/** What the main and the latency configs share: the synthetic pack, the dev server and the (load-proof) timeouts. */
export const shared: PlaywrightTestConfig = {
  testDir: './tests',
  globalSetup: './global-setup.ts',
  // One baseline per screenshot, not per OS: the synthetic art is flat colour, so engines agree.
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  // The machine may run dozens of other jobs: waits are on state (a turn reached, a unit trained) and carry no cap of
  // their own, so these are only the stall bounds. A test that does not progress fails at `timeout`.
  timeout: 240_000,
  expect: { timeout: 60_000 },
  use: { baseURL },
  webServer: {
    command: 'npm run dev',
    cwd: '..',
    url: baseURL,
    env: { CLIENT_PORT: String(clientPort), PORT: String(serverPort), ASSETS_DIR: syntheticPackDir },
    reuseExistingServer: false,
    timeout: 120_000,
  },
};
