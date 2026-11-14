/**
 * Active sprites (docs/spec/sprites.md §2-4): the main sprite of an object and its animation state. Frame changes are
 * sim state because the attack action reads them (sprites.md §5). Every float store is rounded to float32.
 */
import { add32, div32, f32, mul32, sub32 } from './num';
import type { Entity } from './entities';
import type { CrtRand } from './rng';
import { unitType, type SpriteInfo } from './units';

/** `RGE_Active_Animated_Sprite` fields (sprites.md §3.2), for the object's main sprite. */
export interface ActiveSprite {
  graphic: number;
  frame: number;
  lastFrame: number;
  interval: number;
  last: number;
  changed: boolean;
  looped: boolean;
  /** `animate_flag`: 0 stopped, 1 running, 2 holding the loop pause. */
  flag: number;
}

const MIN_INTERVAL = f32(0.001);
/** `3.051851e-05f`, about 1/32767 (src/game_globals.cpp:208). */
const RANDOM_SCALE = f32(3.051851e-5);

/**
 * Make the active sprite of `s` (`RGE_Active_Animated_Sprite` ctor, sprites.md §4): one `rand()` for a random start
 * frame. A sprite without the animated bit never changes frame.
 */
export function makeActiveSprite(s: SpriteInfo, rng: CrtRand): ActiveSprite {
  const a: ActiveSprite = { graphic: s.graphic, frame: 0, lastFrame: 0, interval: 0, last: 0, changed: false, looped: false, flag: 1 };
  if ((s.flags & 1) === 0) return a;
  a.interval = s.duration < 0.001 ? MIN_INTERVAL : s.duration;
  if (s.flags & 4) {
    const total = add32(mul32(s.frames, s.duration), s.pause);
    const t = mul32(mul32(rng.rand(), total), RANDOM_SCALE);
    let frame = Math.trunc(div32(t, s.duration)) << 16 >> 16;
    if (frame >= s.frames) {
      frame = s.frames - 1;
      a.interval = sub32(t, mul32(frame, s.duration));
    }
    a.frame = frame;
    a.lastFrame = frame;
  }
  return a;
}

/** `RGE_Active_Animated_Sprite::update(dt, speed)` (sprites.md §3.2). */
export function advanceSprite(a: ActiveSprite, s: SpriteInfo, dt: number, speed: number): void {
  a.changed = false;
  a.looped = false;
  if ((s.flags & 1) === 0) return;
  if (a.flag !== 0) {
    if (a.frame > s.frames - 1) a.frame = s.frames - 1;
    a.last = add32(a.last, dt);
    if (a.last >= a.interval) {
      a.changed = true;
      a.lastFrame = a.frame;
      const count = Math.trunc(div32(a.last, a.interval)) << 16 >> 16;
      a.last = sub32(a.last, mul32(count, a.interval));
      if (speed > 0 || s.baseSpeed === 0) {
        a.frame = (a.frame + (count & 0xff)) << 16 >> 16;
        a.looped = a.frame >= s.frames;
      }
      a.interval = s.baseSpeed === 0 || speed === 0 ? s.duration : div32(mul32(s.duration, s.baseSpeed), speed);
      if (a.interval < 0.001) a.interval = MIN_INTERVAL;
      if (a.looped) {
        if (s.pause <= 0 || a.flag === 2) {
          a.flag = 1;
          while (a.frame >= s.frames) a.frame -= s.frames;
        } else {
          a.interval = sub32(s.pause, mul32(a.frame - s.frames, s.duration));
          a.frame = s.frames - 1;
          a.flag = 2;
          a.looped = false;
        }
      }
    }
  }
  if (a.looped && s.flags & 8) {
    a.flag = 0;
    a.frame = s.frames - 1;
  }
}

/** `frame_passed(f)` (sprites.md §3.3): the frame changed this update and crossed `f`, or the animation looped. */
export function framePassed(a: ActiveSprite, f: number): boolean {
  return a.changed && (a.looped || (a.lastFrame < f && f <= a.frame));
}

/** `is_animating`. */
export function isAnimating(a: ActiveSprite, s: SpriteInfo): boolean {
  return a.flag !== 0 && (s.flags & 1) !== 0;
}

/**
 * `new_sprite(s)` (`src/stat_obj.cpp:1653-1664`, sprites.md §2): null means the master's standing sprite. Nothing
 * happens when `s` is already the main sprite or the main sprite is the master's death sprite; otherwise a fresh
 * active sprite replaces it (one `rand()` for a random start frame).
 */
export function newSprite(e: Entity, s: SpriteInfo | null, rng: CrtRand): void {
  const t = unitType(e.type);
  const next = s ?? t.standing;
  if (e.sprite) {
    if (e.sprite.graphic === next.graphic) return;
    if (t.dying && e.sprite.graphic === t.dying.graphic) return;
  }
  e.sprite = makeActiveSprite(next, rng);
}
