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
 * drawn from the RNG, then moves each of the sender's non-unit entities one float32 unit step toward (x, y).
 */
export interface TestCommand {
  type: 'test';
  x: number;
  y: number;
}

/**
 * Move order (`RGE_Command::do_command_move`, docs/spec/movement.md §5.1): the listed units of the sender walk to map
 * point (x, y), in tiles.
 */
export interface MoveCommand {
  type: 'move';
  units: number[];
  x: number;
  y: number;
}

/**
 * Work order (`RGE_Command::do_command_work`, docs/spec/economy.md §3.1): the listed units of the sender work on
 * object `target` (gather, hunt, drop off); (x, y) is the clicked map point.
 */
export interface WorkCommand {
  type: 'work';
  units: number[];
  target: number;
  x: number;
  y: number;
}

/**
 * Build order (`TRIBE_Command::do_command_build`, docs/spec/economy.md §4.1): place a foundation of master `unitType`
 * centred on (x, y), paid by the sender, and send the listed units of the sender to build it.
 */
export interface BuildCommand {
  type: 'build';
  units: number[];
  unitType: number;
  x: number;
  y: number;
}

/**
 * Production queue order (`TRIBE_Command::do_command_queue`, economy.md §5.1): `count` > 0 queues that many units of
 * master `unit` at `building`, `count` < 0 removes that many.
 */
export interface QueueCommand {
  type: 'queue';
  building: number;
  unit: number;
  count: number;
}

/**
 * Cancel order (`TRIBE_Command::do_command_cancel_build`, economy.md §4.4): a foundation is cancelled with a partial
 * refund; any other unit or building is destroyed.
 */
export interface CancelCommand {
  type: 'cancel';
  target: number;
}

/**
 * Attack order: the listed units of the sender attack object `target` (the right-click on an enemy; the original sends
 * it as a work order, `do_command_work`, at the target's position).
 */
export interface AttackCommand {
  type: 'attack';
  units: number[];
  target: number;
}

/** Most units one move command may list. */
export const MAX_ORDER_UNITS = 255;

export type Command = NoopCommand | TestCommand | MoveCommand | WorkCommand | BuildCommand | QueueCommand | CancelCommand | AttackCommand;

function isId(v: unknown): v is number {
  return Number.isInteger(v) && (v as number) > 0 && (v as number) <= 0x7fffffff;
}

/** A master object id (`short` on the wire). */
function isMasterId(v: unknown): v is number {
  return Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 0x7fff;
}

function isPoint(x: unknown, y: unknown): boolean {
  return typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y);
}

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
    case 'move':
    case 'work': {
      const { units, x, y, target } = o;
      if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null;
      if (!Array.isArray(units) || units.length === 0 || units.length > MAX_ORDER_UNITS) return null;
      if (!units.every(isId)) return null;
      if (o['type'] === 'move') return { type: 'move', units: [...(units as number[])], x, y };
      if (!isId(target)) return null;
      return { type: 'work', units: [...(units as number[])], target, x, y };
    }
    case 'build': {
      const { units, unitType, x, y } = o;
      if (!isPoint(x, y) || !isMasterId(unitType)) return null;
      if (!Array.isArray(units) || units.length > MAX_ORDER_UNITS || !units.every(isId)) return null;
      return { type: 'build', units: [...(units as number[])], unitType, x: x as number, y: y as number };
    }
    case 'queue': {
      const { building, unit, count } = o;
      if (!isId(building) || !isMasterId(unit)) return null;
      // `train_count` is a short; 0 would remove nothing.
      if (!Number.isInteger(count) || count === 0 || (count as number) < -0x7fff || (count as number) > 0x7fff) return null;
      return { type: 'queue', building, unit, count: count as number };
    }
    case 'cancel': {
      const { target } = o;
      if (!isId(target)) return null;
      return { type: 'cancel', target };
    }
    case 'attack': {
      const { units, target } = o;
      if (!isId(target)) return null;
      if (!Array.isArray(units) || units.length === 0 || units.length > MAX_ORDER_UNITS || !units.every(isId)) return null;
      return { type: 'attack', units: [...(units as number[])], target };
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
    return this.items.map((item) => ({ ...item, command: copyCommand(item.command) }));
  }

  static fromJSON(items: QueuedCommand[]): CommandQueue {
    const queue = new CommandQueue();
    queue.items = items.map((item) => ({ ...item, command: copyCommand(item.command) }));
    return queue;
  }
}

function copyCommand(c: Command): Command {
  return 'units' in c ? { ...c, units: [...c.units] } : { ...c };
}
