/**
 * Tech tree and effects (docs/spec/techs.md): per-player tech states, `check_for_new_tech` at player creation and
 * after every change, `do_tech` / `undo_tech`, and the effect engine. Research (the action, costs, progress) is not
 * ported, so `research_done` is always 0 and only zero-time techs complete on their own.
 */
import { add32, f32 } from './num';
import { EFFECTS, TECHS, UNIT_TYPES, type EffectCommand } from './units';

/** Tech states (`Tech_Player_Tree::state`, techs.md §2.3). */
export const TECH_DISABLED = -1;
export const TECH_LOCKED = 0;
export const TECH_AVAILABLE = 1;
export const TECH_RESEARCHING = 2;
export const TECH_DONE = 3;

/** `PLAYER_ATTRIBUTE_ALL_TECHNOLOGIES`. */
const ATTR_ALL_TECHNOLOGIES = 39;

/** A player's changes to a master object (masters are per player in the original). */
export interface MasterChange {
  /** `available`, set by effect type 2. */
  enabled?: boolean;
  /** `building_facet`, set by attribute code 17. */
  facet?: number;
}

/** The per-player state techs read and write. */
export interface TechPlayers {
  /** `[player][attribute]`, float32. */
  attributes: number[][];
  /** `[player][tech]`: state. */
  techs: number[][];
  /** `[player]`: changed masters by unit id. */
  masters: Record<number, MasterChange>[];
}

export function newTechStates(): number[] {
  return new Array<number>(TECHS.length).fill(TECH_LOCKED);
}

/** The player's `available` flag for master `id`. */
export function isEnabled(p: TechPlayers, player: number, id: number): boolean {
  return p.masters[player]![id]?.enabled ?? UNIT_TYPES.get(id)?.enabled ?? false;
}

/** The player's `building_facet` for master `id`. */
export function buildingFacet(p: TechPlayers, player: number, id: number): number {
  return p.masters[player]![id]?.facet ?? UNIT_TYPES.get(id)?.building?.facet ?? 0;
}

/**
 * `check_for_new_tech` (`src/tech.cpp:476-527`, techs.md §3.7): one ascending pass; a tech whose prerequisites are
 * met completes at once when its research time is not above `research_done` (0 here), else opens; completions
 * recurse.
 */
export function checkForNewTech(p: TechPlayers, player: number): void {
  const states = p.techs[player]!;
  let active = 0;
  for (let i = 0; i < TECHS.length; i++) {
    const state = states[i]!;
    if (state === TECH_LOCKED || state === TECH_AVAILABLE) {
      active++;
      const t = TECHS[i]!;
      let done = 0;
      for (const r of t.requires) if (r >= 0 && states[r] === TECH_DONE) done++;
      if (done >= t.required) {
        if (t.researchTime <= 0) {
          doTech(p, player, i);
          active--;
        } else if (states[i]! < TECH_AVAILABLE) states[i] = TECH_AVAILABLE;
      } else if (states[i]! > TECH_LOCKED) states[i] = TECH_LOCKED;
    } else if (state === TECH_RESEARCHING) active++;
  }
  const attributes = p.attributes[player]!;
  if (active === 0 && attributes[ATTR_ALL_TECHNOLOGIES] === 0) attributes[ATTR_ALL_TECHNOLOGIES] = 1;
}

/** `TRIBE_Player_Tech::do_tech` (`src/tech.cpp:267-282`): complete a tech not disabled or done, run its effect. */
export function doTech(p: TechPlayers, player: number, id: number): boolean {
  const states = p.techs[player]!;
  if (!(states[id]! < TECH_DONE && states[id]! > TECH_DISABLED)) return false;
  states[id] = TECH_DONE;
  const effect = TECHS[id]!.effect;
  if (effect >= 0) doEffect(p, player, effect);
  checkForNewTech(p, player);
  return true;
}

/** `undo_tech` (`src/tech.cpp:258-265`): back to locked; the effect is not reversed. */
export function undoTech(p: TechPlayers, player: number, id: number): void {
  const states = p.techs[player]!;
  if (states[id]! < TECH_AVAILABLE) return;
  states[id] = TECH_LOCKED;
  checkForNewTech(p, player);
}

/**
 * `TRIBE_Effects::do_effect` (techs.md §4.1): first every tech disable (type 102), then types 0-5 in list order.
 * Of the master attribute codes only 17 (building facet) is ported; the start techs and the techs of the sim's
 * buildings use no other.
 */
export function doEffect(p: TechPlayers, player: number, id: number): void {
  const commands = EFFECTS[id];
  if (!commands) return;
  const states = p.techs[player]!;
  for (const c of commands) {
    // `tech_abling(d, 0)`: every state but done becomes disabled (`src/tech.cpp:600-612`).
    if (c.type === 102 && states[Math.trunc(c.d)] !== TECH_DONE) states[Math.trunc(c.d)] = TECH_DISABLED;
  }
  for (const c of commands) {
    switch (c.type) {
      case 0:
      case 4:
      case 5:
        modifyMasters(p, player, c);
        break;
      case 1: {
        const attributes = p.attributes[player]!;
        if (c.a < 0 || c.a >= attributes.length) break;
        attributes[c.a] = c.b === 0 ? f32(c.d) : add32(c.d, attributes[c.a]!);
        break;
      }
      case 2:
        if (c.a >= 0) change(p, player, c.a).enabled = c.b !== 0;
        break;
    }
  }
}

function change(p: TechPlayers, player: number, id: number): MasterChange {
  const masters = p.masters[player]!;
  return (masters[id] ??= {});
}

/** Types 0/4/5 (set, add, multiply) on master `a`, or on every master of class `b` (techs.md §4.2-4.3). */
function modifyMasters(p: TechPlayers, player: number, c: EffectCommand): void {
  const ids = c.a >= 0 ? [c.a] : c.b >= 0 ? [...UNIT_TYPES.values()].filter((t) => t.group === c.b).map((t) => t.id).sort((x, y) => x - y) : [];
  for (const id of ids) {
    const t = UNIT_TYPES.get(id);
    if (!t || (c.c & 0xff) !== 17 || !t.building) continue;
    const facet = buildingFacet(p, player, id);
    const d = Math.trunc(c.d);
    if (c.type === 0) change(p, player, id).facet = d;
    else if (c.type === 4) change(p, player, id).facet = facet + d;
    // Multiply has no case for code 17 (`src/tm_b_obj.cpp:142-160`).
  }
}
