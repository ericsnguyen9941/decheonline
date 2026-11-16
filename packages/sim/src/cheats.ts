/**
 * Cheat codes (chat.md §7, read from the 1.0a exe): `processCheatCode`, the text typed in chat turned into a command,
 * and `TRIBE_World::cheat`, what the command does on every peer when the game allows cheats.
 */

import { payObjCost, emptyQueue } from './buildings';
import type { CheatCommand, QuickBuildCommand } from './commands';
import type { GameContext } from './context';
import { ObjectState } from './entities';
import { hasMaster } from './masters';
import { add32, f32 } from './num';
import { martyrdom } from './priest';
import { doEffect } from './techs';
import { TOWN_CENTER } from './units';
import { lossIfGameOn } from './victory';

/** The game-wide flags the cheats set; hashed and in the snapshot. */
export interface CheatState {
  /** `allowCheatCodes()`: the lobby's Enable Cheating. */
  allowed: boolean;
  /** `rge_base_game->quick_build` (STEROIDS). */
  quickBuild: boolean;
  /** The map's `map_visible_flag` (REVEAL MAP): drawn as all explored. */
  mapVisible: boolean;
  /** The map's `fog_flag` (NO FOG clears it): fog drawn. */
  mapFog: boolean;
}

export function newCheatState(allowed: boolean): CheatState {
  return { allowed, quickBuild: false, mapVisible: false, mapFog: true };
}

/** Whole-line codes (`strcmp` on the uppercased text). */
const EXACT: Readonly<Record<string, number>> = {
  'PHOTON MAN': 0,
  'E=MC2 TROOPER': 1,
  'JACK BE NIMBLE': 2,
  'BIG BERTHA': 3,
  'FLYING DUTCHMAN': 4,
  UPSIDFLINTMOBILE: 7,
  HOYOHOYO: 8,
  'DARK RAIN': 10,
  'BLACK RIDER': 11,
  MEDUSA: 12,
  ICBM: 13,
  'PEPPERONI PIZZA': 20,
  COINAGE: 21,
  QUARRY: 22,
  WOODSTOCK: 23,
  'HARI KARI': 101,
  RESIGN: 103,
  BIGDADDY: 220,
  'REVEAL MAP': 230,
  'NO FOG': 231,
};

/** Substring codes (`strstr`), tried first in this order. */
const SUBSTRING: readonly [string, number][] = [
  ['STORMBILLY', 14],
  ['CONVERT THIS!', 15],
  ['BIG MOMMA', 16],
  ['POW', 17],
  ['GRANTLINKSPENCE', 18],
  ['KING ARTHUR', 19],
];

/**
 * `TRIBE_Game::processCheatCode` in a multiplayer game (chat.md §7.1): the command a chat line sends instead of being
 * sent as chat, or null when it is no cheat or the game does not allow cheats. `quickBuild` is the current flag, which
 * STEROIDS toggles.
 */
export function processCheatCode(text: string, allowed: boolean, quickBuild: boolean): CheatCommand | QuickBuildCommand | null {
  if (!allowed) return null;
  const upper = text.toUpperCase();
  for (const [s, code] of SUBSTRING) if (upper.includes(s)) return { type: 'cheat', code };
  if (upper === 'STEROIDS') return { type: 'quick-build', on: !quickBuild };
  const code = EXACT[upper];
  return code === undefined ? null : { type: 'cheat', code };
}

/** Codes 0, 1, 14-17, 220: the unit made at the player's Town Center. */
const MAKE_UNITS: Readonly<Record<number, number>> = { 0: 274, 1: 248, 14: 386, 15: 394, 16: 397, 17: 398, 220: 372 };
/** Codes 20-23: the attribute given 1000. */
const RESOURCE_CODES: Readonly<Record<number, number>> = { 20: 0, 21: 3, 22: 2, 23: 1 };

/**
 * `TRIBE_World::cheat` (chat.md §7.2) for the codes a multiplayer chat can send; 100, 102 and 200-209 (single-player
 * only) and unknown codes do nothing.
 */
export function cheat(ctx: GameContext, state: CheatState, player: number, code: number): void {
  if (!state.allowed) return;
  const unit = MAKE_UNITS[code];
  if (unit !== undefined) {
    if (player > 0) makeAtTownCenter(ctx, player, unit);
    return;
  }
  if (code >= 2 && code <= 13) return doEffect(ctx, code === 5 ? 0 : player, 125 + code);
  if (code === 18 || code === 19) return doEffect(ctx, 0, code === 18 ? 216 : 217);
  const resource = RESOURCE_CODES[code];
  if (resource !== undefined) {
    const a = ctx.attributes[player]!;
    a[resource] = add32(a[resource]!, f32(1000));
    return;
  }
  switch (code) {
    case 101:
      // HARI KARI: `die_die_die` on each of the player's objects, a priest's martyrdom first (support-actions.md §4.5).
      for (const e of ctx.entities.all()) {
        if (e.owner !== player || e.state >= ObjectState.Dying) continue;
        martyrdom(ctx, e);
        ctx.wake(e);
        e.hp = 0;
      }
      return;
    case 103:
      return lossIfGameOn(ctx.victory, player);
    case 230:
      state.mapVisible = true;
      return;
    case 231:
      state.mapFog = false;
      return;
  }
}

/**
 * `command_make` at the player's first finished Town Center, then `do_command_make` (`tcommand.cpp:104-125`): nothing
 * while it trains or researches; else a make action that is not pre-paid replaces the queue's, paid now, and the queue
 * empties without a refund.
 */
function makeAtTownCenter(ctx: GameContext, player: number, unit: number): void {
  let tc = null;
  for (const e of ctx.entities.all()) {
    if (e.owner === player && e.type === TOWN_CENTER && e.state === ObjectState.Active && (!tc || e.id < tc.id)) tc = e;
  }
  if (!tc || tc.train || tc.research || !hasMaster(ctx, player, unit)) return;
  emptyQueue(tc);
  if (!payObjCost(ctx, player, unit, 1, false)) return;
  tc.train = { unit, workDone: 0, state: 6, make: true };
  ctx.wake(tc);
}
