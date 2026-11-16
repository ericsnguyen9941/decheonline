import { describe, expect, test } from 'vitest';
import { ATTR_POPULATION } from './buildings';
import { ATTACK_ATTACKING } from './combat';
import { parseCommand, type Command } from './commands';
import type { Entity } from './entities';
import {
  NOTIFY_CANNOT_TRADE_WITH_ENEMY,
  NOTIFY_NOT_CLOSE_ENOUGH_TO_LAND,
  NOTIFY_NOT_ENOUGH_UNLOAD_SPACE,
} from './game-log';
import { DEFAULT_GAME_SETTINGS, LOBBY_MAP_TYPES, lobbyWorldOptions } from './game-settings';
import { TERRAIN_WATER, TileMap } from './map';
import { master, typeOf } from './masters';
import { navalTerrain, runReplay, sampleTransportReplay } from './replay';
import { MAP_ALL_WATER, MAP_ISTHMAS, MAP_LAKE, MAP_MOSTLY_WATER, MAP_WATER_AND_LAND } from './rmm-controller';
import { TECH_AVAILABLE, TECH_DONE } from './techs';
import { AI_ACTION_TRADE } from './trade';
import { ACTION_ENTER, ACTION_TRANSPORT, AI_ACTION_TRANSPORT } from './transport';
import { playerNotify } from './unit-ai';
import { CLUBMAN, TOWN_CENTER, VILLAGER } from './units';
import { VICTORY_SPECIAL } from './victory';
import { AGE_IRON, World, type Snapshot, type StartUnit } from './world';

const DOCK = 45;
const TRANSPORT_BOAT = 17;
const TRANSPORT_SHIP = 18;
const TECH_HEAVY_TRANSPORT = 8;
const TERRAIN_BEACH = 2;
const TERRAIN_SHALLOWS = 4;

/** Population room for the units a test places. */
const HOME: StartUnit = { owner: 1, type: TOWN_CENTER, x: 6.5, y: 34.5 };

/** `navalTerrain` (west land 0-14, beach 15, sea 16-27, beach 28, east island 29-39), with column 16 shallows when asked. */
function map(shallows = false): TileMap {
  const { width, height, tiles } = navalTerrain();
  if (shallows) for (let y = 0; y < height; y++) tiles[y * width + 16] = TERRAIN_SHALLOWS;
  return new TileMap(width, height, tiles);
}

function world(units: StartUnit[], shallows = false, startingAge?: number): World {
  return new World({ players: 3, civs: [0, 1, 1], map: map(shallows), units: [HOME, ...units], startingAge, victory: { type: VICTORY_SPECIAL } });
}

function order(w: World, player: number, command: Command): void {
  w.addBatch(w.turn, player, [command]);
}

function entity(w: World, id: number): Entity {
  return w.entities.get(id)!;
}

function runUntil(w: World, done: () => boolean, limit: number): void {
  for (let turns = 0; !done() && turns < limit; turns++) w.runTurn();
  expect(done()).toBe(true);
}

function terrainUnder(w: World, e: Entity): number {
  return w.map.terrainAt(Math.trunc(e.x), Math.trunc(e.y));
}

/** Villagers at x 12.5 from row 18.5 down, a Transport Boat in the west sea; ids: 1 the Town Center, 2.. the Villagers, then the boat. */
function boarding(villagers: number, shallows = false): { w: World; boat: Entity; units: Entity[] } {
  const units: StartUnit[] = Array.from({ length: villagers }, (_, i) => ({ owner: 1, type: VILLAGER, x: 12.5, y: 18.5 + i }));
  const w = world([...units, { owner: 1, type: TRANSPORT_BOAT, x: 18.5, y: 20.5 }], shallows);
  const ids = units.map((_, i) => i + 2);
  return { w, boat: entity(w, villagers + 2), units: ids.map((id) => entity(w, id)) };
}

function board(w: World, boat: Entity, units: Entity[]): void {
  order(w, 1, { type: 'work', units: units.map((u) => u.id), target: boat.id, x: boat.x, y: boat.y });
  runUntil(w, () => units.every((u) => u.inside === boat.id || (u.work === null && u.inside == null && w.turn > 4)), 2000);
}

describe('naval.md §7: transports', () => {
  test('an idle transport holds its default Transport action (12) in state 2', () => {
    const { w, boat } = boarding(0);
    w.runTurn();
    expect([boat.work?.type, boat.work?.state]).toEqual([ACTION_TRANSPORT, 2]);
  });

  test('a right click on an own transport boards it (Enter, action 3): the boat is called to the beach, the Villagers walk on, leave the map and ride with it', () => {
    const { w, boat, units } = boarding(3);
    w.runTurn();
    order(w, 1, { type: 'work', units: units.map((u) => u.id), target: boat.id, x: boat.x, y: boat.y });
    w.runTurn();
    w.runTurn();
    w.runTurn();
    expect(units.every((u) => u.work?.type === ACTION_ENTER)).toBe(true);
    runUntil(w, () => units.every((u) => u.inside === boat.id), 2000);
    expect([...boat.cargo!].sort()).toEqual(units.map((u) => u.id).sort());
    // Off the obstruction map and out of every tile scan; still in the population.
    for (const u of units) expect([u.stamped, u.x, u.y]).toEqual([false, boat.x, boat.y]);
    expect(w.attributes[1]![ATTR_POPULATION]).toBe(4);
  });

  test('the transport crosses the sea and a targetless work order on the far beach within 2 tiles drops every passenger on the east island', () => {
    const { w, boat, units } = boarding(3);
    board(w, boat, units);
    order(w, 1, { type: 'move', units: [boat.id], x: 26.5, y: 20.5 });
    runUntil(w, () => boat.x > 25 && boat.work?.state === 2, 2000);
    // The click on the beach tile (28) picks the transport's task 0 (terrain 2) and drops when the beach is within 2.
    for (let i = 0; i < 5 && (boat.cargo?.length ?? 0) > 0; i++) {
      order(w, 1, { type: 'work', units: [boat.id], target: 0, x: 28.5, y: boat.y });
      runUntil(w, () => boat.work?.state === 2 && boat.mover?.action == null, 500);
      w.runTurn();
    }
    expect(boat.cargo).toEqual([]);
    for (const u of units) {
      expect(u.inside).toBeNull();
      expect(u.x).toBeGreaterThan(28);
      expect(u.stamped).toBe(true);
      expect([TERRAIN_BEACH, 0]).toContain(terrainUnder(w, u));
    }
    // Dropped, they take orders on the island.
    order(w, 1, { type: 'move', units: [units[0]!.id], x: 34.5, y: 20.5 });
    runUntil(w, () => Math.abs(units[0]!.x - 34.5) < 1 && Math.abs(units[0]!.y - 20.5) < 1, 500);
  });

  test('capacity: a Transport Boat (obj_max 5) takes five of six Villagers; the sixth finishes its Enter and stays ashore', () => {
    const { w, boat, units } = boarding(6);
    expect(typeOf(w, boat).objMax).toBe(5);
    board(w, boat, units);
    runUntil(w, () => units.every((u) => u.inside != null || u.work == null), 2000);
    expect(boat.cargo).toHaveLength(5);
    const ashore = units.filter((u) => u.inside == null);
    expect(ashore).toHaveLength(1);
    expect(ashore[0]!.stamped).toBe(true);
  });

  test('cargo dies with its ship: no corpse, the passengers leave the population and the game', () => {
    const { w, boat, units } = boarding(2);
    board(w, boat, units);
    const before = w.entities.size;
    boat.hp = 0;
    runUntil(w, () => !w.entities.get(boat.id) && units.every((u) => !w.entities.get(u.id)), 2000);
    expect(w.attributes[1]![ATTR_POPULATION]).toBe(0);
    // Only the boat may leave a dead object behind; the Villagers leave none.
    expect(w.entities.size).toBeLessThanOrEqual(before - 3 + 1);
    expect([...w.entities.all()].filter((e) => e.owner === 1 && e.type !== TOWN_CENTER && e.type !== typeOf(w, boat).deadUnitId)).toEqual([]);
  });

  test('a passenger is no target: an enemy Clubman’s attack on a Villager that boards never lands', () => {
    const w = world([
      { owner: 1, type: VILLAGER, x: 12.5, y: 18.5 },
      { owner: 1, type: TRANSPORT_BOAT, x: 18.5, y: 20.5 },
      { owner: 2, type: CLUBMAN, x: 6.5, y: 14.5 },
    ]);
    const units = [entity(w, 2)];
    const boat = entity(w, 3);
    const clubman = entity(w, 4);
    order(w, 2, { type: 'attack', units: [clubman.id], target: units[0]!.id });
    order(w, 1, { type: 'work', units: [units[0]!.id], target: boat.id, x: boat.x, y: boat.y });
    runUntil(w, () => units[0]!.inside === boat.id, 2000);
    const hp = units[0]!.hp;
    // Every update of its attack ends as TARGET_INVALID (src/act_atak.cpp:292); the Clubman never lands a blow.
    for (let i = 0; i < 100; i++) {
      w.runTurn();
      expect(clubman.attack?.state ?? 1).not.toBe(ATTACK_ATTACKING);
    }
    expect(units[0]!.hp).toBe(hp);
  });

  test('a queued ENTER order (0x2cd) runs as `enterObject(target, 1)`: the idle Villager boards (src/aiuaimod.cpp:2666)', () => {
    const { w, boat, units } = boarding(1);
    const v = units[0]!;
    w.runTurn();
    expect([v.ai!.action, v.work ?? null]).toEqual([-1, null]);
    v.ai!.orders.push({ issuer: v.id, type: 0x2cd, target: boat.id, targetOwner: 1, x: -1, y: -1, z: -1, range: 0, priority: 100 });
    w.runTurn();
    expect([v.work?.type, v.ai!.orders]).toEqual([ACTION_ENTER, []]);
    runUntil(w, () => v.inside === boat.id, 2000);
  });

  test('a queued TRANSPORT order (0x2ca) runs as `transportObject(x, y, z, 1)`: the boat’s Transport action sails to the point with its passengers (src/aiuaimod.cpp:2670)', () => {
    const { w, boat, units } = boarding(2);
    board(w, boat, units);
    runUntil(w, () => boat.ai!.action === -1 && boat.mover?.action == null, 2000);
    boat.ai!.orders.push({ issuer: boat.id, type: 0x2ca, target: -1, targetOwner: -1, x: 24.5, y: 30.5, z: 0, range: 0, priority: 100 });
    w.runTurn();
    expect([boat.work?.type, boat.work?.state, boat.ai!.orders]).toEqual([ACTION_TRANSPORT, 11, []]);
    runUntil(w, () => Math.abs(boat.x - 24.5) < 1.5 && Math.abs(boat.y - 30.5) < 1.5, 2000);
    expect(boat.cargo).toHaveLength(2);
  });

  test('a targetless work on open water is the current action’s `move_to` (src/act_obj.cpp:111): the boat keeps its Transport action (state 11, a move order)', () => {
    const { w, boat, units } = boarding(2);
    board(w, boat, units);
    runUntil(w, () => boat.mover?.action == null, 2000);
    const action = boat.work;
    order(w, 1, { type: 'work', units: [boat.id], target: 0, x: 24.5, y: 10.5 });
    runUntil(w, () => boat.work?.state === 11, 10);
    expect([boat.work === action, boat.work?.type, boat.work?.target2]).toEqual([true, ACTION_TRANSPORT, 0]);
    runUntil(w, () => Math.abs(boat.x - 24.5) < 1.5 && Math.abs(boat.y - 10.5) < 1.5, 2000);
    expect(boat.cargo).toHaveLength(2);
  });

  test('the unload command: the boat sails towards the clicked point and drops its passengers on that shore (the order stops it first)', () => {
    const { w, boat, units } = boarding(3);
    board(w, boat, units);
    order(w, 1, { type: 'unload', units: [boat.id], x: 30.5, y: 12.5 });
    runUntil(w, () => (boat.cargo?.length ?? 0) === 0, 2000);
    expect(boat.work?.type).toBe(ACTION_TRANSPORT);
    for (const u of units) {
      expect(u.inside).toBeNull();
      expect(u.x).toBeGreaterThan(28);
      expect([TERRAIN_BEACH, 0]).toContain(terrainUnder(w, u));
    }
  });

  test('an unload clicked on the water beside the boat drops onto the shallows of the boat’s own zone, never onto the beach', () => {
    const { w, boat, units } = boarding(3, true);
    board(w, boat, units);
    runUntil(w, () => boat.work?.state === 2 && boat.mover?.action == null, 2000);
    order(w, 1, { type: 'unload', units: [boat.id], x: boat.x, y: boat.y });
    runUntil(w, () => (boat.cargo?.length ?? 0) === 0, 50);
    for (const u of units) expect(terrainUnder(w, u)).toBe(TERRAIN_SHALLOWS);
  });

  test('the boat’s refusals reach the game’s notifications for its owner, who hears cantdo.wav (src/tplayer.cpp:1765-1774, sounds.md §5)', () => {
    const w = world([]);
    const ctx = w.gameContext();
    playerNotify(ctx, 1, 0x207, AI_ACTION_TRANSPORT);
    playerNotify(ctx, 2, 0x206, AI_ACTION_TRANSPORT);
    playerNotify(ctx, 1, 0x20c, AI_ACTION_TRADE);
    // A 0x20c of another action is not trade's refusal.
    playerNotify(ctx, 1, 0x20c, AI_ACTION_TRANSPORT);
    expect(w.log.notifications.map((n) => [n.type, n.args[0]])).toEqual([
      [NOTIFY_NOT_CLOSE_ENOUGH_TO_LAND, 1],
      [NOTIFY_NOT_ENOUGH_UNLOAD_SPACE, 2],
      [NOTIFY_CANNOT_TRADE_WITH_ENEMY, 1],
    ]);
  });

  test('the unload command parses as the wire sends it and ignores another player’s transports', () => {
    expect(parseCommand({ type: 'unload', units: [5], x: 3.5, y: 4 })).toEqual({ type: 'unload', units: [5], x: 3.5, y: 4 });
    expect(parseCommand({ type: 'unload', units: [], x: 3.5, y: 4 })).toBeNull();
    expect(parseCommand({ type: 'unload', units: [5], x: 'a', y: 4 })).toBeNull();
    const { w, boat, units } = boarding(1, true);
    board(w, boat, units);
    runUntil(w, () => boat.work?.state === 2 && boat.mover?.action == null, 2000);
    order(w, 2, { type: 'unload', units: [boat.id], x: boat.x, y: boat.y });
    for (let i = 0; i < 10; i++) w.runTurn();
    expect(boat.cargo).toHaveLength(1);
  });

  test('the Dock trains the Transport Boat; Heavy Transport (8) makes it the Transport Ship (18): 200 hp, speed 1.75, room for 10', () => {
    const w = world([{ owner: 1, type: DOCK, x: 16.5, y: 10.5 }], false, AGE_IRON);
    for (const r of [0, 1, 2, 3]) w.attributes[1]![r] = 50000;
    const dock = [...w.entities.all()].find((e) => e.type === DOCK)!;
    order(w, 1, { type: 'queue', building: dock.id, unit: TRANSPORT_BOAT, count: 1 });
    runUntil(w, () => [...w.entities.all()].some((e) => e.type === TRANSPORT_BOAT), 3000);
    const boat = [...w.entities.all()].find((e) => e.type === TRANSPORT_BOAT)!;
    expect([TERRAIN_WATER, TERRAIN_SHALLOWS, 22]).toContain(w.map.terrainAt(Math.trunc(boat.x), Math.trunc(boat.y)));
    expect(typeOf(w, boat).objMax).toBe(5);
    expect(w.techs[1]![TECH_HEAVY_TRANSPORT]).toBe(TECH_AVAILABLE);
    order(w, 1, { type: 'research', building: dock.id, tech: TECH_HEAVY_TRANSPORT });
    runUntil(w, () => w.techs[1]![TECH_HEAVY_TRANSPORT] === TECH_DONE, 3000);
    const t = master(w, 1, TRANSPORT_BOAT);
    expect([t.hitPoints, t.speed, t.objMax, t.unitLevel]).toEqual([200, 1.75, 10, 7]);
    expect(master(w, 1, TRANSPORT_SHIP).objMax).toBe(10);
  });
});

describe('lobby.md §6: the water maps', () => {
  const WATER_MAPS = [MAP_ALL_WATER, MAP_MOSTLY_WATER, MAP_WATER_AND_LAND, MAP_LAKE, MAP_ISTHMAS];

  test('Small Islands, Large Islands, Coastal, Mediterranean and Narrows are offered', () => {
    for (const t of WATER_MAPS) expect(LOBBY_MAP_TYPES).toContain(t);
  });

  test.each(WATER_MAPS)('map type %i: a seeded game starts both players on land, each with its Town Center, three Villagers and a beach to build a Dock at', (mapType) => {
    for (const seed of [1, 2, 3]) {
      const w = new World(lobbyWorldOptions(seed, { ...DEFAULT_GAME_SETTINGS, mapType, mapSize: 72 }, [1, 1]));
      const centers: Entity[] = [];
      for (const player of [1, 2]) {
        const own = [...w.entities.all()].filter((e) => e.owner === player);
        const tc = own.filter((e) => e.type === TOWN_CENTER);
        const villagers = own.filter((e) => e.type === VILLAGER);
        expect([tc.length, villagers.length]).toEqual([1, 3]);
        const land = w.pathing.zones.of(typeOf(w, villagers[0]!));
        const zone = land.at(w.map.width, Math.trunc(villagers[0]!.x), Math.trunc(villagers[0]!.y));
        for (const v of villagers) expect(land.at(w.map.width, Math.trunc(v.x), Math.trunc(v.y))).toBe(zone);
        let beach = false;
        for (let y = 0; y < w.map.height && !beach; y++) {
          for (let x = 0; x < w.map.width && !beach; x++) beach = w.map.terrainAt(x, y) === TERRAIN_BEACH && land.at(w.map.width, x, y) === zone;
        }
        expect(beach).toBe(true);
        centers.push(tc[0]!);
      }
      expect([centers[0]!.x, centers[0]!.y]).not.toEqual([centers[1]!.x, centers[1]!.y]);
    }
  });
});

describe('determinism with transports', () => {
  test('sampleTransportReplay boards, crosses, drops, unloads and sinks, and replays to the same hashes and after a snapshot', () => {
    const log = sampleTransportReplay();
    const { width, height, tiles } = log.terrain!;
    const w = new World({ players: log.players, randomSeed: log.randomSeed, units: log.units, civs: log.civs, map: new TileMap(width, height, tiles), ...log.start });
    let boarded = 0;
    let crossed = 0;
    let sunk = 0;
    let aboard = new Set<number>();
    const step = (world: World) => {
      for (const b of log.batches) if (b.turn === world.turn) world.addBatch(b.turn, b.player, b.commands);
      for (const c of log.speeds ?? []) if (c.turn === world.turn) world.setSpeedChange(c);
      world.runTurn();
      return world.hash();
    };
    const hashes: number[] = [];
    let restored: World | null = null;
    while (w.turn < log.turns) {
      hashes.push(step(w));
      if (w.turn === 100) restored = World.restore(JSON.parse(JSON.stringify(w.snapshot())) as Snapshot);
      for (const id of aboard) if (!w.entities.get(id)) sunk++;
      aboard = new Set([...w.entities.all()].filter((e) => e.inside != null).map((e) => e.id));
      for (const e of w.entities.all()) {
        if (e.type !== VILLAGER) continue;
        if (e.inside != null) boarded++;
        // A Villager on the other side's land got there by boat.
        if ((e.owner === 1 && e.x > 28) || (e.owner === 2 && e.x < 16)) crossed++;
      }
    }
    expect(runReplay(log)).toEqual(hashes);
    expect(boarded).toBeGreaterThan(0);
    expect(crossed).toBeGreaterThan(0);
    expect(sunk).toBeGreaterThan(0);
    const again: number[] = [];
    while (restored!.turn < log.turns) again.push(step(restored!));
    expect(again).toEqual(hashes.slice(100));
  });
});
