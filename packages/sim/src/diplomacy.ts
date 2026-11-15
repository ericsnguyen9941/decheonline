/**
 * Diplomacy and tribute (docs/spec/diplomacy.md): each player's stance towards every other (`RGE_Player::relations`),
 * its allied-victory flag and allied line of sight (Writing), the mutual-ally visibility masks they make, and the
 * tribute command. Plain data, so the world hashes and snapshots it as it is. No RNG.
 */
import type { Entity } from './entities';
import { ObjectState } from './entities';
import { add32, f32, mul32, sub32 } from './num';
import { MARKET } from './units';
import type { Visibility } from './visibility';

/** `RGE_RELATION_*` (include/player.h:14-16): the values a stance takes. */
export const RELATION_ALLY = 0;
export const RELATION_NEUTRAL = 1;
export const RELATION_ENEMY = 3;

/** `UNIT_DIPLOMACY_*` (include/player.h:19-23): the buckets of the unit AI's visible-unit search. */
export const UNIT_DIPLOMACY_GAIA = 0;
export const UNIT_DIPLOMACY_SELF = 1;
export const UNIT_DIPLOMACY_ALLY = 2;
export const UNIT_DIPLOMACY_NEUTRAL = 3;
export const UNIT_DIPLOMACY_ENEMY = 4;

/** `PLAYER_ATTRIBUTE_TRIBUTE_FEE` (46): the share of a tribute the sender pays on top; 0.25 at start, Coinage sets 0. */
export const ATTR_TRIBUTE_FEE = 46;
/** `PLAYER_ATTRIBUTE_ALLIED_LOS` (50): Writing adds 1, which turns allied line of sight on. */
export const ATTR_ALLIED_LOS = 50;
/** `PLAYER_ATTRIBUTE_TRIBUTE_SENT` (53): tribute sent with its fee, less tribute received (score entry 9). */
export const ATTR_TRIBUTE_SENT = 53;
/** The resources a tribute may send: food, wood, stone, gold (src/dlg_dip.cpp:457-482). */
export const TRIBUTE_RESOURCES: readonly number[] = [0, 1, 2, 3];

export interface DiplomacyState {
  /** `relations[p][q]`: player p's stance towards q (`RELATION_*`), one-sided. */
  relations: number[][];
  /** `allied_victory` per player. */
  alliedVictory: boolean[];
  /** `allied_LOS_Enable` per player: it sees what its mutual allies see. */
  alliedLos: boolean[];
}

/**
 * The stances at game start: `RGE_Player`'s constructor sets every entry to NEUTRAL (src/player.cpp:126-136), then
 * `TRIBE_Player`'s sets every other player from 1 up to ENEMY (src/tplayer.cpp:252-260). A lobby game has no teams,
 * so `new_game`'s team alliances (src/world.cpp:1013-1029) never apply. Allied victory and allied LOS start off.
 */
export function newDiplomacy(players: number): DiplomacyState {
  return {
    relations: Array.from({ length: players }, (_, p) => Array.from({ length: players }, (_, q) => (q >= 1 && q !== p ? RELATION_ENEMY : RELATION_NEUTRAL))),
    alliedVictory: new Array<boolean>(players).fill(false),
    alliedLos: new Array<boolean>(players).fill(false),
  };
}

export function copyDiplomacy(d: DiplomacyState): DiplomacyState {
  return { relations: d.relations.map((r) => [...r]), alliedVictory: [...d.alliedVictory], alliedLos: [...d.alliedLos] };
}

/** What diplomacy reads in a context; without it (bare test contexts) every other player is an enemy. */
export interface DiplomacyContext {
  diplomacy?: DiplomacyState;
}

function relationOf(ctx: DiplomacyContext, p: number, q: number): number {
  return ctx.diplomacy?.relations[p]?.[q] ?? (q >= 1 && q !== p ? RELATION_ENEMY : RELATION_NEUTRAL);
}

/** `RGE_Player::relation` (src/player.cpp:1259). */
export function relation(ctx: DiplomacyContext, p: number, q: number): number {
  return relationOf(ctx, p, q);
}

/** `RGE_Player::isAlly` (src/player.cpp:296-304): itself, or a player 1 and up p calls an ally (one-sided). */
export function isAlly(ctx: DiplomacyContext, p: number, q: number): boolean {
  if (p === q) return true;
  return q > 0 && relationOf(ctx, p, q) === RELATION_ALLY;
}

/** `RGE_Player::isEnemy` (src/player.cpp:288-294): another player 1 and up p calls an enemy. */
export function isEnemy(ctx: DiplomacyContext, p: number, q: number): boolean {
  return q !== p && q > 0 && relationOf(ctx, p, q) === RELATION_ENEMY;
}

/** Both call each other allies (`relations[p][q] == ALLY && relations[q][p] == ALLY`). */
export function mutualAllies(ctx: DiplomacyContext, p: number, q: number): boolean {
  return relationOf(ctx, p, q) === RELATION_ALLY && relationOf(ctx, q, p) === RELATION_ALLY;
}

/**
 * `RGE_Player::unitDiplomacy[owner]` of player `p` (`set_relation`, src/player.cpp:1263-1276): the bucket p's unit AI
 * files another object under. Gaia's own objects stay in the Gaia bucket for a Gaia searcher, as the port had it.
 */
export function unitDiplomacy(ctx: DiplomacyContext, p: number, owner: number): number {
  if (owner === 0) return UNIT_DIPLOMACY_GAIA;
  if (owner === p) return UNIT_DIPLOMACY_SELF;
  const r = relationOf(ctx, p, owner);
  return r === RELATION_ALLY ? UNIT_DIPLOMACY_ALLY : r === RELATION_NEUTRAL ? UNIT_DIPLOMACY_NEUTRAL : UNIT_DIPLOMACY_ENEMY;
}

/**
 * `RGE_Game_World::update_mutual_allies` (src/world.cpp:3214-3260): each player's visible and explored masks hold its own
 * bits, plus those of every player j it is mutually allied with while its own allied LOS is on. The non-mutual masks
 * (`nonMutualVisibleMask`, `RemoveVisibleBits`) only steer the drawing of fogged buildings and are not kept.
 */
export function updateMutualAllies(d: DiplomacyState, v: Visibility): void {
  const n = d.relations.length;
  for (let i = 0; i < n; i++) {
    let visible = 1 << i;
    let explored = 1 << (i + 16);
    if (i >= 1 && d.alliedLos[i]) {
      for (let j = 1; j < n; j++) {
        if (j !== i && d.relations[i]![j] === RELATION_ALLY && d.relations[j]![i] === RELATION_ALLY) {
          visible |= 1 << j;
          explored |= 1 << (j + 16);
        }
      }
    }
    v.setMutual(i, visible, explored);
  }
}

/** What the tribute command reads and changes. */
export interface TributeContext {
  attributes: number[][];
  /** The sender's objects, to look for its Market. */
  objectsOf(player: number): Iterable<Entity>;
}

/**
 * `TRIBE_Command::do_command_give_attribute` (src/tcommand.cpp:453-486): `from` sends `amount` of resource `resource` to
 * `to` and pays the fee (`amount * fee`) on top; with too little in stock, all of it goes, the fee's share of it to
 * nobody and the rest to `to`. Attribute 53 counts what the sender paid and loses what the receiver got. The fee is the
 * sender's attribute 46 when the command runs (the original carries the value the sender's dialog read, src/dlg_dip.cpp:
 * 457-482). Returns the amount `to` received, or -1 when the command is refused: the sender has no active Market
 * (master 0x54; the dialog's condition, src/dlg_dip.cpp:302-320).
 */
export function giveAttribute(ctx: TributeContext, from: number, to: number, resource: number, amount: number): number {
  let market = false;
  for (const e of ctx.objectsOf(from)) {
    if (e.type === MARKET && e.state === ObjectState.Active) {
      market = true;
      break;
    }
  }
  if (!market) return -1;
  const fee = f32(ctx.attributes[from]![ATTR_TRIBUTE_FEE] ?? 0);
  let tribute = amount >= 0 ? f32(amount) : 0;
  let cost = 0;
  if (tribute > 0) cost = mul32(fee, tribute);
  const stock = ctx.attributes[from]![resource]!;
  if (add32(tribute, cost) > stock) {
    cost = mul32(stock, fee);
    tribute = sub32(stock, cost);
  }
  const sender = ctx.attributes[from]!;
  const receiver = ctx.attributes[to]!;
  receiver[resource] = add32(tribute, receiver[resource]!);
  const paid = add32(tribute, cost);
  sender[resource] = add32(-paid, sender[resource]!);
  sender[ATTR_TRIBUTE_SENT] = add32(paid, sender[ATTR_TRIBUTE_SENT] ?? 0);
  receiver[ATTR_TRIBUTE_SENT] = add32(-tribute, receiver[ATTR_TRIBUTE_SENT] ?? 0);
  return tribute;
}
