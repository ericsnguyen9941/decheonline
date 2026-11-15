import { describe, expect, test } from 'vitest';
import {
  CIV_RANDOM,
  DEFAULT_GAME_SETTINGS,
  isLobbyCiv,
  isLobbySettings,
  LOBBY_MAP_SIZES,
  LOBBY_MAP_TYPES,
  lobbyWorldOptions,
  resolveCivs,
} from './game-settings';
import { MAP_ALL_WATER, MAP_HILLY, MAP_ISTHMAS, MAP_MOSTLY_WATER } from './rmm-controller';
import { runReplay, sampleLobbyReplay } from './replay';
import { CrtRand } from './rng';
import { VICTORY_SCORE, VICTORY_SPECIAL, VICTORY_STANDARD, VICTORY_TIME_LIMIT } from './victory';
import { DEFAULT_RANDOM_MAP, startingObjects, World } from './world';

describe('lobby settings (docs/spec/lobby.md)', () => {
  test('the defaults are the multiplayer screen\'s: Large, Mostly Land, Standard', () => {
    expect(DEFAULT_GAME_SETTINGS).toEqual({ mapType: DEFAULT_RANDOM_MAP.type, mapSize: DEFAULT_RANDOM_MAP.size, victory: { type: VICTORY_STANDARD } });
    expect(isLobbySettings(DEFAULT_GAME_SETTINGS)).toBe(true);
  });

  test('only what the sim can play is offered', () => {
    for (const water of [MAP_ALL_WATER, MAP_MOSTLY_WATER, MAP_ISTHMAS]) expect(LOBBY_MAP_TYPES).not.toContain(water);
    expect(LOBBY_MAP_SIZES).toEqual([72, 96, 120, 144, 200, 250]);
    const s = (mapType: number, mapSize: number, type: number, amount?: number) => isLobbySettings({ mapType, mapSize, victory: amount === undefined ? { type } : { type, amount } });
    expect(s(MAP_HILLY, 72, VICTORY_TIME_LIMIT, 3000)).toBe(true);
    expect(s(MAP_HILLY, 72, VICTORY_SCORE, 900)).toBe(true);
    expect(s(MAP_HILLY, 72, VICTORY_SCORE, 950)).toBe(false);
    expect(s(MAP_HILLY, 72, VICTORY_SPECIAL)).toBe(false);
    expect(s(MAP_ALL_WATER, 72, VICTORY_STANDARD)).toBe(false);
    expect(s(MAP_HILLY, 73, VICTORY_STANDARD)).toBe(false);
    expect([0, 1, 16, 17, 18, 1.5].map(isLobbyCiv)).toEqual([false, true, true, true, false, false]);
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
    const options = lobbyWorldOptions(99, { mapType: MAP_HILLY, mapSize: 96, victory: { type: VICTORY_SCORE, amount: 300 } }, [9, CIV_RANDOM]);
    expect(options.randomMap).toEqual({ type: MAP_HILLY, size: 96 });
    expect(options.civs).toEqual([0, 9, resolveCivs(99, [9, CIV_RANDOM])[1]]);
    expect(options.victory).toEqual({ type: VICTORY_SCORE, amount: 300 });
    const world = new World(options);
    expect(world.map.width).toBe(96);
    expect([...world.civs]).toEqual(options.civs);
  });

  test("the lobby sample replay (the determinism e2e's third) carries its settings and replays", () => {
    const log = sampleLobbyReplay(20);
    expect(log.randomMap).toEqual({ type: MAP_HILLY, size: 120 });
    expect(log.civs).toEqual([0, ...resolveCivs(log.randomSeed, [CIV_RANDOM, 10])]);
    expect(log.victory).toEqual({ type: VICTORY_TIME_LIMIT, amount: 3000 });
    expect(runReplay(log)).toHaveLength(20);
  });
});
