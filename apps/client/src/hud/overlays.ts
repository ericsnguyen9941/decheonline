// The game clock and population (`TRIBE_Panel_Time` clock type 2, src/tpnl_tim.cpp; `TRIBE_Panel_Pop`,
// src/tpnl_pop.cpp; the original toggles them with `key_down_action`'s `VK_F11`, src/scr_game.cpp:1824-1833, the port
// always shows them) and F5's timings panel (`command_fps`, src/scr_game.cpp:3871-3886; `calc_timing_text`,
// src/tribegam.cpp:1622-1650). docs/spec/hud.md "F11 clock and population, F5 timings".
import { ATTR_HEADROOM, ATTR_POPULATION, ATTR_POPULATION_LIMIT, type World } from '@aoe/sim';
import type { AssetProvider } from '../assets';
import { FONT, placed, textColours } from './easy-panel';

/** `STRING_ID_POPULATION_PREFIX`: "pop: ". */
export const POPULATION_PREFIX = 0x2b2a;
/** The population panel's x in the main view by layout width (src/scr_game.cpp:790, :831, :871); 4 down, 160 x 20. */
export const POPULATION_X: Record<640 | 800 | 1024, number> = { 640: 240, 800: 320, 1024: 432 };
/** `color1`, `color3` (Windows COLORREF 0xFFFF, yellow while a queue waits for room) and `color2`, the shadow. */
const WHITE = '#ffffff';
const YELLOW = '#ffff00';
const BLACK = '#000000';
/** The four diagonal copies in colour 2 under the text in colour 1 (`render_to_image_buffer`). */
const OUTLINE = [[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([x, y]) => `${x}px ${y}px 0 ${BLACK}`).join(', ');

/** Clock format 1: `"%02ld:%02ld:%02ld (%3.1f)"` of `world_time / 1000` and the game speed. */
export function clockText(worldTimeMs: number, speed: number): string {
  let seconds = Math.trunc(worldTimeMs / 1000);
  let minutes = 0;
  let hours = 0;
  if (seconds > 59) {
    minutes = Math.trunc(seconds / 60);
    seconds -= minutes * 60;
    if (minutes > 59) {
      hours = Math.trunc(minutes / 60);
      minutes -= hours * 60;
    }
  }
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(hours)}:${two(minutes)}:${two(seconds)} (${speed.toFixed(1).padStart(3, ' ')})`;
}

/** `pop` and `max_pop` of `TRIBE_Panel_Pop::draw` (src/tpnl_pop.cpp:155-160): the population, its room capped by the limit. */
export function populationRoom(world: World, player: number): { pop: number; max: number } {
  const a = world.attributes[player]!;
  const pop = Math.trunc(a[ATTR_POPULATION]!);
  return { pop, max: Math.min(pop + Math.trunc(a[ATTR_HEADROOM]!), Math.trunc(a[ATTR_POPULATION_LIMIT]!)) };
}

/**
 * `queue_is_waiting_on_pop_counter[player] > 0`: one of the player's buildings has a queue waiting for population room,
 * at the limit or without headroom (`production_queue_need_attr`, src/t_b_obj.cpp:975-1000; `updateQueue` in the sim).
 */
export function waitingOnPopulation(world: World, player: number): boolean {
  const a = world.attributes[player]!;
  if (a[ATTR_POPULATION]! < a[ATTR_POPULATION_LIMIT]! && a[ATTR_HEADROOM]! > 0) return false;
  for (const e of world.entities.ofPlayer(player)) if (e.queue && e.queue.length > 0 && !e.train && !e.research) return true;
  return false;
}

/**
 * The population text's blink (`TRIBE_Panel_Pop::mode`): from 0 a waiting queue starts mode 1 (yellow); every game
 * second the mode steps, 2 (white) and back to 0, where it waits for the next check.
 */
export class PopulationBlink {
  mode = 0;
  private timer = 0;

  /** One draw: `waiting` the counter's test, `deltaSeconds` the world time since the last draw. */
  step(waiting: boolean, deltaSeconds: number): void {
    if (this.mode === 0 && waiting) {
      this.mode = 1;
      this.timer = 0;
    }
    if (this.mode > 0) {
      this.timer += deltaSeconds;
      if (this.timer > 1) {
        this.timer = 0;
        if (++this.mode > 2) this.mode = 0;
      }
    }
  }
}

/**
 * The overlay over the main view, always shown (F11 does not hide it): the game clock (120 x 20 at 4, 4, left-aligned)
 * and the population "pop: 5/10" (160 x 20, centred, at `POPULATION_X`), both in the standard font, white over black one
 * pixel off each diagonal.
 */
export class ClockOverlay {
  private readonly clock: HTMLDivElement;
  private readonly pop: HTMLDivElement;
  private readonly blink = new PopulationBlink();
  private lastTime: number;

  constructor(
    view: HTMLElement,
    private readonly world: World,
    private readonly player: number,
    private readonly provider: AssetProvider,
  ) {
    this.clock = placed(view, 'div', `aoe-text ${FONT.standard}`, 4, 4, 120, 20);
    this.clock.dataset.testid = 'game-clock';
    this.pop = placed(view, 'div', `aoe-text ${FONT.standard}`, POPULATION_X[1024], 4, 160, 20);
    this.pop.style.textAlign = 'center';
    this.pop.dataset.testid = 'population';
    for (const el of [this.clock, this.pop]) {
      Object.assign(el.style, { color: WHITE, textShadow: OUTLINE });
    }
    this.lastTime = world.worldTime;
    this.update();
  }

  /** The population panel's x for the HUD's layout width. */
  place(width: 640 | 800 | 1024): void {
    this.pop.style.left = `${POPULATION_X[width]}px`;
  }

  update(): void {
    const { world, player } = this;
    const delta = (world.worldTime - this.lastTime) / 1000;
    this.lastTime = world.worldTime;
    this.clock.textContent = clockText(world.worldTime, world.gameSpeed);
    this.blink.step(waitingOnPopulation(world, player), delta);
    const { pop, max } = populationRoom(world, player);
    this.pop.textContent = `${this.provider.string(POPULATION_PREFIX) ?? ''}${pop}/${max}`;
    this.pop.style.color = this.blink.mode === 1 ? YELLOW : WHITE;
  }
}

/**
 * F5's text (`timing_text2`): world updates and frames drawn in the last second, then the engine's profiler slots,
 * averaged per update (`avg`) or their peaks (`max`). The port has no such slots: each reads 0.
 */
export function timingText(updates: number, frames: number, max: boolean): string {
  if (updates === 0) return 'f?';
  return max ? `t${updates},f${frames},max(r(v0,m0,o0),s0,u0,c0,ls0,lg0,p0,o0)` : `t${updates},f${frames},avg(r(v0,m0,o0),s0,u0,c0,l0,p0,o0)`;
}

/**
 * F5's panel (`fps_panel`): at 2, 2, 280 x 16 on the top strip in place of the resource counts, Arial 10 on black.
 * F5 cycles off, averages (`do_show_timings`), peaks (`show_timing_max`), off.
 */
export class TimingsPanel {
  private readonly el: HTMLDivElement;
  /** 0 off, 1 averages, 2 peaks. */
  private mode = 0;
  private second = -1;
  private updates = 0;
  private frames = 0;
  private lastStep: number;

  constructor(
    strip: HTMLElement,
    private readonly world: World,
    private readonly resources: HTMLElement,
  ) {
    this.el = placed(strip, 'div', `aoe-text ${FONT.arial10}`, 2, 2, 280, 16);
    Object.assign(this.el.style, { background: BLACK, lineHeight: '16px' });
    textColours(this.el, [WHITE, BLACK]);
    this.el.dataset.testid = 'timings';
    this.el.hidden = true;
    this.lastStep = this.stepOf();
  }

  get state(): 'off' | 'avg' | 'max' {
    return this.mode === 0 ? 'off' : this.mode === 1 ? 'avg' : 'max';
  }

  /** `command_fps`. */
  toggle(): void {
    this.mode = (this.mode + 1) % 3;
    this.el.hidden = this.mode === 0;
    this.resources.hidden = this.mode !== 0;
    this.second = -1;
  }

  /** Once a frame: counts the frame and the sim steps run since the last; the text is redone each wall-clock second. */
  update(now = performance.now()): void {
    const step = this.stepOf();
    if (step !== this.lastStep) this.updates += 1;
    this.lastStep = step;
    this.frames += 1;
    const second = Math.floor(now / 1000);
    if (second === this.second) return;
    if (this.mode !== 0) this.el.textContent = timingText(this.updates, this.frames, this.mode === 2);
    this.second = second;
    this.updates = 0;
    this.frames = 0;
  }

  private stepOf(): number {
    return this.world.turn * 0x10000 + this.world.turnStep;
  }
}
