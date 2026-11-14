import { describe, expect, test } from 'vitest';
import type { ClientMessage, Command, ServerMessage, SpeedChange } from '@aoe/protocol';
import { startingObjects, World } from '@aoe/sim';
import type { Link } from '../net/link';
import { Lockstep, type Timers } from './lockstep';

class FakeLink implements Link {
  sent: ClientMessage[] = [];
  handlers: ((m: ServerMessage) => void)[] = [];
  send(m: ClientMessage): void {
    this.sent.push(m);
  }
  onMessage(h: (m: ServerMessage) => void): () => void {
    this.handlers.push(h);
    return () => undefined;
  }
  onClose(): void {}
  close(): void {}
  receive(m: ServerMessage): void {
    for (const h of this.handlers) h(m);
  }
}

/** Timers on a fake clock: `next` jumps the clock to the earliest timer and runs it. */
class FakeTimers implements Timers {
  clock = 0;
  due: { fn: () => void; at: number }[] = [];
  set(fn: () => void, ms: number): unknown {
    const timer = { fn, at: this.clock + ms };
    this.due.push(timer);
    return timer;
  }
  clear(handle: unknown): void {
    this.due = this.due.filter((t) => t !== handle);
  }
  next(): void {
    const timer = this.due.reduce((a, b) => (b.at < a.at ? b : a));
    this.due = this.due.filter((t) => t !== timer);
    this.clock = Math.max(this.clock, timer.at);
    timer.fn();
  }
}

const start = { seed: 77, commandDelay: 2, playerCount: 2 };
const FRAME_MS = 16;

function setup() {
  const link = new FakeLink();
  const timers = new FakeTimers();
  const lockstep = new Lockstep({ link, start, timers, now: () => timers.clock, frameMs: () => FRAME_MS });
  return { link, timers, lockstep };
}

const release = (turn: number, commands: [Command[], Command[]] = [[], []], speed?: SpeedChange): ServerMessage => ({
  t: 'turn',
  turn,
  batches: commands.map((c, slot) => ({ slot, commands: c })),
  ...(speed && { speed }),
});

/** Run timers until `lockstep` has finished `turn`, releasing every submitted turn as the relay would. */
function runThrough(link: FakeLink, timers: FakeTimers, lockstep: Lockstep, turn: number): void {
  while (lockstep.turn <= turn) {
    timers.next();
    for (const m of link.sent.splice(0)) if (m.t === 'turn') link.receive(release(m.turn));
  }
}

describe('lockstep', () => {
  test('turns 0 and 1 need no batch; each sends its hash and the commands issued during it', () => {
    const { link, timers, lockstep } = setup();
    expect(link.sent).toEqual([]);
    lockstep.issue({ type: 'test', x: 1, y: 2 });
    timers.next();
    expect(lockstep.turn).toBe(1);
    const hash = lockstep.hashes.get(0)!;
    expect(link.sent).toEqual([
      { t: 'hash', turn: 0, hash },
      { t: 'turn', turn: 0, commands: [{ type: 'test', x: 1, y: 2 }], frameMs: FRAME_MS },
    ]);
    timers.next();
    expect(lockstep.turn).toBe(2);
    expect(timers.clock).toBe(FRAME_MS);
  });

  test('the boundary step of turn N waits for the release of turn N - 2', () => {
    const { link, timers, lockstep } = setup();
    timers.next();
    timers.next();
    timers.next();
    expect(lockstep.turn).toBe(2);
    expect(timers.due).toEqual([]);
    link.receive(release(1)); // out of order: turn 0 not released yet
    expect(lockstep.turn).toBe(2);
    link.receive(release(0));
    expect(lockstep.turn).toBe(3);
  });

  test('buffer step k runs k · G ms after the boundary; the next boundary one frame after the last', () => {
    const { link, timers, lockstep } = setup();
    runThrough(link, timers, lockstep, 6);
    const boundary = timers.clock + FRAME_MS;
    timers.next();
    expect([lockstep.turn, lockstep.world.turnStep]).toEqual([7, 2]);
    const steps: number[] = [];
    while (lockstep.turn === 7) {
      timers.next();
      steps.push(timers.clock - boundary);
    }
    expect(steps).toEqual([90, 180, 270, 360, 450, 540, 630, 720, 810]);
    for (const m of link.sent.splice(0)) if (m.t === 'turn') link.receive(release(m.turn));
    timers.next();
    expect(timers.clock - boundary).toBe(810 + FRAME_MS);
    expect(lockstep.turnMs(8)).toBe(810 + FRAME_MS);
  });

  test('a late loop runs every step that is due in one pass; the next turn restarts the clock at its boundary', () => {
    const { link, timers, lockstep } = setup();
    runThrough(link, timers, lockstep, 6);
    timers.next();
    expect([lockstep.turn, lockstep.world.turnStep]).toEqual([7, 2]);
    timers.clock += 5000;
    timers.next();
    expect([lockstep.turn, lockstep.world.turnStep]).toEqual([8, 2]);
    expect(timers.due.map((t) => t.at - timers.clock)).toEqual([90]);
  });

  test('applies both batches and the agreed speed like a World fed the same input', () => {
    const { link, timers, lockstep } = setup();
    const reference = new World({ players: 3, randomSeed: start.seed, units: startingObjects(3) });
    const test = { type: 'test', x: 5, y: 6 } as const;
    const speed = { turn: 12, granularity: 30, frames: 9 };
    for (let turn = 0; turn < 20; turn++) {
      if (turn >= 2) {
        const commands: [Command[], Command[]] = [turn === 3 ? [test] : [], turn === 4 ? [test] : []];
        link.receive(release(turn - 2, commands, turn === 9 ? speed : undefined));
        reference.addBatch(turn - 2, 1, commands[0]);
        reference.addBatch(turn - 2, 2, commands[1]);
        if (turn === 9) reference.setSpeedChange(speed);
      }
      reference.runTurn();
      while (lockstep.turn === turn) timers.next();
      expect(lockstep.hashes.get(turn)).toBe(reference.hash());
    }
    expect([lockstep.world.granularity, lockstep.world.frames]).toEqual([30, 9]);
    expect(lockstep.turnMs(20)).toBe(8 * 30 + FRAME_MS);
    expect(lockstep.applied.map((c) => c.length)).toEqual([1, 1]);
    expect([...lockstep.world.entities.all()].filter((e) => !e.sprite).map((e) => e.owner)).toEqual([1, 2]);
  });

  test('answers pings, at once or after the debug delay, and keeps the reported round trips', () => {
    const { link, timers, lockstep } = setup();
    link.receive({ t: 'ping', n: 1 });
    expect(link.sent).toEqual([{ t: 'pong', n: 1 }]);
    lockstep.pongDelayMs = 500;
    link.receive({ t: 'ping', n: 2 });
    expect(link.sent).toHaveLength(1);
    while (!link.sent.some((m) => m.t === 'pong' && m.n === 2)) timers.next();
    expect(timers.clock).toBe(500);
    link.receive({ t: 'rtt', rtt: [12, 40] });
    expect(lockstep.rtt).toEqual([12, 40]);
  });

  test('desync and ended stop the loop and notify', () => {
    const { link, timers, lockstep } = setup();
    let desync: number | undefined;
    lockstep.onDesync = (turn) => (desync = turn);
    link.receive({ t: 'desync', turn: 9, hashes: [1, 2] });
    expect(desync).toBe(9);
    expect(timers.due).toEqual([]);
    link.receive(release(0));
    expect(lockstep.turn).toBe(0);
  });
});
