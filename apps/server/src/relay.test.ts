import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { WebSocket } from 'ws';
import { CODE_LENGTH, DROP_AFTER_MS, isValidCode, type ClientMessage, type ServerMessage } from '@aoe/protocol';
import { createApp } from './app';
import { PING_INTERVAL_MS, RoomRegistry, type Peer } from './rooms';

const WAIT_MS = 15_000;

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
      // Only a hung relay reaches this; a loaded machine takes seconds to schedule the server and the client.
      const timer = setTimeout(() => reject(new Error('timed out waiting for a server message')), WAIT_MS);
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

  /**
   * Assert nothing else is on its way. The relay answers a socket's messages in order, so a malformed frame's error
   * arriving with nothing queued before it means the relay had nothing more to send this client (no fixed sleep).
   */
  async expectSilence(): Promise<void> {
    this.socket.send('{nope');
    const m = await this.next();
    expect(this.queue).toEqual([]);
    expect(m).toMatchObject({ t: 'error', code: 'bad-message' });
  }

  close(): void {
    this.socket.close();
  }

  /** Break the socket without a close frame, as a lost connection does (the server sees 1006). */
  terminate(): void {
    this.socket.terminate();
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
  let civ = 0;
  rooms = new RoomRegistry({ generateSeed: () => 1234, generateCiv: () => (civ++ % 2) + 5 });
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

async function startGame(host: TestClient, guest: TestClient): Promise<string[]> {
  host.send({ t: 'ready', ready: true });
  guest.send({ t: 'ready', ready: true });
  await host.expect('lobby');
  await host.expect('lobby');
  await guest.expect('lobby');
  await guest.expect('lobby');
  host.send({ t: 'start' });
  return [(await host.expect('start')).token, (await guest.expect('start')).token];
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
    expect(created.players).toEqual([{ slot: 0, name: 'Eric', ready: false, civ: 5 }]);
    expect(created.settings).toEqual({ deathMatch: false, startingAge: 0, resources: 0, revealMap: false, fullTechTree: false, mapType: 3, mapSize: 144, victory: { type: 0 }, populationLimit: 50 });

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

  test('the host sets map and victory, each player its civ, both see them and the start carries them', async () => {
    const { host, guest } = await pair();
    const settings = { deathMatch: true, mapType: 7, mapSize: 96, victory: { type: 2, amount: 5000 }, startingAge: 4, resources: 0, revealMap: true, fullTechTree: true, populationLimit: 125 };
    guest.send({ t: 'settings', settings });
    expect((await guest.expect('error')).code).toBe('not-host');
    host.send({ t: 'settings', settings });
    for (const c of [host, guest]) expect((await c.expect('lobby')).settings).toEqual(settings);
    guest.send({ t: 'civ', civ: 17 });
    for (const c of [host, guest]) expect((await c.expect('lobby')).players.map((p) => p.civ)).toEqual([5, 17]);
    host.send({ t: 'civ', civ: 10 });
    for (const c of [host, guest]) expect((await c.expect('lobby')).players.map((p) => p.civ)).toEqual([10, 17]);
    // Ready locks the player's civ, and the host's settings (scr_mps.cpp fillPlayers, action).
    host.send({ t: 'ready', ready: true });
    for (const c of [host, guest]) await c.expect('lobby');
    host.send({ t: 'civ', civ: 1 });
    expect((await host.expect('error')).code).toBe('locked');
    host.send({ t: 'settings', settings: { deathMatch: false, startingAge: 0, resources: 0, revealMap: false, fullTechTree: false, mapType: 3, mapSize: 144, victory: { type: 0 }, populationLimit: 50 } });
    expect((await host.expect('error')).code).toBe('locked');
    guest.send({ t: 'ready', ready: true });
    for (const c of [host, guest]) await c.expect('lobby');
    host.send({ t: 'start' });
    for (const c of [host, guest]) {
      const start = await c.expect('start');
      expect(start.settings).toEqual(settings);
      expect(start.players.map((p) => p.civ)).toEqual([10, 17]);
    }
  });

  test('settings the sim cannot play are refused by the codec', async () => {
    const { host } = await pair();
    host.send({ t: 'settings', settings: { deathMatch: false, startingAge: 0, resources: 0, revealMap: false, fullTechTree: false, mapType: 0, mapSize: 144, victory: { type: 0 }, populationLimit: 50 } });
    expect((await host.expect('error')).code).toBe('bad-message');
    host.send({ t: 'civ', civ: 0 });
    expect((await host.expect('error')).code).toBe('bad-message');
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
    expect(lobby.players).toEqual([{ slot: 0, name: 'Guest', ready: false, civ: 6 }]);
    guest.send({ t: 'leave' });
    await guest.expectSilence();
    expect(rooms.rooms.has(code)).toBe(false);
  });
});

describe('chat', () => {
  test('a chat message goes to the players it names, in the lobby and in the game, never into a turn', async () => {
    const { host, guest, code } = await pair();
    host.send({ t: 'chat', text: 'hello', to: [0, 1] });
    expect(await guest.next()).toEqual({ t: 'chat', from: 0, text: 'hello' });
    // Not to the sender (it shows its own copy), nor to a player left out.
    guest.send({ t: 'chat', text: 'just me', to: [1] });
    host.send({ t: 'chat', text: 'nobody', to: [0] });
    await host.expectSilence();
    await guest.expectSilence();

    await startGame(host, guest);
    guest.send({ t: 'chat', text: 'gl hf', to: [0, 1] });
    expect(await host.next()).toEqual({ t: 'chat', from: 1, text: 'gl hf' });
    host.send({ t: 'turn', turn: 0, commands: [] });
    guest.send({ t: 'turn', turn: 0, commands: [] });
    expect(await host.expect('turn')).toMatchObject({ batches: [{ slot: 0, commands: [] }, { slot: 1, commands: [] }] });
    expect(rooms.rooms.get(code)?.log).toHaveLength(1);
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

  test('hashes sent before their turn is released, as the client sends them, are held and compared', async () => {
    const { host, guest, code } = await pair();
    await startGame(host, guest);
    // Lockstep.endTurn: the hash of turn N goes out just before the batch of turn N.
    host.send({ t: 'hash', turn: 0, hash: 7 });
    host.send({ t: 'turn', turn: 0, commands: [] });
    guest.send({ t: 'hash', turn: 0, hash: 7 });
    guest.send({ t: 'turn', turn: 0, commands: [] });
    expect((await host.expect('turn')).turn).toBe(0);
    expect((await guest.expect('turn')).turn).toBe(0);
    await host.expectSilence();
    expect(rooms.rooms.get(code)?.desyncs).toEqual([]);

    host.send({ t: 'hash', turn: 1, hash: 7 });
    host.send({ t: 'turn', turn: 1, commands: [] });
    guest.send({ t: 'hash', turn: 1, hash: 8 });
    guest.send({ t: 'turn', turn: 1, commands: [] });
    expect(await host.next()).toEqual({ t: 'desync', turn: 1, hashes: [7, 8] });
    expect(await guest.next()).toEqual({ t: 'desync', turn: 1, hashes: [7, 8] });
    expect(rooms.rooms.get(code)?.desyncs).toEqual([1]);
  });

  test('a hash for a turn the player has not run yet is refused', async () => {
    const { host, guest } = await pair();
    await startGame(host, guest);
    host.send({ t: 'hash', turn: 1, hash: 7 });
    expect((await host.expect('error')).code).toBe('bad-turn');
  });

  test('a player leaving a started game ends it for the other', async () => {
    const { host, guest, code } = await pair();
    await startGame(host, guest);
    guest.close();
    expect(await host.next()).toEqual({ t: 'ended', reason: 'peer-left' });
    await host.expectSilence();
    expect(rooms.rooms.has(code)).toBe(false);
  });

  test('a player who resigned leaves without ending the game: the server fills its batches', async () => {
    const { host, guest, code } = await pair();
    await startGame(host, guest);
    guest.send({ t: 'turn', turn: 0, commands: [{ type: 'resign' }] });
    guest.send({ t: 'leave' });
    host.send({ t: 'turn', turn: 0, commands: [] });
    expect(await host.expect('turn')).toEqual({ t: 'turn', turn: 0, batches: [{ slot: 0, commands: [] }, { slot: 1, commands: [{ type: 'resign' }] }] });
    host.send({ t: 'turn', turn: 1, commands: [] });
    expect(await host.expect('turn')).toEqual({ t: 'turn', turn: 1, batches: [{ slot: 0, commands: [] }, { slot: 1, commands: [] }] });
    expect(rooms.rooms.get(code)?.members.map((m) => m.dropped)).toEqual([false, true]);
    host.close();
    await guest.expectSilence();
  });
});

describe('rejoin', () => {
  test('a broken socket keeps its slot: the player rejoins with its token, gets the turns it missed and goes on', async () => {
    const { host, guest, code } = await pair();
    const [, token] = await startGame(host, guest);
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    for (const c of [host, guest]) c.send({ t: 'turn', turn: 0, commands: [] });
    await host.expect('turn');
    await guest.expect('turn');
    // Turn 1 is released while the guest's socket is broken: it sent its batch just before.
    guest.send({ t: 'turn', turn: 1, commands: [{ type: 'noop' }] });
    host.send({ t: 'turn', turn: 1, commands: [] });
    expect((await host.expect('turn')).turn).toBe(1);
    guest.terminate();
    host.send({ t: 'turn', turn: 2, commands: [] });
    await host.expectSilence();

    const wrong = await connect();
    wrong.send({ t: 'rejoin', code, slot: 1, token: 'nope', received: 1 });
    expect((await wrong.expect('error')).code).toBe('bad-rejoin');

    const back = await connect();
    back.send({ t: 'rejoin', code: code.toLowerCase(), slot: 1, token: token!, received: 1 });
    expect(await back.next()).toEqual({ t: 'rejoined', nextTurn: 2 });
    expect(await back.next()).toEqual({ t: 'turn', turn: 1, batches: [{ slot: 0, commands: [] }, { slot: 1, commands: [{ type: 'noop' }] }] });
    expect((await back.expect('rtt')).rtt).toHaveLength(2);
    back.send({ t: 'turn', turn: 2, commands: [] });
    expect((await host.expect('turn')).turn).toBe(2);
    expect((await back.expect('turn')).turn).toBe(2);
    expect(rooms.rooms.get(code)?.members.map((m) => m.dropped)).toEqual([false, false]);
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

  test('a player away DROP_AFTER_MS after it was last heard is dropped: its next batch resigns it, then empty ones', () => {
    let clock = 0;
    const timers: { fn: () => void; at: number }[] = [];
    const registry = new RoomRegistry({ generateSeed: () => 1, now: () => clock, generateToken: () => 't', schedule: (fn, ms) => {
      const timer = { fn, at: clock + ms };
      timers.push(timer);
      return () => timers.splice(timers.indexOf(timer), 1);
    } });
    const peers = [new FakePeer(), new FakePeer()];
    registry.handle(peers[0]!, { t: 'create', name: 'A' });
    const code = peers[0]!.take('lobby')[0]!.code;
    registry.handle(peers[1]!, { t: 'join', code, name: 'B' });
    for (const p of peers) registry.handle(p, { t: 'ready', ready: true });
    registry.handle(peers[0]!, { t: 'start' });
    registry.handle(peers[1]!, { t: 'turn', turn: 0, commands: [] });
    clock = 500;
    registry.disconnect(peers[1]!, true);
    expect(timers.map((t) => t.at)).toEqual([DROP_AFTER_MS]);
    registry.handle(peers[0]!, { t: 'turn', turn: 0, commands: [] });
    registry.handle(peers[0]!, { t: 'turn', turn: 1, commands: [] });
    expect(peers[0]!.take('turn').map((m) => m.turn)).toEqual([0]);
    clock = DROP_AFTER_MS;
    timers[0]!.fn();
    expect(peers[0]!.take('dropped')).toEqual([{ t: 'dropped', slot: 1 }]);
    registry.handle(peers[0]!, { t: 'turn', turn: 2, commands: [] });
    expect(peers[0]!.take('turn').map((m) => m.batches[1])).toEqual([
      { slot: 1, commands: [{ type: 'resign' }] },
      { slot: 1, commands: [] },
    ]);
    const late = new FakePeer();
    registry.handle(late, { t: 'rejoin', code, slot: 1, token: 't', received: 0 });
    expect(late.take('error')).toMatchObject([{ code: 'bad-rejoin' }]);
    // Its hashes are no longer awaited.
    registry.handle(peers[0]!, { t: 'hash', turn: 2, hash: 5 });
    expect(peers[0]!.take('desync')).toEqual([]);
  });

  test('a room whose players are all away is closed when the first drop falls due', () => {
    const timers: (() => void)[] = [];
    const registry = new RoomRegistry({ generateSeed: () => 1, now: () => 0, schedule: (fn) => (timers.push(fn), () => undefined) });
    const peers = [new FakePeer(), new FakePeer()];
    registry.handle(peers[0]!, { t: 'create', name: 'A' });
    const code = peers[0]!.take('lobby')[0]!.code;
    registry.handle(peers[1]!, { t: 'join', code, name: 'B' });
    for (const p of peers) registry.handle(p, { t: 'ready', ready: true });
    registry.handle(peers[0]!, { t: 'start' });
    for (const p of peers) registry.disconnect(p, true);
    timers[0]!();
    expect(registry.rooms.has(code)).toBe(false);
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
