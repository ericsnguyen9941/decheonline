import { describe, expect, test } from 'vitest';
import type { ClientMessage, ServerMessage } from '@aoe/protocol';
import { TURN_MS } from '@aoe/protocol';
import { World } from '@aoe/sim';
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

class FakeTimers implements Timers {
  due: (() => void)[] = [];
  delays: number[] = [];
  set(fn: () => void, ms: number): unknown {
    this.due.push(fn);
    this.delays.push(ms);
    return fn;
  }
  clear(): void {
    this.due = [];
  }
  fire(): void {
    this.due.shift()?.();
  }
}

const start = { seed: 77, turnMs: TURN_MS, commandDelay: 2, playerCount: 2 };

function setup() {
  const link = new FakeLink();
  const timers = new FakeTimers();
  const lockstep = new Lockstep({ link, start, timers });
  return { link, timers, lockstep };
}

describe('lockstep', () => {
  test('submits empty batches for turns 0 and 1 on start', () => {
    const { link } = setup();
    expect(link.sent).toEqual([
      { t: 'turn', turn: 0, commands: [] },
      { t: 'turn', turn: 1, commands: [] },
    ]);
  });

  test('a released turn runs, reports its hash and submits the batch for turn + 2', () => {
    const { link, lockstep } = setup();
    lockstep.issue({ type: 'test', x: 1, y: 2 });
    link.receive({ t: 'turn', turn: 0, batches: [{ slot: 0, commands: [] }, { slot: 1, commands: [] }] });
    expect(lockstep.turn).toBe(1);
    const hash = lockstep.hashes.get(0)!;
    expect(link.sent).toContainEqual({ t: 'hash', turn: 0, hash });
    expect(link.sent).toContainEqual({ t: 'turn', turn: 2, commands: [{ type: 'test', x: 1, y: 2 }] });
  });

  test('waits for the released turn and for the pacing delay', () => {
    const { link, timers, lockstep } = setup();
    const empty = (turn: number): ServerMessage => ({
      t: 'turn',
      turn,
      batches: [{ slot: 0, commands: [] }, { slot: 1, commands: [] }],
    });
    link.receive(empty(1)); // out of order: turn 0 not released yet
    expect(lockstep.turn).toBe(0);
    link.receive(empty(0));
    expect(lockstep.turn).toBe(1); // turn 1 was already released, but pacing holds it
    expect(timers.delays).toEqual([90]); // turn 0 is a single step
    timers.fire();
    expect(lockstep.turn).toBe(2);
  });

  test('applies both batches like a World fed the same input', () => {
    const { link, timers, lockstep } = setup();
    const reference = new World({ players: 3, randomSeed: start.seed });
    const test = { type: 'test', x: 5, y: 6 } as const;
    for (let turn = 0; turn < 12; turn++) {
      const batches = [
        { slot: 0, commands: turn === 3 ? [test] : [] },
        { slot: 1, commands: turn === 4 ? [test] : [] },
      ];
      link.receive({ t: 'turn', turn, batches });
      for (const b of batches) reference.addBatch(turn, b.slot + 1, b.commands);
      reference.runTurn();
      expect(lockstep.hashes.get(turn)).toBe(reference.hash());
      timers.fire();
    }
    expect(lockstep.applied.map((c) => c.length)).toEqual([1, 1]);
    expect([...lockstep.world.entities.all()].map((e) => e.owner)).toEqual([1, 2]);
  });

  test('desync and ended stop the loop and notify', () => {
    const { link, lockstep } = setup();
    let desync: number | undefined;
    lockstep.onDesync = (turn) => (desync = turn);
    link.receive({ t: 'desync', turn: 9, hashes: [1, 2] });
    expect(desync).toBe(9);
    link.receive({ t: 'turn', turn: 0, batches: [] });
    expect(lockstep.turn).toBe(0);
  });
});
