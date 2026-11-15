// All relics or all ruins held (docs/spec/victory.md §10, docs/spec/hud.md "Relic and ruin countdown"): the captured and
// lost notifications (`TRIBE_Game::notification`, src/tribegam.cpp:1990-2087) and the countdown clocks
// (`TRIBE_Screen_Game::reset_clocks`, src/scr_game.cpp:3176-3260; `TRIBE_Panel_Time`, src/tpnl_tim.cpp). The sim sends no
// events: the countdowns `artifactHeld` / `ruinHeld` going from -1 to a time is the notification `hold` sends on
// arming (src/tworld.cpp:1013, :1054), back to -1 the one on losing (:1031, :1072). Both only happen in a Standard game.
import { RELATION_ALLY, VICTORY_STANDARD, type World } from '@aoe/sim';
import type { AssetProvider } from '../assets';
import { FONT, placed } from './easy-panel';
import { colorref, COLOURS } from './score-display';

/** `STRING_ID_MESSAGE_ARTIFACTS_CAPTURED_SELF` / `_OTHER`, `_LOST`, and the ruins' (include/resource_ids.h:956-961). */
export const ARTIFACTS_CAPTURED_SELF = 0xbd4;
export const ARTIFACTS_CAPTURED_OTHER = 0xbd5;
export const ARTIFACTS_LOST = 0xbd6;
export const RUINS_CAPTURED_SELF = 0xbd9;
export const RUINS_CAPTURED_OTHER = 0xbda;
export const RUINS_LOST = 0xbdb;
/** `STRING_ID_ARTIFACTS_YEARS_FORMAT` "Artifacts: %d Years", `STRING_ID_RUINS_YEARS_FORMAT` (include/resource_ids.h:549-550). */
export const ARTIFACTS_YEARS = 0x2c26;
export const RUINS_YEARS = 0x2c27;
/** `TRIBE_Game::sounds`: artheld.wav, artlost.wav. */
export const SOUND_ART_HELD = 11;
export const SOUND_ART_LOST = 12;
/** `countdown_clock[10]`: 170 x 20 each, 4 from the main view's right, from 4 down in steps of 20 (src/scr_game.cpp:923-929). */
const CLOCKS = 10;

/** A notification: its string and game sound. */
export interface HeldNotice {
  text: number;
  sound: number;
}

/** Clock types 5 (relics) and 6 (ruins) of `TRIBE_Panel_Time`. */
export interface HeldClock {
  ruins: boolean;
  player: number;
}

/** `p1->relation(p2) == ally` and allied victory on, both ways: the test `notification` and `reset_clocks` make. */
function alliedTeam(world: World, p: number, q: number): boolean {
  const d = world.diplomacy;
  return !!d.alliedVictory[p] && !!d.alliedVictory[q] && world.relation(p, q) === RELATION_ALLY && world.relation(q, p) === RELATION_ALLY;
}

/**
 * The notifications from the countdowns `before` to `after` for player `player`'s screen. A team arms or loses together,
 * so the first player of a team that changes is the one `hold` names; a player whose lower teammate changed with it
 * adds nothing. Captured: "Hold them ... to win!" for the holder and its allied-victory allies, "You will lose ..." for
 * the others, with artheld.wav; lost: one text for everyone, with artlost.wav.
 */
export function heldNotices(world: World, player: number, before: readonly number[], after: readonly number[], ruins: boolean): HeldNotice[] {
  if (world.victory.type !== VICTORY_STANDARD) return [];
  const notices: HeldNotice[] = [];
  for (let p = 1; p < after.length; p++) {
    const captured = before[p] === -1 && after[p] !== -1;
    const lost = before[p] !== -1 && after[p] === -1;
    if (!captured && !lost) continue;
    let first = true;
    for (let q = 1; q < p; q++) {
      if ((before[q] === -1) === (before[p] === -1) && (after[q] === -1) === (after[p] === -1) && alliedTeam(world, p, q)) first = false;
    }
    if (!first) continue;
    if (lost) notices.push({ text: ruins ? RUINS_LOST : ARTIFACTS_LOST, sound: SOUND_ART_LOST });
    else {
      const self = p === player || alliedTeam(world, p, player);
      const text = ruins ? (self ? RUINS_CAPTURED_SELF : RUINS_CAPTURED_OTHER) : self ? ARTIFACTS_CAPTURED_SELF : ARTIFACTS_CAPTURED_OTHER;
      notices.push({ text, sound: SOUND_ART_HELD });
    }
  }
  return notices;
}

/**
 * `reset_clocks` in a Standard game: per player in order, a relic clock while its relic countdown runs and a ruin clock
 * while its ruin countdown runs, unless a lower player is its allied-victory ally (the team shows one clock). At most 10.
 * The Wonder clocks (type 4) are not ported.
 */
export function heldClocks(world: World): HeldClock[] {
  if (world.victory.type !== VICTORY_STANDARD) return [];
  const clocks: HeldClock[] = [];
  for (let p = 1; p < world.players; p++) {
    let shown = true;
    for (let q = 1; q < p; q++) if (alliedTeam(world, p, q)) shown = false;
    if (!shown) continue;
    if (world.victory.artifactHeld[p] !== -1) clocks.push({ ruins: false, player: p });
    if (world.victory.ruinHeld[p] !== -1) clocks.push({ ruins: true, player: p });
  }
  return clocks.slice(0, CLOCKS);
}

/** The years a clock shows: the countdown truncated, then rounded up to 5 (`clock_format` 2, src/tpnl_tim.cpp:182-185, 245). */
export function clockYears(held: number): number {
  return Math.trunc((Math.trunc(held) + 4) / 5) * 5;
}

export interface HeldDisplayOptions {
  /** The main view's box. */
  view: HTMLElement;
  provider: AssetProvider;
  world: World;
  player: number;
  /** `play_sound(index)`. */
  sound(index: number): void;
  /** `display_system_message`: a line on the chat lines. */
  message(text: string): void;
}

/** Watches the countdowns after each step: the notifications on the chat lines, and the clocks top right of the view. */
export class HeldDisplay {
  private readonly clocks: HTMLDivElement[];
  private artifacts: number[];
  private ruins: number[];
  private shown: HeldClock[] = [];

  constructor(private readonly o: HeldDisplayOptions) {
    // Every countdown starts at -1 (src/tplayer.cpp:206-207): one already running was armed before the screen was up.
    this.artifacts = o.world.victory.artifactHeld.map(() => -1);
    this.ruins = o.world.victory.ruinHeld.map(() => -1);
    this.clocks = Array.from({ length: CLOCKS }, (_, i) => {
      const el = placed(o.view, 'div', `aoe-text ${FONT.standard}`, 0, 4 + 20 * i, 170, 20);
      Object.assign(el.style, { left: '', right: '4px', textAlign: 'right', whiteSpace: 'nowrap' });
      el.dataset.testid = 'countdown-clock';
      el.hidden = true;
      return el;
    });
    this.resetClocks();
  }

  update(): void {
    const { world, player, provider } = this.o;
    const { artifactHeld, ruinHeld } = world.victory;
    const notices = [...heldNotices(world, player, this.artifacts, artifactHeld, false), ...heldNotices(world, player, this.ruins, ruinHeld, true)];
    this.artifacts = [...artifactHeld];
    this.ruins = [...ruinHeld];
    for (const n of notices) {
      this.o.sound(n.sound);
      this.o.message(provider.string(n.text) ?? '');
    }
    // `notification` ends with `reset_clocks`; the clocks read their countdown on every idle.
    if (notices.length > 0) this.resetClocks();
    this.shown.forEach((c, i) => {
      const held = (c.ruins ? ruinHeld : artifactHeld)[c.player]!;
      const format = provider.string(c.ruins ? RUINS_YEARS : ARTIFACTS_YEARS) ?? '%d';
      this.clocks[i]!.textContent = format.replace('%d', String(held === -1 ? 0 : clockYears(held)));
    });
  }

  /** The clocks' texts, top first (for the tests). */
  get texts(): string[] {
    return this.clocks.flatMap((el) => (el.hidden ? [] : [el.textContent ?? '']));
  }

  private resetClocks(): void {
    this.shown = heldClocks(this.o.world);
    this.clocks.forEach((el, i) => {
      const c = this.shown[i];
      el.hidden = !c;
      if (!c) return;
      // `set_clock_type`: the player's colour, drawn over its second colour one pixel off each diagonal.
      const [c1, c2] = COLOURS[c.player - 1] ?? [0xffffff, 0];
      const shadow = colorref(c2);
      el.style.color = colorref(c1);
      el.style.textShadow = [[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([x, y]) => `${x}px ${y}px 0 ${shadow}`).join(', ');
    });
  }
}
