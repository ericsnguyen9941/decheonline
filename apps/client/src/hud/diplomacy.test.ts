import { expect, test } from 'vitest';
import { MARKET, RELATION_ALLY, startingObjects, TOWN_CENTER, VILLAGER, World, type Command } from '@aoe/sim';
import type { AssetProvider } from '../assets';
import { diplomacyNotices } from './diplomacy';

// What language.dll says for the notifications (STRING_ID_MESSAGE_TRIBUTE_*, STRING_ID_MESSAGE_DIPLOMACY_*).
const STRINGS: Record<number, string> = {
  3009: '%s paid %d gold in tribute to you.',
  3016: '%s paid %d food in tribute to you.',
  3026: '%s changed diplomatic stance with you to Ally.',
};
const provider = { string: (id: number) => STRINGS[id] ?? null } as AssetProvider;
const names = ['', 'Alice', 'Bob'];

function world(market: boolean): World {
  const w = new World({ players: 3, units: startingObjects(3) });
  if (market) w.createUnit({ owner: 1, type: MARKET, x: 5, y: 5 });
  return w;
}

/** Player `player`'s commands, run until they have executed (2 turns later) and one more turn. */
function order(w: World, player: number, commands: Command[]): void {
  w.addBatch(w.turn, player, commands);
  for (let i = 0; i < 3; i++) w.runTurn();
}

test('the receiver hears of a stance towards it and of a tribute with the amount the sim logged', () => {
  const w = world(true);
  w.attributes[1]![0] = 100;
  order(w, 1, [{ type: 'relation', player: 2, relation: RELATION_ALLY }, { type: 'tribute', player: 2, resource: 0, amount: 500 }]);
  // 100 food with a 25% fee: the whole stock goes, the fee's share (25) is lost, 75 reach the receiver (diplomacy.md §5).
  expect(diplomacyNotices(w, 2, 0, provider, names)).toEqual([
    { text: 'Alice changed diplomatic stance with you to Ally.', tribute: false },
    { text: 'Alice paid 75 food in tribute to you.', tribute: true },
  ]);
  // The sender hears of neither (`val2 == curr_player`); entries already read are not told again.
  expect(diplomacyNotices(w, 1, 0, provider, names)).toEqual([]);
  expect(diplomacyNotices(w, 2, w.log.notifications.length, provider, names)).toEqual([]);
});

test('the amount is what was left when the tribute ran: a train paid earlier in the same turn is counted', () => {
  const w = world(true);
  w.attributes[1]![0] = 125;
  const tc = [...w.entities.ofPlayer(1)].find((e) => e.type === TOWN_CENTER)!;
  // The Villager (50 food) is paid first, then 100 food are offered of the 75 left: 75 go, 56 reach Bob (fee 25%).
  order(w, 1, [{ type: 'queue', building: tc.id, unit: VILLAGER, count: 1 }, { type: 'tribute', player: 2, resource: 0, amount: 100 }]);
  expect(diplomacyNotices(w, 2, 0, provider, names).map((n) => n.text)).toEqual(['Alice paid 56 food in tribute to you.']);
});

test('tributes run in order over the same stock, and none without a Market', () => {
  const w = world(true);
  w.attributes[1]![3] = 250;
  const tribute = (amount: number): Command => ({ type: 'tribute', player: 2, resource: 3, amount });
  order(w, 1, [tribute(100), tribute(100), tribute(100)]);
  expect(diplomacyNotices(w, 2, 0, provider, names).map((n) => n.text)).toEqual([
    'Alice paid 100 gold in tribute to you.',
    'Alice paid 100 gold in tribute to you.',
    'Alice paid 0 gold in tribute to you.',
  ]);
  const none = world(false);
  order(none, 1, [tribute(100)]);
  expect(diplomacyNotices(none, 2, 0, provider, names)).toEqual([]);
});
