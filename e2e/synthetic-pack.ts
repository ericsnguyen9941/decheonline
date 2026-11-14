import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Fixed paths so the config (which names the pack for the server) and the setup agree.
export const syntheticInstallDir = join(tmpdir(), 'aoe1web-e2e-install');
export const syntheticPackDir = join(tmpdir(), 'aoe1web-e2e-pack');
