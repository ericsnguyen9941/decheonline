import { describe, expect, test } from 'vitest';
import {
  CIV_RANDOM,
  DEFAULT_GAME_SETTINGS,
  isLobbyCiv,
  isLobbySettings,
  LOBBY_MAP_SIZES,
  LOBBY_MAP_TYPES,
  LOBBY_POPULATION_LIMITS,
  LOBBY_RESOURCES,
  LOBBY_STARTING_AGES,
  lobbyWorldOptions,
  resolveCivs,
  type GameSettings,
} from './game-settings';
import { MAP_ALL_WATER, MAP_HILLY } from './rmm-controller';
import { runReplay, sampleLobbyReplay } from './replay';
import { ATTR_HEADROOM, ATTR_POPULATION, ATTR_POPULATION_LIMIT } from './buildings';
import { ObjectState } from './entities';
import { CrtRand } from './rng';
import { BOWMAN, HOUSE, TOWN_CENTER, VILLAGER } from './units';
import { VICTORY_SCORE, VICTORY_SPECIAL, VICTORY_STANDARD, VICTORY_TIME_LIMIT } from './victory';
import { AGE_BRONZE, AGE_DEFAULT, AGE_TOOL, ATTR_FOOD, DEFAULT_RANDOM_MAP, RESOURCES_DEFAULT, RESOURCES_HIGH, RESOURCES_LOW, startingObjects, World } from './world';

describe('lobby settings (docs/spec/lobby.md)', () => {
  test('the defaults are the multiplayer screen\'s: Random Map, Large, Mostly Land, Standard, Default age and resources, population limit 50', () => {
    expect(DEFAULT_GAME_SETTINGS).toEqual({
      deathMatch: false,
      mapType: DEFAULT_RANDOM_MAP.type,
      mapSize: DEFAULT_RANDOM_MAP.size,
      victory: { type: VICTORY_STANDARD },
      startingAge: AGE_DEFAULT,
      resources: RESOURCES_DEFAULT,
      revealMap: false,
      fullTechTree: false,
      populationLimit: 50,
    });
    expect(isLobbySettings(DEFAULT_GAME_SETTINGS)).toBe(true);
  });

  test('all nine map types are offered, in the drop-down order', () => {
    expect(LOBBY_MAP_TYPES).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(LOBBY_MAP_SIZES).toEqual([72, 96, 120, 144, 200, 250]);
    const s = (mapType: number, mapSize: number, type: number, amount?: number, populationLimit = 50) =>
      isLobbySettings({ ...DEFAULT_GAME_SETTINGS, mapType, mapSize, victory: amount === undefined ? { type } : { type, amount }, populationLimit });
    expect(s(MAP_HILLY, 72, VICTORY_TIME_LIMIT, 3000)).toBe(true);
    expect(s(MAP_HILLY, 72, VICTORY_SCORE, 900)).toBe(true);
    expect(s(MAP_HILLY, 72, VICTORY_SCORE, 950)).toBe(false);
    expect(s(MAP_HILLY, 72, VICTORY_SPECIAL)).toBe(false);
    expect(s(MAP_ALL_WATER, 72, VICTORY_STANDARD)).toBe(true);
    expect(s(9, 72, VICTORY_STANDARD)).toBe(false);
    expect(s(MAP_HILLY, 73, VICTORY_STANDARD)).toBe(false);
    // The multiplayer Population Limit drop-down: 25 to 200 by 25 (scr_set.cpp:181-194).
    expect(LOBBY_POPULATION_LIMITS).toEqual([25, 50, 75, 100, 125, 150, 175, 200]);
    for (const limit of LOBBY_POPULATION_LIMITS) expect(s(MAP_HILLY, 72, VICTORY_STANDARD, undefined, limit)).toBe(true);
    for (const limit of [0, 24, 30, 225, 50.5]) expect(s(MAP_HILLY, 72, VICTORY_STANDARD, undefined, limit)).toBe(false);
    expect([0, 1, 16, 17, 18, 1.5].map(isLobbyCiv)).toEqual([false, true, true, true, false, false]);
    // Starting Age: Default, Nomad, Stone, Tool, Bronze, Iron (scr_set.cpp:148-154); Resources: Default, Medium, High
    // (:162-165), and Default only in a Death Match (sendSettings, :746-750).
    expect(LOBBY_STARTING_AGES).toEqual([0, 1, 2, 3, 4, 5]);
    expect(LOBBY_RESOURCES).toEqual([0, 2, 3]);
    const t = (patch: Partial<GameSettings>) => isLobbySettings({ ...DEFAULT_GAME_SETTINGS, ...patch });
    for (const startingAge of LOBBY_STARTING_AGES) expect(t({ startingAge })).toBe(true);
    for (const resources of LOBBY_RESOURCES) expect(t({ resources })).toBe(true);
    expect([t({ startingAge: 6 }), t({ startingAge: -1 }), t({ resources: RESOURCES_LOW }), t({ resources: 4 })]).toEqual([false, false, false, false]);
    expect([t({ deathMatch: true }), t({ deathMatch: true, resources: RESOURCES_HIGH })]).toEqual([true, false]);
    expect([t({ revealMap: true, fullTechTree: true })]).toEqual([true]);
  });

  test('Random draws rand() * 16 / 0x7FFF + 1 from the game seed, in player order (tribegam.cpp:2865-2870)', () => {
    // srand(1): 41, 18467, ... -> 41 * 16 / 32767 = 0, 18467 * 16 / 32767 = 9.
    expect(resolveCivs(1, [CIV_RANDOM, CIV_RANDOM])).toEqual([1, 10]);
    // A chosen civ draws nothing: the Random player gets the first draw.
    expect(resolveCivs(1, [5, CIV_RANDOM])).toEqual([5, 1]);
    expect(resolveCivs(1, [5, 12])).toEqual([5, 12]);
    // A draw of 0x7FFF would make 17, past the civs: kept at 16.
    const rng = new CrtRand();
    let seed = 0;
    for (; ; seed++) {
      rng.srand(seed);
      if (rng.rand() === 0x7fff) break;
    }
    expect(resolveCivs(seed, [CIV_RANDOM])).toEqual([16]);
  });

  test('the default lobby game is the world every client game was before the lobby had settings', () => {
    const before = new World({ players: 3, randomSeed: 99, randomMap: DEFAULT_RANDOM_MAP });
    const lobby = new World(lobbyWorldOptions(99, DEFAULT_GAME_SETTINGS, [1, 1]));
    expect(lobby.hash()).toBe(before.hash());
    const fixed = new World(lobbyWorldOptions(99, DEFAULT_GAME_SETTINGS, [1, 1], true));
    expect(fixed.hash()).toBe(new World({ players: 3, randomSeed: 99, units: startingObjects(3) }).hash());
  });

  test('settings and civs change the world', () => {
    const settings: GameSettings = { ...DEFAULT_GAME_SETTINGS, mapType: MAP_HILLY, mapSize: 96, victory: { type: VICTORY_SCORE, amount: 300 }, startingAge: AGE_TOOL, resources: RESOURCES_HIGH, revealMap: true, fullTechTree: true, populationLimit: 150 };
    const options = lobbyWorldOptions(99, settings, [9, CIV_RANDOM]);
    expect(options.randomMap).toEqual({ type: MAP_HILLY, size: 96 });
    expect(options.civs).toEqual([0, 9, resolveCivs(99, [9, CIV_RANDOM])[1]]);
    expect(options.victory).toEqual({ type: VICTORY_SCORE, amount: 300 });
    expect(options.populationLimit).toBe(150);
    expect([options.startingAge, options.resourceLevel, options.deathMatch, options.revealMap, options.fullTechTree]).toEqual([AGE_TOOL, RESOURCES_HIGH, false, true, true]);
    const world = new World(options);
    expect(world.map.width).toBe(96);
    expect(world.attributes.map((a) => a[ATTR_POPULATION_LIMIT])).toEqual([0, 150, 150]);
    expect([...world.civs]).toEqual(options.civs);
  });

  test("the lobby sample replay (the determinism e2e's third) carries its settings and replays", () => {
    const log = sampleLobbyReplay(20);
    expect(log.randomMap).toEqual({ type: MAP_HILLY, size: 120 });
    expect(log.civs).toEqual([0, ...resolveCivs(log.randomSeed, [CIV_RANDOM, 10])]);
    expect(log.victory).toEqual({ type: VICTORY_TIME_LIMIT, amount: 3000 });
    expect(log.populationLimit).toBe(25);
    expect(log.start).toEqual({ startingAge: AGE_BRONZE, resourceLevel: RESOURCES_DEFAULT, deathMatch: true, fullTechTree: true, revealMap: true });
    expect(runReplay(log)).toHaveLength(20);
  });

  // `TRIBE_World::new_game` gives every player the lobby's limit as attribute 32 (tworld.cpp:869-872); a production
  // queue does not start a unit while population >= that limit (t_b_obj.cpp:978-986), whatever headroom the Houses
  // left; `check_obj_cost` refuses headroom costs the same way (tplayer.cpp:1054-1059).
  test.each([25, 50])('population limit %i: training stops at the cap with headroom left', (limit) => {
    const world = new World(lobbyWorldOptions(7, { ...DEFAULT_GAME_SETTINGS, populationLimit: limit }, [1, 1], true));
    const a = world.attributes[1]!;
    expect([a[ATTR_POPULATION_LIMIT], world.attributes[2]![ATTR_POPULATION_LIMIT]]).toEqual([limit, limit]);
    a[ATTR_FOOD] = 10000;
    const mine = () => [...world.entities.ofPlayer(1)];
    const tc = mine().find((e) => e.type === TOWN_CENTER)!;
    // limit - 5 Bowmen: population limit - 2. Houses for more room than the cap (each +4 headroom).
    for (let i = 0; i < limit - 5; i++) world.createUnit({ owner: 1, type: BOWMAN, x: 1.5 + (i % 30), y: 40.5 + Math.trunc(i / 30) });
    const houses = Math.trunc(limit / 4) + 2;
    for (let i = 0; i < houses; i++) world.createUnit({ owner: 1, type: HOUSE, x: 2 + 2 * (i % 15), y: 2 + 2 * Math.trunc(i / 15) });
    expect(a[ATTR_POPULATION]).toBe(limit - 2);
    expect(a[ATTR_POPULATION]! + a[ATTR_HEADROOM]!).toBeGreaterThan(limit + 3);

    world.addBatch(world.turn, 1, [{ type: 'queue', building: tc.id, unit: VILLAGER, count: 5 }]);
    const villagers = () => mine().filter((e) => e.type === VILLAGER && e.state <= ObjectState.Active).length;
    for (let i = 0; i < 2000 && a[ATTR_POPULATION]! < limit; i++) world.runTurn();
    expect(a[ATTR_POPULATION]).toBe(limit);
    expect(villagers()).toBe(5);
    // Past the cap: nothing more is trained, the last 3 wait in the queue, the headroom stays unused.
    for (let i = 0; i < 600; i++) world.runTurn();
    expect(a[ATTR_POPULATION]).toBe(limit);
    expect(villagers()).toBe(5);
    expect(tc.queue).toEqual([{ unit: VILLAGER, count: 3 }]);
    expect(tc.train).toBeNull();
    expect(a[ATTR_HEADROOM]).toBeGreaterThan(3);
  });
});
