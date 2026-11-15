import { describe, expect, test, vi } from 'vitest';
import { checkPlacement } from './buildings';
import type { Command } from './commands';
import { ObjectState, type Entity } from './entities';
import { WORK_IDLE, type WorkAction } from './gather';
import { TERRAIN_WATER, TERRAIN_WATER_DARK, TileMap } from './map';
import { master, typeOf } from './masters';
import { f32 } from './num';
import { REPAIR_MAN } from './repair';
import { navalTerrain, runReplay, sampleNavalReplay } from './replay';
import { doTech, TECH_AVAILABLE, TECH_DISABLED, TECH_DONE } from './techs';
import { CLUBMAN, TOWN_CENTER, VILLAGER } from './units';
import { VICTORY_SPECIAL } from './victory';
import { ZoneMap } from './zone-map';
import { AGE_BRONZE, AGE_IRON, AGE_TOOL, ATTR_GOLD, ATTR_WOOD, COMMAND_DELAY_TURNS, World, type Snapshot, type StartUnit } from './world';

const DOCK = 45;
const FISHING_BOAT = 13;
const SCOUT_SHIP = 19;
const CATAPULT_TRIREME = 250;
const FIRE_GALLEY = 360;
const FISH = 53;
const TREE = 134;
const ARROW = 9;
const BOAT_STONE = 368;
const PRIEST = 125;

const TECH_DOCK = 0;
const TECH_SCOUT_SHIP = 3;
const TECH_FISHING_SHIP = 4;
const TECH_WAR_GALLEY = 5;
const TECH_MERCHANT_SHIP = 6;
const TECH_TRIREME = 7;
const TECH_HEAVY_TRANSPORT = 8;
const TECH_CATAPULT_TRIREME = 9;
const TECH_JUGGERNAUGHT = 25;
const TECH_FIRE_GALLEY = 118;
const TECH_ENGINEERING = 35;

const CIV_EGYPTIAN = 1;
const CIV_GREEK = 2;
const CIV_MINOAN = 5;
const CIV_HITTITE = 6;
const CIV_PHOENICIAN = 7;
const CIV_PERSIAN = 9;
const CIV_YAMATO = 11;
const CIV_ROMAN = 13;
const CIV_CARTHAGE = 14;

/** Population room (4) for the boats a test trains. */
const HOME: StartUnit = { owner: 1, type: TOWN_CENTER, x: 6.5, y: 30.5 };
const WATER = [TERRAIN_WATER, 4, TERRAIN_WATER_DARK];

/** `navalTerrain`: columns 0-14 grass (the west land), 15 beach, 16-27 water (21-22 deep), 28 beach, 29-39 grass (the east island). */
function navalMap(): TileMap {
  const { width, height, tiles } = navalTerrain();
  return new TileMap(width, height, tiles);
}

/** Gaia and two players on the naval map with these objects (ids from 1 in list order); conquest off. */
function world(units: StartUnit[], options: { civs?: [number, number]; startingAge?: number } = {}): World {
  const [a, b] = options.civs ?? [CIV_EGYPTIAN, CIV_EGYPTIAN];
  return new World({ players: 3, civs: [0, a, b], map: navalMap(), units, startingAge: options.startingAge, victory: { type: VICTORY_SPECIAL } });
}

function order(w: World, player: number, command: Command): void {
  w.addBatch(w.turn, player, [command]);
}

function entity(w: World, id: number): Entity {
  return w.entities.get(id)!;
}

function live(w: World, owner: number, type: number): Entity[] {
  return [...w.entities.all()].filter((e) => e.owner === owner && e.type === type && e.state <= ObjectState.Active);
}

function runUntil(w: World, done: () => boolean, limit: number): number {
  let turns = 0;
  while (!done() && turns < limit) {
    w.runTurn();
    turns++;
  }
  expect(done()).toBe(true);
  return turns;
}

function onWater(w: World, e: Entity): boolean {
  return WATER.includes(w.map.terrainAt(Math.trunc(e.x), Math.trunc(e.y)));
}

/** Research `tech` at the building as the player would: the command, then turns until it is done. */
function research(w: World, building: Entity, tech: number): void {
  expect([tech, w.techs[1]![tech]]).toEqual([tech, TECH_AVAILABLE]);
  order(w, 1, { type: 'research', building: building.id, tech });
  runUntil(w, () => w.techs[1]![tech] === TECH_DONE, 3000);
}

/** Queue one `unit` at the building and run until a new one exists; returns it. */
function train(w: World, building: Entity, unit: number): Entity {
  const before = new Set(live(w, building.owner, unit).map((e) => e.id));
  order(w, building.owner, { type: 'queue', building: building.id, unit, count: 1 });
  runUntil(w, () => live(w, building.owner, unit).some((e) => !before.has(e.id)), 3000);
  return live(w, building.owner, unit).find((e) => !before.has(e.id))!;
}

describe('naval.md §2: zone maps', () => {
  test('a land unit sees the west land and the east island as two zones, a boat sees one sea; withinRange reaches across a shore', () => {
    const w = world([
      { owner: 1, type: VILLAGER, x: 5.5, y: 5.5 },
      { owner: 1, type: FISHING_BOAT, x: 20.5, y: 5.5 },
    ]);
    const land = w.pathing.zones.of(typeOf(w, entity(w, 1)));
    const sea = w.pathing.zones.of(typeOf(w, entity(w, 2)));
    expect(land.at(40, 5, 5)).not.toBe(land.at(40, 35, 5));
    expect(land.at(40, 5, 5)).toBe(land.at(40, 15, 39));
    expect(sea.at(40, 16, 0)).toBe(sea.at(40, 27, 39));
    expect(sea.at(40, 16, 0)).not.toBe(sea.at(40, 5, 5));
    // One zone map per passability pattern: every land unit shares the villager's.
    expect(w.pathing.zones.of(master(w, 1, CLUBMAN))).toBe(land);
    // From the west land: the island's tile (30, 5) has a west-land tile within 15.1 but none within 14.9.
    expect(land.withinRange(5, 5, 30, 5, 15.1)).toBe(true);
    expect(land.withinRange(5, 5, 30, 5, 14.9)).toBe(false);
  });
});

describe('naval.md §3: the Dock on the shore', () => {
  test('placement: water or shallows at the centre with a beach beside the centre tile; open water, land and a beach off the centre ring fail with 1', () => {
    const w = world([]);
    const ctx = w.gameContext();
    const dock = master(w, 1, DOCK);
    expect([dock.placementTerrain, dock.placementSideTerrain, dock.terrainRestriction]).toEqual([[1, 4], [2, -1], 6]);
    expect(checkPlacement(ctx, dock, 16.5, 10.5, true, true)).toBe(0);
    expect(checkPlacement(ctx, dock, 27.5, 10.5, true, true)).toBe(0);
    // The centre tile 17 has water on both sides: the beach (15) is in the footprint but not beside the centre tile.
    expect(checkPlacement(ctx, dock, 17.5, 10.5, true, true)).toBe(1);
    expect(checkPlacement(ctx, dock, 20.5, 10.5, true, true)).toBe(1);
    // The centre on the beach or on grass.
    expect(checkPlacement(ctx, dock, 15.5, 10.5, true, true)).toBe(1);
    expect(checkPlacement(ctx, dock, 8.5, 10.5, true, true)).toBe(1);
    // A land building may not stand in the water.
    expect(checkPlacement(ctx, master(w, 1, TOWN_CENTER), 16.5, 10.5, true, true)).toBe(2);
  });

  test('a Villager builds it from the shore; the build command in open water places nothing; the built Dock completes tech 0', () => {
    const w = world([{ owner: 1, type: VILLAGER, x: 12.5, y: 10.5 }]);
    expect(w.techs[1]![TECH_DOCK]).toBe(TECH_AVAILABLE);
    order(w, 1, { type: 'build', units: [1], unitType: DOCK, x: 20.5, y: 10.5 });
    for (let i = 0; i <= COMMAND_DELAY_TURNS; i++) w.runTurn();
    expect(live(w, 1, DOCK)).toHaveLength(0);
    expect(w.attributes[1]![ATTR_WOOD]).toBe(200);
    order(w, 1, { type: 'build', units: [1], unitType: DOCK, x: 16.5, y: 10.5 });
    runUntil(w, () => live(w, 1, DOCK)[0]?.state === ObjectState.Active, 3000);
    expect(w.attributes[1]![ATTR_WOOD]).toBe(100);
    expect(w.techs[1]![TECH_DOCK]).toBe(TECH_DONE);
    const v = entity(w, 1);
    expect(w.map.terrainAt(Math.trunc(v.x), Math.trunc(v.y))).not.toBe(TERRAIN_WATER);
  });

  test('Tool Age: the Dock trains the Fishing Boat and the Scout Ship onto water', () => {
    const w = world([{ owner: 1, type: DOCK, x: 16.5, y: 10.5 }, HOME], { startingAge: AGE_TOOL });
    for (const r of [0, 1, 2, 3]) w.attributes[1]![r] = 50000;
    const dock = live(w, 1, DOCK)[0]!;
    // Tool Age and the Dock: tech 3 (no research time) enables the Scout Ship.
    expect(w.techs[1]![TECH_SCOUT_SHIP]).toBe(TECH_DONE);
    const trained: Entity[] = [train(w, dock, FISHING_BOAT), train(w, dock, SCOUT_SHIP)];
    expect([typeOf(w, trained[0]!).name, typeOf(w, trained[1]!).name]).toEqual(['Boat-Fishing1', 'Boat-War1']);
    for (const boat of trained) expect([boat.type, onWater(w, boat)]).toEqual([boat.type, true]);
  });

  test('Bronze Age: Fishing Ship (4) and War Galley (5) researched at the Dock copy 14 into 13 and 20 into 19; each boat leaves onto water', () => {
    const w = world([{ owner: 1, type: DOCK, x: 16.5, y: 10.5 }, HOME], { startingAge: AGE_BRONZE });
    for (const r of [0, 1, 2, 3]) w.attributes[1]![r] = 50000;
    const dock = live(w, 1, DOCK)[0]!;
    research(w, dock, TECH_FISHING_SHIP);
    research(w, dock, TECH_WAR_GALLEY);
    const trained = [train(w, dock, FISHING_BOAT)];
    expect([trained[0]!.type, typeOf(w, trained[0]!).name]).toEqual([FISHING_BOAT, 'Boat-Fishing2']);
    const galley = train(w, dock, SCOUT_SHIP);
    expect([galley.type, typeOf(w, galley).name, typeOf(w, galley).hitPoints]).toEqual([SCOUT_SHIP, 'Boat-War2', 160]);
    trained.push(galley);
    for (const boat of trained) expect([boat.type, onWater(w, boat)]).toEqual([boat.type, true]);
  });

  test('Iron Age: Trireme (7), Catapult Trireme (9) and Juggernaught (25, with Engineering) researched at the Dock; each boat leaves onto water', () => {
    const w = world([{ owner: 1, type: DOCK, x: 16.5, y: 10.5 }, HOME], { startingAge: AGE_IRON });
    for (const r of [0, 1, 2, 3]) w.attributes[1]![r] = 50000;
    const dock = live(w, 1, DOCK)[0]!;
    const trained: Entity[] = [];
    research(w, dock, TECH_TRIREME);
    const trireme = train(w, dock, SCOUT_SHIP);
    expect([typeOf(w, trireme).name, typeOf(w, trireme).hitPoints, typeOf(w, trireme).combat!.projectileUnitId]).toEqual(['Boat-War3', 200, 204]);
    trained.push(trireme);
    research(w, dock, TECH_CATAPULT_TRIREME);
    trained.push(train(w, dock, CATAPULT_TRIREME));
    // Engineering (35) is a Government Center tech; the Juggernaught needs it.
    doTech(w.gameContext(), 1, TECH_ENGINEERING);
    research(w, dock, TECH_JUGGERNAUGHT);
    const jug = train(w, dock, CATAPULT_TRIREME);
    expect([jug.type, typeOf(w, jug).name, typeOf(w, jug).combat!.blastWidth, typeOf(w, jug).combat!.blastLevel]).toEqual([CATAPULT_TRIREME, 'Boat-War5', 1.5, 1]);
    trained.push(jug);
    for (const boat of trained) expect([boat.type, onWater(w, boat)]).toEqual([boat.type, true]);
  });

  test('a Carthaginian Dock in the Iron Age with the War Galley trains the Fire Galley (tech 118 has no research time); an Egyptian one does not have it', () => {
    const w = world([{ owner: 1, type: DOCK, x: 16.5, y: 10.5 }, HOME], { civs: [CIV_CARTHAGE, CIV_CARTHAGE], startingAge: AGE_IRON });
    w.attributes[1]![ATTR_WOOD] = 50000;
    w.attributes[1]![ATTR_GOLD] = 50000;
    expect(w.techs[1]![TECH_FIRE_GALLEY]).toBe(TECH_DONE);
    const fire = train(w, live(w, 1, DOCK)[0]!, FIRE_GALLEY);
    expect([typeOf(w, fire).name, onWater(w, fire)]).toEqual(['Boat-War6', true]);
    expect(world([], { startingAge: AGE_IRON }).techs[1]![TECH_FIRE_GALLEY]).toBe(TECH_DISABLED);
  });
});

describe('naval.md §4: the Dock techs and the civ ship bonuses', () => {
  /** A Tool, Bronze or Iron Age game (`startingAge`) with a built Dock and plenty of everything. */
  function dockGame(civ = CIV_EGYPTIAN, age = AGE_IRON): [World, Entity] {
    const w = world([{ owner: 1, type: DOCK, x: 16.5, y: 10.5 }, HOME], { civs: [civ, civ], startingAge: age });
    for (const r of [0, 1, 2, 3]) w.attributes[1]![r] = 50000;
    return [w, live(w, 1, DOCK)[0]!];
  }

  test('Fishing Ship (4) makes 13 the Fishing Ship: 75 hp, speed 2; Merchant Ship (6) and Heavy Transport (8) research but change no master in the table', () => {
    const [w, dock] = dockGame(CIV_EGYPTIAN, AGE_BRONZE);
    research(w, dock, TECH_FISHING_SHIP);
    const t = master(w, 1, FISHING_BOAT);
    expect([t.name, t.hitPoints, t.speed]).toEqual(['Boat-Fishing2', 75, 2]);
    research(w, dock, TECH_MERCHANT_SHIP);
    const [iron, ironDock] = dockGame();
    research(iron, ironDock, TECH_HEAVY_TRANSPORT);
  });

  test('Tool Age: the Scout Ship but not yet the War Galley (needs the Bronze Age, 102)', () => {
    const [w] = dockGame(CIV_EGYPTIAN, AGE_TOOL);
    expect(w.techs[1]![TECH_SCOUT_SHIP]).toBe(TECH_DONE);
    expect(w.techs[1]![TECH_WAR_GALLEY]).not.toBe(TECH_AVAILABLE);
    expect(master(w, 1, CATAPULT_TRIREME).enabled).toBe(false);
  });

  test('civ bonuses read the ship masters: Phoenician catapult ships fire every 2.9 s, Persian Triremes every 1.3 s, Yamato boats have 30% more hp, Minoan boats cost 30% less, Greek war ships are faster, Hittite Scout Ships shoot and see 4 tiles farther, Carthaginian Fire Galleys 6 harder, Roman Docks cost 15% less', () => {
    expect(master(dockGame(CIV_PHOENICIAN)[0], 1, CATAPULT_TRIREME).combat!.reloadTime).toBe(f32(2.9));
    expect(master(dockGame(CIV_EGYPTIAN)[0], 1, CATAPULT_TRIREME).combat!.reloadTime).toBe(5);
    // An Iron Age start has the War Galley (5) done.
    const [persian, pDock] = dockGame(CIV_PERSIAN);
    research(persian, pDock, TECH_TRIREME);
    expect(master(persian, 1, SCOUT_SHIP).combat!.reloadTime).toBe(f32(1.3));
    const [egyptian, eDock] = dockGame(CIV_EGYPTIAN);
    research(egyptian, eDock, TECH_TRIREME);
    expect(master(egyptian, 1, SCOUT_SHIP).combat!.reloadTime).toBe(f32(1.8));
    expect(master(dockGame(CIV_YAMATO, AGE_TOOL)[0], 1, FISHING_BOAT).hitPoints).toBe(Math.trunc(45 * f32(1.33)));
    expect(master(dockGame(CIV_MINOAN, AGE_TOOL)[0], 1, FISHING_BOAT).creatable!.costs[0]!.amount).toBe(f32(50 * f32(0.7)));
    expect(master(dockGame(CIV_GREEK, AGE_TOOL)[0], 1, SCOUT_SHIP).speed).toBe(f32(1.75 + f32(0.3)));
    const hittite = master(dockGame(CIV_HITTITE, AGE_TOOL)[0], 1, SCOUT_SHIP);
    expect([hittite.combat!.range, hittite.los]).toEqual([5 + 4, 7 + 4]);
    expect(master(dockGame(CIV_CARTHAGE)[0], 1, FIRE_GALLEY).combat!.attacks.find((a) => a.group === 4)!.amount).toBe(30);
    expect(master(dockGame(CIV_ROMAN)[0], 1, DOCK).creatable!.costs[0]!.amount).toBe(f32(100 * f32(0.85)));
  });
});

describe('naval.md §5.1: fishing', () => {
  test('a Fishing Boat ordered onto a fish gathers 15 food and delivers it to the Dock, then goes back', () => {
    const w = world([
      { owner: 1, type: DOCK, x: 16.5, y: 10.5 },
      { owner: 1, type: FISHING_BOAT, x: 19.5, y: 12.5 },
      { owner: 0, type: FISH, x: 24, y: 16 },
    ]);
    const food = w.attributes[1]![0]!;
    order(w, 1, { type: 'work', units: [2], target: 3, x: 24, y: 16 });
    runUntil(w, () => entity(w, 2).heldAmount >= 15, 2000);
    expect(entity(w, 3).heldAmount).toBeCloseTo(250 - 15, 1);
    runUntil(w, () => w.attributes[1]![0]! > food, 2000);
    expect(w.attributes[1]![0]).toBe(food + 15);
    expect(onWater(w, entity(w, 2))).toBe(true);
    // Back to the fish for more.
    runUntil(w, () => entity(w, 2).heldAmount > 0, 2000);
  });

  test('a loaded Fishing Boat right-clicked on its own Dock delivers there (the task pass sends fish to Dock 45)', () => {
    const w = world([
      { owner: 1, type: DOCK, x: 16.5, y: 10.5 },
      { owner: 1, type: FISHING_BOAT, x: 21.5, y: 10.5 },
    ]);
    const boat = entity(w, 2);
    boat.heldType = 17;
    boat.heldAmount = f32(10);
    const food = w.attributes[1]![0]!;
    order(w, 1, { type: 'work', units: [2], target: 1, x: 16.5, y: 10.5 });
    runUntil(w, () => w.attributes[1]![0]! > food, 2000);
    expect(w.attributes[1]![0]).toBe(food + 10);
  });
});

describe('naval.md §2.2: land units and zones', () => {
  test('a Villager on the island with wood finds no drop site: the Town Center across the water is in another zone', () => {
    const w = world([
      { owner: 1, type: TOWN_CENTER, x: 8.5, y: 8.5 },
      { owner: 1, type: VILLAGER, x: 33.5, y: 10.5 },
      { owner: 0, type: TREE, x: 35.5, y: 10.5 },
    ]);
    order(w, 1, { type: 'work', units: [2], target: 3, x: 35.5, y: 10.5 });
    for (let i = 0; i < 300; i++) w.runTurn();
    // Full (10 wood) and idle: the drop-off search found nothing.
    const v = entity(w, 2);
    const a = v.work as WorkAction | null;
    expect([v.heldAmount, a?.state, a?.target, w.attributes[1]![ATTR_WOOD]]).toEqual([10, WORK_IDLE, -1, 200]);
    expect(v.x).toBeGreaterThan(28);
  });

  test('the same Villager on the west land takes its wood to the Town Center', () => {
    const w = world([
      { owner: 1, type: TOWN_CENTER, x: 8.5, y: 8.5 },
      { owner: 1, type: VILLAGER, x: 12.5, y: 14.5 },
      { owner: 0, type: TREE, x: 13.5, y: 16.5 },
    ]);
    order(w, 1, { type: 'work', units: [2], target: 3, x: 13.5, y: 16.5 });
    runUntil(w, () => w.attributes[1]![ATTR_WOOD]! > 200, 3000);
  });

  test('a Clubman shot from a ship does not chase it: the ship is in another zone with no land within its reach, answered before any path search', () => {
    const w = world([
      { owner: 1, type: CLUBMAN, x: 13.5, y: 10.5 },
      { owner: 2, type: SCOUT_SHIP, x: 19.5, y: 10.5 },
    ]);
    const club = entity(w, 1);
    const search = vi.spyOn(w.pathing, 'findTilePath');
    const reach = vi.spyOn(ZoneMap.prototype, 'withinRange');
    runUntil(w, () => club.hp < 40, 1000);
    for (let i = 0; i < 20; i++) w.runTurn();
    expect(reach.mock.calls.some((c) => c[0] === 13 && c[1] === 10)).toBe(true);
    reach.mockRestore();
    // No search towards the ship: the only ones are its walks away from the arrows, west on its own land.
    expect(search.mock.calls.filter((c) => c[0] === club && c[4] >= 15)).toHaveLength(0);
    expect(club.x).toBeLessThan(15);
  });

  test('a Villager ordered to an island tree never leaves the land; a boat ordered onto land stays on the water', () => {
    const w = world([
      { owner: 1, type: VILLAGER, x: 12.5, y: 10.5 },
      { owner: 0, type: TREE, x: 33.5, y: 10.5 },
      { owner: 1, type: SCOUT_SHIP, x: 20.5, y: 20.5 },
    ]);
    order(w, 1, { type: 'work', units: [1], target: 2, x: 33.5, y: 10.5 });
    order(w, 1, { type: 'move', units: [3], x: 5.5, y: 20.5 });
    for (let i = 0; i < 150; i++) {
      w.runTurn();
      const v = entity(w, 1);
      expect([1, 4, 22].includes(w.map.terrainAt(Math.trunc(v.x), Math.trunc(v.y)))).toBe(false);
      expect(onWater(w, entity(w, 3))).toBe(true);
    }
    expect(entity(w, 1).x).toBeLessThan(16);
    expect(entity(w, 3).x).toBeLessThan(18);
  });
});

describe('naval.md §5: war ships fight', () => {
  test('an idle Scout Ship attacks an enemy Fishing Boat in sight with arrows (9); the boat, fishing, keeps on until it sinks', () => {
    const w = world([
      { owner: 1, type: SCOUT_SHIP, x: 18.5, y: 10.5 },
      { owner: 2, type: FISHING_BOAT, x: 22.5, y: 10.5 },
      { owner: 0, type: FISH, x: 23.5, y: 11.5 },
    ]);
    order(w, 2, { type: 'work', units: [2], target: 3, x: 23.5, y: 11.5 });
    let arrows = 0;
    runUntil(
      w,
      () => {
        if ([...w.entities.all()].some((e) => e.type === ARROW && e.owner === 1)) arrows++;
        return entity(w, 2) === undefined || entity(w, 2).state > ObjectState.Active;
      },
      2000,
    );
    expect(arrows).toBeGreaterThan(0);
  });

  test('a Catapult Trireme throws the boat stone (368) whose blast (radius 1, level 2) hurts both of two close enemy boats', () => {
    const w = world([
      { owner: 1, type: CATAPULT_TRIREME, x: 17.5, y: 20.5 },
      { owner: 2, type: SCOUT_SHIP, x: 25.5, y: 20.5 },
      { owner: 2, type: SCOUT_SHIP, x: 25.5, y: 21.6 },
    ]);
    order(w, 1, { type: 'attack', units: [1], target: 2 });
    let stones = 0;
    runUntil(
      w,
      () => {
        if ([...w.entities.all()].some((e) => e.type === BOAT_STONE)) stones++;
        return entity(w, 3).hp < 120;
      },
      2000,
    );
    expect(stones).toBeGreaterThan(0);
    expect(entity(w, 2).hp).toBeLessThan(120);
  });

  test('a Fire Galley closes in and fights at range 1', () => {
    const w = world([
      { owner: 1, type: FIRE_GALLEY, x: 17.5, y: 30.5 },
      { owner: 2, type: SCOUT_SHIP, x: 24.5, y: 30.5 },
    ]);
    order(w, 1, { type: 'attack', units: [1], target: 2 });
    runUntil(w, () => entity(w, 2).hp < 120, 2000);
    const d = Math.sqrt((entity(w, 1).x - entity(w, 2).x) ** 2 + (entity(w, 1).y - entity(w, 2).y) ** 2);
    expect(d).toBeLessThan(0.75 + 0.75 + 1 + 0.5);
  });

  test('a War ship shoots a land unit on the shore it can reach, not one far inland', () => {
    const w = world([
      { owner: 1, type: SCOUT_SHIP, x: 20.5, y: 10.5 },
      { owner: 2, type: CLUBMAN, x: 13.5, y: 10.5 },
    ]);
    runUntil(w, () => entity(w, 2).hp < 40, 2000);
    const far = world([
      { owner: 1, type: SCOUT_SHIP, x: 16.5, y: 10.5 },
      { owner: 2, type: CLUBMAN, x: 3.5, y: 10.5 },
      { owner: 1, type: TOWN_CENTER, x: 4.5, y: 20.5 },
    ]);
    for (let i = 0; i < 100; i++) far.runTurn();
    expect(entity(far, 2).hp).toBe(40);
    expect(onWater(far, entity(far, 1))).toBe(true);
  });

  test('a hit Fishing Boat with no order runs from its attacker', () => {
    const w = world([
      { owner: 1, type: FISHING_BOAT, x: 20.5, y: 10.5 },
      { owner: 2, type: SCOUT_SHIP, x: 25.5, y: 10.5 },
    ]);
    const x0 = entity(w, 1).x;
    runUntil(w, () => entity(w, 1).hp < 45, 2000);
    for (let i = 0; i < 10; i++) w.runTurn();
    expect(entity(w, 1).x).toBeLessThan(x0);
  });
});

describe('naval.md §6: boat repair', () => {
  test('a Villager right-clicked on its damaged Scout Ship calls it to the shore and repairs it, paying half its cost per full bar', () => {
    const w = world([
      { owner: 1, type: VILLAGER, x: 12.5, y: 10.5 },
      { owner: 1, type: SCOUT_SHIP, x: 22.5, y: 10.5 },
    ]);
    const ship = entity(w, 2);
    ship.hp = f32(60);
    order(w, 1, { type: 'work', units: [1], target: 2, x: ship.x, y: ship.y });
    for (let i = 0; i <= COMMAND_DELAY_TURNS; i++) w.runTurn();
    expect(entity(w, 1).type).toBe(REPAIR_MAN);
    // The ship sails for the first beach tile on the line from the repairer: (15, 10).
    expect(ship.mover!.action).not.toBeNull();
    runUntil(w, () => ship.hp >= 120, 4000);
    expect(onWater(w, ship)).toBe(true);
    expect(ship.x).toBeLessThan(18);
    // 60 hp of 120 is half a bar: a quarter of the 135 wood, up to float rounding.
    expect(Math.abs(w.attributes[1]![ATTR_WOOD]! - (200 - 135 / 4))).toBeLessThan(0.01);
  });

  test('the Repair button\'s `repair` command on a damaged Fishing Boat repairs it too', () => {
    const w = world([
      { owner: 1, type: VILLAGER, x: 12.5, y: 20.5 },
      { owner: 1, type: FISHING_BOAT, x: 19.5, y: 20.5 },
    ]);
    entity(w, 2).hp = f32(20);
    order(w, 1, { type: 'repair', units: [1], target: 2 });
    runUntil(w, () => entity(w, 2).hp >= 45, 4000);
    expect(entity(w, 1).type).toBe(REPAIR_MAN);
    expect(w.attributes[1]![ATTR_WOOD]).toBeLessThan(200);
  });

  test('an undamaged ship: the generic group pass still gives the Villager the repair task (task_lst.cpp), the ship is called in, nothing is added or paid', () => {
    const w = world([
      { owner: 1, type: VILLAGER, x: 12.5, y: 10.5 },
      { owner: 1, type: SCOUT_SHIP, x: 18.5, y: 10.5 },
    ]);
    order(w, 1, { type: 'work', units: [1], target: 2, x: 18.5, y: 10.5 });
    for (let i = 0; i < 200; i++) w.runTurn();
    expect(entity(w, 1).type).toBe(REPAIR_MAN);
    expect(entity(w, 2).hp).toBe(120);
    expect(w.attributes[1]![ATTR_WOOD]).toBe(200);
  });
});

describe('support-actions.md §4.4, §5: priests and boats', () => {
  test('a Priest on the shore converts an enemy Fishing Boat; it does not heal its own damaged one', () => {
    const w = world(
      [
        { owner: 1, type: PRIEST, x: 14.5, y: 10.5 },
        { owner: 2, type: FISHING_BOAT, x: 19.5, y: 10.5 },
        { owner: 1, type: FISHING_BOAT, x: 18.5, y: 16.5 },
      ],
      { startingAge: AGE_IRON },
    );
    entity(w, 3).hp = f32(30);
    order(w, 1, { type: 'work', units: [1], target: 2, x: 19.5, y: 10.5 });
    runUntil(w, () => entity(w, 2).owner === 1, 3000);
    order(w, 1, { type: 'work', units: [1], target: 3, x: 18.5, y: 16.5 });
    for (let i = 0; i < 100; i++) w.runTurn();
    expect(entity(w, 3).hp).toBe(f32(30));
  });
});

describe('determinism with boats', () => {
  test('sampleNavalReplay fishes, fights and repairs at sea, and replays to the same hashes', () => {
    const log = sampleNavalReplay();
    const w = new World({ players: log.players, randomSeed: log.randomSeed, units: log.units, civs: log.civs, map: navalMap(), ...log.start });
    const a = runReplay(log, w);
    expect(runReplay(log)).toEqual(a);
    expect(w.attributes[1]![0]! + w.attributes[2]![0]!).toBeGreaterThan(40000);
    expect([...w.entities.all()].some((e) => e.type === REPAIR_MAN)).toBe(true);
  });

  test('a naval game restored from its snapshot mid-game (zone maps rebuilt from the map) goes on to the same hashes', () => {
    const log = sampleNavalReplay();
    const w = new World({ players: log.players, randomSeed: log.randomSeed, units: log.units, civs: log.civs, map: navalMap(), ...log.start });
    const step = (world: World) => {
      for (const b of log.batches) if (b.turn === world.turn) world.addBatch(b.turn, b.player, b.commands);
      for (const c of log.speeds ?? []) if (c.turn === world.turn) world.setSpeedChange(c);
      world.runTurn();
      return world.hash();
    };
    while (w.turn < 50) step(w);
    const restored = World.restore(JSON.parse(JSON.stringify(w.snapshot())) as Snapshot);
    expect(restored.hash()).toBe(w.hash());
    const a: number[] = [];
    const b: number[] = [];
    while (w.turn < 120) {
      a.push(step(w));
      b.push(step(restored));
    }
    expect(b).toEqual(a);
  });
});
