import { COMMAND_DELAY_TURNS, STEP_MS, startingUnits, stepsInTurn, World, type Command } from '@aoe/sim';
import { TURN_MS, type EndReason, type TurnBatch } from '@aoe/protocol';
import type { Link } from '../net/link';

export interface LockstepStart {
  seed: number;
  turnMs: number;
  commandDelay: number;
  /** Number of human players; protocol slot s is sim player s + 1 (player 0 is Gaia). */
  playerCount: number;
}

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface LockstepOptions {
  link: Link;
  start: LockstepStart;
  /** Pace multiplier (debug/tests); 1 runs at the server's turnMs. */
  speed?: number;
  timers?: Timers;
}

const browserTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Client side of the lockstep loop. Each turn this client submits one batch, the relay releases the turn once both
 * clients have, and both batches are applied to the `World`, which then runs the turn and reports its hash. Turns
 * 0 and 1 are submitted empty on start; the batch for turn N + 2 goes out as turn N is executed.
 */
export class Lockstep {
  readonly world: World;
  /** State hash after each executed turn, by turn number. */
  readonly hashes = new Map<number, number>();
  /** Called after each executed turn. */
  onTurn: (turn: number, hash: number) => void = () => {};
  onDesync: (turn: number, hashes: number[]) => void = () => {};
  onEnded: (reason: EndReason) => void = () => {};
  /** Total command batches applied, per slot (debug and tests). */
  readonly applied: Command[][] = [];

  private readonly link: Link;
  private readonly paceScale: number;
  private readonly timers: Timers;
  private readonly released = new Map<number, TurnBatch[]>();
  private pending: Command[] = [];
  private gateOpen = true;
  private timer: unknown;
  private stopped = false;
  private readonly unsubscribe: () => void;

  constructor({ link, start, speed = 1, timers = browserTimers }: LockstepOptions) {
    if (start.commandDelay !== COMMAND_DELAY_TURNS) {
      throw new Error(`server command delay ${start.commandDelay} != sim's ${COMMAND_DELAY_TURNS}`);
    }
    this.link = link;
    this.timers = timers;
    this.paceScale = start.turnMs / TURN_MS / speed;
    const players = start.playerCount + 1;
    this.world = new World({ players, randomSeed: start.seed, units: startingUnits(players) });
    this.unsubscribe = link.onMessage((m) => {
      if (this.stopped) return;
      if (m.t === 'turn') {
        this.released.set(m.turn, m.batches);
        this.pump();
      } else if (m.t === 'desync') {
        this.stop();
        this.onDesync(m.turn, m.hashes);
      } else if (m.t === 'ended') {
        this.stop();
        this.onEnded(m.reason);
      }
    });
    link.onClose(() => {
      if (this.stopped) return;
      this.stop();
      this.onEnded('peer-left');
    });
    for (let turn = 0; turn < COMMAND_DELAY_TURNS; turn++) link.send({ t: 'turn', turn, commands: [] });
  }

  /** Turn the next executed turn will be. */
  get turn(): number {
    return this.world.turn;
  }

  /** Wall time the loop spends on `turn` before running the next one. */
  turnMs(turn: number): number {
    return stepsInTurn(turn) * STEP_MS * this.paceScale;
  }

  /** Queue a command; it goes out in the next batch and executes COMMAND_DELAY_TURNS later on both clients. */
  issue(command: Command): void {
    this.pending.push(command);
  }

  stop(): void {
    this.stopped = true;
    this.unsubscribe();
    if (this.timer !== undefined) this.timers.clear(this.timer);
  }

  private pump(): void {
    if (!this.gateOpen || this.stopped) return;
    const turn = this.world.turn;
    const batches = this.released.get(turn);
    if (!batches) return;
    this.released.delete(turn);
    for (const batch of batches) {
      this.world.addBatch(turn, batch.slot + 1, batch.commands);
      (this.applied[batch.slot] ??= []).push(...batch.commands);
    }
    this.world.runTurn();
    const hash = this.world.hash();
    this.hashes.set(turn, hash);
    this.link.send({ t: 'hash', turn, hash });
    this.link.send({ t: 'turn', turn: turn + COMMAND_DELAY_TURNS, commands: this.pending });
    this.pending = [];
    this.onTurn(turn, hash);
    // Hold the next turn until this one's share of wall time has passed.
    this.gateOpen = false;
    this.timer = this.timers.set(() => {
      this.timer = undefined;
      this.gateOpen = true;
      this.pump();
    }, this.turnMs(turn));
  }
}
