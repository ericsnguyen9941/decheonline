import { expect, test } from 'vitest';
import {
  CLUBMAN,
  HOUSE,
  NOTIFY_CANNOT_REPAIR,
  NOTIFY_CANNOT_TRADE_WITH_ENEMY,
  NOTIFY_CONVERSION_NO_FAITH,
  NOTIFY_CONVERSION_PRIEST_NEEDS_MONOTHEISM,
  NOTIFY_CONVERSION_BUILDING_NEEDS_MONOTHEISM,
  NOTIFY_CONVERSION_TOWN_CENTER,
  NOTIFY_CONVERSION_WONDER,
  NOTIFY_NO_ROOM_FOR_UNIT,
  NOTIFY_NOT_CLOSE_ENOUGH_TO_LAND,
  NOTIFY_NOT_ENOUGH_UNLOAD_SPACE,
  NOTIFY_PLAYER_RESIGNED,
  startingObjects, TOOL_AGE,
  TOWN_CENTER,
  unitType,
  VILLAGER,
  World,
} from '@aoe/sim';
import type { AssetProvider, UnitInfo } from '../assets';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ageName, attackRollover, cantDoMessages, civilizationName, commandMessage, objectName, shortMessage, statRows, techCost, techName, topButtonLabels } from './text';

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
  4105: 'Stop (S)',
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
  7063: 'Tool Age',
  8063: 'Advance to Tool Age: Requires 2 Stone Age buildings',
};

function provider(strings: Record<number, string> = STRINGS): AssetProvider {
  return {
    unitInfo: (id: number) => {
      const u = UNITS[id];
      return u ? { icon: 0, hitPoints: 1, button: 0, outline: [0, 0, 0], ...u } : null;
    },
    // Tool Age in data2/empires.dat.
    techInfo: (id: number) => (id === TOOL_AGE ? { name: 'Tool Age', nameId: 7063, creationId: 8063, icon: 65, button: 6 } : null),
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

const world = new World({ players: 3, units: startingObjects(3) });

test('a villager shows its attack; a soldier its attack and armour; a plain building nothing', () => {
  expect(statRows(provider(), unitType(VILLAGER), false)).toEqual([{ kind: 'attack', icon: 7, text: '3' }]);
  expect(statRows(provider(), unitType(CLUBMAN), false)).toEqual([
    { kind: 'attack', icon: 7, text: '3' },
    { kind: 'armor', icon: 8, text: '0' },
  ]);
  expect(statRows(provider(), unitType(TOWN_CENTER), false)).toEqual([]);
  expect(statRows(provider({}), { ...unitType(VILLAGER), id: 99999 }, false)).toEqual([]);
});

test('a current value above the displayed one shows as base+bonus', () => {
  const p = provider();
  const weak = { ...p, unitInfo: (id: number) => ({ ...p.unitInfo(id)!, displayed: [1, 0, 0, 0] as [number, number, number, number] }) };
  expect(statRows(weak, unitType(VILLAGER), false)[0]?.text).toBe('1+2');
});

test('train and build messages carry the cost; commands their text', () => {
  expect(commandMessage(provider(), { kind: 'train', slot: 0, unit: VILLAGER, count: 0 }, world, 1)).toBe('Create Villager (C) (Food: 50)');
  expect(commandMessage(provider(), { kind: 'place', slot: 0, unit: HOUSE }, world, 1)).toBe('Build House (E) (Wood: 30)');
  expect(commandMessage(provider(), { kind: 'build', slot: 0 }, world, 1)).toBe('Build (B)');
  expect(commandMessage(provider(), { kind: 'unselect', slot: 11 }, world, 1)).toBe('Unselect (ESC)');
  expect(commandMessage(provider({}), { kind: 'train', slot: 0, unit: VILLAGER, count: 0 }, world, 1)).toBe('Create Man (Food: 50)');
  expect(commandMessage(provider({}), { kind: 'cancel', slot: 11 }, world, 1)).toBe('Cancel');
  expect(commandMessage(provider(), { kind: 'stop', slot: 0 }, world, 1)).toBe('Stop (S)');
});

test("research messages: the tech's research text and tech_cost; without strings the dat name", () => {
  const research = { kind: 'research', slot: 6, tech: TOOL_AGE, disabled: false } as const;
  expect(commandMessage(provider(), research, world, 1)).toBe('Advance to Tool Age: Requires 2 Stone Age buildings (Food: 500)');
  expect(commandMessage(provider({}), research, world, 1)).toBe('Research Tool Age (Food: 500)');
  expect(techName(provider(), TOOL_AGE)).toBe('Tool Age');
  expect(techName(provider({}), 5)).toBe('Tech 5');
});

test('tech_cost: with gold replacement the shortfall moves to the first gold or empty slot', () => {
  const w = new World({ players: 2, units: startingObjects(2) });
  expect(techCost(w, 1, TOOL_AGE)).toEqual([[0, 500], [-1, 0], [-1, 0]]);
  const a = w.attributes[1]!;
  a[29] = 1;
  a[0] = 300;
  expect(techCost(w, 1, TOOL_AGE)).toEqual([[0, 300], [3, 200], [-1, 0]]);
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
  expect(commandMessage(provider(), { kind: 'group', slot: 6 }, world, 1)).toBe('Group (G)');
});

test('the HUD code holds no English text for the age, the top buttons or the refusals', () => {
  const dir = import.meta.dirname;
  const literals = /['"`](Stone Age|Tool Age|Bronze Age|Iron Age|Chat|Diplomacy|Menu|Not enough[^'"`]*|You cannot build[^'"`]*)['"`]/;
  const found = readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .flatMap((f) => readFileSync(join(dir, f), 'utf8').split('\n').flatMap((line, i) => (literals.test(line) ? [`${f}:${i + 1}: ${line.trim()}`] : [])));
  expect(found).toEqual([]);
});

test('each can’t-do notification gives its original string to the player told and to no one else', () => {
  // The ids `get_string2(RGE_STRING_TYPE_ATTRIBUTE)` / `get_string` map them to (src/tribegam.cpp:930-965, 1773-1817, 2090-2134).
  const ids: Record<number, number> = {
    [NOTIFY_NOT_CLOSE_ENOUGH_TO_LAND]: 0xbbf,
    [NOTIFY_NOT_ENOUGH_UNLOAD_SPACE]: 0xbc0,
    [NOTIFY_NO_ROOM_FOR_UNIT]: 0xbc2,
    [NOTIFY_CANNOT_TRADE_WITH_ENEMY]: 0xbc3,
    [NOTIFY_CANNOT_REPAIR]: 0xbca,
    [NOTIFY_CONVERSION_NO_FAITH]: 0xbe7,
    [NOTIFY_CONVERSION_PRIEST_NEEDS_MONOTHEISM]: 0xbe8,
    [NOTIFY_CONVERSION_BUILDING_NEEDS_MONOTHEISM]: 0xbe9,
    [NOTIFY_CONVERSION_TOWN_CENTER]: 0xbea,
    [NOTIFY_CONVERSION_WONDER]: 0xbeb,
  };
  const p = { string: (id: number) => `string ${id.toString(16)}` } as AssetProvider;
  const w = new World({ players: 3, units: startingObjects(3) });
  const ctx = w.gameContext();
  const types = Object.keys(ids).map(Number);
  for (const type of types) ctx.notify(type, 1, 7);
  ctx.notify(NOTIFY_CANNOT_REPAIR, 2);
  ctx.notify(NOTIFY_PLAYER_RESIGNED, 1);
  expect(cantDoMessages(w, 1, 0, p)).toEqual(types.map((t) => `string ${ids[t]!.toString(16)}`));
  expect(cantDoMessages(w, 2, 0, p)).toEqual(['string bca']);
  expect(cantDoMessages(w, 3, 0, p)).toEqual([]);
  // Entries already read are not told again; a pack without the string says nothing.
  expect(cantDoMessages(w, 1, w.log.notifications.length, p)).toEqual([]);
  expect(cantDoMessages(w, 1, 0, provider({}))).toEqual([]);
});
