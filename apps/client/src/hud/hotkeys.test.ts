import { expect, test } from 'vitest';
import { HOUSE, startingObjects, TOWN_CENTER, VILLAGER, World } from '@aoe/sim';
import type { AssetProvider } from '../assets';
import { buttonLetter, hotkeyLetter, pressedLetter } from './hotkeys';

// language.dll: 0x1037 Build 'B', 0x1038 Stop 'S', 0x1039 Group 'G', 0x103B More 'X'; hotkey_id of the Villager (16132),
// the House (16120) and the Town Center (16256) in data2/empires.dat (npm run dat:dump -- unit <id>).
const STRINGS: Record<number, string> = { 0x1037: 'B', 0x1038: 'S', 0x1039: 'G', 0x103b: 'X', 16132: 'C', 16120: 'e' };
const HOTKEY_IDS: Record<number, number> = { [VILLAGER]: 16132, [HOUSE]: 16120 };

const provider = {
  unitInfo: (id: number) => (HOTKEY_IDS[id] === undefined ? null : { hotkeyId: HOTKEY_IDS[id] }),
  string: (id: number) => STRINGS[id] ?? null,
} as unknown as AssetProvider;
const world = new World({ players: 3, units: startingObjects(3) });

test('a key is the first character of its string, in upper case', () => {
  expect(hotkeyLetter(provider, 16120)).toBe('E');
  expect(hotkeyLetter(provider, 16256)).toBeNull();
  expect(hotkeyLetter(provider, 0)).toBeNull();
});

test('commands read their STRING_ID_HOTKEY_*, units and buildings their hotkey_id, research and Esc buttons none', () => {
  expect(buttonLetter(provider, { kind: 'build', slot: 0 }, world, 1)).toBe('B');
  expect(buttonLetter(provider, { kind: 'stop', slot: 0 }, world, 1)).toBe('S');
  expect(buttonLetter(provider, { kind: 'group', slot: 6 }, world, 1)).toBe('G');
  expect(buttonLetter(provider, { kind: 'more', slot: 5 }, world, 1)).toBe('X');
  expect(buttonLetter(provider, { kind: 'ungroup', slot: 7 }, world, 1)).toBeNull();
  expect(buttonLetter(provider, { kind: 'train', slot: 0, unit: VILLAGER, count: 0 }, world, 1)).toBe('C');
  expect(buttonLetter(provider, { kind: 'place', slot: 0, unit: HOUSE }, world, 1)).toBe('E');
  expect(buttonLetter(provider, { kind: 'train', slot: 0, unit: TOWN_CENTER, count: 0 }, world, 1)).toBeNull();
  expect(buttonLetter(provider, { kind: 'research', slot: 0, tech: 101, disabled: false }, world, 1)).toBeNull();
  expect(buttonLetter(provider, { kind: 'unselect', slot: 11 }, world, 1)).toBeNull();
});

test('only a single character key is a letter', () => {
  expect(pressedLetter({ key: 'c' })).toBe('C');
  expect(pressedLetter({ key: 'Escape' })).toBeNull();
});
