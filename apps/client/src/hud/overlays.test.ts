import { expect, test } from 'vitest';
import { ATTR_HEADROOM, ATTR_POPULATION, ATTR_POPULATION_LIMIT, startingObjects, TOWN_CENTER, VILLAGER, World } from '@aoe/sim';
import { clockText, PopulationBlink, populationRoom, timingText, waitingOnPopulation } from './overlays';

test("F11's clock reads world time as hh:mm:ss and the game speed as %3.1f", () => {
  expect(clockText(0, 1)).toBe('00:00:00 (1.0)');
  expect(clockText(59_999, 1.5)).toBe('00:00:59 (1.5)');
  expect(clockText(61_000, 2)).toBe('00:01:01 (2.0)');
  expect(clockText((100 * 3600 + 7 * 60 + 3) * 1000, 1)).toBe('100:07:03 (1.0)');
});

test("the population panel shows the population over its room, capped by the limit, and blinks while a queue waits", () => {
  const w = new World({ players: 3, units: startingObjects(3) });
  const a = w.attributes[1]!;
  a[ATTR_POPULATION] = 4;
  a[ATTR_HEADROOM] = 6.5;
  a[ATTR_POPULATION_LIMIT] = 50;
  expect(populationRoom(w, 1)).toEqual({ pop: 4, max: 10 });
  a[ATTR_POPULATION_LIMIT] = 8;
  expect(populationRoom(w, 1)).toEqual({ pop: 4, max: 8 });
  // A queue counts only while there is no room for its unit.
  const tc = [...w.entities.ofPlayer(1)].find((e) => e.type === TOWN_CENTER)!;
  tc.queue = [{ unit: VILLAGER, count: 1 } as never];
  expect(waitingOnPopulation(w, 1)).toBe(false);
  a[ATTR_HEADROOM] = 0;
  expect(waitingOnPopulation(w, 1)).toBe(true);
  // Yellow for a game second, white for one, then the check again.
  const blink = new PopulationBlink();
  blink.step(true, 0.5);
  expect(blink.mode).toBe(1);
  blink.step(true, 0.6);
  expect(blink.mode).toBe(2);
  blink.step(false, 1.1);
  expect(blink.mode).toBe(0);
  blink.step(false, 5);
  expect(blink.mode).toBe(0);
});

test("F5's text: updates and frames of the last second, then the profiler slots, averaged or peaks", () => {
  expect(timingText(0, 30, false)).toBe('f?');
  expect(timingText(20, 60, false)).toBe('t20,f60,avg(r(v0,m0,o0),s0,u0,c0,l0,p0,o0)');
  expect(timingText(20, 60, true)).toBe('t20,f60,max(r(v0,m0,o0),s0,u0,c0,ls0,lg0,p0,o0)');
});
