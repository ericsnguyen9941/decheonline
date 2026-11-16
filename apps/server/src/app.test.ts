import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createApp } from './app';

test('GET /health answers ok', async () => {
  const server = createApp();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

describe('GET /assets', () => {
  let dir: string;
  let server: Server;
  let base: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'aoe-assets-'));
    await mkdir(join(dir, 'pack'));
    await writeFile(join(dir, 'pack', 'manifest.json'), '{"version":1}');
    await writeFile(join(dir, 'pack', 'x.exe'), 'nope');
    for (const name of ['5000.wav', 'music1.mid', 'bank.dls']) await writeFile(join(dir, 'pack', name), 'RIFF');
    await writeFile(join(dir, 'secret.json'), '{}');
    server = createApp({ assetsDir: join(dir, 'pack') });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });

  test('serves a pack file with its content type', async () => {
    const res = await fetch(`${base}/assets/manifest.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(await res.json()).toEqual({ version: 1 });
  });

  test('serves the sounds, the music and its sound bank', async () => {
    for (const [name, type] of [['5000.wav', 'audio/wav'], ['music1.mid', 'audio/midi'], ['bank.dls', 'application/octet-stream']]) {
      const res = await fetch(`${base}/assets/${name}`);
      expect(res.status, name).toBe(200);
      expect(res.headers.get('content-type'), name).toBe(type);
    }
  });

  test('404s for a missing file, an unknown type and a path outside the pack', async () => {
    for (const path of ['/assets/nope.png', '/assets/x.exe', '/assets/', '/assets/..%2Fsecret.json', '/assets/%2e%2e/secret.json']) {
      expect((await fetch(`${base}${path}`)).status, path).toBe(404);
    }
  });

  test('404s cleanly when the pack folder does not exist', async () => {
    const empty = createApp({ assetsDir: join(dir, 'absent') });
    await new Promise<void>((resolve) => empty.listen(0, resolve));
    try {
      const res = await fetch(`http://127.0.0.1:${(empty.address() as AddressInfo).port}/assets/manifest.json`);
      expect(res.status).toBe(404);
    } finally {
      await new Promise((resolve) => empty.close(resolve));
    }
  });
});

describe('conditional requests and the built client', () => {
  let dir: string;
  let server: Server;
  let base: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'aoe-client-'));
    await mkdir(join(dir, 'pack'));
    await mkdir(join(dir, 'client', 'bundle'), { recursive: true });
    await writeFile(join(dir, 'pack', 'manifest.json'), '{"version":1}');
    await writeFile(join(dir, 'client', 'index.html'), '<title>AoE1 Web</title>');
    await writeFile(join(dir, 'client', 'bundle', 'index-abc123.js'), 'export {};');
    await writeFile(join(dir, 'client', 'bundle', 'index-abc123.css'), 'body{}');
    await writeFile(join(dir, 'client', 'bundle', 'x.exe'), 'nope');
    await writeFile(join(dir, 'secret.json'), '{}');
    server = createApp({ assetsDir: join(dir, 'pack'), clientDir: join(dir, 'client') });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });

  test('serves the page at / (query string ignored) and /index.html', async () => {
    for (const path of ['/', '/?debug=net', '/index.html']) {
      const res = await fetch(`${base}${path}`);
      expect(res.status, path).toBe(200);
      expect(res.headers.get('content-type'), path).toBe('text/html; charset=utf-8');
      expect(await res.text(), path).toBe('<title>AoE1 Web</title>');
    }
  });

  test('serves the bundle with content types and an immutable cache', async () => {
    const js = await fetch(`${base}/bundle/index-abc123.js`);
    expect(js.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(js.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect((await fetch(`${base}/bundle/index-abc123.css`)).headers.get('content-type')).toBe('text/css; charset=utf-8');
  });

  test('a file with a validator answers 304 to If-None-Match and If-Modified-Since, and a stale one 200', async () => {
    for (const path of ['/', '/assets/manifest.json', '/bundle/index-abc123.js']) {
      const first = await fetch(`${base}${path}`);
      const etag = first.headers.get('etag');
      const modified = first.headers.get('last-modified');
      expect(etag, path).toBeTruthy();
      expect(modified, path).toBeTruthy();
      const byTag = await fetch(`${base}${path}`, { headers: { 'if-none-match': etag! } });
      expect(byTag.status, path).toBe(304);
      expect(await byTag.text(), path).toBe('');
      expect((await fetch(`${base}${path}`, { headers: { 'if-modified-since': modified! } })).status, path).toBe(304);
      expect((await fetch(`${base}${path}`, { headers: { 'if-none-match': 'W/"0-0"' } })).status, path).toBe(200);
    }
  });

  test('HEAD answers the headers without a body', async () => {
    const res = await fetch(`${base}/assets/manifest.json`, { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe('13');
    expect(await res.text()).toBe('');
  });

  test('404s for a missing file, an unknown type and a path outside the client folder', async () => {
    for (const path of ['/nope.js', '/bundle/x.exe', '/bundle/', '/..%2Fsecret.json', '/%2e%2e/secret.json']) {
      expect((await fetch(`${base}${path}`)).status, path).toBe(404);
    }
  });

  test('POST is a 404 and /health still answers', async () => {
    expect((await fetch(`${base}/`, { method: 'POST' })).status).toBe(404);
    expect((await fetch(`${base}/health`)).status).toBe(200);
  });
});
