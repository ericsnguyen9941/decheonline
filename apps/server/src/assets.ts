import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `assets-local/pack` at the repo root: the same depth from `src/` and from the bundled `dist/`. */
export const DEFAULT_ASSETS_DIR = fileURLToPath(new URL('../../../assets-local/pack', import.meta.url));
/** `apps/client/dist`, the built client (`npm run build`): the same depth from `src/` and from the bundled `dist/`. */
export const DEFAULT_CLIENT_DIR = fileURLToPath(new URL('../../client/dist', import.meta.url));

const PACK_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.json': 'application/json',
  '.dat': 'application/octet-stream',
  // The sounds and the music with its sound bank (docs/spec/sounds.md).
  '.wav': 'audio/wav',
  '.mid': 'audio/midi',
  '.dls': 'application/octet-stream',
  '.sf2': 'application/octet-stream',
};

const CLIENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

/** The client's files under `/bundle/` carry a content hash in their name (vite `assetsDir`), so they never change. */
const IMMUTABLE = 'public, max-age=31536000, immutable';
/** Everything else may change under the same URL (the page, the pack): the browser revalidates, a 304 costs no body. */
const REVALIDATE = 'no-cache';

function notFound(res: ServerResponse): void {
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
}

/** A path under `root`, or null for a missing file, a missing folder, a malformed escape or a path that leaves `root`. */
async function resolveFile(root: string, relPath: string) {
  try {
    const base = resolve(root);
    const candidate = resolve(join(base, decodeURIComponent(relPath)));
    if (!candidate.startsWith(base + sep)) return null;
    const info = await stat(candidate);
    return info.isFile() ? { file: candidate, info } : null;
  } catch {
    return null;
  }
}

/** True when the request's validators (`If-None-Match`, else `If-Modified-Since`) say the client's copy is current. */
function notModified(req: IncomingMessage, etag: string, mtimeMs: number): boolean {
  const none = req.headers['if-none-match'];
  if (none !== undefined) return none.split(',').some((tag) => tag.trim() === '*' || tag.trim().replace(/^W\//, '') === etag.replace(/^W\//, ''));
  const since = Date.parse(req.headers['if-modified-since'] ?? '');
  return !Number.isNaN(since) && Math.floor(mtimeMs / 1000) * 1000 <= since;
}

/** Answers a GET or HEAD with `file`'s bytes, its `ETag` and `Last-Modified`, or 304 when the request's copy is current. */
async function sendFile(
  req: IncomingMessage,
  res: ServerResponse,
  { file, info }: NonNullable<Awaited<ReturnType<typeof resolveFile>>>,
  types: Record<string, string>,
  cacheControl: string,
): Promise<void> {
  const type = types[extname(file).toLowerCase()];
  if (!type) return notFound(res);
  const etag = `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
  const headers = { etag, 'last-modified': info.mtime.toUTCString(), 'cache-control': cacheControl };
  if (notModified(req, etag, info.mtimeMs)) {
    res.writeHead(304, headers);
    res.end();
    return;
  }
  res.writeHead(200, { ...headers, 'content-type': type, 'content-length': info.size });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(file)
    .on('error', () => res.destroy())
    .pipe(res);
}

/**
 * Answers `GET /assets/<path>` from the pack folder. Returns false when the URL is not under
 * /assets; 404s cleanly for a missing pack, a missing file or a path that leaves the folder.
 */
export async function serveAsset(req: IncomingMessage, rawUrl: string, assetsDir: string, res: ServerResponse): Promise<boolean> {
  const url = new URL(rawUrl, 'http://localhost');
  if (!url.pathname.startsWith('/assets/')) return false;
  const found = await resolveFile(assetsDir, url.pathname.slice('/assets/'.length));
  if (found) await sendFile(req, res, found, PACK_TYPES, REVALIDATE);
  else notFound(res);
  return true;
}

/**
 * Answers `GET /` and `GET /<path>` from the built client folder (`/` is `index.html`; the client has no routes of its
 * own, so no other URL falls back to the page). 404s for a missing file or folder.
 */
export async function serveClient(req: IncomingMessage, rawUrl: string, clientDir: string, res: ServerResponse): Promise<void> {
  const { pathname } = new URL(rawUrl, 'http://localhost');
  const relPath = pathname === '/' ? 'index.html' : pathname.slice(1);
  const found = await resolveFile(clientDir, relPath);
  if (found) await sendFile(req, res, found, CLIENT_TYPES, pathname.startsWith('/bundle/') ? IMMUTABLE : REVALIDATE);
  else notFound(res);
}
