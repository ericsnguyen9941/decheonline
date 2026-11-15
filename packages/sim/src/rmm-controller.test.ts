import { describe, expect, test } from 'vitest';
import { MAP_MOSTLY_LAND, MAP_SMALL, MAP_TINY, RmmController, type RmmSettings } from './rmm-controller';
import { afterDraws, nextDraws, rmmFixture } from './rmm-testing';
import { VILLAGER, TOWN_CENTER } from './units';
import { World } from './world';

const TWO_PLAYERS: RmmSettings = { type: MAP_MOSTLY_LAND, players: 2, fixedPositions: true, nomad: false, allied: () => false };

describe('TRIBE_RMM_Database_Controller::init (src/rmm_tdbc.cpp:27; random-maps.md §4, §9.2)', () => {
  test('§9.2: map seed 41, Mostly Land, 96 tiles, 2 players: the tables after 22 draws', () => {
    const { m, rng } = rmmFixture(MAP_SMALL, MAP_SMALL, 41);
    const c = new RmmController(m, TWO_PLAYERS);
    c.init();
    expect(nextDraws(rng)).toEqual(nextDraws(afterDraws(41, 22)));
    // Lands: (62, 10) and (34, 84), zone 0, 100 % × 7372 / 200; only wall 1 opened (draws 10-13).
    expect(c.lands.slice(0, c.landNum).map((l) => [l.x, l.y, l.zone, l.size, ...l.walls, l.fade])).toEqual([
      [62, 10, 0, 3686, -1, 5, 91, 91, 33],
      [34, 84, 0, 3686, -1, 5, 91, 91, 33],
    ]);
    expect(c.baseTerrain).toBe(1);
    expect(c.shallows).toBeNull();
    // §9.4: the forest variant (draw 16 = 5886).
    expect(c.terrain.rows.map((r) => [r.terrain, r.size, r.clumps, r.avoid])).toEqual([
      [6, 2948, 8, 0],
      [13, 663, 9, 2],
      [10, 258, 4, 2],
      [20, 110, 1, 1],
      [19, 110, 1, 1],
      [22, 7371, 12, 1],
    ]);
    expect(c.terrain.hotSpots).toEqual([
      { x: 62, y: 10, radius: 16, fade: 15 },
      { x: 34, y: 84, radius: 16, fade: 15 },
    ]);
    // Elevation scale 1.2295388 (draw 20 = 28919).
    expect(c.elevation.levels.map((l) => l.size)).toEqual([906, 724, 543, 361]);
    expect(c.cliffs).toMatchObject({ count: 4, averageSize: 8, sizeVariance: 4, terrainSpacing: 2, cliffSpacing: 2 });
    // Land points: land id 1 for players 1 and 2; the TRIBE exclusion zones (§4.3).
    expect(c.objects.lands).toEqual([
      { x: 62, y: 10, id: 1, player: 1 },
      { x: 34, y: 84, id: 1, player: 2 },
    ]);
    const exclusion = (landId: number, type: number) => c.objects.rows.filter((r) => r.landId === landId && r.type === type).map((r) => r.exclusion);
    expect(exclusion(1, 66)).toEqual([12, 12]);
    expect(exclusion(1, 59)).toEqual([12]);
    expect(exclusion(-2, 65)).toEqual([12]);
    expect(exclusion(-2, 102)).toEqual([16]);
    expect(exclusion(1, TOWN_CENTER)).toEqual([1]);
  });
});

describe('random map game (RGE_Game_World::new_game, src/world.cpp:983; random-maps.md §3, §6)', () => {
  test('§9.1: the map seed is the 6th draw after the game seed', () => {
    expect(new World({ players: 3, randomSeed: 1, randomMap: { size: MAP_TINY } }).randomMapSeed).toBe(15724);
    expect(new World({ players: 3, randomSeed: 12345, randomMap: { size: MAP_TINY } }).randomMapSeed).toBe(23405);
  });

  test('every map type gives both players a Town Center and 3 Villagers on a Tiny map', () => {
    for (let type = 0; type <= 8; type++) {
      const world = new World({ players: 3, randomSeed: 777 + type, randomMap: { type, size: MAP_TINY } });
      const objects = [...world.entities.all()];
      for (const p of [1, 2]) {
        expect(objects.filter((e) => e.owner === p && e.type === TOWN_CENTER), `type ${type} player ${p}`).toHaveLength(1);
        expect(objects.filter((e) => e.owner === p && e.type === VILLAGER), `type ${type} player ${p}`).toHaveLength(3);
      }
    }
  });
});
