import { type PlaywrightTestConfig } from '@playwright/test';
import { syntheticPackDir } from './synthetic-pack';

// Own ports so the e2e run never collides with a `npm run dev` left running.
const clientPort = 5273;
const serverPort = 8887;
const baseURL = `http://localhost:${clientPort}`;

/**
 * The built bundles, not `npm run dev`: a page then loads a few files instead of hundreds of modules the dev server
 * transforms on request, which is what made every test minutes long on a loaded machine.
 */
export const BUNDLES_COMMAND = 'npm run build && npx concurrently -k -n server,client "npm start -w @aoe/server" "npm run preview -w @aoe/client"';

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
    command: BUNDLES_COMMAND,
    cwd: '..',
    url: baseURL,
    // Every player starts the lobby Egyptian, not a random civ, so a test that does not pick one plays the same civ.
    env: { NO_GTM: '1', CLIENT_PORT: String(clientPort), PORT: String(serverPort), ASSETS_DIR: syntheticPackDir, LOBBY_CIV: '1', DROP_AFTER_MS: '40000' },
    reuseExistingServer: false,
    timeout: 300_000,
  },
};
