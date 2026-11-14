import { expect, test } from 'vitest';
import { CLUBMAN, HOUSE, TOWN_CENTER, VILLAGER } from '@aoe/sim';
import type { AssetProvider, UnitInfo } from '../assets';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ageName, attackRollover, civilizationName, commandMessage, objectName, shortMessage, statRows, topButtonLabels } from './text';

// Name and creation ids, interface kind and displayed values of these masters in data2/empires.dat (npm run dat:dump).
const UNITS: Record<number, Pick<UnitInfo, 'nameId' | 'creationId' | 'level' | 'displayed'>> = {
  [VILLAGER]: { nameId: 5131, creationId: 6131, level: 3, displayed: [3, 0, 0, 0] },
  [CLUBMAN]: { nameId: 5183, creationId: 6183, level: 4, displayed: [3, 0, 0, 0] },
  [TOWN_CENTER]: { nameId: 5255, creationId: 6255, level: 2, displayed: [0, 0, 0, 0] },
  [HOUSE]: { nameId: 5119, creationId: 6119, level: 2, displayed: [0, 0, 0, 0] },
};
// What languagex.dll over language.dll says for them.
const STRINGS: Record<number, string> = {
  5131: 'Villager',
  6131: 'Create Villager (C)',
  5255: 'Town Center',
  6119: 'Build House (E)',
  10231: 'Egyptian',
  4301: 'Food',
  4302: 'Wood',
  4103: 'Build (B)',
  4106: 'Unselect (ESC)',
  4108: 'Group (G)',
  4201: 'Stone Age',
  4202: 'Tool Age',
  4113: 'Chat',
  4114: 'Diplomacy',
  4115: 'Menu',
  3001: 'Not enough food.',
  3002: 'Not enough wood.',
  3005: 'You need to build more houses.',
  3046: 'You have reached your population limit.',
  3701: 'Click to attack this unit.',
  3702: 'Click to attack this building.',
};

function provider(strings: Record<number, string> = STRINGS): AssetProvider {
  return {
    unitInfo: (id: number) => {
      const u = UNITS[id];
      return u ? { icon: 0, hitPoints: 1, button: 0, outline: [0, 0, 0], ...u } : null;
    },
    string: (id: number) => strings[id] ?? null,
  } as AssetProvider;
}

test('names come from the language strings, else the dat name', () => {
  expect(objectName(provider(), VILLAGER)).toBe('Villager');
  expect(objectName(provider(), TOWN_CENTER)).toBe('Town Center');
  expect(objectName(provider({}), VILLAGER)).toBe('Man');
  expect(objectName(provider(), CLUBMAN)).toBe('Soldier-Inf1');
});

test('civilization names: 10230 + civ, Rise of Rome civs out of order, nothing without strings', () => {
  expect(civilizationName(provider(), 1)).toBe('Egyptian');
  expect(civilizationName(provider({ 10248: 'Macedonian', 10249: 'Palmyran' }), 15)).toBe('Palmyran');
  expect(civilizationName(provider({ 10248: 'Macedonian' }), 16)).toBe('Macedonian');
  expect(civilizationName(provider({}), 1)).toBe('');
});

test('a villager shows its attack; a soldier its attack and armour; a plain building nothing', () => {
  expect(statRows(provider(), VILLAGER, false)).toEqual([{ kind: 'attack', icon: 7, text: '3' }]);
  expect(statRows(provider(), CLUBMAN, false)).toEqual([
    { kind: 'attack', icon: 7, text: '3' },
    { kind: 'armor', icon: 8, text: '0' },
  ]);
  expect(statRows(provider(), TOWN_CENTER, false)).toEqual([]);
  expect(statRows(provider({}), 99999, false)).toEqual([]);
});

test('a current value above the displayed one shows as base+bonus', () => {
  const p = provider();
  const weak = { ...p, unitInfo: (id: number) => ({ ...p.unitInfo(id)!, displayed: [1, 0, 0, 0] as [number, number, number, number] }) };
  expect(statRows(weak, VILLAGER, false)[0]?.text).toBe('1+2');
});

test('train and build messages carry the cost; commands their text', () => {
  expect(commandMessage(provider(), { kind: 'train', slot: 0, unit: VILLAGER, count: 0 })).toBe('Create Villager (C) (Food: 50)');
  expect(commandMessage(provider(), { kind: 'place', slot: 0, unit: HOUSE })).toBe('Build House (E) (Wood: 30)');
  expect(commandMessage(provider(), { kind: 'build', slot: 0 })).toBe('Build (B)');
  expect(commandMessage(provider(), { kind: 'unselect', slot: 11 })).toBe('Unselect (ESC)');
  expect(commandMessage(provider({}), { kind: 'train', slot: 0, unit: VILLAGER, count: 0 })).toBe('Create Man (Food: 50)');
  expect(commandMessage(provider({}), { kind: 'cancel', slot: 11 })).toBe('Cancel');
});

test('age, top buttons, refusals and the attack rollover come from the strings, and are empty without them', () => {
  expect([1, 2, 0, 5].map((age) => ageName(provider(), age))).toEqual(['Stone Age', 'Tool Age', '', '']);
  expect(topButtonLabels(provider())).toEqual(['Chat', 'Diplomacy', 'Menu']);
  expect([0, 1, 4, 32, 30, -1].map((attr) => shortMessage(provider(), attr))).toEqual([
    'Not enough food.',
    'Not enough wood.',
    'You need to build more houses.',
    'You have reached your population limit.',
    '',
    '',
  ]);
  // Object groups: 4 Villagers (3701), 3 buildings (3702).
  expect([4, 3].map((group) => attackRollover(provider(), group))).toEqual(['Click to attack this unit.', 'Click to attack this building.']);
  expect(ageName(provider({}), 1)).toBe('');
  expect(topButtonLabels(provider({}))).toEqual(['', '', '']);
  expect(shortMessage(provider({}), 0)).toBe('');
  expect(commandMessage(provider(), { kind: 'group', slot: 6 })).toBe('Group (G)');
});

test('the HUD code holds no English text for the age, the top buttons or the refusals', () => {
  const dir = import.meta.dirname;
  const literals = /['"`](Stone Age|Tool Age|Bronze Age|Iron Age|Chat|Diplomacy|Menu|Not enough[^'"`]*|You cannot build[^'"`]*)['"`]/;
  const found = readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .flatMap((f) => readFileSync(join(dir, f), 'utf8').split('\n').flatMap((line, i) => (literals.test(line) ? [`${f}:${i + 1}: ${line.trim()}`] : [])));
  expect(found).toEqual([]);
});
