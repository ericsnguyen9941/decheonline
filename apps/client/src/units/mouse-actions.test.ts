import { expect, test } from 'vitest';
import { unitType } from '@aoe/sim';
import { canAttack, isAttackable } from './mouse-actions';

// Master ids (empires.dat): Bowman, Clubman, Villager, Barracks, Town Center, the Bowman's arrow, Dead_Man, Flare.
test('Villagers, Clubmen and Bowmen can attack; a Barracks cannot', () => {
  for (const id of [4, 73, 83]) expect(canAttack(unitType(id))).toBe(true);
  expect(canAttack(unitType(12))).toBe(false);
});

test('units and buildings take the attack cursor; arrows, bodies and the flare do not', () => {
  for (const id of [4, 73, 83, 12, 109]) expect(isAttackable(unitType(id))).toBe(true);
  for (const id of [9, 43, 112]) expect(isAttackable(unitType(id))).toBe(false);
});
