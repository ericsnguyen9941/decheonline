import { describe, expect, test } from 'vitest';
import { processCheatCode } from './cheats';
import type { Command } from './commands';
import { ObjectState } from './entities';
import { master } from './masters';
import { HOUSE, TOWN_CENTER, VILLAGER } from './units';
import { STATUS_LOST, STATUS_PLAYING, VICTORY_SPECIAL } from './victory';
import { World, type StartUnit } from './world';

const FOOD = 0;
const WOOD = 1;
const STONE = 2;
const GOLD = 3;
const PRIEST = 125;

/** Player 1: a Town Center (id 1) and a Villager (2); player 2: a Villager (3). */
const UNITS: StartUnit[] = [
  { owner: 1, type: TOWN_CENTER, x: 20.5, y: 20.5 },
  { owner: 1, type: VILLAGER, x: 10.5, y: 10.5 },
  { owner: 2, type: VILLAGER, x: 40.5, y: 40.5 },
];

function world(cheating = true): World {
  return new World({ players: 3, units: UNITS, victory: { type: VICTORY_SPECIAL }, cheating });
}

/** Run until the commands have executed (2 turns later). */
function order(w: World, player: number, ...commands: Command[]): void {
  w.addBatch(w.turn, player, commands);
  for (let i = 0; i < 3; i++) w.runTurn();
}

function ofType(w: World, owner: number, type: number) {
  return [...w.entities.all()].filter((e) => e.owner === owner && e.type === type && e.state <= ObjectState.Active);
}

describe('chat.md §7.1: processCheatCode', () => {
  test('nothing unless the game allows cheats; whole-line codes in any case, substring codes anywhere, substrings first', () => {
    expect(processCheatCode('coinage', false, false)).toBeNull();
    expect(processCheatCode('coinage', true, false)).toEqual({ type: 'cheat', code: 21 });
    expect(processCheatCode('Photon Man', true, false)).toEqual({ type: 'cheat', code: 0 });
    expect(processCheatCode('coinage!', true, false)).toBeNull();
    expect(processCheatCode('hello', true, false)).toBeNull();
    expect(processCheatCode('that was POWerful', true, false)).toEqual({ type: 'cheat', code: 17 });
    expect(processCheatCode('king arthur', true, false)).toEqual({ type: 'cheat', code: 19 });
    expect(processCheatCode('steroids', true, false)).toEqual({ type: 'quick-build', on: true });
    expect(processCheatCode('STEROIDS', true, true)).toEqual({ type: 'quick-build', on: false });
    expect(processCheatCode('reveal map', true, false)).toEqual({ type: 'cheat', code: 230 });
    // Single-player only.
    expect(processCheatCode('home run', true, false)).toBeNull();
    expect(processCheatCode('diediedie', true, false)).toBeNull();
    expect(processCheatCode('kill2', true, false)).toBeNull();
  });
});

describe('chat.md §7.2: TRIBE_World::cheat', () => {
  test('PEPPERONI PIZZA, COINAGE, QUARRY, WOODSTOCK add 1000; nothing when the game does not allow cheats', () => {
    const off = world(false);
    const before = [...off.attributes[1]!.slice(0, 4)];
    order(off, 1, ...[20, 21, 22, 23].map((code): Command => ({ type: 'cheat', code })));
    expect(off.attributes[1]!.slice(0, 4)).toEqual(before);

    const w = world();
    const start = [...w.attributes[1]!.slice(0, 4)];
    order(w, 1, { type: 'cheat', code: 21 }, { type: 'cheat', code: 21 }, { type: 'cheat', code: 20 }, { type: 'cheat', code: 22 }, { type: 'cheat', code: 23 });
    const got = w.attributes[1]!;
    expect([got[FOOD]! - start[FOOD]!, got[WOOD]! - start[WOOD]!, got[STONE]! - start[STONE]!, got[GOLD]! - start[GOLD]!]).toEqual([1000, 1000, 1000, 2000]);
    expect(w.attributes[2]!.slice(0, 4)).toEqual(off.attributes[2]!.slice(0, 4));
  });

  test('PHOTON MAN and BIGDADDY are made at the Town Center, free, past the population limit; the queue empties unrefunded', () => {
    const w = world();
    w.attributes[1]![FOOD] = 50;
    order(w, 1, { type: 'queue', building: 1, unit: VILLAGER, count: 1 });
    expect(w.attributes[1]![FOOD]).toBe(0);
    // Training: the make command does nothing.
    order(w, 1, { type: 'cheat', code: 0 });
    expect(ofType(w, 1, 274)).toHaveLength(0);
    for (let i = 0; i < 40 && ofType(w, 1, VILLAGER).length < 2; i++) w.runTurn();
    expect(ofType(w, 1, VILLAGER)).toHaveLength(2);

    w.attributes[1]![FOOD] = 100;
    w.attributes[1]![4] = 0; // no headroom: the queue waits with no train
    order(w, 1, { type: 'queue', building: 1, unit: VILLAGER, count: 2 });
    expect(w.attributes[1]![FOOD]).toBe(0);
    const tc = w.entities.get(1)!;
    expect([tc.queue, tc.train]).toEqual([[{ unit: VILLAGER, count: 2 }], null]);
    order(w, 1, { type: 'cheat', code: 0 }, { type: 'cheat', code: 220 });
    expect(ofType(w, 1, 274)).toHaveLength(1);
    // The second make waited behind the first and was dropped (the building was making).
    expect(ofType(w, 1, 372)).toHaveLength(0);
    expect([tc.queue, tc.train, w.attributes[1]![FOOD]]).toEqual([[], null, 0]);
    order(w, 1, { type: 'cheat', code: 220 });
    expect(ofType(w, 1, 372)).toHaveLength(1);
  });

  test('MEDUSA upgrades the player\'s Villagers (effect 137); HOYOHOYO gives its Priests 600 hp (133); KING ARTHUR is Gaia\'s (217)', () => {
    const w = world();
    order(w, 1, { type: 'cheat', code: 12 }, { type: 'cheat', code: 8 }, { type: 'cheat', code: 19 });
    // `copy_obj`: master 83 becomes a copy of 298 under its own id.
    expect([master(w, 1, VILLAGER).name, master(w, 2, VILLAGER).name]).toEqual(['Hero_Medusa', master(world(), 2, VILLAGER).name]);
    expect([master(w, 0, 95).name, master(w, 0, 96).name, master(w, 1, 95).name]).toEqual(['Dragon', 'Dragon', master(world(), 1, 95).name]);
    expect([master(w, 1, PRIEST).hitPoints, master(w, 2, PRIEST).hitPoints]).toEqual([600, master(world(), 2, PRIEST).hitPoints]);
  });

  test('HARI KARI kills every object of the player; RESIGN loses without a resignation', () => {
    const w = world();
    order(w, 1, { type: 'cheat', code: 101 });
    expect([1, 2].map((id) => w.entities.get(id)?.state ?? ObjectState.Dead).every((s) => s >= ObjectState.Dying)).toBe(true);
    expect(w.entities.get(3)!.state).toBe(ObjectState.Active);

    const r = world();
    order(r, 2, { type: 'cheat', code: 103 });
    expect([r.playerStatus(1), r.playerStatus(2), r.victory.resigned[2]]).toEqual([STATUS_PLAYING, STATUS_LOST, false]);
    // `loss_if_game_on`: the status change's defeat notice, no resignation notice.
    expect(r.log.notifications.map((n) => [n.type, ...n.args])).toEqual([[6, 2, 0, 0, 0]]);
  });

  test('REVEAL MAP and NO FOG set the map\'s drawing flags; single-player codes do nothing', () => {
    const w = world();
    const before = w.hash();
    order(w, 1, { type: 'cheat', code: 100 }, { type: 'cheat', code: 102 }, { type: 'cheat', code: 202 });
    expect(w.entities.get(3)!.state).toBe(ObjectState.Active);
    expect(w.playerStatus(1)).toBe(STATUS_PLAYING);
    expect([w.cheats.mapVisible, w.cheats.mapFog]).toEqual([false, true]);
    order(w, 2, { type: 'cheat', code: 230 }, { type: 'cheat', code: 231 });
    expect([w.cheats.mapVisible, w.cheats.mapFog]).toEqual([true, false]);
    expect(w.hash()).not.toBe(before);
  });

  test('STEROIDS: a House is built and a Villager trained in one step each; off again, training takes its time', () => {
    const w = world();
    w.attributes[1]![FOOD] = 1000;
    w.attributes[1]![WOOD] = 1000;
    order(w, 1, { type: 'quick-build', on: true });
    expect(w.cheats.quickBuild).toBe(true);
    order(w, 1, { type: 'build', units: [2], unitType: HOUSE, x: 12, y: 12 });
    for (let i = 0; i < 10 && ofType(w, 1, HOUSE)[0]?.state !== ObjectState.Active; i++) w.runTurn();
    expect(ofType(w, 1, HOUSE)[0]!.state).toBe(ObjectState.Active);
    w.addBatch(w.turn, 1, [{ type: 'queue', building: 1, unit: VILLAGER, count: 1 }]);
    w.runTurn();
    w.runTurn();
    w.runStep();
    w.runStep();
    expect(ofType(w, 1, VILLAGER).length + ofType(w, 1, 118).length).toBe(2);

    order(w, 2, { type: 'quick-build', on: false });
    order(w, 1, { type: 'queue', building: 1, unit: VILLAGER, count: 1 });
    for (let i = 0; i < 5; i++) w.runTurn();
    expect(ofType(w, 1, VILLAGER).length + ofType(w, 1, 118).length).toBe(2);
  });

  test('the flags are in the hash and the snapshot, and the cheat replays to the same hashes', () => {
    const a = world();
    a.addBatch(a.turn, 1, [{ type: 'cheat', code: 0 }, { type: 'quick-build', on: true }]);
    const b = World.restore(JSON.parse(JSON.stringify(a.snapshot())));
    for (let i = 0; i < 6; i++) {
      a.runTurn();
      b.runTurn();
      expect(b.hash()).toBe(a.hash());
    }
    expect([b.cheats, ofType(b, 1, 274).length]).toEqual([{ allowed: true, quickBuild: true, mapVisible: false, mapFog: true }, 1]);
    expect(world(false).hash()).not.toBe(world(true).hash());
  });
});
