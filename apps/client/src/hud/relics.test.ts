import { expect, test } from 'vitest';
import { RELATION_ALLY, startingObjects, VICTORY_SCORE, World } from '@aoe/sim';
import {
  ARTIFACTS_CAPTURED_OTHER,
  ARTIFACTS_CAPTURED_SELF,
  ARTIFACTS_LOST,
  clockYears,
  heldClocks,
  heldNotices,
  RUINS_CAPTURED_SELF,
  RUINS_LOST,
  SOUND_ART_HELD,
  SOUND_ART_LOST,
} from './relics';

function world(): World {
  return new World({ players: 3, units: startingObjects(3) });
}

function allies(w: World): void {
  for (const [p, q] of [[1, 2], [2, 1]] as const) w.diplomacy.relations[p]![q] = RELATION_ALLY;
  w.diplomacy.alliedVictory[1] = true;
  w.diplomacy.alliedVictory[2] = true;
}

test('player 1 takes all relics: "hold them to win" for it, "you will lose" for player 2, artheld.wav for both', () => {
  const w = world();
  const before = [-1, -1, -1];
  const after = [-1, 2000, -1];
  expect(heldNotices(w, 1, before, after, false)).toEqual([{ text: ARTIFACTS_CAPTURED_SELF, sound: SOUND_ART_HELD }]);
  expect(heldNotices(w, 2, before, after, false)).toEqual([{ text: ARTIFACTS_CAPTURED_OTHER, sound: SOUND_ART_HELD }]);
  // Losing them: one text for everyone, artlost.wav.
  for (const p of [1, 2]) expect(heldNotices(w, p, after, before, false)).toEqual([{ text: ARTIFACTS_LOST, sound: SOUND_ART_LOST }]);
  expect(heldNotices(w, 2, [-1, 1990, -1], [-1, 1980, -1], false)).toEqual([]);
});

test('an allied-victory team arms together: one notification, "hold them to win" for both', () => {
  const w = world();
  allies(w);
  const before = [-1, -1, -1];
  const after = [-1, 2000, 2000];
  for (const p of [1, 2]) expect(heldNotices(w, p, before, after, true)).toEqual([{ text: RUINS_CAPTURED_SELF, sound: SOUND_ART_HELD }]);
  expect(heldNotices(w, 2, after, before, true)).toEqual([{ text: RUINS_LOST, sound: SOUND_ART_LOST }]);
});

test('outside Standard nothing is notified (hold arms no countdown there)', () => {
  const w = new World({ players: 3, units: startingObjects(3), victory: { type: VICTORY_SCORE, amount: 3000 } });
  expect(heldNotices(w, 1, [-1, -1, -1], [-1, 2000, -1], false)).toEqual([]);
  expect(heldClocks(w)).toEqual([]);
});

test('reset_clocks: a clock per running countdown in player order, one per allied-victory team', () => {
  const w = world();
  w.victory.artifactHeld[2] = 1500;
  w.victory.ruinHeld[1] = 800;
  w.victory.ruinHeld[2] = 800;
  expect(heldClocks(w)).toEqual([
    { ruins: true, player: 1 },
    { ruins: false, player: 2 },
    { ruins: true, player: 2 },
  ]);
  allies(w);
  expect(heldClocks(w)).toEqual([{ ruins: true, player: 1 }]);
});

test('the years shown: truncated, then rounded up to 5', () => {
  expect([2000, 1999.9, 1996, 1995.2, 4.9, 0.5].map(clockYears)).toEqual([2000, 2000, 2000, 1995, 5, 0]);
});
