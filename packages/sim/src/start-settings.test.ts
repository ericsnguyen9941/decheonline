import { describe, expect, test } from 'vitest';
import { DEFAULT_GAME_SETTINGS, lobbyWorldOptions, type GameSettings } from './game-settings';
import { BRONZE_AGE, IRON_AGE, TECH_DISABLED, TECH_DONE, TOOL_AGE } from './techs';
import { CIVS, EFFECTS, TECHS, TOWN_CENTER, VILLAGER } from './units';
import { TILE_BLACK, TILE_FOGGED } from './visibility';
import {
  AGE_BRONZE,
  AGE_DEFAULT,
  AGE_IRON,
  AGE_NOMAD,
  AGE_STONE,
  AGE_TOOL,
  ATTR_FOOD,
  ATTR_GOLD,
  ATTR_STONE,
  ATTR_WOOD,
  RESOURCES_DEFAULT,
  RESOURCES_HIGH,
  RESOURCES_MEDIUM,
  World,
} from './world';

// The start settings as `TRIBE_World::new_game` applies them after the objects (docs/spec/lobby.md §2.1): the civ's
// tech tree effect or Full Tech Tree's (tworld.cpp:796-805), the resource level (:806-831), Death Match (:833-840),
// the starting age (:842-855, tplayer.cpp:1132-1168); Nomad in the generator (rmm_tdbc.cpp:284-293); Reveal Map in
// `start_game` (tribegam.cpp:3023-3032). Two Egyptian players on a Tiny Inland map from game seed 99.
const game = (patch: Partial<GameSettings>) => new World(lobbyWorldOptions(99, { ...DEFAULT_GAME_SETTINGS, mapSize: 72, ...patch }, [1, 1]));
const objects = (w: World, p: number) => [...w.entities.ofPlayer(p)];
const count = (w: World, p: number, type: number) => objects(w, p).filter((e) => e.type === type).length;
const withState = (w: World, p: number, state: number) => w.techs[p]!.flatMap((s, i) => (s === state ? [i] : []));
const stockpile = (w: World, p: number) => [ATTR_FOOD, ATTR_WOOD, ATTR_GOLD, ATTR_STONE].map((a) => w.attributes[p]![a]);

/** The techs an Egyptian player has done at a Default start: the zero-time techs of the first `check_for_new_tech`. */
const STONE_DONE = [29, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 99, 100, 104, 105];
/** Egyptian's tech tree effect 83 disables these (its type 102 commands). */
const EGYPTIAN_DISABLED = [27, 30, 36, 38, 47, 54, 58, 60, 65, 66, 69, 71, 73, 77, 78, 79, 111, 117, 118, 122, 125];
/** The Bronze Age start's done techs: the Tool Age, every tech naming it with their prerequisites, then the Bronze Age. */
const BRONZE_DONE = [
  0, 1, 3, 10, 11, 16, 26, 29, 39, 40, 41, 42, 46, 55, 62, 63, 67, 74, 75, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101,
  102, 104, 105, 107, 108, 109, 123, 124,
];
const IRON_DONE = [
  0, 1, 3, 4, 5, 6, 10, 11, 12, 13, 16, 17, 21, 22, 24, 26, 28, 29, 31, 32, 33, 34, 39, 40, 41, 42, 43, 44, 45, 46, 51, 55, 56, 57, 59, 61, 62, 63, 64, 67, 68,
  70, 74, 75, 76, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 107, 108, 109, 112, 114, 115,
  116, 121, 123, 124,
];

describe('Starting Age (scr_set.cpp:148-154; tworld.cpp:842-855)', () => {
  test('Default and Stone: no age tech, the Town Center and 3 Villagers; the same world', () => {
    const stone = game({ startingAge: AGE_STONE });
    expect(stone.hash()).toBe(game({ startingAge: AGE_DEFAULT }).hash());
    for (const p of [1, 2]) {
      expect([count(stone, p, TOWN_CENTER), count(stone, p, VILLAGER), objects(stone, p).length]).toEqual([1, 3, 4]);
      expect(withState(stone, p, TECH_DONE)).toEqual(STONE_DONE);
      expect(withState(stone, p, TECH_DISABLED)).toEqual(EGYPTIAN_DISABLED);
      expect(stockpile(stone, p)).toEqual([200, 200, 0, 150]);
    }
  });

  test('Nomad: the generator gives each player 1 Villager row group and no Town Center; techs and resources as Default', () => {
    for (const seed of [99, 1, 2]) {
      const w = new World(lobbyWorldOptions(seed, { ...DEFAULT_GAME_SETTINGS, mapSize: 72, startingAge: AGE_NOMAD }, [1, 1]));
      for (const p of [1, 2]) {
        expect(objects(w, p).map((e) => e.type)).toEqual([VILLAGER]);
        expect(withState(w, p, TECH_DONE)).toEqual(STONE_DONE);
        expect(stockpile(w, p)).toEqual([200, 200, 0, 150]);
      }
    }
    // The Villager can found the player's Town Center (200 wood) where it stands.
    const w = game({ startingAge: AGE_NOMAD });
    const v = objects(w, 1)[0]!;
    w.addBatch(0, 1, [{ type: 'build', unitType: TOWN_CENTER, x: Math.trunc(v.x) + 0.5, y: Math.trunc(v.y) + 3.5, units: [v.id] }]);
    for (let i = 0; i < 4; i++) w.runTurn();
    expect(count(w, 1, TOWN_CENTER)).toBe(1);
    expect(w.attributes[1]![ATTR_WOOD]).toBe(0);
  });

  test('Tool: the Tool Age tech (attribute 25) alone, and the zero-time techs it opens', () => {
    const w = game({ startingAge: AGE_TOOL });
    for (const p of [1, 2]) {
      expect(withState(w, p, TECH_DONE)).toEqual([...STONE_DONE, TOOL_AGE, 123].sort((a, b) => a - b));
      expect(withState(w, p, TECH_DISABLED)).toEqual(EGYPTIAN_DISABLED);
      expect([count(w, p, TOWN_CENTER), count(w, p, VILLAGER)]).toEqual([1, 3]);
      expect(stockpile(w, p)).toEqual([200, 200, 0, 150]);
    }
  });

  test('Bronze: every Stone and Tool Age tech the civ has (rev_tech of the Tool Age), then the Bronze Age', () => {
    const w = game({ startingAge: AGE_BRONZE });
    for (const p of [1, 2]) {
      const done = withState(w, p, TECH_DONE);
      expect(done).toEqual(BRONZE_DONE);
      // The rule behind the list: each tech requiring the Tool Age is done unless the civ disabled it.
      for (const [i, t] of TECHS.entries()) if (t.requires.includes(TOOL_AGE) && !EGYPTIAN_DISABLED.includes(i)) expect(done).toContain(i);
      expect(done).not.toContain(IRON_AGE);
      expect(withState(w, p, TECH_DISABLED)).toEqual(EGYPTIAN_DISABLED);
      expect([count(w, p, TOWN_CENTER), count(w, p, VILLAGER)]).toEqual([1, 3]);
      expect(stockpile(w, p)).toEqual([200, 200, 0, 150]);
    }
  });

  test('Iron: the Tool and Bronze Ages with every tech requiring them, then the Iron Age', () => {
    const w = game({ startingAge: AGE_IRON });
    for (const p of [1, 2]) {
      const done = withState(w, p, TECH_DONE);
      expect(done).toEqual(IRON_DONE);
      for (const [i, t] of TECHS.entries()) {
        if ((t.requires.includes(TOOL_AGE) || t.requires.includes(BRONZE_AGE)) && !EGYPTIAN_DISABLED.includes(i)) expect(done).toContain(i);
      }
      // Techs requiring the Iron Age stay to be researched, but for the zero-time ones `check_for_new_tech` completes.
      const iron = TECHS.flatMap((t, i) => (t.requires.includes(IRON_AGE) && done.includes(i) ? [i] : []));
      expect(iron).toEqual([61, 70, 116]);
      for (const i of iron) expect(TECHS[i]!.researchTime).toBe(0);
      expect(withState(w, p, TECH_DISABLED)).toEqual(EGYPTIAN_DISABLED);
      expect([count(w, p, TOWN_CENTER), count(w, p, VILLAGER)]).toEqual([1, 3]);
    }
  });
});

describe('Resources (scr_set.cpp:162-165; tworld.cpp:806-831) and Death Match (scr_set.cpp:721, tworld.cpp:833-840)', () => {
  test.each([
    ['Default: the civ\'s own', { resources: RESOURCES_DEFAULT }, [200, 200, 0, 150]],
    ['Medium', { resources: RESOURCES_MEDIUM }, [500, 500, 0, 250]],
    ['High', { resources: RESOURCES_HIGH }, [1000, 1000, 0, 750]],
    ['Death Match', { deathMatch: true }, [20000, 20000, 10000, 5000]],
  ] as const)('%s: food, wood, gold, stone', (_name, patch, expected) => {
    const w = game(patch);
    expect(stockpile(w, 1)).toEqual(expected);
    expect(stockpile(w, 2)).toEqual(expected);
    expect(stockpile(w, 0)).toEqual([0, 0, 0, 0]);
    // Only the stockpile changes: the same objects and techs as Default.
    expect([count(w, 1, TOWN_CENTER), count(w, 1, VILLAGER)]).toEqual([1, 3]);
    expect(withState(w, 1, TECH_DONE)).toEqual(STONE_DONE);
  });

  test('Death Match after the resource level, the age after both: a Bronze Death Match keeps its stockpile', () => {
    const w = game({ deathMatch: true, startingAge: AGE_BRONZE });
    expect(stockpile(w, 1)).toEqual([20000, 20000, 10000, 5000]);
    expect(withState(w, 1, TECH_DONE)).toEqual(BRONZE_DONE);
  });
});

describe('Reveal Map (scr_set.cpp:229-231; tribegam.cpp:3023-3032, visible.cpp:331-353)', () => {
  test('every tile explored for both players, not Gaia; the fog stays; no "most explored" score entry', () => {
    const off = game({});
    const on = game({ revealMap: true });
    const tiles = on.map.width * on.map.height;
    expect(on.visibility.explored).toEqual([off.visibility.explored[0], tiles, tiles]);
    expect(off.visibility.explored[1]).toBeLessThan(tiles / 10);
    // A corner far from player 1's units: black without Reveal Map, explored but unseen with it.
    const tc = objects(on, 1).find((e) => e.type === TOWN_CENTER)!;
    const [col, row] = [tc.x < 36 ? 71 : 0, tc.y < 36 ? 71 : 0];
    expect(off.tileVisibility(1, col, row)).toBe(TILE_BLACK);
    expect(on.tileVisibility(1, col, row)).toBe(TILE_FOGGED);
    // tworld.cpp:885-887: the score table's id 8 (highest percent explored) only without Reveal Map.
    expect(off.victory.scores[1]!.map((s) => s.id)).toContain(8);
    expect(on.victory.scores[1]!.map((s) => s.id)).not.toContain(8);
    expect(on.victory.scores[1]).toHaveLength(off.victory.scores[1]!.length - 1);
    on.runTurn();
    expect(on.visibility.explored.slice(1)).toEqual([tiles, tiles]);
    expect([count(on, 1, TOWN_CENTER), count(on, 1, VILLAGER)]).toEqual([1, 3]);
  });
});

describe('Full Tech Tree (scr_set.cpp:218-225; tworld.cpp:796-805)', () => {
  test('effect 210 instead of the civ\'s: only tech 118 disabled, and no civ bonus', () => {
    expect(CIVS[1]!.effect).toBe(83);
    expect(EFFECTS[210]).toEqual([{ type: 102, a: -1, b: -1, c: -1, d: 118 }]);
    const on = game({ fullTechTree: true });
    expect(withState(game({}), 1, TECH_DISABLED)).toEqual(EGYPTIAN_DISABLED);
    for (const p of [1, 2]) {
      expect(withState(on, p, TECH_DISABLED)).toEqual([118]);
      expect(withState(on, p, TECH_DONE)).toEqual(STONE_DONE);
    }
    // Phoenician's effect 88 gives the Lumberjack (123) +3 carried (type 4, attribute 14); Full Tech Tree does not.
    expect(CIVS[7]!.effect).toBe(88);
    const phoenician = (fullTechTree: boolean) => new World(lobbyWorldOptions(99, { ...DEFAULT_GAME_SETTINGS, mapSize: 72, fullTechTree }, [7, 7])).masters[1]![123]!.resourceCapacity;
    expect(phoenician(false)).toBe(phoenician(true) + 3);
    // With an age: the techs the civ would disable are done too.
    const bronze = game({ fullTechTree: true, startingAge: AGE_BRONZE });
    const done = withState(bronze, 1, TECH_DONE);
    for (const [i, t] of TECHS.entries()) if (t.requires.includes(TOOL_AGE) && i !== 118) expect(done).toContain(i);
  });
});
