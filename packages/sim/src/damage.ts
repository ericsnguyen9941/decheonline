/**
 * Damage sprites (`RGE_Static_Object::check_damage_sprites`, src/stat_obj.cpp:1242-1327; docs/spec/sprites.md §6): the
 * fire on a damaged building or boat, the broken look of a damaged wall. The object's sprite list keeps the overlays the
 * game screen draws over the object; adding one draws `rand()` (a random point, then the sprite's random start frame), so
 * they are sim state.
 */
import type { Entity, Overlay } from './entities';
import { div32, f32, mul32, toInt, u8 } from './num';
import { makeActiveSprite, newSprite, type SpriteContext } from './sprites';
import type { SpriteInfo, UnitType } from './units';

/** `g_damage_health_percent_scale` (src/game_globals.cpp:310). */
const HEALTH_PERCENT_SCALE = f32(100);

/**
 * `check_damage_sprites` for object `e` under master `t`: the damage, `100 - (long)(hp * 100 / master hp)` as a byte, picks
 * the last damage sprite whose percent is below it (none at 100 or more). When that entry changes, the new one's sprite
 * is added (flag 0; flag 1 first draws two `rand()` for a point within the master's radius, which only a still sprite
 * would be drawn at: every damage sprite in the dat is animated, `RGE_Active_Animated_Sprite::draw` ignores the offset)
 * or made the object's sprite (flag 2), and the old one's overlay removed, or its sprite-flag look undone.
 */
export function checkDamageSprites(ctx: SpriteContext, e: Entity, t: UnitType): void {
  if (t.hitPoints <= 0 || t.damageSprites.length === 0) return;
  const health = toInt(div32(mul32(e.hp, HEALTH_PERCENT_SCALE), t.hitPoints));
  const damage = u8(100 - health);
  const current = e.damagePercent ?? 0;
  if (damage === current) return;
  let to = -1;
  let from = -1;
  if (damage < 100) {
    t.damageSprites.forEach((d, i) => {
      if (d.percent < damage) to = i;
      if (d.percent < current) from = i;
    });
  }
  if (to !== from) {
    const add = t.damageSprites[to];
    if (add?.flag === 0 || add?.flag === 1) {
      if (add.flag === 1) {
        ctx.rng.rand();
        ctx.rng.rand();
      }
      addOverlay(ctx, e, add.sprite);
    } else if (add?.flag === 2) {
      newSprite(ctx, e, add.sprite ?? t.standing);
    }
    const remove = t.damageSprites[from];
    if (remove && remove.flag < 2) {
      removeOverlay(e, remove.sprite);
    } else if (remove?.flag === 2 && add?.flag !== 2) {
      newSprite(ctx, e, t.standing);
    }
  }
  e.damagePercent = damage;
}

/** `RGE_Active_Sprite_List::add_sprite(sprite, 0x5A, x, y)`, after the main sprite (0x3C): a sprite already listed counts once more, else a new active sprite. */
function addOverlay(ctx: SpriteContext, e: Entity, s: SpriteInfo | null): void {
  if (!s) return;
  const listed = e.overlays?.find((o) => o.graphic === s.graphic);
  if (listed) {
    listed.count = u8(listed.count + 1);
    return;
  }
  const overlay: Overlay = { graphic: s.graphic, count: 0, frame: makeActiveSprite(s, ctx.rng).frame };
  (e.overlays ??= []).push(overlay);
}

/** `remove_sprite`: one count less, or the overlay goes. */
function removeOverlay(e: Entity, s: SpriteInfo | null): void {
  if (!s || !e.overlays) return;
  const i = e.overlays.findIndex((o) => o.graphic === s.graphic);
  if (i < 0) return;
  const o = e.overlays[i]!;
  if (o.count > 0) o.count = u8(o.count - 1);
  else e.overlays.splice(i, 1);
  if (e.overlays.length === 0) delete e.overlays;
}
