// The setup screens' text from the language strings the pack carries (ids in docs/spec/lobby.md §7), with the pack's
// English as the fallback when the server has no pack.
import { CIV_RANDOM, VICTORY_CONQUEST, VICTORY_SCORE, VICTORY_STANDARD, VICTORY_TIME_LIMIT, LOBBY_MAP_SIZES, LOBBY_TIME_LIMITS, type GameSettings } from '@aoe/sim';

/** A language string by id, or `fallback` when the pack has none. */
export type Text = (id: number, fallback: string) => string;

export const englishText: Text = (_id, fallback) => fallback;

/**
 * `STRING_ID_MP_SETTINGS_LABEL`, `_MP_CIV_LABEL`, `_MAP_SIZE_LABEL`, `_MAP_TYPE_LABEL`, `_VICTORY_CONDITION_LABEL`,
 * `_POPULATION_LIMIT_LABEL`.
 */
export const LABELS = {
  settings: [9682, 'Settings'],
  civ: [9681, 'Civ'],
  mapSize: [10656, 'Map Size'],
  mapType: [9691, 'Map Type'],
  victory: [10804, 'Victory Condition'],
  timeLimit: [4329, 'Time Limit'],
  score: [4330, 'Score'],
  populationLimit: [9747, 'Population Limit'],
  /** `STRING_ID_MP_CHAT_LABEL` (scr_mps.cpp:224). */
  chat: [9687, 'Chat'],
} as const;

/** `STRING_ID_CIVILIZATION_*` by civ 1-16 (Palmyran 15 and Macedonian 16 swap ids), 17 "Random" (scr_mps.cpp:133-150). */
const CIV_STRINGS: readonly [number, string][] = [
  [10231, 'Egyptian'],
  [10232, 'Greek'],
  [10233, 'Babylonian'],
  [10234, 'Assyrian'],
  [10235, 'Minoan'],
  [10236, 'Hittite'],
  [10237, 'Phoenician'],
  [10238, 'Sumerian'],
  [10239, 'Persian'],
  [10240, 'Shang'],
  [10241, 'Yamato'],
  [10242, 'Choson'],
  [10246, 'Roman'],
  [10247, 'Carthaginian'],
  [10249, 'Palmyran'],
  [10248, 'Macedonian'],
  [10250, 'Random'],
];

/** `STRING_ID_MAP_TYPE_*`: map type t is string 10602 + t (the retail names). */
const MAP_TYPE_NAMES = ['Small Islands', 'Large Islands', 'Coastal', 'Inland', 'Highland', 'Continental', 'Mediterranean', 'Hill Country', 'Narrows'];
/** `STRING_ID_MAP_SIZE_TINY` .. `_HUMONGOUS`, by size index. */
const MAP_SIZE_NAMES = ['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gigantic'];
/** `STRING_ID_VICTORY_*` by world victory type. */
const VICTORY_NAMES: Record<number, [number, string]> = {
  [VICTORY_STANDARD]: [4332, 'Standard'],
  [VICTORY_CONQUEST]: [4321, 'Conquest'],
  [VICTORY_TIME_LIMIT]: [4329, 'Time Limit'],
  [VICTORY_SCORE]: [4330, 'Score'],
};
/** `STRING_ID_TIME_LIMIT_15000` .. `_3000`: 9780 + the line. */
const TIME_LIMIT_NAMES = ['15,000 years (2:00 hr)', '13,000 years (1:45 hr)', '11,000 years (1:30 hr)', '9,000 years (1:15 hr)', '7,000 years (60 min)', '5,000 years (40 min)', '3,000 years (25 min)'];

export function civName(text: Text, civ: number): string {
  const s = CIV_STRINGS[civ - 1] ?? CIV_STRINGS[CIV_RANDOM - 1]!;
  return text(s[0], s[1]);
}

export function mapTypeName(text: Text, type: number): string {
  return text(10602 + type, MAP_TYPE_NAMES[type] ?? '');
}

export function mapSizeName(text: Text, size: number): string {
  const i = LOBBY_MAP_SIZES.indexOf(size);
  return text(10611 + i, MAP_SIZE_NAMES[i] ?? String(size));
}

export function victoryName(text: Text, type: number): string {
  const [id, fallback] = VICTORY_NAMES[type] ?? [0, ''];
  return text(id, fallback);
}

export function timeLimitName(text: Text, years: number): string {
  const i = LOBBY_TIME_LIMITS.indexOf(years);
  return text(9780 + i, TIME_LIMIT_NAMES[i] ?? String(years));
}

/**
 * The setup screen's summary lines (`TribeMPSetupScreen::updateSummary`): "Map Size: %s" (9690), "Map Type: %s" (9654),
 * "Victory: %s" (9660), with the years or points "Victory: %s (%d)" (9662), and, the screen's last line,
 * "Population Limit: %d" (9712, scr_mps.cpp:2069).
 */
export function summaryLines(text: Text, s: GameSettings): string[] {
  const fill = (format: string, ...values: (string | number)[]) => {
    let i = 0;
    return format.replace(/%[sd]/g, () => String(values[i++] ?? ''));
  };
  const victory = victoryName(text, s.victory.type);
  return [
    fill(text(9690, 'Map Size: %s'), mapSizeName(text, s.mapSize)),
    fill(text(9654, 'Map Type: %s'), mapTypeName(text, s.mapType)),
    s.victory.amount === undefined ? fill(text(9660, 'Victory: %s'), victory) : fill(text(9662, 'Victory: %s (%d)'), victory, s.victory.amount),
    fill(text(9712, 'Population Limit: %d'), s.populationLimit),
  ];
}
