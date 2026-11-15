/**
 * The multiplayer setup screen's settings (docs/spec/lobby.md): the host's map type, map size and victory condition,
 * each player's civilization, and the game they start. Only the values the sim can play are offered (lobby.md §6).
 */
import { CrtRand } from './rng';
import { MAP_CONTINENTAL, MAP_HILLY, MAP_HUGE, MAP_HUMONGOUS, MAP_LARGE, MAP_MEDIUM, MAP_MOSTLY_LAND, MAP_ALL_LAND, MAP_SMALL, MAP_TINY } from './rmm-controller';
import { CIV_GAIA } from './units';
import { VICTORY_CONQUEST, VICTORY_SCORE, VICTORY_STANDARD, VICTORY_TIME_LIMIT, type VictorySettings } from './victory';
import { startingObjects, type WorldOptions } from './world';

/** The host's settings: map type (`MAP_*`), map side in tiles, and the victory type with its years or points. */
export interface GameSettings {
  mapType: number;
  mapSize: number;
  victory: VictorySettings;
}

/** `TribeMPSetupScreen::init_vars` (src/scr_mps.cpp:436-438): Large, Mostly Land, Default victory (Standard). */
export const DEFAULT_GAME_SETTINGS: Readonly<GameSettings> = { mapType: MAP_MOSTLY_LAND, mapSize: MAP_LARGE, victory: { type: VICTORY_STANDARD } };

/**
 * The map types offered, in the drop-down's order (src/scr_set.cpp:63-71): those whose two start positions a land
 * unit can always walk between. The water maps need the Dock and boats, which the sim does not have (lobby.md §6).
 */
export const LOBBY_MAP_TYPES: readonly number[] = [MAP_MOSTLY_LAND, MAP_ALL_LAND, MAP_CONTINENTAL, MAP_HILLY];
/** Tiny .. Gigantic (src/scr_set.cpp:50-55). */
export const LOBBY_MAP_SIZES: readonly number[] = [MAP_TINY, MAP_SMALL, MAP_MEDIUM, MAP_LARGE, MAP_HUGE, MAP_HUMONGOUS];
/** Standard, Conquest, Time Limit, Score: a random game's victory drop-down (src/scr_set.cpp:83-89), as world types. */
export const LOBBY_VICTORY_TYPES: readonly number[] = [VICTORY_STANDARD, VICTORY_CONQUEST, VICTORY_TIME_LIMIT, VICTORY_SCORE];
/** The time limit drop-down, years (src/scr_set.cpp:97-103); picking Time Limit selects line 3. */
export const LOBBY_TIME_LIMITS: readonly number[] = [15000, 13000, 11000, 9000, 7000, 5000, 3000];
export const DEFAULT_TIME_LIMIT = 9000;
/** The score drop-down, points (src/scr_set.cpp:110-123); picking Score selects line 7. */
export const LOBBY_SCORE_LIMITS: readonly number[] = [3000, 2700, 2400, 2100, 1800, 1500, 1200, 900, 800, 700, 600, 500, 400, 300];
export const DEFAULT_SCORE_LIMIT = 900;

/** `CIVILIZATION_COUNT`: Egyptian (1) .. Macedonian (16). */
export const CIV_COUNT = 16;
/** The civ drop-down's last line (string "Random", src/scr_mps.cpp:150): resolved when the game starts. */
export const CIV_RANDOM = 17;

/** Whether `s` is a setting the lobby offers: a listed map type and size, victory type and, for time or score, amount. */
export function isLobbySettings(s: GameSettings): boolean {
  const { type, amount } = s.victory;
  if (!LOBBY_MAP_TYPES.includes(s.mapType) || !LOBBY_MAP_SIZES.includes(s.mapSize) || !LOBBY_VICTORY_TYPES.includes(type)) return false;
  if (type === VICTORY_TIME_LIMIT) return amount !== undefined && LOBBY_TIME_LIMITS.includes(amount);
  if (type === VICTORY_SCORE) return amount !== undefined && LOBBY_SCORE_LIMITS.includes(amount);
  return amount === undefined;
}

export function isLobbyCiv(civ: number): boolean {
  return Number.isInteger(civ) && civ >= 1 && civ <= CIV_RANDOM;
}

/**
 * The players' civs once the game starts (`TRIBE_Game::create_game`, src/tribegam.cpp:2849-2870): seeded with the
 * game seed, each player whose civ is not a civ (Random) in turn gets `rand() * 16 / 0x7FFF + 1`. A draw of 0x7FFF
 * makes 17, past the dat's civs; the port keeps it at 16 (lobby.md §5). The world reseeds after this, so the draws
 * change nothing else.
 */
export function resolveCivs(seed: number, civs: readonly number[]): number[] {
  const rng = new CrtRand();
  rng.srand(seed);
  return civs.map((c) => (c >= 1 && c <= CIV_COUNT ? c : Math.min(Math.trunc((rng.rand() * CIV_COUNT) / 0x7fff) + 1, CIV_COUNT)));
}

/**
 * The world a lobby game starts: the random map of `settings` from `seed` (or, `testMap`, the fixed test map and its
 * start objects), each player's civ (by slot, Random resolved) and the victory setting.
 */
export function lobbyWorldOptions(seed: number, settings: GameSettings, civs: readonly number[], testMap = false): WorldOptions {
  const players = civs.length + 1;
  const common = { players, randomSeed: seed, civs: [CIV_GAIA, ...resolveCivs(seed, civs)], victory: { ...settings.victory } };
  return testMap ? { ...common, units: startingObjects(players) } : { ...common, randomMap: { type: settings.mapType, size: settings.mapSize } };
}
