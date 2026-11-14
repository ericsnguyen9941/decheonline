/**
 * Tech tree and effects (docs/spec/techs.md): per-player tech states and research progress, `check_for_new_tech` at
 * player creation and after every change, `do_tech` / `undo_tech`, research costs (`check_tech_cost`, `start_research`,
 * `cancel_research`, `research`), and the effect engine on the player's own masters (§4). The building's research
 * action is in `research.ts`.
 */
import { ObjectState, type Entity } from './entities';
import { copyUnitType, EFFECTS, TECHS, type EffectCommand, type UnitType } from './units';
import { add32, div32, f32, i16, mul32, sub32, toInt, u8 } from './num';
import type { PlayerMasters } from './masters';
import type { CrtRand } from './rng';
import { newSprite } from './sprites';
import { exploreObject, unexploreObject, type VisibilityContext } from './visibility';

/** Tech states (`Tech_Player_Tree::state`, techs.md §2.3). */
export const TECH_DISABLED = -1;
export const TECH_LOCKED = 0;
export const TECH_AVAILABLE = 1;
export const TECH_RESEARCHING = 2;
export const TECH_DONE = 3;

/** The Tool, Bronze and Iron Age techs. */
export const TOOL_AGE = 101;
export const BRONZE_AGE = 102;
export const IRON_AGE = 103;

/** `PLAYER_ATTRIBUTE_ALL_TECHNOLOGIES`. */
const ATTR_ALL_TECHNOLOGIES = 39;
const ATTR_GOLD = 3;
const ATTR_GOLD_REPLACEMENT = 29;
const ATTR_HEADROOM = 4;
const ATTR_POPULATION = 11;
const ATTR_TOTAL_UNITS = 19;

/** The per-player state techs read and write. */
export interface TechPlayers extends PlayerMasters {
  /** `[player][attribute]`, float32. */
  attributes: number[][];
  /** `[player][tech]`: state. */
  techs: number[][];
  /** `[player][tech]`: `research_done`, float32. */
  researchDone: number[][];
}

/** What an effect needs beyond the players' state: the objects it changes, and the RNG their new sprites draw from. */
export interface TechContext extends TechPlayers, VisibilityContext {
  rng: CrtRand;
  /** The player's object list in update order (`RGE_Player::objects`). */
  objectsOf(owner: number): Entity[];
  /** Told before an effect changes the player's masters (the world caches their hash). */
  mastersChanged?(player: number): void;
}

export function newTechStates(): number[] {
  return new Array<number>(TECHS.length).fill(TECH_LOCKED);
}

export function newResearchDone(): number[] {
  return new Array<number>(TECHS.length).fill(0);
}

/** The player's `available` flag for master `id`; false when the player has no such master. */
export function isEnabled(p: PlayerMasters, player: number, id: number): boolean {
  return p.masters[player]?.[id]?.enabled ?? false;
}

/** The player's `building_facet` for master `id`. */
export function buildingFacet(p: PlayerMasters, player: number, id: number): number {
  return p.masters[player]?.[id]?.building?.facet ?? 0;
}

/**
 * `check_for_new_tech` (`src/tech.cpp:476-527`, techs.md §3.7): one ascending pass; a tech whose prerequisites are
 * met completes at once when its research time is not above its `research_done`, else opens; completions recurse.
 */
export function checkForNewTech(ctx: TechContext, player: number): void {
  const states = ctx.techs[player]!;
  const done = ctx.researchDone[player]!;
  let active = 0;
  for (let i = 0; i < TECHS.length; i++) {
    const state = states[i]!;
    if (state === TECH_LOCKED || state === TECH_AVAILABLE) {
      active++;
      const t = TECHS[i]!;
      let met = 0;
      for (const r of t.requires) if (r >= 0 && states[r] === TECH_DONE) met++;
      if (met >= t.required) {
        if (t.researchTime <= done[i]!) {
          doTech(ctx, player, i);
          active--;
        } else if (states[i]! < TECH_AVAILABLE) states[i] = TECH_AVAILABLE;
      } else if (states[i]! > TECH_LOCKED) states[i] = TECH_LOCKED;
    } else if (state === TECH_RESEARCHING) active++;
  }
  const attributes = ctx.attributes[player]!;
  if (active === 0 && attributes[ATTR_ALL_TECHNOLOGIES] === 0) attributes[ATTR_ALL_TECHNOLOGIES] = 1;
}

/** `TRIBE_Player_Tech::do_tech` (`src/tech.cpp:267-282`): complete a tech not disabled or done, run its effect. */
export function doTech(ctx: TechContext, player: number, id: number): boolean {
  const states = ctx.techs[player]!;
  if (!(states[id]! < TECH_DONE && states[id]! > TECH_DISABLED)) return false;
  states[id] = TECH_DONE;
  const effect = TECHS[id]!.effect;
  if (effect >= 0) doEffect(ctx, player, effect);
  checkForNewTech(ctx, player);
  return true;
}

/** `undo_tech` (`src/tech.cpp:258-265`): back to locked; the effect is not reversed. */
export function undoTech(ctx: TechContext, player: number, id: number): void {
  const states = ctx.techs[player]!;
  if (states[id]! < TECH_AVAILABLE) return;
  states[id] = TECH_LOCKED;
  checkForNewTech(ctx, player);
}

/**
 * `check_tech_cost` (`src/tech.cpp:374-421`, techs.md §3.2): only an available tech passes; every used cost slot must
 * be covered, a shortfall by gold when attribute 29 (gold replacement) is at least 1.
 */
export function checkTechCost(p: TechPlayers, player: number, id: number): boolean {
  if (p.techs[player]![id] !== TECH_AVAILABLE) return false;
  const attributes = p.attributes[player]!;
  const replace = attributes[ATTR_GOLD_REPLACEMENT]! >= 1;
  let carry = replace ? attributes[ATTR_GOLD]! : 0;
  for (const c of TECHS[id]!.costs) {
    if (c.flag === 0) continue;
    const cost = f32(c.amount);
    if (replace && c.type === ATTR_GOLD) {
      carry = sub32(carry, cost);
      if (carry < 0) return false;
    }
    if (attributes[c.type]! < cost) {
      if (add32(carry, attributes[c.type]!) < cost) return false;
      carry = sub32(carry, sub32(cost, attributes[c.type]!));
    }
  }
  return true;
}

/** `start_research` (`src/tech.cpp:423-453`, techs.md §3.3): check, pay every used slot (a shortfall from gold), state 2. */
export function startResearch(p: TechPlayers, player: number, id: number): boolean {
  if (!checkTechCost(p, player, id)) return false;
  const attributes = p.attributes[player]!;
  for (const c of TECHS[id]!.costs) {
    if (c.flag === 0) continue;
    const cost = f32(c.amount);
    if (attributes[c.type]! < cost) {
      attributes[ATTR_GOLD] = sub32(attributes[ATTR_GOLD]!, sub32(cost, attributes[c.type]!));
      attributes[c.type] = 0;
    } else attributes[c.type] = sub32(attributes[c.type]!, cost);
  }
  p.techs[player]![id] = TECH_RESEARCHING;
  return true;
}

/** `cancel_research` (`src/tech.cpp:455-475`, techs.md §3.6): a researching tech is available again, progress lost. */
export function cancelResearch(p: TechPlayers, player: number, id: number, refund: boolean): void {
  if (p.techs[player]![id] !== TECH_RESEARCHING) return;
  const attributes = p.attributes[player]!;
  if (refund) for (const c of TECHS[id]!.costs) if (c.flag !== 0) attributes[c.type] = add32(attributes[c.type]!, c.amount);
  p.techs[player]![id] = TECH_AVAILABLE;
  p.researchDone[player]![id] = 0;
}

/**
 * `TRIBE_Player_Tech::research` (`src/tech.cpp:284-294`, techs.md §3.4): add `work` to a researching tech; done once
 * the sum is not below its research time. False when the tech is done (or not researching).
 */
export function research(ctx: TechContext, player: number, id: number, work: number): boolean {
  if (ctx.techs[player]![id] !== TECH_RESEARCHING) return false;
  const done = ctx.researchDone[player]!;
  done[id] = add32(done[id]!, work);
  if (!(done[id]! < TECHS[id]!.researchTime)) {
    doTech(ctx, player, id);
    return false;
  }
  return true;
}

/** `tech_abling(id, 0)` → `disable` (`src/tech.cpp:600-612`): every state but done becomes disabled; id < 0 is every tech. */
function disableTech(states: number[], id: number): void {
  const ids = id < 0 ? states.keys() : id < states.length ? [id] : [];
  for (const i of ids) if (states[i] !== TECH_DONE) states[i] = TECH_DISABLED;
}

/**
 * `TRIBE_Effects::do_effect` (techs.md §4.1): first every tech disable (type 102), then types 0-5 in list order on the
 * player's own masters and objects.
 */
export function doEffect(ctx: TechContext, player: number, id: number): void {
  const commands = EFFECTS[id];
  if (!commands) return;
  const states = ctx.techs[player]!;
  ctx.mastersChanged?.(player);
  for (const c of commands) if (c.type === 102) disableTech(states, toInt(c.d));
  const masters = ctx.masters[player]!;
  for (const c of commands) {
    switch (c.type) {
      case 0:
      case 4:
      case 5:
        modifyTobj(ctx, player, c);
        break;
      case 1: {
        const attributes = ctx.attributes[player]!;
        if (c.a < 0 || c.a >= attributes.length) break;
        attributes[c.a] = c.b === 0 ? f32(c.d) : add32(c.d, attributes[c.a]!);
        break;
      }
      case 2: {
        // `make_available`: only a master the player has.
        const t = c.a >= 0 ? masters[c.a] : undefined;
        if (t) t.enabled = c.b !== 0;
        break;
      }
      case 3:
        copyObj(ctx, player, c.a, c.b);
        break;
    }
  }
}

/**
 * `modify_tobj{,_delta,_percent}` (`src/player.cpp:1122-1231`, techs.md §4.2): master `a`, or every master of class `b`
 * in id order; for each, its objects (list order, still seeing the old master) and then the master itself.
 */
function modifyTobj(ctx: TechContext, player: number, c: EffectCommand): void {
  const masters = ctx.masters[player]!;
  const ids = c.a >= 0 ? (masters[c.a] ? [c.a] : []) : c.b >= 0 ? Object.values(masters).filter((t) => t.group === c.b).map((t) => t.id) : [];
  ids.sort((x, y) => x - y);
  const code = u8(c.c);
  for (const id of ids) {
    const t = masters[id]!;
    for (const e of ctx.objectsOf(player)) if (e.type === id) modifyObject(ctx, e, t, c.type, code, c.d);
    modifyMaster(t, c.type, code, c.d);
  }
}

/**
 * Instance side (techs.md §4.4): hit points keep their ratio to the old master's (truncated to an integer); a set
 * facet (code 17) turns a building; code 101 moves the owner's headroom, population and unit count. Line of sight
 * (code 1) re-explores an active object with the new radius (`modify`, `modify_delta`, `modify_percent` flag 1,
 * src/stat_obj.cpp:1728-1774, visibility.md §3.5).
 */
function modifyObject(ctx: TechContext, e: Entity, old: UnitType, type: number, code: number, d: number): void {
  if (code === 1) {
    if (e.state !== ObjectState.Active) return;
    unexploreObject(ctx, e, old, false);
    exploreObject(ctx, e, old, false, toInt(type === 0 ? d : type === 4 ? add32(old.los, d) : mul32(old.los, d)));
  } else if (code === 0) {
    const max = old.hitPoints;
    if (type === 0) e.hp = f32(i16(toInt(div32(mul32(d, e.hp), max))));
    else if (type === 4) e.hp = f32(i16(toInt(div32(mul32(add32(d, max), e.hp), max))));
    else e.hp = f32(i16(toInt(mul32(d, e.hp))));
  } else if (type === 0 && code === 17 && old.masterType === 80) e.facet = u8(toInt(d));
  else if (type === 0 && code === 101 && old.masterType >= 70) {
    const attributes = ctx.attributes[e.owner]!;
    for (const s of old.storages) {
      if (s.type === ATTR_HEADROOM) attributes[ATTR_HEADROOM] = add32(sub32(attributes[ATTR_HEADROOM]!, s.amount), d);
      if (s.type === ATTR_POPULATION) attributes[ATTR_POPULATION] = sub32(sub32(attributes[ATTR_POPULATION]!, s.amount), d);
      if (s.type === ATTR_TOTAL_UNITS) attributes[ATTR_TOTAL_UNITS] = sub32(sub32(attributes[ATTR_TOTAL_UNITS]!, s.amount), d);
    }
  }
}

/** Set (type 0), add (4) or multiply (5) a float field. */
function float(type: number, v: number, d: number): number {
  return type === 0 ? f32(d) : type === 4 ? add32(d, v) : mul32(d, v);
}

/** The same on a `short` field: set and add truncate `d`, multiply truncates the product. */
function short(type: number, v: number, d: number): number {
  return type === 0 ? i16(toInt(d)) : type === 4 ? i16(v + i16(toInt(d))) : i16(toInt(mul32(v, d)));
}

/**
 * Master attribute codes (techs.md §4.3), each handled by the master class that has the field: static (0 hp, 1 line of
 * sight, 3/4 radius, 14 carry capacity), animated (5 speed), moving (6 turn speed), action (13 work rate), combat (8
 * armour, 9 attack, 10 reload, 11 accuracy, 12 range, 15 base armour, 16 projectile), missile (19 targetting), unit and
 * building (100/101 costs), building (17 facet). Codes 2 (`obj_max`) and 18 (`defense_terrain_bonus`) change fields the
 * sim does not read; anything else is ignored.
 */
function modifyMaster(t: UnitType, type: number, code: number, d: number): void {
  const combat = t.masterType >= 50 ? t.combat : null;
  switch (code) {
    case 0:
      t.hitPoints = short(type, t.hitPoints, d);
      return;
    case 1:
      t.los = float(type, t.los, d);
      return;
    case 3:
      t.radiusX = float(type, t.radiusX, d);
      return;
    case 4:
      t.radiusY = float(type, t.radiusY, d);
      return;
    case 14:
      t.resourceCapacity = short(type, t.resourceCapacity, d);
      return;
    case 5:
      if (t.masterType >= 20) t.speed = float(type, t.speed, d);
      return;
    case 6:
      if (t.masterType >= 30) t.turnSpeed = float(type, t.turnSpeed, d);
      return;
    case 13:
      if (t.masterType >= 40 && t.action) t.action.workRate = float(type, t.action.workRate, d);
      return;
    case 8:
    case 9: {
      if (!combat || type === 5) return;
      const entries = code === 8 ? combat.armours : combat.attacks;
      const n = toInt(d);
      const group = (n >> 8) & 0xff;
      const value = i16(n & 0xff);
      // Set uses the class as an array index; add matches the first entry of that class (techs.md §4.3).
      if (type === 0) {
        if (group < entries.length) entries[group]!.amount = value;
      } else {
        const entry = entries.find((w) => w.group === group);
        if (entry) entry.amount = i16(entry.amount + value);
      }
      return;
    }
    case 10:
      if (combat) combat.reloadTime = float(type, combat.reloadTime, d);
      return;
    case 11:
      if (combat) combat.accuracy = short(type, combat.accuracy, d);
      return;
    case 12:
      if (combat) combat.range = float(type, combat.range, d);
      return;
    case 15:
      // Multiply reads `missile_id` (`src/m_co_obj.cpp:471-473`).
      if (combat) combat.baseArmour = u8(type === 0 ? toInt(d) : type === 4 ? combat.baseArmour + u8(toInt(d)) : toInt(mul32(combat.projectileUnitId, d)));
      return;
    case 16:
      if (combat) combat.projectileUnitId = type === 0 ? i16(u8(toInt(d))) : short(type, combat.projectileUnitId, d);
      return;
    case 19:
      if (t.masterType === 60 && t.missile) t.missile.targetting = u8(toInt(d));
      return;
    case 17:
      if (t.masterType === 80 && t.building && type !== 5) t.building.facet = short(type, t.building.facet, d);
      return;
    case 100:
      if (t.masterType >= 70 && t.creatable) for (const c of t.creatable.costs) if (c.flag !== 0) c.amount = short(type, c.amount, d);
      return;
    case 101:
      if (t.masterType >= 70 && t.creatable && type === 0) {
        for (const c of t.creatable.costs) if (c.flag === 0) c.amount = i16(toInt(-d));
        for (const s of t.storages) {
          if (s.type === ATTR_HEADROOM) s.amount = f32(d);
          if (s.type === ATTR_POPULATION || s.type === ATTR_TOTAL_UNITS) s.amount = f32(-d);
        }
      }
      return;
  }
}

/**
 * Type 3, `RGE_Player::copy_obj(dest, source)` (`src/player.cpp:1233-1249`, techs.md §4.5): when the player has both
 * masters, each object of `dest` takes the source's matching sprite and keeps its hit-point ratio, then master `dest`
 * becomes a copy of `source` that keeps its own id and `available` flag.
 */
function copyObj(ctx: TechContext, player: number, dest: number, source: number): void {
  const masters = ctx.masters[player]!;
  const old = masters[dest];
  const src = masters[source];
  if (!old || !src) return;
  for (const e of ctx.objectsOf(player)) if (e.type === dest) copyObject(ctx, e, old, src);
  masters[dest] = { ...copyUnitType(src), id: dest, enabled: old.enabled };
}

/**
 * The object side of an upgrade, layer by layer as the original calls them (building, combat, moving, static): a
 * sprite that is the old master's construction, fight, walking, standing or dying sprite becomes the source's.
 * `check_damage_sprites` is not ported (the sim has no damage sprites). The static layer re-explores an active object
 * with the source's line of sight (src/stat_obj.cpp:1808-1812).
 */
function copyObject(ctx: TechContext, e: Entity, old: UnitType, src: UnitType): void {
  const shows = (s: { graphic: number } | null | undefined) => !!s && e.sprite?.graphic === s.graphic;
  const swap = (from: { graphic: number } | null | undefined, to: UnitType['standing'] | null | undefined) => {
    if (shows(from) && to) newSprite(ctx, e, to);
  };
  if (old.masterType === 80) swap(old.building?.construction, src.building?.construction);
  if (old.masterType >= 50) swap(old.combat?.attackSprite, src.combat?.attackSprite);
  if (old.masterType >= 30) swap(old.walking, src.walking);
  if (e.state === ObjectState.Active) {
    unexploreObject(ctx, e, old, false);
    exploreObject(ctx, e, old, false, toInt(src.los));
  }
  const ratio = div32(e.hp, old.hitPoints);
  const next = shows(old.standing) ? src.standing : shows(old.dying) ? src.dying : null;
  e.hp = mul32(src.hitPoints, ratio);
  if (next) newSprite(ctx, e, next);
}
