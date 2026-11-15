import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { importAssets, writeSyntheticInstall } from '@aoe/assets-import';
import { syntheticInstallDir, syntheticPackDir } from './synthetic-pack';

/** Builds a fake install and imports it; the dev server (ASSETS_DIR) serves the result. */
export default async function globalSetup(): Promise<void> {
  // A macOS system sleep counts against Playwright's test timeouts (a sleeping test "hangs" for the sleep's length):
  // keep the Mac awake until this runner exits. The Linux image has no caffeinate.
  if (process.platform === 'darwin') spawn('caffeinate', ['-s', '-i', '-w', String(process.pid)], { stdio: 'ignore', detached: true }).unref();
  await rm(syntheticInstallDir, { recursive: true, force: true });
  await writeSyntheticInstall(syntheticInstallDir);
  await importAssets({ installDir: syntheticInstallDir, outDir: syntheticPackDir });
}
