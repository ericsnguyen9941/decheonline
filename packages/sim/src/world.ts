import { CommandQueue, type Command, type QueuedCommand } from './commands';
import { EntityStore, type Entity } from './entities';
import { Hasher } from './hash';
import { add32, div32, f32, MS_TO_SECONDS, mul32, sqrt32, sub32, toUint, u32 } from './num';
import { CrtRand } from './rng';

/** Base time per step: the network frame granularity (src/com_spd.cpp:11-25). Never wall time. */
export const STEP_MS = 90;
/** Buffer frames after each turn's boundary step (src/com_spd.cpp:11-25). */
export const BUFFER_FRAMES = 10;
/** Turns up to this one are a single step: the buffer path needs `current_turn > 6` (src/com_hand.cpp:509). */
export const SINGLE_STEP_TURNS = 6;
/** A command issued during turn N runs on turn N + 2 (src/com_hand.cpp:2810, CommandTurnIncrement). */
export const COMMAND_DELAY_TURNS = 2;
/** `random_seed` set by the world constructor (src/world.cpp:95). */
export const DEFAULT_RANDOM_SEED = 14;

/** Steps in a turn: the boundary step plus the buffer frames (docs/spec/core.md §2.2). */
export function stepsInTurn(turn: number): number {
  return turn <= SINGLE_STEP_TURNS ? 1 : 1 + BUFFER_FRAMES;
}

export interface WorldOptions {
  /** Player slots including Gaia (index 0). */
  players: number;
  /** Stored seed the first step reseeds from. */
  randomSeed?: number;
}

/** Plain JSON-safe copy of the whole simulation state, taken between turns. */
export interface Snapshot {
  version: 1;
  players: number;
  turn: number;
  worldTime: number;
  randomSeed: number;
  gameSpeed: number;
  playerTurn: number;
  playerTimeDelta: number[];
  deltaSeconds: number;
  entities: { nextId: number; entities: Entity[] };
  queue: QueuedCommand[];
}

const COMMAND_TYPE_IDS: Record<Command['type'], number> = { noop: 0, test: 1 };

/**
 * The simulation: `RGE_Game_World` in the original. Advances in whole turns of fixed-size steps
 * (`runTurn`), each step following `RGE_Game_World::update` (src/world.cpp:1206) on its multiplayer path.
 */
export class World {
  readonly players: number;
  /** Turn the next `runTurn` call executes. */
  turn = 0;
  /** Game clock, unsigned 32-bit ms (include/world.h:134). */
  worldTime = 0;
  /** The only RNG state carried between steps: a 15-bit value (docs/spec/core.md §4.2). */
  randomSeed: number;
  gameSpeed = f32(1);
  playerTurn = 0;
  playerTimeDelta: number[];
  /**
   * `world_time_delta_seconds`. Commands run before a step recomputes it (src/world.cpp:1270-1272), so they
   * see the previous step's value: it is state, snapshotted and hashed.
   */
  deltaSeconds = 0;
  entities = new EntityStore();
  private queue = new CommandQueue();
  private readonly rng = new CrtRand();

  constructor(options: WorldOptions) {
    this.players = options.players;
    this.randomSeed = options.randomSeed ?? DEFAULT_RANDOM_SEED;
    this.playerTimeDelta = new Array<number>(this.players).fill(0);
  }

  /** Queue the commands `player` issued during `issueTurn`; they run on `issueTurn + COMMAND_DELAY_TURNS`. */
  addBatch(issueTurn: number, player: number, commands: readonly Command[]): void {
    this.queue.push(issueTurn + COMMAND_DELAY_TURNS, player, commands);
  }

  get pendingCommands(): number {
    return this.queue.size;
  }

  runTurn(): void {
    const steps = stepsInTurn(this.turn);
    for (let i = 0; i < steps; i++) this.step(STEP_MS);
    this.turn++;
  }

  /** One `RGE_Game_World::update` with a non-zero cycle (src/world.cpp:1206). */
  private step(cycle: number): void {
    const rng = this.rng;
    rng.srand(this.randomSeed);
    const oldTime = this.worldTime;
    this.worldTime = u32(oldTime + toUint(mul32(cycle, this.gameSpeed)));
    const delta = u32(this.worldTime - oldTime);
    if (delta !== 0) {
      for (const queued of this.queue.take(this.turn)) this.execute(queued);
      this.deltaSeconds = mul32(delta, MS_TO_SECONDS);
      for (let i = 0; i < this.players; i++) {
        this.playerTimeDelta[i] = u32(this.playerTimeDelta[i]! + delta);
        // Player and object updates (src/player.cpp:870) go here once game rules are ported.
      }
      // Fog ghost updates draw from the RNG on each peer's local view; the original fences them so the
      // stream afterwards depends only on this draw (src/world.cpp:1283-1294).
      rng.srand(rng.rand());
      this.playerTimeDelta[this.playerTurn] = 0;
      this.playerTurn = (this.playerTurn + 1) % this.players;
    }
    this.randomSeed = rng.rand();
  }

  private execute({ player, command }: QueuedCommand): void {
    switch (command.type) {
      case 'noop':
        return;
      case 'test': {
        const tx = f32(command.x);
        const ty = f32(command.y);
        this.entities.create({ owner: player, type: 0, x: tx, y: ty, z: 0, hp: 1 + (this.rng.rand() % 100) });
        for (const e of this.entities.ofPlayer(player)) {
          const dx = sub32(tx, e.x);
          const dy = sub32(ty, e.y);
          const len = sqrt32(add32(mul32(dx, dx), mul32(dy, dy)));
          if (len === 0) continue;
          e.x = add32(e.x, div32(dx, len));
          e.y = add32(e.y, div32(dy, len));
          e.hp = sub32(e.hp, mul32(this.deltaSeconds, f32(0.7)));
        }
        return;
      }
    }
  }

  /** 32-bit hash of the whole state; equal on every peer while they are in sync. */
  hash(): number {
    const h = new Hasher()
      .u32(this.players)
      .u32(this.turn)
      .u32(this.worldTime)
      .u32(this.randomSeed)
      .f32(this.gameSpeed)
      .u32(this.playerTurn)
      .f32(this.deltaSeconds);
    for (const d of this.playerTimeDelta) h.u32(d);
    h.u32(this.entities.nextEntityId).u32(this.entities.size);
    for (const e of this.entities.all()) h.u32(e.id).u32(e.owner).u32(e.type).f32(e.x).f32(e.y).f32(e.z).f32(e.hp);
    const queued = this.queue.toJSON();
    h.u32(queued.length);
    for (const q of queued) {
      h.u32(q.turn).u32(q.player).u32(q.seq).u32(COMMAND_TYPE_IDS[q.command.type]);
      if (q.command.type === 'test') h.f64(q.command.x).f64(q.command.y);
    }
    return h.digest();
  }

  snapshot(): Snapshot {
    return {
      version: 1,
      players: this.players,
      turn: this.turn,
      worldTime: this.worldTime,
      randomSeed: this.randomSeed,
      gameSpeed: this.gameSpeed,
      playerTurn: this.playerTurn,
      playerTimeDelta: [...this.playerTimeDelta],
      deltaSeconds: this.deltaSeconds,
      entities: this.entities.toJSON(),
      queue: this.queue.toJSON(),
    };
  }

  static restore(s: Snapshot): World {
    if (s.version !== 1) throw new Error(`unsupported snapshot version ${String(s.version)}`);
    const w = new World({ players: s.players, randomSeed: s.randomSeed });
    w.turn = s.turn;
    w.worldTime = s.worldTime;
    w.gameSpeed = s.gameSpeed;
    w.playerTurn = s.playerTurn;
    w.playerTimeDelta = [...s.playerTimeDelta];
    w.deltaSeconds = s.deltaSeconds;
    w.entities = EntityStore.fromJSON(s.entities);
    w.queue = CommandQueue.fromJSON(s.queue);
    return w;
  }
}
