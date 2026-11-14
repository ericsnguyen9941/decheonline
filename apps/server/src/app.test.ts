import type { AddressInfo } from 'node:net';
import { expect, test } from 'vitest';
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
