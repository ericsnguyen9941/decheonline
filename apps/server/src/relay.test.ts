import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { WebSocket } from 'ws';
import { CODE_LENGTH, isValidCode, type ClientMessage, type ServerMessage } from '@aoe/protocol';
import { createApp } from './app';
import { PING_INTERVAL_MS, RoomRegistry, type Peer } from './rooms';

/** A ws client that queues server messages so tests can await them in order. Pings are left unanswered and skipped. */
class TestClient {
  private readonly queue: ServerMessage[] = [];
  private waiter: ((m: ServerMessage) => void) | undefined;
  private constructor(readonly socket: WebSocket) {
    socket.on('message', (data) => {
      const message = JSON.parse(data.toString()) as ServerMessage;
      if (message.t === 'ping') return;
      if (this.waiter) {
        const w = this.waiter;
        this.waiter = undefined;
        w(message);
      } else this.queue.push(message);
    });
  }

  static async connect(port: number): Promise<TestClient> {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    return new TestClient(socket);
  }

  send(message: ClientMessage | { t: string; [k: string]: unknown }): void {
    this.socket.send(JSON.stringify(message));
  }

  next(): Promise<ServerMessage> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for a server message')), 2000);
      this.waiter = (m) => {
        clearTimeout(timer);
        resolve(m);
      };
    });
  }

  async expect<T extends ServerMessage['t']>(t: T): Promise<Extract<ServerMessage, { t: T }>> {
    const m = await this.next();
    expect(m.t).toBe(t);
    return m as Extract<ServerMessage, { t: T }>;
  }

  /** Assert nothing else arrives shortly. */
  async expectSilence(): Promise<void> {
    await new Promise((r) => setTimeout(r, 50));
    expect(this.queue).toEqual([]);
  }

  close(): void {
    this.socket.close();
  }
}

let server: Server;
let rooms: RoomRegistry;
let port: number;
let clients: TestClient[];

async function connect(): Promise<TestClient> {
  const c = await TestClient.connect(port);
  clients.push(c);
  return c;
}

beforeEach(async () => {
  rooms = new RoomRegistry({ generateSeed: () => 1234 });
  server = createApp({ rooms });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as AddressInfo).port;
  clients = [];
});

afterEach(async () => {
  for (const c of clients) c.close();
  await new Promise((resolve) => server.close(resolve));
});

/** Host creates, guest joins by code; both drained to the post-join lobby. */
async function pair(): Promise<{ host: TestClient; guest: TestClient; code: string }> {
  const host = await connect();
  const guest = await connect();
  host.send({ t: 'create', name: 'Host' });
  const { code } = await host.expect('lobby');
  guest.send({ t: 'join', code, name: 'Guest' });
  await guest.expect('lobby');
  await host.expect('lobby');
  return { host, guest, code };
}

async function startGame(host: TestClient, guest: TestClient): Promise<void> {
  host.send({ t: 'ready', ready: true });
  guest.send({ t: 'ready', ready: true });
  await host.expect('lobby');
  await host.expect('lobby');
  await guest.expect('lobby');
  await guest.expect('lobby');
  host.send({ t: 'start' });
  await host.expect('start');
  await guest.expect('start');
}

describe('rooms', () => {
  test('create returns a short invite code and the guest joins by it', async () => {
    const host = await connect();
    const guest = await connect();
    host.send({ t: 'create', name: 'Eric' });
    const created = await host.expect('lobby');
    expect(created.code).toHaveLength(CODE_LENGTH);
    expect(isValidCode(created.code)).toBe(true);
    expect(created.you).toBe(0);
    expect(created.players).toEqual([{ slot: 0, name: 'Eric', ready: false }]);

    // Lower-case and dashes are accepted.
    guest.send({ t: 'join', code: created.code.toLowerCase().replace(/^(..)/, '$1-'), name: 'Bao' });
    const joined = await guest.expect('lobby');
    expect(joined.you).toBe(1);
    expect(joined.players.map((p) => p.name)).toEqual(['Eric', 'Bao']);
    const hostView = await host.expect('lobby');
    expect(hostView.you).toBe(0);
    expect(hostView.players).toHaveLength(2);
  });

  test('bad invite code is rejected', async () => {
    const c = await connect();
    c.send({ t: 'join', code: 'ZZZZZ', name: 'x' });
    expect((await c.expect('error')).code).toBe('bad-code');
    c.send({ t: 'join', code: 'nonsense!!', name: 'x' });
    expect((await c.expect('error')).code).toBe('bad-code');
  });

  test('third client is rejected with room-full and the room is unharmed', async () => {
    const { host, guest, code } = await pair();
    const third = await connect();
    third.send({ t: 'join', code, name: 'Third' });
    expect((await third.expect('error')).code).toBe('room-full');
    await host.expectSilence();
    await guest.expectSilence();
    expect(rooms.rooms.get(code)?.members).toHaveLength(2);
  });

  test('start needs the host and both players ready', async () => {
    const { host, guest } = await pair();
    host.send({ t: 'start' });
    expect((await host.expect('error')).code).toBe('not-ready');
    host.send({ t: 'ready', ready: true });
    guest.send({ t: 'ready', ready: true });
    for (const c of [host, guest]) {
      await c.expect('lobby');
      await c.expect('lobby');
    }
    guest.send({ t: 'start' });
    expect((await guest.expect('error')).code).toBe('not-host');
    host.send({ t: 'start' });
    const start = await host.expect('start');
    expect(start).toMatchObject({ seed: 1234, commandDelay: 2 });
    await guest.expect('start');
  });

  test('joining a started game is rejected', async () => {
    const { host, guest, code } = await pair();
    await startGame(host, guest);
    const late = await connect();
    late.send({ t: 'join', code, name: 'Late' });
    expect((await late.expect('error')).code).toBe('room-started');
  });

  test('malformed frame and messages outside a room are rejected', async () => {
    const c = await connect();
    c.socket.send('{nope');
    expect((await c.expect('error')).code).toBe('bad-message');
    c.send({ t: 'turn', turn: 0, commands: [] });
    expect((await c.expect('error')).code).toBe('not-in-room');
  });

  test('host leaving the lobby promotes the guest and drops readiness', async () => {
    const { host, guest, code } = await pair();
    host.send({ t: 'leave' });
    const lobby = await guest.expect('lobby');
    expect(lobby.you).toBe(0);
    expect(lobby.players).toEqual([{ slot: 0, name: 'Guest', ready: false }]);
    guest.send({ t: 'leave' });
    await guest.expectSilence();
    expect(rooms.rooms.has(code)).toBe(false);
  });
});

describe('turn relay', () => {
  test('both clients receive turns in order, batches ordered by slot', async () => {
    const { host, guest, code } = await pair();
    await startGame(host, guest);

    // Guest runs ahead; nothing is released until the host submits the same turn.
    guest.send({ t: 'turn', turn: 0, commands: [{ type: 'noop' }] });
    guest.send({ t: 'turn', turn: 1, commands: [] });
    await host.expectSilence();
    host.send({ t: 'turn', turn: 0, commands: [] });
    host.send({ t: 'turn', turn: 1, commands: [{ type: 'test', x: 3, y: 4 }] });

    const expected = [
      {
        t: 'turn',
        turn: 0,
        batches: [
          { slot: 0, commands: [] },
          { slot: 1, commands: [{ type: 'noop' }] },
        ],
      },
      {
        t: 'turn',
        turn: 1,
        batches: [
          { slot: 0, commands: [{ type: 'test', x: 3, y: 4 }] },
          { slot: 1, commands: [] },
        ],
      },
    ];
    for (const c of [host, guest]) {
      expect(await c.next()).toEqual(expected[0]);
      expect(await c.next()).toEqual(expected[1]);
    }
    expect(rooms.rooms.get(code)?.log).toEqual(expected.map(({ turn, batches }) => ({ turn, batches })));
  });

  test('out-of-order and premature turns are rejected', async () => {
    const { host, guest } = await pair();
    host.send({ t: 'turn', turn: 0, commands: [] });
    expect((await host.expect('error')).code).toBe('not-started');
    await startGame(host, guest);
    host.send({ t: 'turn', turn: 1, commands: [] });
    expect((await host.expect('error')).code).toBe('bad-turn');
    host.send({ t: 'turn', turn: 0, commands: [] });
    host.send({ t: 'turn', turn: 0, commands: [] });
    expect((await host.expect('error')).code).toBe('bad-turn');
  });

  test('a player may not run unboundedly ahead', async () => {
    const { host, guest } = await pair();
    await startGame(host, guest);
    for (let turn = 0; turn < 64; turn++) host.send({ t: 'turn', turn, commands: [] });
    host.send({ t: 'turn', turn: 64, commands: [] });
    expect((await host.expect('error')).code).toBe('bad-turn');
  });

  test('matching hashes stay quiet, mismatched hashes report desync to both', async () => {
    const { host, guest, code } = await pair();
    await startGame(host, guest);
    for (const c of [host, guest]) c.send({ t: 'turn', turn: 0, commands: [] });
    await host.expect('turn');
    await guest.expect('turn');

    host.send({ t: 'hash', turn: 0, hash: 7 });
    guest.send({ t: 'hash', turn: 0, hash: 7 });
    await host.expectSilence();

    for (const c of [host, guest]) c.send({ t: 'turn', turn: 1, commands: [] });
    await host.expect('turn');
    await guest.expect('turn');
    host.send({ t: 'hash', turn: 1, hash: 7 });
    guest.send({ t: 'hash', turn: 1, hash: 8 });
    expect(await host.next()).toEqual({ t: 'desync', turn: 1, hashes: [7, 8] });
    expect(await guest.next()).toEqual({ t: 'desync', turn: 1, hashes: [7, 8] });
    expect(rooms.rooms.get(code)?.desyncs).toEqual([1]);
  });

  test('a player leaving a started game ends it for the other', async () => {
    const { host, guest, code } = await pair();
    await startGame(host, guest);
    guest.close();
    expect(await host.next()).toEqual({ t: 'ended', reason: 'peer-left' });
    await host.expectSilence();
    expect(rooms.rooms.has(code)).toBe(false);
  });
});

describe('speed control', () => {
  class FakePeer implements Peer {
    messages: ServerMessage[] = [];
    send(m: ServerMessage): void {
      this.messages.push(m);
    }
    take<T extends ServerMessage['t']>(t: T): Extract<ServerMessage, { t: T }>[] {
      const out = this.messages.filter((m): m is Extract<ServerMessage, { t: T }> => m.t === t);
      this.messages = this.messages.filter((m) => m.t !== t);
      return out;
    }
  }

  function started(now: () => number) {
    const registry = new RoomRegistry({ generateSeed: () => 1, now });
    const peers = [new FakePeer(), new FakePeer()];
    registry.handle(peers[0]!, { t: 'create', name: 'A' });
    const code = peers[0]!.take('lobby')[0]!.code;
    registry.handle(peers[1]!, { t: 'join', code, name: 'B' });
    for (const p of peers) registry.handle(p, { t: 'ready', ready: true });
    registry.handle(peers[0]!, { t: 'start' });
    return { registry, peers, room: registry.rooms.get(code)! };
  }

  test('pings each player at start and every 8 s, and reports the round trips to both', () => {
    let clock = 1000;
    const { registry, peers } = started(() => clock);
    const pings = peers.map((p) => p.take('ping'));
    expect(pings).toEqual([[{ t: 'ping', n: 1 }], [{ t: 'ping', n: 1 }]]);
    clock += 12;
    registry.handle(peers[0]!, { t: 'pong', n: 1 });
    clock += 30;
    registry.handle(peers[1]!, { t: 'pong', n: 1 });
    expect(peers[0]!.take('rtt')).toEqual([{ t: 'rtt', rtt: [12, 0] }, { t: 'rtt', rtt: [12, 42] }]);
    clock += PING_INTERVAL_MS;
    registry.handle(peers[1]!, { t: 'hash', turn: 0, hash: 0 });
    expect(peers[1]!.take('ping')).toEqual([{ t: 'ping', n: 2 }]);
    expect(peers[0]!.take('ping')).toEqual([]);
  });

  test('the change agreed at boundary T rides on the release of turn T - 1, for turn T + 2', () => {
    const clock = 0;
    const { registry, peers, room } = started(() => clock);
    for (const p of peers) registry.handle(p, { t: 'pong', n: 1 });
    for (let turn = 0; turn < 40; turn++) {
      for (const p of peers) registry.handle(p, { t: 'turn', turn, commands: [], frameMs: 17 });
    }
    // Example 7.4: boundaries 22 and 28 (releases of turns 21 and 27).
    expect(room.log.filter((r) => r.speed)).toEqual([
      { turn: 21, batches: expect.any(Array), speed: { turn: 24, granularity: 20, frames: 9 } },
      { turn: 27, batches: expect.any(Array), speed: { turn: 30, granularity: 20, frames: 13 } },
    ]);
    expect(peers[1]!.take('turn').filter((m) => m.speed).map((m) => m.speed!.turn)).toEqual([24, 30]);
  });
});
