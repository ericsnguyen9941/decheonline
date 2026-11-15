import { expect, test } from 'vitest';
import { RELATION_ALLY, startingObjects, VICTORY_SCORE, World, WONDER_COUNTING, WONDER_WAITING } from '@aoe/sim';
import {
  ARTIFACTS_CAPTURED_OTHER,
  ARTIFACTS_CAPTURED_SELF,
  ARTIFACTS_LOST,
  CLOCK_ARTIFACTS,
  CLOCK_RUINS,
  CLOCK_WONDER,
  clockTime,
  clockYears,
  heldClocks,
  heldNotices,
  RUINS_CAPTURED_SELF,
  RUINS_LOST,
  SOUND_ART_HELD,
  SOUND_ART_LOST,
  SOUND_WONDER_COMPLETED,
  SOUND_WONDER_DESTROYED,
  SOUND_WONDER_STARTED,
  WONDER_BUILDING_STARTED,
  WONDER_COMPLETED,
  WONDER_COMPLETED_OTHER,
  WONDER_COMPLETED_OTHER_LOSS,
  WONDER_COMPLETED_OTHER_WIN,
  WONDER_COMPLETED_SELF,
  WONDER_DESTROYED_OTHER,
  WONDER_DESTROYED_SELF,
  WONDER_STARTED,
  wonderNotices,
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
    { type: CLOCK_RUINS, player: 1 },
    { type: CLOCK_ARTIFACTS, player: 2 },
    { type: CLOCK_RUINS, player: 2 },
  ]);
  allies(w);
  expect(heldClocks(w)).toEqual([{ type: CLOCK_RUINS, player: 1 }]);
});

test('the years shown: truncated, then rounded up to 5', () => {
  expect([2000, 1999.9, 1996, 1995.2, 4.9, 0.5].map(clockYears)).toEqual([2000, 2000, 2000, 1995, 5, 0]);
});

const seen = (owner: number, state: number, timer: number) => new Map([[9, { owner, state, timer }]]);
const none = new Map<number, { owner: number; state: number; timer: number }>();

test('a Wonder started, completed and destroyed: the texts for its owner and for the other player, with their sounds', () => {
  const w = world();
  const site = seen(1, WONDER_WAITING, 0);
  const done = seen(1, WONDER_COUNTING, 0);
  expect(wonderNotices(w, 1, none, site)).toEqual([{ text: WONDER_BUILDING_STARTED, sound: SOUND_WONDER_STARTED }]);
  expect(wonderNotices(w, 2, none, site)).toEqual([{ text: WONDER_STARTED, sound: SOUND_WONDER_STARTED, name: 1 }]);
  expect(wonderNotices(w, 1, site, done)).toEqual([{ text: WONDER_COMPLETED_SELF, sound: SOUND_WONDER_COMPLETED }]);
  expect(wonderNotices(w, 2, site, done)).toEqual([{ text: WONDER_COMPLETED_OTHER_LOSS, sound: SOUND_WONDER_COMPLETED, name: 1 }]);
  expect(wonderNotices(w, 2, done, seen(1, WONDER_COUNTING, 10))).toEqual([]);
  expect(wonderNotices(w, 1, done, none)).toEqual([{ text: WONDER_DESTROYED_SELF, sound: SOUND_WONDER_DESTROYED }]);
  expect(wonderNotices(w, 2, done, none)).toEqual([{ text: WONDER_DESTROYED_OTHER, sound: SOUND_WONDER_DESTROYED, name: 1 }]);
  // One already built when the screen comes up: started, then completed.
  expect(wonderNotices(w, 2, none, done).map((n) => n.text)).toEqual([WONDER_STARTED, WONDER_COMPLETED_OTHER_LOSS]);
  // Its action deleted and started again by the next update (the stop command): destroyed, started, completed.
  expect(wonderNotices(w, 1, seen(1, WONDER_COUNTING, 500), done).map((n) => n.text)).toEqual([WONDER_DESTROYED_SELF, WONDER_BUILDING_STARTED, WONDER_COMPLETED_SELF]);
});

test('a Wonder completed by an allied-victory ally is "you will win"; outside Standard: no second sentence, no destroyed', () => {
  const w = world();
  allies(w);
  expect(wonderNotices(w, 2, seen(1, WONDER_WAITING, 0), seen(1, WONDER_COUNTING, 0))).toEqual([{ text: WONDER_COMPLETED_OTHER_WIN, sound: SOUND_WONDER_COMPLETED, name: 1 }]);
  const s = new World({ players: 3, units: startingObjects(3), victory: { type: VICTORY_SCORE, amount: 3000 } });
  expect(wonderNotices(s, 1, seen(1, WONDER_WAITING, 0), seen(1, WONDER_COUNTING, 0)).map((n) => n.text)).toEqual([WONDER_COMPLETED]);
  expect(wonderNotices(s, 2, seen(1, WONDER_WAITING, 0), seen(1, WONDER_COUNTING, 0)).map((n) => n.text)).toEqual([WONDER_COMPLETED_OTHER]);
  expect(wonderNotices(s, 2, seen(1, WONDER_COUNTING, 0), none)).toEqual([]);
});

test('reset_clocks: a Wonder clock per player whose countdown is above 0, before its relic clock, even for an ally', () => {
  const w = world();
  allies(w);
  w.victory.wonderCountdown[2] = 1500;
  w.victory.artifactHeld[1] = 800;
  w.victory.artifactHeld[2] = 800;
  expect(heldClocks(w)).toEqual([
    { type: CLOCK_ARTIFACTS, player: 1 },
    { type: CLOCK_WONDER, player: 2 },
  ]);
  w.victory.wonderCountdown[1] = 1999;
  expect(heldClocks(w)[0]).toEqual({ type: CLOCK_WONDER, player: 1 });
  expect(clockYears(clockTime(w, { type: CLOCK_WONDER, player: 1 }))).toBe(2000);
  w.victory.wonderCountdown[1] = 0;
  expect(heldClocks(w).filter((c) => c.player === 1)).toEqual([{ type: CLOCK_ARTIFACTS, player: 1 }]);
});
