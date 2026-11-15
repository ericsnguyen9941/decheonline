import { expect, test } from 'vitest';
import { MARKET, RELATION_ALLY, RELATION_NEUTRAL, startingObjects, World } from '@aoe/sim';
import type { AssetProvider } from '../assets';
import { diplomacyNotices } from './diplomacy';

// What language.dll says for the notifications (STRING_ID_MESSAGE_TRIBUTE_*, STRING_ID_MESSAGE_DIPLOMACY_*).
const STRINGS: Record<number, string> = {
  3009: '%s paid %d gold in tribute to you.',
  3016: '%s paid %d food in tribute to you.',
  3025: '%s changed diplomatic stance with you to Neutral.',
  3026: '%s changed diplomatic stance with you to Ally.',
};
const provider = { string: (id: number) => STRINGS[id] ?? null } as AssetProvider;
const names = ['', 'Alice', 'Bob'];

function world(market: boolean): World {
  const w = new World({ players: 3, units: startingObjects(3) });
  if (market) w.createUnit({ owner: 1, type: MARKET, x: 5, y: 5 });
  return w;
}

test('the receiver hears of a stance towards it and of a tribute with the amount received', () => {
  const w = world(true);
  w.attributes[1]![0] = 100;
  const batches = [{ player: 1, commands: [{ type: 'relation' as const, player: 2, relation: RELATION_ALLY }, { type: 'tribute' as const, player: 2, resource: 0, amount: 500 }] }];
  // 100 food with a 25% fee: the whole stock goes, the fee's share (25) is lost, 75 reach the receiver (diplomacy.md §5).
  expect(diplomacyNotices(w, 2, batches, provider, names)).toEqual([
    { text: 'Alice changed diplomatic stance with you to Ally.', tribute: false },
    { text: 'Alice paid 75 food in tribute to you.', tribute: true },
  ]);
  // The sender hears of neither (`val2 == curr_player`).
  expect(diplomacyNotices(w, 1, batches, provider, names)).toEqual([]);
  // The replay leaves the world alone.
  expect(w.attributes[1]![0]).toBe(100);
});

test('tributes run in order over the same stock, and none without a Market', () => {
  const w = world(true);
  w.attributes[1]![3] = 250;
  const tribute = (amount: number) => ({ type: 'tribute' as const, player: 2, resource: 3, amount });
  expect(diplomacyNotices(w, 2, [{ player: 1, commands: [tribute(100), tribute(100)] }], provider, names).map((n) => n.text)).toEqual([
    'Alice paid 100 gold in tribute to you.',
    'Alice paid 100 gold in tribute to you.',
  ]);
  expect(diplomacyNotices(w, 2, [{ player: 1, commands: [tribute(100), tribute(100), tribute(100)] }], provider, names).at(-1)!.text).toBe('Alice paid 0 gold in tribute to you.');
  expect(diplomacyNotices(world(false), 2, [{ player: 1, commands: [tribute(100)] }], provider, names)).toEqual([]);
});

test('the commands run by sender player: a resign earlier in the turn stops a later stance towards that player', () => {
  const resign = { type: 'resign' as const };
  const neutral = (player: number) => ({ type: 'relation' as const, player, relation: RELATION_NEUTRAL });
  // Player 1's batch runs before player 2's resign: Bob still hears of it.
  expect(diplomacyNotices(world(true), 2, [{ player: 2, commands: [resign] }, { player: 1, commands: [neutral(2)] }], provider, names).map((n) => n.text)).toEqual([
    'Alice changed diplomatic stance with you to Neutral.',
  ]);
  // Three players: 1 resigns before 2's stance towards it runs.
  const three = new World({ players: 4, units: startingObjects(4) });
  expect(diplomacyNotices(three, 1, [{ player: 2, commands: [neutral(1)] }, { player: 1, commands: [resign] }], provider, names)).toEqual([]);
});
