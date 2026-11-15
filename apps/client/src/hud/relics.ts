// All relics or all ruins held (docs/spec/victory.md §10, docs/spec/hud.md "Relics and ruins") and the Wonder
// (victory.md §8, hud.md "Wonder"): their notifications (`TRIBE_Game::notification`, src/tribegam.cpp:1905-2087) and the
// countdown clocks (`TRIBE_Screen_Game::reset_clocks`, src/scr_game.cpp:3176-3260; `TRIBE_Panel_Time`, src/tpnl_tim.cpp).
// The sim sends no events: the countdowns `artifactHeld` / `ruinHeld` going from -1 to a time is the notification `hold`
// sends on arming (src/tworld.cpp:1013, :1054), back to -1 the one on losing (:1031, :1072), both only in a Standard
// game; a Wonder's action (`Entity.wonder`) appearing is "started", reaching state 6 "completed", going "destroyed"
// (src/tact_wnd.cpp:26-148).
import { RELATION_ALLY, VICTORY_STANDARD, WONDER_COUNTING, WONDER_WAITING, type World } from '@aoe/sim';
import type { AssetProvider } from '../assets';
import { FONT, placed } from './easy-panel';
import { formatName } from './game-over';
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
/** `STRING_ID_WONDER_YEARS_FORMAT` "Wonder: %d Years" (include/resource_ids.h:548). */
export const WONDER_YEARS = 0x2c25;
/** `STRING_ID_MESSAGE_WONDER_*` (include/resource_ids.h:947-971). */
export const WONDER_STARTED = 0xbcb;
export const WONDER_COMPLETED_SELF = 0xbcc;
export const WONDER_COMPLETED_OTHER_WIN = 0xbcd;
export const WONDER_COMPLETED_OTHER_LOSS = 0xbce;
export const WONDER_DESTROYED_SELF = 0xbcf;
export const WONDER_DESTROYED_OTHER = 0xbd0;
export const WONDER_COMPLETED = 0xbee;
export const WONDER_COMPLETED_OTHER = 0xbef;
export const WONDER_BUILDING_STARTED = 0xbf2;
/** `TRIBE_Game::sounds`: mstart.wav, mdone.wav, mkilled.wav, artheld.wav, artlost.wav. */
export const SOUND_WONDER_STARTED = 8;
export const SOUND_WONDER_COMPLETED = 9;
export const SOUND_WONDER_DESTROYED = 10;
export const SOUND_ART_HELD = 11;
export const SOUND_ART_LOST = 12;
/** `countdown_clock[10]`: 170 x 20 each, 4 from the main view's right, from 4 down in steps of 20 (src/scr_game.cpp:923-929). */
const CLOCKS = 10;

/** A notification: its string, the player named in it (`%s`), and game sound. */
export interface HeldNotice {
  text: number;
  sound: number;
  name?: number;
}

/** `TRIBE_Panel_Time`'s clock types: 4 a player's Wonder countdown, 5 its relics', 6 its ruins'. */
export const CLOCK_WONDER = 4;
export const CLOCK_ARTIFACTS = 5;
export const CLOCK_RUINS = 6;

export interface HeldClock {
  type: number;
  player: number;
}

/** A Wonder's action as the last frame saw it: its owner, state (2 or 6) and timer. */
export interface WonderSeen {
  owner: number;
  state: number;
  timer: number;
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

/** Every Wonder's action in the world now, by object id. */
export function wondersSeen(world: World): Map<number, WonderSeen> {
  const seen = new Map<number, WonderSeen>();
  for (const e of world.entities.all()) if (e.wonder) seen.set(e.id, { owner: e.owner, state: e.wonder.state, timer: e.wonder.timer });
  return seen;
}

/**
 * The Wonder notifications from `before` to `after` for player `player`'s screen, by object id. A new action (or one
 * whose timer went back: the old one was deleted and the default task started another) is "started": mstart.wav, 3058
 * "You have started building a Wonder!" for its owner, 3019 "%s started building a Wonder!" for the others. Reaching
 * state 6 is "completed": mdone.wav; for its owner 3020 "... You will win if it stands for 2000 years!", for an
 * allied-victory mutual ally 3021, for the others 3022 "... You will lose ..."; outside Standard 3054 / 3055 without
 * the second sentence. A deleted action is "destroyed", Standard only: mkilled.wav, 3023 for its owner, 3024 for the
 * others.
 */
export function wonderNotices(world: World, player: number, before: ReadonlyMap<number, WonderSeen>, after: ReadonlyMap<number, WonderSeen>): HeldNotice[] {
  const standard = world.victory.type === VICTORY_STANDARD;
  const notices: HeldNotice[] = [];
  const destroyed = (w: WonderSeen) => {
    if (!standard) return;
    notices.push(w.owner === player ? { text: WONDER_DESTROYED_SELF, sound: SOUND_WONDER_DESTROYED } : { text: WONDER_DESTROYED_OTHER, sound: SOUND_WONDER_DESTROYED, name: w.owner });
  };
  for (const [id, w] of before) if (!after.has(id)) destroyed(w);
  for (const [id, w] of after) {
    const old = before.get(id);
    const restarted = !!old && (w.timer < old.timer || (old.state === WONDER_COUNTING && w.state === WONDER_WAITING));
    if (old && restarted) destroyed(old);
    if (!old || restarted) {
      notices.push(w.owner === player ? { text: WONDER_BUILDING_STARTED, sound: SOUND_WONDER_STARTED } : { text: WONDER_STARTED, sound: SOUND_WONDER_STARTED, name: w.owner });
    }
    if (w.state === WONDER_COUNTING && (!old || restarted || old.state !== WONDER_COUNTING)) {
      let text: number;
      if (w.owner === player) text = standard ? WONDER_COMPLETED_SELF : WONDER_COMPLETED;
      else if (!standard) text = WONDER_COMPLETED_OTHER;
      else text = alliedTeam(world, w.owner, player) ? WONDER_COMPLETED_OTHER_WIN : WONDER_COMPLETED_OTHER_LOSS;
      notices.push({ text, sound: SOUND_WONDER_COMPLETED, ...(w.owner === player ? {} : { name: w.owner }) });
    }
  }
  return notices;
}

/**
 * `reset_clocks` in a Standard game: per player in order, a Wonder clock while its countdown is above 0, then a relic
 * clock while its relic countdown runs and a ruin clock while its ruin countdown runs, these two unless a lower player is
 * its allied-victory ally (the team shows one). At most 10.
 */
export function heldClocks(world: World): HeldClock[] {
  if (world.victory.type !== VICTORY_STANDARD) return [];
  const clocks: HeldClock[] = [];
  for (let p = 1; p < world.players; p++) {
    if (world.victory.wonderCountdown[p]! > 0) clocks.push({ type: CLOCK_WONDER, player: p });
    let shown = true;
    for (let q = 1; q < p; q++) if (alliedTeam(world, p, q)) shown = false;
    if (!shown) continue;
    if (world.victory.artifactHeld[p] !== -1) clocks.push({ type: CLOCK_ARTIFACTS, player: p });
    if (world.victory.ruinHeld[p] !== -1) clocks.push({ type: CLOCK_RUINS, player: p });
  }
  return clocks.slice(0, CLOCKS);
}

/** What clock `c` counts (`handle_idle`): the Wonder countdown, or the relic/ruin held time; 0 when there is none. */
export function clockTime(world: World, c: HeldClock): number {
  const v = world.victory;
  const time = c.type === CLOCK_WONDER ? v.wonderCountdown[c.player]! : (c.type === CLOCK_RUINS ? v.ruinHeld : v.artifactHeld)[c.player]!;
  return time === -1 ? 0 : time;
}

const CLOCK_FORMATS: Record<number, number> = { [CLOCK_WONDER]: WONDER_YEARS, [CLOCK_ARTIFACTS]: ARTIFACTS_YEARS, [CLOCK_RUINS]: RUINS_YEARS };

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
  /** Player names by player number, for `%s`. */
  names: readonly string[];
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
  private wonders = new Map<number, WonderSeen>();
  private shown: HeldClock[] = [];

  constructor(private readonly o: HeldDisplayOptions) {
    // Every countdown starts at -1 (src/tplayer.cpp:206-207): one already running was armed before the screen was up.
    this.artifacts = o.world.victory.artifactHeld.map(() => -1);
    this.ruins = o.world.victory.ruinHeld.map(() => -1);
    // No Wonder either: one made before the screen was up is told as started (and completed) on the first update.
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
    const wonders = wondersSeen(world);
    const wonderNews = wonderNotices(world, player, this.wonders, wonders);
    const notices = [...wonderNews, ...heldNotices(world, player, this.artifacts, artifactHeld, false), ...heldNotices(world, player, this.ruins, ruinHeld, true)];
    this.artifacts = [...artifactHeld];
    this.ruins = [...ruinHeld];
    this.wonders = wonders;
    for (const n of notices) {
      this.o.sound(n.sound);
      this.o.message(n.name === undefined ? (provider.string(n.text) ?? '') : formatName(provider, n.text, this.o.names[n.name] ?? ''));
    }
    // `notification` ends with `reset_clocks`, but for "wonder started"; the clocks read their countdown on every idle.
    if (notices.some((n) => n.sound !== SOUND_WONDER_STARTED)) this.resetClocks();
    this.shown.forEach((c, i) => {
      const format = provider.string(CLOCK_FORMATS[c.type]!) ?? '%d';
      this.clocks[i]!.textContent = format.replace('%d', String(clockYears(clockTime(world, c))));
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
