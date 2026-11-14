import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `assets-local/pack` at the repo root: the same depth from `src/` and from the bundled `dist/`. */
export const DEFAULT_ASSETS_DIR = fileURLToPath(new URL('../../../assets-local/pack', import.meta.url));

const TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.json': 'application/json',
  '.dat': 'application/octet-stream',
};

/**
 * Answers `GET /assets/<path>` from the pack folder. Returns false when the URL is not under
 * /assets; 404s cleanly for a missing pack, a missing file or a path that leaves the folder.
 */
export async function serveAsset(rawUrl: string, assetsDir: string, res: ServerResponse): Promise<boolean> {
  const url = new URL(rawUrl, 'http://localhost');
  if (!url.pathname.startsWith('/assets/')) return false;

  const root = resolve(assetsDir);
  let file: string | null = null;
  try {
    const candidate = resolve(join(root, decodeURIComponent(url.pathname.slice('/assets/'.length))));
    if (candidate.startsWith(root + sep) && (await stat(candidate)).isFile()) file = candidate;
  } catch {
    // missing file, missing pack folder or malformed escape: all a 404
  }
  const type = file && TYPES[extname(file).toLowerCase()];
  if (!file || !type) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    return true;
  }
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' });
  createReadStream(file)
    .on('error', () => res.destroy())
    .pipe(res);
  return true;
}
