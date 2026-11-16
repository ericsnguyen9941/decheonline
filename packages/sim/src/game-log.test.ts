import { describe, expect, test } from 'vitest';
import { ATTR_POPULATION } from './buildings';
import type { Command } from './commands';
import { ObjectState } from './entities';
import {
  HISTORY_BRONZE_AGE,
  HISTORY_TOOL_AGE,
  NOTIFY_DIPLOMACY_CHANGED,
  NOTIFY_PLAYER_DEFEATED,
  NOTIFY_PLAYER_RESIGNED,
  NOTIFY_TRIBUTE_PAID,
} from './game-log';
import { doTech } from './techs';
import { MARKET, VILLAGER } from './units';
import { VICTORY_SPECIAL, VICTORY_STANDARD } from './victory';
import { AGE_TOOL, World, type StartUnit } from './world';

const WOOD = 1;
const GOLD = 3;

function world(...units: StartUnit[]): World {
  return new World({ players: 3, units, victory: { type: VICTORY_SPECIAL } });
}

function order(w: World, player: number, command: Command): void {
  w.addBatch(w.turn, player, [command]);
  for (let i = 0; i < 3; i++) w.runTurn();
}

/** Player 1 with a built Market and 1000 of each resource; player 2 a Villager. */
function market(): World {
  const w = world({ owner: 1, type: MARKET, x: 10.5, y: 10.5 }, { owner: 2, type: VILLAGER, x: 30.5, y: 30.5 });
  for (let r = 0; r < 4; r++) w.attributes[1]![r] = 1000;
  return w;
}

describe('victory.md §16: the notification log', () => {
  test('a tribute logs GAME_NOTIFY_TRIBUTE_PAID with sender, receiver, resource and the (long) amount received', () => {
    const w = market();
    order(w, 1, { type: 'tribute', player: 2, resource: GOLD, amount: 100 });
    w.attributes[1]![WOOD] = 90;
    order(w, 1, { type: 'tribute', player: 2, resource: WOOD, amount: 500 });
    const tributes = w.log.notifications.filter((n) => n.type === NOTIFY_TRIBUTE_PAID);
    // 90 wood at the 25% fee: 67.5 received, logged as 67.
    expect(tributes.map((n) => n.args)).toEqual([
      [1, 2, GOLD, 100],
      [1, 2, WOOD, 67],
    ]);
    expect(tributes[0]!.worldTime).toBeGreaterThan(0);
    expect(tributes[1]!.worldTime).toBeGreaterThan(tributes[0]!.worldTime);
  });

  test('a refused tribute (no Market) logs nothing', () => {
    const w = world({ owner: 1, type: VILLAGER, x: 10.5, y: 10.5 }, { owner: 2, type: VILLAGER, x: 30.5, y: 30.5 });
    w.attributes[1]![GOLD] = 1000;
    order(w, 1, { type: 'tribute', player: 2, resource: GOLD, amount: 100 });
    expect(w.log.notifications).toEqual([]);
  });

  test('a stance change logs GAME_NOTIFY_DIPLOMACY_CHANGED (player, other, relation)', () => {
    const w = market();
    order(w, 1, { type: 'relation', player: 2, relation: 0 });
    expect(w.log.notifications.map((n) => [n.type, ...n.args])).toEqual([[NOTIFY_DIPLOMACY_CHANGED, 1, 2, 0, 0]]);
  });

  test('a resignation logs GAME_NOTIFY_PLAYER_RESIGNED once and no defeat; a player eliminated logs GAME_NOTIFY_PLAYER_DEFEATED', () => {
    const units: StartUnit[] = [
      { owner: 1, type: VILLAGER, x: 10.5, y: 10.5 },
      { owner: 2, type: VILLAGER, x: 30.5, y: 30.5 },
    ];
    const r = new World({ players: 3, units, victory: { type: VICTORY_SPECIAL } });
    order(r, 2, { type: 'resign' });
    order(r, 2, { type: 'resign' });
    expect(r.log.notifications.map((n) => [n.type, ...n.args])).toEqual([[NOTIFY_PLAYER_RESIGNED, 2, 0, 0, 0]]);

    const d = new World({ players: 3, units, victory: { type: VICTORY_STANDARD } });
    d.entities.get(2)!.hp = 0;
    for (let i = 0; i < 30 && d.playerStatus(2) === 0; i++) d.runTurn();
    expect(d.playerStatus(2)).toBe(2);
    expect(d.entities.get(2)?.state ?? ObjectState.Dead).not.toBe(ObjectState.Active);
    expect(d.log.notifications.map((n) => [n.type, ...n.args])).toEqual([[NOTIFY_PLAYER_DEFEATED, 2, 0, 0, 0]]);
  });

  test('the log is in the hash and the snapshot', () => {
    const a = market();
    const b = World.restore(JSON.parse(JSON.stringify(a.snapshot())));
    expect(b.hash()).toBe(a.hash());
    order(a, 1, { type: 'tribute', player: 2, resource: GOLD, amount: 100 });
    order(b, 1, { type: 'tribute', player: 2, resource: GOLD, amount: 100 });
    expect(b.log).toEqual(a.log);
    expect(b.hash()).toBe(a.hash());
    const c = World.restore(JSON.parse(JSON.stringify(a.snapshot())));
    c.log.notifications = [];
    expect(c.hash()).not.toBe(a.hash());
  });
});

describe('victory.md §16: the population history', () => {
  test('one entry at game start, then one every 15 game seconds, each the population byte', () => {
    const w = market();
    expect(w.log.history[1]!.population).toEqual([0]);
    expect(w.log.history[2]!.population).toEqual([1]);
    expect(w.log.history[0]!.population).toEqual([]);
    const seen: number[] = [];
    while (w.worldTime < 76_000) {
      w.runStep();
      const n = w.log.history[2]!.population.length;
      if (n > (seen.length === 0 ? 1 : seen.length + 1)) seen.push(w.worldTime);
    }
    // The once-a-second block runs when update_time passes 1 s, so the 15th tick comes just after 15 s of game time.
    expect(w.log.history[2]!.population).toEqual([1, 1, 1, 1, 1, 1]);
    expect(seen.length).toBe(5);
    seen.forEach((t, i) => {
      expect(t).toBeGreaterThanOrEqual((i + 1) * 15_000);
      expect(t).toBeLessThan((i + 1) * 15_000 + 1_000);
    });
    expect(w.attributes[2]![ATTR_POPULATION]).toBe(1);
  });

  test('an age reached after the first entry is an event at the entry count; start ages are not', () => {
    const w = market();
    doTech(w.gameContext(), 1, 101);
    doTech(w.gameContext(), 1, 102);
    expect(w.log.history[1]!.events.map((e) => [e.time, e.event])).toEqual([
      [1, HISTORY_TOOL_AGE],
      [1, HISTORY_BRONZE_AGE],
    ]);
    const s = new World({ players: 3, units: [{ owner: 1, type: VILLAGER, x: 10.5, y: 10.5 }], victory: { type: VICTORY_SPECIAL }, startingAge: AGE_TOOL });
    expect(s.techs[1]![101]).toBe(3);
    expect(s.log.history[1]!.events).toEqual([]);
  });
});
