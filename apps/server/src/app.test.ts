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
