import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importAssets } from './import';
import { PACK_VERSION } from './manifest';

const installDir = process.env.AOE1_DIR;
if (!installDir) {
  console.error('assets:import: set AOE1_DIR to the AoE1 + Rise of Rome install folder');
  process.exit(1);
}
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const outDir = resolve(process.env.ASSETS_DIR ?? join(repoRoot, 'assets-local', 'pack'));

const started = Date.now();
try {
  const { slpCount, imageCount, wavCount } = await importAssets({ installDir, outDir, log: (line) => console.log(line) });
  const took = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`assets:import: pack version ${PACK_VERSION}: ${slpCount} slp -> ${imageCount} images, ${wavCount} wav in ${outDir} (${took}s)`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
