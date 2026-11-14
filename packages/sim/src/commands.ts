/**
 * Command vocabulary and scheduling (docs/spec/core.md §2.3-2.4). Every command travels as a JSON object
 * tagged by `type`; this file is the single list of types the sim accepts.
 */

/** Does nothing. Keeps a turn's batch non-empty in tests. */
export interface NoopCommand {
  type: 'noop';
}

/**
 * Determinism probe, not a game rule: spawns an entity owned by the sender at (x, y) with hit points
 * drawn from the RNG, then moves each of the sender's entities one float32 unit step toward (x, y).
 */
export interface TestCommand {
  type: 'test';
  x: number;
  y: number;
}

export type Command = NoopCommand | TestCommand;

/** Validate untrusted input (from the wire). Returns a fresh object with only known fields, or null. */
export function parseCommand(v: unknown): Command | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  switch (o['type']) {
    case 'noop':
      return { type: 'noop' };
    case 'test': {
      const { x, y } = o;
      if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null;
      return { type: 'test', x, y };
    }
    default:
      return null;
  }
}

export interface QueuedCommand {
  /** Turn the command executes on (issue turn + 2, src/com_hand.cpp:2810). */
  turn: number;
  /** Sender player number. */
  player: number;
  /** 1-based position among the sender's commands for this turn (src/com_q.cpp:335). */
  seq: number;
  command: Command;
}

/**
 * Commands waiting for their turn. `take(turn)` hands them out ordered by sender player, then sequence
 * (the original's `Code = sequence + player * 1000`, src/com_q.cpp:228) and drops any for a passed turn
 * (src/com_q.cpp:304-306).
 */
export class CommandQueue {
  private items: QueuedCommand[] = [];

  get size(): number {
    return this.items.length;
  }

  /** Queue one sender's commands for `turn`, in the order the sender issued them. */
  push(turn: number, player: number, commands: readonly Command[]): void {
    let seq = 0;
    for (const item of this.items) if (item.turn === turn && item.player === player) seq = Math.max(seq, item.seq);
    for (const command of commands) this.items.push({ turn, player, seq: ++seq, command });
  }

  take(turn: number): QueuedCommand[] {
    const due: QueuedCommand[] = [];
    const later: QueuedCommand[] = [];
    for (const item of this.items) {
      if (item.turn === turn) due.push(item);
      else if (item.turn > turn) later.push(item);
    }
    this.items = later;
    return due.sort((a, b) => a.player - b.player || a.seq - b.seq);
  }

  toJSON(): QueuedCommand[] {
    return this.items.map((item) => ({ ...item, command: { ...item.command } }));
  }

  static fromJSON(items: QueuedCommand[]): CommandQueue {
    const queue = new CommandQueue();
    queue.items = items.map((item) => ({ ...item, command: { ...item.command } }));
    return queue;
  }
}
