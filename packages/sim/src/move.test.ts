import { describe, expect, test } from 'vitest';
import type { Command } from './commands';
import { ObjectState, type Entity } from './entities';
import { MOVE_MOVING, MOVE_NEED_PATH, orderMove, updateMover, type MoveContext } from './movement';
import { add32, f32, mul32, sub32, toInt } from './num';
import { runReplay, sampleReplay } from './replay';
import { CrtRand } from './rng';
import { TECH_DONE, TECH_RESEARCHING } from './techs';
import { BARRACKS, CLUBMAN, HOUSE, unitType, VILLAGER } from './units';
import { END_CONQUEST, STATUS_LOST, STATUS_WON } from './victory';
import { startingUnits, World, type StartUnit } from './world';

const length = (dx: number, dy: number): number => Math.sqrt(dx * dx + dy * dy);
const villager = (owner: number, x: number, y: number): StartUnit => ({ owner, type: VILLAGER, x, y });

/** Order on turn `turn` (it runs on turn + 2), then run turns until every unit is idle or `limit` turns passed. */
function order(world: World, player: number, command: Command, limit = 80): void {
  world.addBatch(world.turn, player, [command]);
  world.runTurn();
  world.runTurn();
  for (let i = 0; i < limit; i++) {
    world.runTurn();
    if (![...world.entities.all()].some((e) => e.mover?.action)) return;
  }
}

/** The unit shows its walking sprite. */
function walking(e: Entity): boolean {
  return e.sprite?.graphic === unitType(e.type).walking!.graphic;
}

/** Obstruction counts rebuilt from the stamped footprints, the way `addToObstructionMap` stamps them. */
function expectedCells(world: World, live = false): Uint8Array {
  const { cellsX, cellsY } = world.pathing;
  const cells = new Uint8Array(cellsX * cellsY);
  for (const e of world.entities.all()) {
    if (!e.stamped || (live && e.state >= ObjectState.PendingRemoval)) continue;
    const t = unitType(e.type);
    const minX = Math.max(0, toInt(mul32(sub32(e.x, t.radiusX), 4)));
    const minY = Math.max(0, toInt(mul32(sub32(e.y, t.radiusY), 4)));
    const maxX = toInt(mul32(add32(t.radiusX, e.x), 4));
    const maxY = toInt(mul32(add32(t.radiusY, e.y), 4));
    for (let x = minX; x < maxX; x++) for (let y = minY; y < maxY; y++) cells[x * cellsY + y]! += 1;
  }
  return cells;
}

/** A `CrtRand` that counts its draws. */
class CountingRand extends CrtRand {
  draws = 0;
  override rand(): number {
    this.draws++;
    return super.rand();
  }
}

describe('random draws of the Villager sprites (sprites.md §4)', () => {
  test('creating a Villager draws its standing start frame, the setup fence, its facing and its unit AI idle timeout', () => {
    const seed = 777;
    const world = new World({ players: 2, randomSeed: seed, units: [villager(1, 10.5, 10.5)] });
    const r = new CrtRand();
    r.srand(seed);
    r.rand(); // standing sprite (sequence type 7: animated, facings, random start)
    r.srand(r.rand()); // static setup fence
    r.rand(); // facing
    r.rand(); // unit AI adjusted idle timeout (unit-ai.md §1.2)
    expect(world.randomSeed).toBe(r.rand());
  });

  test('a walk draws nothing to start (the walk sprite has no random start) and one draw to stand again', () => {
    const world = new World({ players: 2, units: [villager(1, 10.5, 10.5)] });
    const rng = new CountingRand();
    const ctx: MoveContext = { map: world.map, entities: world.entities, pathing: world.pathing, rng, deltaSeconds: f32(0.09), attempts: 0, masters: world.masters };
    const e = world.entities.get(1)!;
    orderMove(ctx, e, 14.5, 10.5);
    updateMover(ctx, e);
    expect([e.mover!.action!.state, walking(e), rng.draws]).toEqual([MOVE_MOVING, true, 0]);
    while (e.mover!.action) updateMover(ctx, e);
    expect([walking(e), rng.draws]).toEqual([false, 1]);
  });
});

describe('move orders on the test map', () => {
  test('a Villager ordered to a point walks until its footprint is within the move range of it, then stops', () => {
    const world = new World({ players: 3, units: startingUnits(3) });
    const unit = world.entities.get(1)!;
    order(world, 1, { type: 'move', units: [1], x: 16.3, y: 14.7 });
    // doMove's arrival test: per axis the distance minus the radius (0.2), then the Euclidean length <= 0.4.
    const dx = Math.max(0, Math.abs(16.3 - unit.x) - 0.2);
    const dy = Math.max(0, Math.abs(14.7 - unit.y) - 0.2);
    expect(length(dx, dy)).toBeLessThanOrEqual(0.4);
    expect(length(16.3 - unit.x, 14.7 - unit.y)).toBeGreaterThan(0.4);
    expect(unit.mover!.action).toBeNull();
    expect(walking(unit)).toBe(false);
    expect(unit.mover!.speed).toBe(0);
  });

  test('the path goes around the lake and the unit never stands in water', () => {
    const world = new World({ players: 2, units: [villager(1, 9.5, 28.5)] });
    const unit = world.entities.get(1)!;
    world.addBatch(0, 1, [{ type: 'move', units: [1], x: 23.5, y: 28.5 }]);
    const terrains = new Set<number>();
    let minY = unit.y;
    for (let i = 0; i < 80; i++) {
      world.runTurn();
      terrains.add(world.map.terrainAt(toInt(unit.x), toInt(unit.y)));
      minY = Math.min(minY, unit.y);
      if (!unit.mover!.action && i > 2) break;
    }
    expect([...terrains]).toEqual([0]);
    // The lake spans rows 22..34 at its widest; the unit walks round its north shore and arrives.
    expect(minY).toBeLessThan(22);
    expect(unit.mover!.action).toBeNull();
    expect([toInt(unit.x), toInt(unit.y)]).toEqual([23, 27]);
  });

  test('a group order keeps the layout around the clicked point', () => {
    const world = new World({ players: 3, units: startingUnits(3) });
    world.addBatch(0, 1, [{ type: 'move', units: [1, 2, 3], x: 20.5, y: 15.5 }]);
    for (let i = 0; i < 3; i++) world.runTurn();
    const targets = [1, 2, 3].map((id) => world.entities.get(id)!.mover!.action && [world.entities.get(id)!.mover!.action!.x, world.entities.get(id)!.mover!.action!.y]);
    expect(targets).toEqual([
      [19.5, 15.5],
      [20.5, 15.5],
      [21.5, 15.5],
    ]);
    expect(world.entities.get(1)!.mover!.group).toEqual([2, 3]);
  });

  test("an order for the other player's units is ignored", () => {
    const world = new World({ players: 3, units: startingUnits(3) });
    order(world, 2, { type: 'move', units: [1], x: 20.5, y: 15.5 });
    expect(world.entities.get(1)!.x).toBe(10.5);
  });

  test('each player starts at most two path searches per step', () => {
    const units = [0, 1, 2, 3, 4].map((i) => villager(1, 5.5 + 2 * i, 5.5));
    const world = new World({ players: 2, units });
    world.addBatch(0, 1, [0, 1, 2, 3, 4].map((i) => ({ type: 'move', units: [i + 1], x: 5.5 + 2 * i, y: 12.5 }) as Command));
    for (let i = 0; i < 3; i++) world.runTurn();
    const states = [1, 2, 3, 4, 5].map((id) => world.entities.get(id)!.mover!.action!.state);
    // Newest first: units 5 and 4 search on the order's step, the rest wait.
    expect(states).toEqual([MOVE_NEED_PATH, MOVE_NEED_PATH, MOVE_NEED_PATH, MOVE_MOVING, MOVE_MOVING]);
    world.runTurn();
    expect([1, 2, 3, 4, 5].map((id) => world.entities.get(id)!.mover!.action!.state)).toEqual([
      MOVE_NEED_PATH,
      MOVE_MOVING,
      MOVE_MOVING,
      MOVE_MOVING,
      MOVE_MOVING,
    ]);
  });
});

/** The fuzz replays take seconds each; the suite runs files in parallel. */
const FUZZ_TIMEOUT = 30_000;

describe('fuzz: random move, work, build, queue, cancel, research and stop orders', () => {
  for (const seed of [1, 2, 3, 4]) {
    test(`seed ${seed}: replaying twice gives the same hashes; footprints stay consistent, apart and on land; loads are dropped off, buildings finished, units trained, techs researched`, () => {
      const log = sampleReplay(240, seed, false);
      const first = runReplay(log);
      expect(runReplay(log)).toEqual(first);

      const world = new World({ players: log.players, randomSeed: log.randomSeed, units: log.units });
      let moved = 0;
      let deposits = 0;
      const built = new Set<number>();
      const trained = new Set<number>();
      let researched = 0;
      while (world.turn < log.turns) {
        for (const b of log.batches) if (b.turn === world.turn) world.addBatch(b.turn, b.player, b.commands);
        for (const c of log.speeds ?? []) if (c.turn === world.turn) world.setSpeedChange(c);
        const before = new Map([...world.entities.all()].map((e) => [e.id, [e.x, e.y]] as const));
        const loads = [...world.entities.all()].filter((e) => e.owner > 0 && e.heldType >= 0 && e.heldType <= 3 && e.heldAmount >= 1);
        const resources = world.attributes.map((a) => a.slice(0, 4));
        const researching = world.techs.map((states) => states.flatMap((s, id) => (s === TECH_RESEARCHING ? [id] : [])));
        world.runTurn();
        researching.forEach((ids, p) => (researched += ids.filter((id) => world.techs[p]![id] === TECH_DONE).length));
        // A load gone while the owner's stock of it grew by at least as much: a drop-off.
        for (const was of loads.map((e) => ({ e, type: e.heldType, amount: e.heldAmount }))) {
          const now = world.entities.get(was.e.id);
          const gain = world.attributes[was.e.owner]![was.type]! - resources[was.e.owner]![was.type]!;
          if (now && now.heldAmount === 0 && gain >= was.amount) deposits++;
        }
        for (const e of world.entities.all()) {
          if (e.id <= log.units!.length || e.owner === 0) continue;
          if ((e.type === HOUSE || e.type === BARRACKS) && e.state === ObjectState.Active) built.add(e.id);
          if (e.type === VILLAGER || e.type === CLUBMAN) trained.add(e.id);
        }
        // Missiles fly over anything and stamp nothing.
        const units = [...world.entities.all()].filter((e) => e.mover && unitType(e.type).masterType !== 60);
        for (const e of units) {
          const was = before.get(e.id);
          moved += was && (e.x !== was[0] || e.y !== was[1]) ? 1 : 0;
        }
        expect(world.pathing.cells).toEqual(expectedCells(world));
        // A foundation destroys the trees under it; they keep their footprint until removed (2 steps later).
        expect(Math.max(...expectedCells(world, true))).toBeLessThanOrEqual(1);
        for (const e of units) expect(unitType(e.type).terrainTable[world.map.terrainAt(toInt(e.x), toInt(e.y))]).toBeGreaterThan(0);
      }
      expect(world.hash()).toBe(first.at(-1));
      expect(moved).toBeGreaterThan(100);
      expect(deposits).toBeGreaterThan(0);
      expect(built.size).toBeGreaterThan(0);
      expect(trained.size).toBeGreaterThan(0);
      expect(researched).toBeGreaterThan(0);
    }, FUZZ_TIMEOUT);
  }
});

describe('fuzz: the same orders plus a mid-map skirmish and attack orders', () => {
  for (const seed of [1, 2, 3, 4]) {
    test(`seed ${seed}: replaying twice gives the same hashes; both sides' units get killed; P2 deletes everything and is defeated`, () => {
      const log = sampleReplay(240, seed);
      const first = runReplay(log);
      expect(runReplay(log)).toEqual(first);
      const world = new World({ players: log.players, randomSeed: log.randomSeed, units: log.units });
      let endTurn = -1;
      while (world.turn < log.turns) {
        for (const b of log.batches) if (b.turn === world.turn) world.addBatch(b.turn, b.player, b.commands);
        for (const c of log.speeds ?? []) if (c.turn === world.turn) world.setSpeedChange(c);
        world.runTurn();
        if (world.gameOver && endTurn < 0) endTurn = world.turn - 1;
      }
      expect(world.hash()).toBe(first.at(-1));
      // Kills (player attribute 20) only count combat deaths of another player's objects, not cancels.
      expect(world.attributes[1]![20]!).toBeGreaterThan(0);
      expect(world.attributes[2]![20]!).toBeGreaterThan(0);
      // P2's deletes run on turn turns - 18; it is defeated at its next per-second check (a turn is 11 steps, ~1 s), and
      // P1 wins by conquest in that step.
      expect(endTurn).toBeGreaterThanOrEqual(log.turns - 18);
      expect(endTurn).toBeLessThanOrEqual(log.turns - 16);
      expect(world.gameResult()).toEqual({ endCondition: END_CONQUEST, winners: [1], status: [0, STATUS_WON, STATUS_LOST] });
      expect(world.score(2).survival).toBe(0);
      expect(world.score(1).total).toBeGreaterThan(world.score(2).total);
    }, FUZZ_TIMEOUT);
  }
});
