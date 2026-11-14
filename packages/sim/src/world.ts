import { build, cancelBuild, checkDestructables, checkPlacement, isBuilding, addToQueue, payObjCost, removeFromQueue, setupBuilding } from './buildings';
import {
  CommandQueue,
  type BuildCommand,
  type CancelCommand,
  type Command,
  type MoveCommand,
  type QueueCommand,
  type QueuedCommand,
  type WorkCommand,
} from './commands';
import type { GameContext } from './context';
import { EntityStore, ObjectState, type Entity } from './entities';
import { orderWork, workMoveTo } from './gather';
import { Hasher } from './hash';
import { add32, div32, f32, MS_TO_SECONDS, mul32, sqrt32, sub32, toUint, u32 } from './num';
import { createTestMap, TileMap, type MapSnapshot } from './map';
import { initialFacing, newMover, orderMove, teleport } from './movement';
import { giveStorages, isAnimated, isMoving, updateObject } from './objects';
import { DEFAULT_PATHING_ITERATIONS, PathingSystem } from './pathing';
import { CrtRand } from './rng';
import { newSprite } from './sprites';
import { checkForNewTech, newTechStates, type MasterChange } from './techs';
import { ELEPHANT, FORAGE, GAZELLE, MINE_GOLD, MINE_STONE, TOWN_CENTER, TREES, UNIT_TYPES, unitType, VILLAGER } from './units';

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
  /** Objects placed before the first step, in this order (see `startingObjects`). */
  units?: readonly StartUnit[];
  /** "Path Finding" budget per search: 2500 low, 5000 medium, 7500 high (docs/spec/movement.md §3). */
  pathingIterations?: number;
  /** The game's population limit (`pop_limit`, default 50), each player's attribute 32. */
  populationLimit?: number;
}

export interface StartUnit {
  owner: number;
  /** Master object id; must be in the sim's unit table. */
  type: number;
  x: number;
  y: number;
}

/**
 * `RGE_Player` attributes at game start: the civilization's resource table (empires.dat civ 1, Egyptians; every
 * playable civ has the same table). Food 200, wood 200, stone 150, gold 0; attribute 47 (gold mining multiplier) 1.
 * Gaia's table (civ 0) is all zeros.
 */
export const START_ATTRIBUTES: readonly number[] = [
  200, 200, 150, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 102, 103, 101, 10, 0, 0, 0, 0, 0, 0, 0, 0, 2, 250,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0.25, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
].map(f32);
export const ATTRIBUTE_COUNT = START_ATTRIBUTES.length;
/** Player attribute indices the client shows (`PLAYER_ATTRIBUTE_*`). */
export const ATTR_FOOD = 0;
export const ATTR_WOOD = 1;
export const ATTR_STONE = 2;
export const ATTR_GOLD = 3;

/** `RGE_Game_Info` default population limit. */
export const DEFAULT_POPULATION_LIMIT = 50;
/**
 * Attributes `new_game` sets for every player but Gaia after the objects are placed (`src/tworld.cpp`, economy.md
 * §6.4): 32 population limit (filled in from the options), 33 0, 30 building allowance 500, 45 1. They overwrite what
 * the start techs gave (Stone Age adds 8 to attribute 30).
 */
const NEW_GAME_ATTRIBUTES: readonly (readonly [number, number])[] = [
  [32, DEFAULT_POPULATION_LIMIT],
  [33, 0],
  [30, 500],
  [45, 1],
];

/** Villagers each player starts with (the original's default start: 3 per player). */
export const STARTING_VILLAGERS = 3;

/**
 * Starting units on the fixed test map until the random map generator places them: three Villagers per player
 * on adjacent tile centres. Player 1 starts north-west of the lake, player 2 south-east of it.
 */
export function startingUnits(players: number): StartUnit[] {
  const units: StartUnit[] = [];
  for (let owner = 1; owner < players; owner++) {
    const [bx, by] = BASES[(owner - 1) % BASES.length]!;
    for (let i = 0; i < STARTING_VILLAGERS; i++) units.push({ owner, type: VILLAGER, x: bx! + i + 0.5, y: by! + 0.5 });
  }
  return units;
}

/**
 * The fixed test map's start until the random map generator places objects: per player three Villagers, a Town
 * Center below them, and (owned by Gaia) eight trees, three forage bushes, two gold mines, a stone mine, a gazelle
 * and an elephant around the base. All on land; ids follow this order (players first, then Gaia's objects).
 */
export function startingObjects(players: number): StartUnit[] {
  const out = startingUnits(players);
  const gaia: StartUnit[] = [];
  for (let owner = 1; owner < players; owner++) {
    const [bx, by] = BASES[(owner - 1) % BASES.length]!;
    out.push({ owner, type: TOWN_CENTER, x: bx! + 1.5, y: by! + 3.5 });
    const at = (type: number, dx: number, dy: number) => gaia.push({ owner: 0, type, x: bx! + dx, y: by! + dy });
    for (let i = 0; i < 8; i++) at(TREES[i % TREES.length]!, -4.5 + (i % 4), 7.5 + (i >> 2));
    for (let i = 0; i < 3; i++) at(FORAGE, 4.5 + i, 7.5);
    at(MINE_GOLD, 6.5, 0.5);
    at(MINE_GOLD, 7.5, 0.5);
    at(MINE_STONE, 6.5, 4.5);
    at(GAZELLE, 9.5, 6.5);
    at(ELEPHANT, 3.5, 11.5);
  }
  return [...out, ...gaia];
}

const BASES = [
  [10, 10],
  [30, 30],
  [10, 40],
  [40, 8],
];

/** Plain JSON-safe copy of the whole simulation state, taken between turns. */
export interface Snapshot {
  version: 5;
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
  /** Player attributes, `[player][attribute]`. */
  attributes: number[][];
  /** Each player's updated object list, by id, in update order. */
  awake: number[][];
  /** Tech states, `[player][tech]`. */
  techs: number[][];
  /** Changed masters, `[player]` by unit id. */
  masters: Record<number, MasterChange>[];
}

const COMMAND_TYPE_IDS: Record<Command['type'], number> = { noop: 0, test: 1, move: 2, work: 3, build: 4, queue: 5, cancel: 6 };

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
  /** Player attributes (`RGE_Player::attributes`): resources and counters, float32. */
  attributes: number[][];
  /**
   * Each player's object list as the update walks it: head first, which is the newest object or the latest woken one
   * (src/obj_list.cpp:57). Sleeping objects (living trees) are not in it until damage wakes them.
   */
  awake: number[][];
  /** Tech states per player (`Tech_Player_Tree`), `[player][tech]`. */
  techs: number[][];
  /** Each player's changes to the master objects (masters are per player in the original), by unit id. */
  masters: Record<number, MasterChange>[];
  private queue = new CommandQueue();
  private readonly rng = new CrtRand();

  constructor(options: WorldOptions) {
    this.players = options.players;
    this.randomSeed = options.randomSeed ?? DEFAULT_RANDOM_SEED;
    this.map = options.map ?? createTestMap();
    this.playerTimeDelta = new Array<number>(this.players).fill(0);
    this.attributes = Array.from({ length: this.players }, (_, p) => (p === 0 ? new Array<number>(ATTRIBUTE_COUNT).fill(0) : [...START_ATTRIBUTES]));
    this.awake = Array.from({ length: this.players }, () => []);
    this.pathing = new PathingSystem(this.map, { get: (id) => this.entities.get(id) });
    this.pathing.iterations = options.pathingIterations ?? DEFAULT_PATHING_ITERATIONS;
    // Player creation runs each tech tree's first `check_for_new_tech` (techs.md §3.7): the zero-time start techs
    // complete, Gaia's too. The fog-of-war draw of player creation is not ported (no fog of war yet).
    this.techs = Array.from({ length: this.players }, () => newTechStates());
    this.masters = Array.from({ length: this.players }, () => ({}));
    for (let p = 0; p < this.players; p++) checkForNewTech(this, p);
    if (options.units?.length) {
      // Game setup draws from the stored seed and stores a fresh one afterwards (docs/spec/core.md §4.2).
      this.rng.srand(this.randomSeed);
      for (const u of options.units) this.createUnit(u);
      this.randomSeed = this.rng.rand();
    }
    for (let p = 1; p < this.players; p++) {
      for (const [attr, value] of NEW_GAME_ATTRIBUTES) this.attributes[p]![attr] = f32(attr === 32 ? (options.populationLimit ?? value) : value);
    }
  }

  /**
   * A start object (`build_all_the_way`): created, then a building clears what it stands on and is built at once
   * (`build(10000)`, which completes it).
   */
  createUnit({ owner, type, x, y }: StartUnit): Entity {
    const e = this.createObject(owner, type, x, y, 0);
    const t = unitType(type);
    if (isBuilding(t)) {
      const ctx = this.gameContext();
      checkDestructables(ctx, t, e.x, e.y, (o) => this.destroyObject(o));
      build(ctx, e, f32(10000));
    }
    return e;
  }

  /**
   * `destroy_obj` (src/stat_obj.cpp): wake the object and mark it for removal. It stays on the obstruction map until it
   * is removed.
   */
  private destroyObject(o: Entity): void {
    if (o.state >= ObjectState.PendingRemoval) return;
    this.wake(o);
    o.state = ObjectState.PendingRemoval;
  }

  private wake(e: Entity): void {
    const list = this.awake[e.owner]!;
    if (!list.includes(e.id)) list.unshift(e.id);
  }

  /**
   * `make_new_obj` + `setup` (src/stat_obj.cpp:200-286): place the object, show its standing sprite (one draw if it
   * has a random start frame, sprites.md §4), load its own starting resource, give the owner its flag 1/2 storages,
   * draw one `rand()` and reseed with it (economy.md §7); a moving object then draws its facing (movement.md §11).
   * Animated objects, and static ones without hit points, join the owner's updated list at the front; living trees
   * sleep.
   */
  createObject(owner: number, type: number, x: number, y: number, z: number): Entity {
    const t = unitType(type);
    const own = t.storages.find((s) => s.flag === 0);
    const e = this.entities.create({
      owner,
      type,
      x,
      y,
      z,
      hp: t.hitPoints,
      heldType: own ? own.type : -1,
      heldAmount: own ? own.amount : 0,
      mover: isMoving(t) ? newMover() : undefined,
    });
    if (t.combat) e.attackTimer = 0;
    if (isMoving(t)) e.turnTowardsTime = 0;
    teleport(this.gameContext(), e, t, e.x, e.y, e.z);
    newSprite(e, null, this.rng);
    giveStorages(this.attributes[owner]!, t, 1, [1, 2]);
    this.rng.srand(this.rng.rand());
    if (e.mover) initialFacing(e, e.mover, this.rng);
    if (isAnimated(t) || e.hp <= 0) this.awake[owner]!.unshift(e.id);
    if (isBuilding(t)) setupBuilding(this.gameContext(), e, t, (o) => this.destroyObject(o));
    return e;
  }

  /** The context object updates and orders run with (current RNG, delta and clock). */
  gameContext(): GameContext {
    return {
      map: this.map,
      entities: this.entities,
      pathing: this.pathing,
      rng: this.rng,
      deltaSeconds: this.deltaSeconds,
      attempts: 0,
      attributes: this.attributes,
      techs: this.techs,
      masters: this.masters,
      worldTime: this.worldTime,
      create: (owner, type, x, y, z) => this.createObject(owner, type, x, y, z),
      wake: (e) => this.wake(e),
      objectsOf: (owner) => this.awake[owner]!.map((id) => this.entities.get(id)!),
    };
  }

  /** Remove an object that is ready (`recycle_out_of_game`): off the obstruction map, the lists and the store. */
  private removeObject(e: Entity): void {
    this.pathing.unstamp(e, unitType(e.type));
    const list = this.awake[e.owner]!;
    const i = list.indexOf(e.id);
    if (i !== -1) list.splice(i, 1);
    this.entities.remove(e.id);
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
      const ctx = this.gameContext();
      for (let i = 0; i < this.players; i++) {
        this.playerTimeDelta[i] = u32(this.playerTimeDelta[i]! + delta);
        // `RGE_Player::update` (src/player.cpp:870): the path search counter restarts, then the object list updates
        // from its head. Objects created or woken during the walk go in front of it and wait for the next step.
        ctx.attempts = 0;
        for (const id of [...this.awake[i]!]) {
          const e = this.entities.get(id);
          if (e && updateObject(ctx, e)) this.removeObject(e);
        }
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
      case 'work':
        return this.doCommandWork(player, command);
      case 'build':
        return this.doCommandBuild(player, command);
      case 'queue':
        return this.doCommandQueue(player, command);
      case 'cancel':
        return this.doCommandCancel(player, command);
      case 'test': {
        const tx = f32(command.x);
        const ty = f32(command.y);
        this.entities.create({ owner: player, type: 0, x: tx, y: ty, z: 0, hp: 1 + (this.rng.rand() % 100) });
        for (const e of this.entities.ofPlayer(player)) {
          // Only the probe's own objects: game objects move only through orders.
          if (e.type !== 0) continue;
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
      // `move_to`: a gather or hunt action takes the order itself (src/act_obj.cpp:111-113).
      if (!workMoveTo(this.gameContext(), e, tx, ty)) orderMove(e, tx, ty, this.rng);
    });
  }

  /**
   * `RGE_Command::do_command_work` (src/Command.cpp:295): each listed unit of the sender joins the others' pathing
   * group and is ordered to work on the target (`work2`, economy.md §3.1). A missing target leaves a walk to (x, y).
   */
  private doCommandWork(player: number, command: WorkCommand): void {
    // `test` probe objects are not game objects: an order on one is an order on nothing.
    const found = this.entities.get(command.target);
    const target = found && UNIT_TYPES.has(found.type) ? found : undefined;
    const ids = command.units;
    const ctx = this.gameContext();
    ids.forEach((id, index) => {
      const e = this.entities.get(id);
      if (!e?.mover || e.owner !== player || e.state !== 2) return;
      e.mover.group = ids.filter((_, other) => other !== index);
      e.mover.waitingToMove = true;
      orderWork(ctx, e, target, command.x, command.y);
    });
  }

  /**
   * `TRIBE_Command::do_command_build` (economy.md §4.1): the foundation must fit (construction radius, objects that can
   * be built on ignored) and be paid for; then it is created and each listed unit of the sender is ordered onto it.
   */
  private doCommandBuild(player: number, command: BuildCommand): void {
    const t = UNIT_TYPES.get(command.unitType);
    if (!t || !isBuilding(t) || !t.creatable) return;
    const x = f32(command.x);
    const y = f32(command.y);
    const ctx = this.gameContext();
    if (checkPlacement(ctx, t, x, y, true, true) !== 0) return;
    if (!payObjCost(ctx, player, t.id, 1, false)) return;
    const building = this.createObject(player, t.id, x, y, 0);
    for (const id of command.units) {
      const e = this.entities.get(id);
      if (!e?.mover || e.owner !== player || e.state !== ObjectState.Active) continue;
      e.mover.group = [];
      orderWork(ctx, e, building, x, y);
    }
  }

  /**
   * `TRIBE_Command::do_command_queue` (economy.md §5.1): queue or unqueue units at a building. Only buildings have a
   * queue. Port-side guard (economy.md §5.5): the original accepts another player's building, this ignores it; the
   * command's `rand()` was already drawn in `execute`, so determinism is the same as for an accepted command.
   */
  private doCommandQueue(player: number, command: QueueCommand): void {
    const building = this.entities.get(command.building);
    if (!building?.queue || building.owner !== player || building.state >= ObjectState.PendingRemoval || !UNIT_TYPES.has(command.unit)) return;
    const ctx = this.gameContext();
    if (command.count > 0) addToQueue(ctx, building, command.unit, command.count);
    else removeFromQueue(ctx, building, command.unit, -command.count);
  }

  /**
   * `TRIBE_Command::do_command_cancel_build` → `cancel_object`: a foundation is cancelled with a refund (economy.md
   * §4.4), anything else of combat level or above is killed (`die_die_die`). Port-side guard (economy.md §5.5): a target
   * the sender does not own is ignored, the original accepts it.
   */
  private doCommandCancel(player: number, command: CancelCommand): void {
    const e = this.entities.get(command.target);
    if (!e || e.owner !== player || !UNIT_TYPES.has(e.type) || e.state >= ObjectState.PendingRemoval) return;
    const t = unitType(e.type);
    if (t.masterType < 50) return;
    const ctx = this.gameContext();
    if (isBuilding(t) && e.state === ObjectState.Unbuilt) cancelBuild(ctx, e);
    else {
      this.wake(e);
      e.hp = 0;
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
    for (const e of this.entities.all()) hashValue(h, e);
    hashValue(h, this.attributes);
    hashValue(h, this.awake);
    hashValue(h, this.techs);
    hashValue(h, this.masters);
    this.map.hashInto(h);
    h.u32(this.pathing.iterations);
    this.pathing.hashInto(h);
    const queued = this.queue.toJSON();
    h.u32(queued.length);
    for (const q of queued) {
      h.u32(q.turn).u32(q.player).u32(q.seq).u32(COMMAND_TYPE_IDS[q.command.type]);
      if (q.command.type === 'test') h.f64(q.command.x).f64(q.command.y);
      if (q.command.type === 'move' || q.command.type === 'work') {
        h.u32(q.command.units.length);
        for (const id of q.command.units) h.u32(id);
        h.f64(q.command.x).f64(q.command.y);
      }
      if (q.command.type === 'work') h.u32(q.command.target);
      if (q.command.type === 'build' || q.command.type === 'queue' || q.command.type === 'cancel') hashValue(h, q.command);
    }
    return h.digest();
  }

  snapshot(): Snapshot {
    return {
      version: 5,
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
      attributes: this.attributes.map((a) => [...a]),
      awake: this.awake.map((a) => [...a]),
      techs: this.techs.map((a) => [...a]),
      masters: copyMasters(this.masters),
    };
  }

  static restore(s: Snapshot): World {
    if (s.version !== 5) throw new Error(`unsupported snapshot version ${String(s.version)}`);
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
    w.attributes = s.attributes.map((a) => [...a]);
    w.awake = s.awake.map((a) => [...a]);
    w.techs = s.techs.map((a) => [...a]);
    w.masters = copyMasters(s.masters);
    return w;
  }
}

function copyMasters(masters: readonly Record<number, MasterChange>[]): Record<number, MasterChange>[] {
  return masters.map((m) => Object.fromEntries(Object.entries(m).map(([id, c]) => [id, { ...c }])));
}

/**
 * Hash any plain state value: numbers as float64 (every sim number is a float32 or a 32-bit integer, so this is
 * exact), booleans and null as markers, arrays by length then items, objects by sorted key. Absent, undefined and null
 * fields hash alike.
 */
function hashValue(h: Hasher, v: unknown): void {
  if (v === undefined || v === null) h.u32(0xfffffffe);
  else if (typeof v === 'number') h.f64(v);
  else if (typeof v === 'boolean') h.u32(v ? 0xfffffffd : 0xfffffffc);
  else if (Array.isArray(v)) {
    h.u32(v.length);
    for (const x of v) hashValue(h, x);
  } else if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o)
      .filter((k) => o[k] !== undefined && o[k] !== null)
      .sort();
    h.u32(keys.length);
    for (const k of keys) {
      for (let i = 0; i < k.length; i++) h.u32(k.charCodeAt(i));
      hashValue(h, o[k]);
    }
  }
}
