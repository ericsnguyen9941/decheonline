import { describe, expect, test } from 'vitest';
import { parseCommand, type Command } from './commands';
import { ObjectState, type Entity } from './entities';
import { doEffect } from './techs';
import { BUILDER, HOUSE, SMALL_WALL, VILLAGER } from './units';
import { ATTR_STONE, World } from './world';

/** Small Wall cost (empires.dat unit 72: 5 stone). */
const WALL_STONE = 5;

function order(world: World, player: number, command: Command): void {
  world.addBatch(world.turn, player, [command]);
}

function runUntil(world: World, done: () => boolean, limit = 400): void {
  for (let i = 0; i < limit && !done(); i++) world.runTurn();
  expect(done()).toBe(true);
}

function walls(world: World, owner = 1): Entity[] {
  return [...world.entities.all()].filter((e) => e.owner === owner && e.type === SMALL_WALL).sort((a, b) => a.id - b.id);
}

function tiles(list: Entity[]): string[] {
  return list.map((e) => `${Math.trunc(e.x)},${Math.trunc(e.y)}`);
}

/** Map revealed; player 1: one Villager (id 1) at (10.5, 24.5); player 2: one Villager (id 2) at (40.5, 40.5); then `extra`. */
function base(extra: { owner: number; type: number; x: number; y: number }[] = []): World {
  return new World({
    players: 3,
    revealMap: true,
    units: [
      { owner: 1, type: VILLAGER, x: 10.5, y: 24.5 },
      { owner: 2, type: VILLAGER, x: 40.5, y: 40.5 },
      ...extra,
    ],
  });
}

/** Order a wall line and run until it is placed (the command runs two turns later). */
function line(world: World, x1: number, y1: number, x2: number, y2: number, units: number[] = [], player = 1): Entity[] {
  const before = world.attributes[player]![ATTR_STONE]!;
  const old = walls(world, player).length;
  order(world, player, { type: 'build-wall', units, unitType: SMALL_WALL, x1, y1, x2, y2 });
  for (let i = 0; i < 3; i++) world.runTurn();
  const placed = walls(world, player).slice(old);
  expect(world.attributes[player]![ATTR_STONE]).toBe(before - WALL_STONE * placed.length);
  return placed;
}

describe('wall line command (economy.md §4.8.1)', () => {
  test('a straight line places a foundation on every tile from the start to the end, each paid', () => {
    const world = base();
    const placed = line(world, 10, 20, 14, 20);
    expect(tiles(placed)).toEqual(['10,20', '11,20', '12,20', '13,20', '14,20']);
    expect(placed.every((e) => e.state === ObjectState.Unbuilt && e.x === Math.trunc(e.x) + 0.5)).toBe(true);
  });

  test('a line drawn backwards steps from the start towards the end', () => {
    const world = base();
    expect(tiles(line(world, 12, 18, 12, 15))).toEqual(['12,18', '12,17', '12,16', '12,15']);
  });

  test('equal axis spans make a diagonal line', () => {
    const world = base();
    expect(tiles(line(world, 10, 10, 13, 7))).toEqual(['10,10', '11,9', '12,8', '13,7']);
  });

  test('unequal spans make an L: along the longer axis to the end row or column, then across from the next tile', () => {
    const world = base();
    // dy 5 >= dx 2: down column 10 to row 15, then row 15 from column 11 to 12.
    expect(tiles(line(world, 10, 10, 12, 15))).toEqual(['10,10', '10,11', '10,12', '10,13', '10,14', '10,15', '11,15', '12,15']);
    const other = base();
    // dx 3 > dy 1: along row 10 to column 7, then column 7 from row 11.
    expect(tiles(line(other, 10, 10, 7, 11))).toEqual(['10,10', '9,10', '8,10', '7,10', '7,11']);
  });

  test('a tile that does not fit is skipped and costs nothing; the rest of the line is placed', () => {
    // A House centred on (12, 20) covers tiles 11-12 of rows 19-20.
    const world = base([{ owner: 1, type: HOUSE, x: 12, y: 20 }]);
    expect(tiles(line(world, 9, 20, 14, 20))).toEqual(['9,20', '10,20', '13,20', '14,20']);
  });

  test('the line stops at the first segment the player cannot pay for', () => {
    const world = base();
    world.attributes[1]![ATTR_STONE] = 12;
    // An L, so the second leg is tried too: it stops at its first segment.
    expect(tiles(line(world, 10, 10, 12, 15))).toEqual(['10,10', '10,11']);
    expect(world.attributes[1]![ATTR_STONE]).toBe(2);
  });

  test("another player's units are not ordered; the sender's walls are placed and paid by the sender", () => {
    const world = base();
    const placed = line(world, 20, 20, 22, 20, [1], 2);
    expect(placed.map((e) => e.owner)).toEqual([2, 2, 2]);
    expect(walls(world, 1)).toEqual([]);
    for (let i = 0; i < 10; i++) world.runTurn();
    const v = world.entities.get(1)!;
    expect(v.type).toBe(VILLAGER);
    expect(v.work).toBeFalsy();
  });

  test('the codec takes tile bytes only', () => {
    const ok = { type: 'build-wall', units: [1], unitType: SMALL_WALL, x1: 0, y1: 255, x2: 3, y2: 4 };
    expect(parseCommand(ok)).toEqual(ok);
    expect(parseCommand({ ...ok, x1: 256 })).toBeNull();
    expect(parseCommand({ ...ok, y2: 1.5 })).toBeNull();
    expect(parseCommand({ ...ok, x2: -1 })).toBeNull();
  });
});

describe('builders and joining (economy.md §4.8.2-§4.8.3)', () => {
  test('the Villager builds the first segment, then each next foundation of the line, and every wall joins', () => {
    const world = base();
    const placed = line(world, 10, 20, 14, 20, [1]);
    const v = world.entities.get(1)!;
    runUntil(world, () => v.type === BUILDER, 10);
    // The first segment placed is the one ordered.
    expect(v.work?.target).toBe(placed[0]!.id);
    runUntil(world, () => placed.every((e) => e.state === ObjectState.Active), 2000);
    // Ends (one neighbour) show facet 2, the middle west-east facet 0.
    expect(placed.map((e) => e.facet)).toEqual([2, 0, 0, 0, 2]);
  });

  test('north-south neighbours give facet 1, a corner facet 2', () => {
    const world = base();
    const placed = line(world, 10, 18, 12, 21, [1]);
    expect(tiles(placed)).toEqual(['10,18', '10,19', '10,20', '10,21', '11,21', '12,21']);
    runUntil(world, () => placed.every((e) => e.state === ObjectState.Active), 3000);
    expect(placed.map((e) => e.facet)).toEqual([2, 1, 1, 2, 0, 2]);
  });

  test('a wall built alone, or next to only unbuilt neighbours, follows the same rule; foundations count', () => {
    const world = base();
    order(world, 1, { type: 'build', units: [1], unitType: SMALL_WALL, x: 10.5, y: 22.5 });
    for (let i = 0; i < 3; i++) world.runTurn();
    const [alone] = walls(world);
    runUntil(world, () => alone!.state === ObjectState.Active, 1000);
    expect(alone!.facet).toBe(2);
    // Foundations west and east of it (no builder): it turns west-east at once, when the next wall is built.
    line(world, 9, 22, 9, 22);
    line(world, 11, 22, 11, 22);
    expect(alone!.facet).toBe(2);
    const [, west, east] = walls(world);
    order(world, 1, { type: 'work', units: [1], target: west!.id, x: west!.x, y: west!.y });
    runUntil(world, () => west!.state === ObjectState.Active, 1000);
    expect(alone!.facet).toBe(0);
    expect(west!.facet).toBe(2);
    runUntil(world, () => east!.state === ObjectState.Active, 1000);
    expect([west!.facet, alone!.facet, east!.facet]).toEqual([2, 0, 2]);
  });

  test("a destroyed neighbour does not rejoin the walls left (the original connects on build and upgrade only)", () => {
    const world = base();
    const placed = line(world, 10, 20, 12, 20, [1]);
    runUntil(world, () => placed.every((e) => e.state === ObjectState.Active), 2000);
    expect(placed.map((e) => e.facet)).toEqual([2, 0, 2]);
    order(world, 1, { type: 'cancel', target: placed[2]!.id });
    runUntil(world, () => !world.entities.get(placed[2]!.id), 200);
    expect([placed[0]!.facet, placed[1]!.facet]).toEqual([2, 0]);
  });

  test('an upgrade joins every wall again (copy_obj → connect)', () => {
    const world = base();
    const placed = line(world, 10, 20, 12, 20, [1]);
    runUntil(world, () => placed.every((e) => e.state === ObjectState.Active), 2000);
    order(world, 1, { type: 'cancel', target: placed[2]!.id });
    runUntil(world, () => !world.entities.get(placed[2]!.id), 200);
    expect([placed[0]!.facet, placed[1]!.facet]).toEqual([2, 0]);
    // Effect 13 (Medium Wall): master 72 becomes a copy of 117, its walls show 117's standing sprite.
    doEffect(world.gameContext(), 1, 13);
    expect(placed[1]!.sprite?.graphic).toBe(259);
    expect([placed[0]!.facet, placed[1]!.facet]).toEqual([2, 2]);
  });

  test('a builder done with a building takes the closest own foundation, a wall when no building is left', () => {
    const world = base();
    world.addBatch(world.turn, 1, [
      { type: 'build', units: [1], unitType: HOUSE, x: 12, y: 22 },
      { type: 'build', units: [], unitType: HOUSE, x: 15, y: 22 },
    ]);
    line(world, 12, 19, 12, 19);
    const [house, other] = [...world.entities.all()].filter((e) => e.type === HOUSE);
    const [wall] = walls(world);
    runUntil(world, () => house!.state === ObjectState.Active, 1000);
    runUntil(world, () => world.entities.get(1)!.work?.target === other!.id, 20);
    runUntil(world, () => other!.state === ObjectState.Active, 1000);
    runUntil(world, () => world.entities.get(1)!.work?.target === wall!.id, 20);
    runUntil(world, () => wall!.state === ObjectState.Active, 1000);
  });

  test("another player's wall is not a neighbour", () => {
    const world = base([{ owner: 2, type: SMALL_WALL, x: 11.5, y: 20.5 }]);
    const placed = line(world, 10, 20, 10, 20, [1]);
    runUntil(world, () => placed[0]!.state === ObjectState.Active, 1000);
    expect(placed[0]!.facet).toBe(2);
  });
});
