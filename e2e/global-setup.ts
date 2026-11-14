import { rm } from 'node:fs/promises';
import { importAssets, writeSyntheticInstall } from '@aoe/assets-import';
import { syntheticInstallDir, syntheticPackDir } from './synthetic-pack';

/** Builds a fake install and imports it; the dev server (ASSETS_DIR) serves the result. */
export default async function globalSetup(): Promise<void> {
  await rm(syntheticInstallDir, { recursive: true, force: true });
  await writeSyntheticInstall(syntheticInstallDir);
  await importAssets({ installDir: syntheticInstallDir, outDir: syntheticPackDir });
}
