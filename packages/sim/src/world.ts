import { CommandQueue, type Command, type MoveCommand, type QueuedCommand } from './commands';
import { EntityStore, type Entity } from './entities';
import { Hasher } from './hash';
import { add32, div32, f32, MS_TO_SECONDS, mul32, sqrt32, sub32, toUint, u32 } from './num';
import { createTestMap, TileMap, type MapSnapshot } from './map';
import { initialFacing, newMover, orderMove, showSprite, teleport, updateMover, type MoveContext, type Mover } from './movement';
import { DEFAULT_PATHING_ITERATIONS, PathingSystem } from './pathing';
import { CrtRand } from './rng';
import { unitType, VILLAGER } from './units';

/** Base time per step: the network frame granularity (src/com_spd.cpp:11-25). Never wall time. */
export const STEP_MS = 90;
/** Buffer frames after each turn's boundary step (src/com_spd.cpp:11-25). */
export const BUFFER_FRAMES = 10;
/** Turns up to this one are a single step: the buffer path needs `current_turn > 6` (src/com_hand.cpp:509). */
export const SINGLE_STEP_TURNS = 6;
/** A command issued during turn N runs on turn N + 2 (src/com_hand.cpp:2810, CommandTurnIncrement). */
export const COMMAND_DELAY_TURNS = 2;
/** A move order keeps the group's layout unless it spans more than this many tiles on an axis (movement.md §5.1). */
const GROUP_EXTENT_LIMIT = 8.0;
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
  /** The tile map; defaults to the fixed test map. */
  map?: TileMap;
  /** Units placed before the first step, in this order (see `startingUnits`). */
  units?: readonly StartUnit[];
  /** "Path Finding" budget per search: 2500 low, 5000 medium, 7500 high (docs/spec/movement.md §3). */
  pathingIterations?: number;
}

export interface StartUnit {
  owner: number;
  /** Master object id; must be in the sim's unit table. */
  type: number;
  x: number;
  y: number;
}

/** Villagers each player starts with (the original's default start: 3 per player). */
export const STARTING_VILLAGERS = 3;

/**
 * Starting units on the fixed test map until the random map generator places them: three Villagers per player
 * on adjacent tile centres. Player 1 starts north-west of the lake, player 2 south-east of it.
 */
export function startingUnits(players: number): StartUnit[] {
  const bases = [
    [10, 10],
    [30, 30],
    [10, 40],
    [40, 8],
  ];
  const units: StartUnit[] = [];
  for (let owner = 1; owner < players; owner++) {
    const [bx, by] = bases[(owner - 1) % bases.length]!;
    for (let i = 0; i < STARTING_VILLAGERS; i++) units.push({ owner, type: VILLAGER, x: bx! + i + 0.5, y: by! + 0.5 });
  }
  return units;
}

/** Plain JSON-safe copy of the whole simulation state, taken between turns. */
export interface Snapshot {
  version: 3;
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
  map: MapSnapshot;
  pathingIterations: number;
  /** Obstruction counters, one per cell (`PathingSystem.cells`). */
  obstruction: number[];
}

const COMMAND_TYPE_IDS: Record<Command['type'], number> = { noop: 0, test: 1, move: 2 };

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
  map: TileMap;
  /** Obstruction map and path search; its cells are state. */
  readonly pathing: PathingSystem;
  private queue = new CommandQueue();
  private readonly rng = new CrtRand();

  constructor(options: WorldOptions) {
    this.players = options.players;
    this.randomSeed = options.randomSeed ?? DEFAULT_RANDOM_SEED;
    this.map = options.map ?? createTestMap();
    this.playerTimeDelta = new Array<number>(this.players).fill(0);
    this.pathing = new PathingSystem(this.map, { get: (id) => this.entities.get(id) });
    this.pathing.iterations = options.pathingIterations ?? DEFAULT_PATHING_ITERATIONS;
    if (options.units?.length) {
      // Game setup draws from the stored seed and stores a fresh one afterwards (docs/spec/core.md §4.2).
      this.rng.srand(this.randomSeed);
      for (const u of options.units) this.createUnit(u);
      this.randomSeed = this.rng.rand();
    }
  }

  /**
   * Make a moving unit at (x, y): `RGE_Moving_Object::setup`. The static part shows the standing sprite (one draw if
   * it has a random start frame, sprites.md §4), draws one `rand()` and reseeds with it (economy.md §8), then the
   * facing takes one more draw (movement.md §11).
   */
  createUnit({ owner, type, x, y }: StartUnit): Entity {
    const t = unitType(type);
    const e = this.entities.create({ owner, type, x, y, z: 0, hp: t.hitPoints, mover: newMover() });
    teleport(this.moveContext(), e, t, e.x, e.y, e.z);
    showSprite(t.standing, this.rng);
    this.rng.srand(this.rng.rand());
    initialFacing(t, e.mover!, this.rng);
    return e;
  }

  private moveContext(): MoveContext {
    return { map: this.map, entities: this.entities, pathing: this.pathing, rng: this.rng, deltaSeconds: this.deltaSeconds, attempts: 0 };
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
      const ctx = this.moveContext();
      for (let i = 0; i < this.players; i++) {
        this.playerTimeDelta[i] = u32(this.playerTimeDelta[i]! + delta);
        // `RGE_Player::update` (src/player.cpp:870): the path search counter restarts, then the object list updates.
        // The list prepends new objects (src/obj_list.cpp:57), so it runs newest first.
        ctx.attempts = 0;
        const own = [...this.entities.ofPlayer(i)].filter((e) => e.mover?.action);
        for (let k = own.length - 1; k >= 0; k--) updateMover(ctx, own[k]!);
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
    // `TRIBE_Command::do_command` draws once for every command before dispatch (docs/spec/core.md §2.4).
    this.rng.rand();
    switch (command.type) {
      case 'noop':
        return;
      case 'move':
        return this.doCommandMove(player, command);
      case 'test': {
        const tx = f32(command.x);
        const ty = f32(command.y);
        this.entities.create({ owner: player, type: 0, x: tx, y: ty, z: 0, hp: 1 + (this.rng.rand() % 100) });
        for (const e of this.entities.ofPlayer(player)) {
          // Units move only through orders: teleporting them here would desync the obstruction map.
          if (e.mover) continue;
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

  /**
   * `RGE_Command::do_command_move` (docs/spec/movement.md §5.1). Units listed but missing, or not the sender's, are
   * skipped yet still count towards the group size, as missing ones do in the original.
   */
  private doCommandMove(player: number, command: MoveCommand): void {
    const ids = command.units;
    const units = ids.map((id) => {
      const e = this.entities.get(id);
      return e?.mover && e.owner === player ? e : undefined;
    });
    const x = f32(command.x);
    const y = f32(command.y);
    let keepFormation = false;
    let avgX = 0;
    let avgY = 0;
    if (ids.length > 1) {
      let minX = f32(10000);
      let maxX = 0;
      let minY = f32(10000);
      let maxY = 0;
      for (const e of units) {
        if (!e) continue;
        if (e.x < minX) minX = e.x;
        else if (e.x > maxX) maxX = e.x;
        if (e.y < minY) minY = e.y;
        else if (e.y > maxY) maxY = e.y;
        avgX = add32(avgX, e.x);
        avgY = add32(avgY, e.y);
      }
      keepFormation = !(sub32(maxX, minX) > GROUP_EXTENT_LIMIT || sub32(maxY, minY) > GROUP_EXTENT_LIMIT);
      avgX = div32(avgX, ids.length);
      avgY = div32(avgY, ids.length);
    }
    const width = f32(this.map.width);
    const height = f32(this.map.height);
    units.forEach((e, index) => {
      if (!e) return;
      const m = e.mover!;
      m.group = ids.filter((_, other) => other !== index);
      m.waitingToMove = true;
      let tx = x;
      let ty = y;
      if (keepFormation) {
        tx = add32(sub32(e.x, avgX), x);
        ty = add32(sub32(e.y, avgY), y);
        if (tx < 0) tx = 1;
        else if (tx >= width) tx = sub32(width, 1);
        if (ty < 0) ty = 1;
        else if (ty >= height) ty = sub32(height, 1);
      }
      orderMove(e, tx, ty, this.rng);
    });
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
    for (const e of this.entities.all()) {
      h.u32(e.id).u32(e.owner).u32(e.type).f32(e.x).f32(e.y).f32(e.z).f32(e.hp);
      if (e.mover) hashMover(h, e.mover);
      else h.u32(0xffffffff);
    }
    this.map.hashInto(h);
    h.u32(this.pathing.iterations);
    this.pathing.hashInto(h);
    const queued = this.queue.toJSON();
    h.u32(queued.length);
    for (const q of queued) {
      h.u32(q.turn).u32(q.player).u32(q.seq).u32(COMMAND_TYPE_IDS[q.command.type]);
      if (q.command.type === 'test') h.f64(q.command.x).f64(q.command.y);
      if (q.command.type === 'move') {
        h.u32(q.command.units.length);
        for (const id of q.command.units) h.u32(id);
        h.f64(q.command.x).f64(q.command.y);
      }
    }
    return h.digest();
  }

  snapshot(): Snapshot {
    return {
      version: 3,
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
      map: this.map.toJSON(),
      pathingIterations: this.pathing.iterations,
      obstruction: Array.from(this.pathing.cells),
    };
  }

  static restore(s: Snapshot): World {
    if (s.version !== 3) throw new Error(`unsupported snapshot version ${String(s.version)}`);
    const w = new World({
      players: s.players,
      randomSeed: s.randomSeed,
      map: TileMap.fromJSON(s.map),
      pathingIterations: s.pathingIterations,
    });
    w.pathing.cells.set(s.obstruction);
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

function hashMover(h: Hasher, m: Mover): void {
  h.f32(m.angle).u32(m.facet).f32(m.speed).u32(m.walking ? 1 : 0).f32(m.turnTimer).f32(m.collisionAvoidanceDistance);
  h.u32(m.lastFacet).u32(m.lastFacet2).f32(m.closestDistanceToWaypoint).u32(m.continueCounter).u32(m.numberWaitDelays);
  h.u32((m.waitingToMove ? 1 : 0) | (m.stamped ? 2 : 0) | (m.finalUserWaypoint ? 4 : 0));
  h.f32(m.goalX).f32(m.goalY).f32(m.goalZ).f32(m.actionRange);
  h.u32(m.path.length).u32(m.pathIndex);
  for (const w of m.path) h.f32(w.x).f32(w.y).f32(w.z).u32(w.facet);
  h.u32(m.userWaypoints.length);
  for (const w of m.userWaypoints) h.u32(w.x).u32(w.y).u32(w.z);
  h.u32(m.group.length);
  for (const id of m.group) h.u32(id);
  const a = m.action;
  if (a) h.u32(a.state).f32(a.x).f32(a.y).f32(a.z).f32(a.range);
  else h.u32(0xffffffff);
}
