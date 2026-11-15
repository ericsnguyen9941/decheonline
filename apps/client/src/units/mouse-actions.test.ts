import { expect, test } from 'vitest';
import { ObjectState, unitType } from '@aoe/sim';
import { canAttack, isAttackable, priestCursor, type CursorTarget, type PriestSelection } from './mouse-actions';

// Master ids (empires.dat): Bowman, Clubman, Villager, Barracks, Town Center, the Bowman's arrow, Dead_Man, Flare.
test('Villagers, Clubmen and Bowmen can attack; a Barracks cannot', () => {
  for (const id of [4, 73, 83]) expect(canAttack(unitType(id))).toBe(true);
  expect(canAttack(unitType(12))).toBe(false);
});

test('units and buildings take the attack cursor; arrows, bodies and the flare do not', () => {
  for (const id of [4, 73, 83, 12, 109]) expect(isAttackable(unitType(id))).toBe(true);
  for (const id of [9, 43, 112]) expect(isAttackable(unitType(id))).toBe(false);
});

// Master ids and groups (empires.dat): Priest 125 (group 18), Clubman 73 (6), Barracks 12 (3), Small Wall 72 (27), Town_Center1 109, Wonder 276.
const sel = (over: Partial<PriestSelection> = {}): PriestSelection => ({ attack: false, faith: true, single: 1, priestConversion: false, buildingConversion: false, ...over });
const target = (over: Partial<CursorTarget> = {}): CursorTarget => ({ id: 2, type: 73, group: 6, hp: 40, maxHp: 40, state: ObjectState.Active, ...over });

test('a priest selection shows the ring over a hurt own or allied unit, not a whole one, a building or itself alone', () => {
  expect(priestCursor(sel(), target({ hp: 20 }), 'self')).toBe(true);
  expect(priestCursor(sel(), target({ hp: 20 }), 'ally')).toBe(true);
  expect(priestCursor(sel(), target(), 'self')).toBe(false);
  expect(priestCursor(sel(), target({ hp: 0.5 }), 'self')).toBe(false);
  expect(priestCursor(sel(), target({ type: 12, group: 3, hp: 20, maxHp: 350 }), 'self')).toBe(false);
  expect(priestCursor(sel(), target({ id: 1, type: 125, group: 18, hp: 10, maxHp: 25 }), 'self')).toBe(false);
  expect(priestCursor(sel({ single: -1 }), target({ id: 1, type: 125, group: 18, hp: 10, maxHp: 25 }), 'self')).toBe(true);
});

test('over an enemy the ring needs full faith; priests and buildings need Monotheism; never a Town_Center1 or the Wonder', () => {
  expect(priestCursor(sel(), target(), 'enemy')).toBe(true);
  expect(priestCursor(sel(), target(), 'neutral')).toBe(true);
  expect(priestCursor(sel({ faith: false }), target(), 'enemy')).toBe(false);
  // A selection that can attack shows the sword over it instead.
  expect(priestCursor(sel({ attack: true }), target(), 'enemy')).toBe(false);
  expect(priestCursor(sel(), target({ type: 125, group: 18 }), 'enemy')).toBe(false);
  expect(priestCursor(sel({ priestConversion: true }), target({ type: 125, group: 18 }), 'enemy')).toBe(true);
  expect(priestCursor(sel(), target({ type: 12, group: 3 }), 'enemy')).toBe(false);
  expect(priestCursor(sel({ buildingConversion: true }), target({ type: 12, group: 3 }), 'enemy')).toBe(true);
  for (const type of [109, 276]) expect(priestCursor(sel({ buildingConversion: true }), target({ type, group: 3 }), 'enemy')).toBe(false);
  // Walls (27) are only attacked.
  expect(priestCursor(sel({ buildingConversion: true }), target({ type: 72, group: 27 }), 'enemy')).toBe(false);
});
