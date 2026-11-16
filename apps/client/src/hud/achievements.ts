// The achievements screen (`TribeAchievementsScreen`, src/scr_ach.cpp): the score summary of every player and, on a
// click on one of the first four columns, that group's details. Laid out for 640 x 480 and stretched to the screen
// size (`set_ideal_size`), on the background for that size; fonts keep their size. At the end of the game it has the
// won (`scr7`) or the other (`scr8`) look and Close leaves the game; from the menu it has the in-game look (`scr10`) and
// Close goes back to the game. Timeline shows the population history (mode 6, hud/timeline.ts); the X at the top right
// asks to quit and leaves the game.
import type { World } from '@aoe/sim';
import type { AssetProvider } from '../assets';
import { easyButton, FONT, lookOf, placed, textColours, type PanelLook } from './easy-panel';
import { paintFrame } from './frame-image';
import { hudLayout } from './layout';
import { CONFIRM_QUIT, confirmPopup, Modal } from './menu';
import { civilizationName } from './text';
import { TIMELINE_STRINGS, TimelinePanel } from './timeline';

/** `scr7`, `scr8`, `scr10` (`BINARY_RESOURCE_ID_ACHIEVEMENTS_*_LAYOUT`). */
const LAYOUT_WON = 50057;
const LAYOUT_OTHER = 50058;
const LAYOUT_IN_GAME = 50061;
/** `viccheck.shp`, `defcheck.shp`: the mark before each winner's name. */
const DECAL_WON = 52001;
const DECAL_OTHER = 52002;

const S = {
  title: 0x269e,
  instruction: 0x26db,
  timeline: 0x26d8,
  close: 0x269c,
  back: 0x26da,
  summary: 0x26d9,
  military: 0x26ac,
  economy: 0x26ad,
  religion: 0x26ae,
  technology: 0x26af,
  survival: 0x26d6,
  wonder: 0x26d7,
  totalSummary: 0x26b1,
  total: 0x26b5,
  kills: 0x26b6,
  razings: 0x26b7,
  killsLosses: 0x26b8,
  losses: 0x26b9,
  largestArmy: 0x26ba,
  gold: 0x26be,
  villagerHigh: 0x26bf,
  villagerBonus: 0x26c0,
  exploration: 0x26c1,
  mostExplored: 0x26c2,
  tribute: 0x26c3,
  conversions: 0x26c6,
  mostConversions: 0x26c7,
  ruins: 0x26c8,
  artifacts: 0x26c9,
  temples: 0x26ca,
  technologies: 0x26ce,
  bronzeFirst: 0x26cf,
  ironFirst: 0x26d0,
  mostTechnologies: 0x26d1,
  allArtifactsRuins: 0x26dc,
  yes: 4003,
  /** `STRING_ID_BUTTON_CLOSE`: the X. */
  x: 0x3ea,
} as const;

/** `PLAYER_ATTRIBUTE_TOTAL_UNITS_OWNED`, `_POPULATION`: losses are units ever owned less those alive. */
const ATTR_TOTAL_UNITS = 19;
const ATTR_POPULATION = 11;

/** `title_bar[0..6]` (x, y, w, h) and alignment (scr_ach.cpp:136-145). */
const TITLE_BARS: [number, number, number, number, 'left' | 'center' | 'right'][] = [
  [98, 151, 200, 30, 'left'],
  [152, 131, 200, 30, 'left'],
  [212, 111, 145, 30, 'left'],
  [260, 91, 200, 30, 'center'],
  [364, 111, 145, 30, 'right'],
  [370, 131, 200, 30, 'right'],
  [424, 151, 200, 30, 'right'],
];
/** The statistic columns' x (51 wide), the rows from y 171, 30 apart (29 high). */
const COLUMNS = [178, 231, 283, 336, 389, 442, 494];
const ROW_Y = 171;
const ROW_STEP = 30;
/** `achievement_choice[0..4]`: a click in 0-3 opens modes 1-4, but not where 3 overlaps 4. */
const CHOICES: [number, number, number, number][] = [
  [100, 151, 130, 250],
  [154, 131, 128, 274],
  [214, 111, 121, 289],
  [282, 91, 156, 309],
  [388, 111, 121, 289],
];

/** `set_mode`'s timeline mode. */
const MODE_TIMELINE = 6;
/** `create_timeline(this, ..., 10, 85, 620, 330, 11, 9, 640, 480)` (scr_ach.cpp:124). */
const TIMELINE_RECT = [10, 85, 620, 330] as const;
/** The X: `PositionRightTop`, 4 from the top and the right, 17 x 17 at any size (scr_ach.cpp:130-134). */
const X_MARGIN = 4;
const X_SIZE = 17;

/** The names' and statistics' colour by colour table (scr_ach.cpp:171-200), a Windows COLORREF (0x00BBGGRR). */
const COLOURS = [0xc40000, 0xc8, 0xeaea, 0x215a8c, 0x80ff, 0x8000, 0x808080, 0x808040];

const colorref = (c: number) => `rgb(${c & 0xff}, ${(c >> 8) & 0xff}, ${(c >> 16) & 0xff})`;

export interface AchievementsOptions {
  parent: HTMLElement;
  provider: AssetProvider;
  world: World;
  /** This client's player. */
  player: number;
  /** Player names by player number (0 Gaia). */
  names: readonly string[];
  /** The end of the game's screen (`end_game_flag`), or the in-game one. */
  end: boolean;
  click(): void;
  /** Close: leave the game at the end, else back to it. */
  onClose(): void;
  /** The X's quit confirmed (`rge_base_game->close()`): leave the game. */
  onQuit(): void;
}

interface Mode {
  summary: number;
  titles: number[];
  values(p: number): string[];
}

export class AchievementsScreen {
  private readonly modal: Modal;
  private readonly look: PanelLook;
  private readonly scale: { x: number; y: number };
  private readonly summary: HTMLDivElement;
  private readonly instruction: HTMLDivElement;
  private readonly titles: HTMLDivElement[];
  private readonly stats: HTMLDivElement[][];
  private readonly buttons: { summary: HTMLButtonElement[]; detail: HTMLButtonElement[] };
  private readonly names: HTMLElement[] = [];
  private readonly timeline: TimelinePanel;
  /** The X's yes/no popup while it is open. */
  private confirm: Modal | null = null;
  private mode = 0;

  constructor(private readonly o: AchievementsOptions) {
    const { provider, world, player } = o;
    const won = world.playerStatus(player) === 1;
    const id = o.end ? (won ? LAYOUT_WON : LAYOUT_OTHER) : LAYOUT_IN_GAME;
    const size = hudLayout(window.innerWidth, window.innerHeight).width;
    const w = size;
    const h = (size * 3) / 4;
    this.scale = { x: w / 640, y: h / 480 };
    this.look = lookOf(provider, id, size);
    this.modal = new Modal(o.parent, w, h, 'achievements', () => {
      // The X's popup takes Esc (its No).
      if (this.confirm?.cover.isConnected) return;
      if (this.mode === 0) this.close();
      else this.setMode(0);
    });
    this.modal.cover.style.background = '#000';
    const panel = this.modal.panel;
    panel.style.backgroundColor = this.look.backgroundColour;
    if (this.look.background) paintFrame(panel, this.look.background);

    const text = (r: [number, number, number, number], font: string, align: 'left' | 'center' | 'right', value: string, colour: string | [string, string] = this.look.text) => {
      const el = this.box(r, `aoe-text ${font}`);
      Object.assign(el.style, { display: 'flex', alignItems: 'flex-start', justifyContent: align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start' });
      el.textContent = value;
      textColours(el, typeof colour === 'string' ? [colour, '#000'] : colour);
      return el;
    };
    const string = (id: number) => provider.string(id) ?? '';
    // `world_time / 1000` as hh:mm:ss, right aligned.
    const seconds = Math.trunc(world.worldTime / 1000);
    const two = (n: number) => String(n).padStart(2, '0');
    text([480, 10, 110, 20], FONT.standard, 'right', `${two(Math.trunc(seconds / 3600))}:${two(Math.trunc(seconds / 60) % 60)}:${two(seconds % 60)}`).dataset.testid = 'achievements-time';
    text([0, 5, 640, 30], FONT.copper21, 'center', string(S.title));
    this.summary = text([10, 35, 620, 30], FONT.copper21, 'center', '');
    this.summary.dataset.testid = 'achievements-summary';
    this.instruction = text([10, 410, 620, 20], FONT.standard, 'center', string(S.instruction));
    this.titles = TITLE_BARS.map(([x, y, bw, bh, align]) => text([x, y, bw, bh], FONT.standard, align, ''));

    this.stats = [];
    for (let p = 1; p < world.players; p++) {
      const y = ROW_Y + (p - 1) * ROW_STEP;
      const colour = colorref(COLOURS[p - 1] ?? 0xffffff);
      const name = text([22, y, 150, 29], FONT.standard, 'left', o.names[p] ?? '', colour);
      name.style.alignItems = 'center';
      name.dataset.testid = `achievements-name-${p}`;
      this.names.push(name);
      if (world.playerStatus(p) === 1) {
        // The win mark at the name's x less 20 (`draw`), at its own pixels.
        const decal = provider.interfaceFrame(won ? DECAL_WON : DECAL_OTHER, 0);
        if (decal) {
          const mark = placed(panel, 'div', 'aoe-text', 22 * this.scale.x - 20 - decal.hotspotX, y * this.scale.y - decal.hotspotY, decal.w, decal.h);
          mark.dataset.testid = `achievements-winner-${p}`;
          paintFrame(mark, decal);
          this.names.push(mark);
        }
      }
      this.stats.push(
        COLUMNS.map((x, column) => {
          const el = text([x, y, 51, 29], FONT.standard, 'center', '', colour);
          el.style.alignItems = 'center';
          el.dataset.testid = `achievements-${p}-${column}`;
          return el;
        }),
      );
    }

    const button = (r: [number, number, number, number], label: number, testid: string, run: (() => void) | null) => {
      const b = easyButton(panel, this.look, this.rect(r), string(label), FONT.copper12, run, o.click);
      b.dataset.testid = testid;
      return b;
    };
    this.buttons = {
      summary: [button([100, 441, 200, 30], S.timeline, 'achievements-timeline', () => this.setMode(MODE_TIMELINE)), button([340, 441, 200, 30], S.close, 'achievements-close', () => this.close())],
      detail: [button([200, 441, 240, 30], S.back, 'achievements-back', () => this.setMode(0))],
    };
    // The timeline, made with the screen (`init_timeline` counts the entries then), shown in mode 6.
    const [tx, ty, tw, th] = TIMELINE_RECT;
    const history = world.log.history.slice(1, world.players);
    this.timeline = new TimelinePanel(
      panel,
      Math.trunc((w * tx) / 640),
      Math.trunc((h * ty) / 480),
      {
        width: Math.trunc((w * tw) / 640),
        height: Math.trunc((h * th) / 480),
        history,
        colours: history.map((_, i) => colorref(COLOURS[i] ?? 0xffffff)),
        names: history.map((_, i) => `${o.names[i + 1] ?? ''} - ${civilizationName(provider, world.civs[i + 1] ?? 0)}`),
        strings: { population: string(TIMELINE_STRINGS.population), time: string(TIMELINE_STRINGS.time), ages: [string(TIMELINE_STRINGS.ages[0]), string(TIMELINE_STRINGS.ages[1]), string(TIMELINE_STRINGS.ages[2])] },
      },
      this.look.bevels,
    );
    // The X (`STRING_ID_BUTTON_CLOSE`, font -1: Arial 10 normal alt; no sound) in every mode.
    const x = easyButton(panel, this.look, { x: w - X_MARGIN - X_SIZE, y: X_MARGIN, w: X_SIZE, h: X_SIZE }, string(S.x), FONT.arial10, () => this.askQuit());
    x.dataset.testid = 'achievements-x';
    panel.addEventListener('pointerdown', (e) => {
      if (this.mode !== 0 || e.button !== 0) return;
      const r = panel.getBoundingClientRect();
      const x = (e.clientX - r.left) / this.scale.x;
      const y = (e.clientY - r.top) / this.scale.y;
      const inside = ([cx, cy, cw, ch]: [number, number, number, number]) => x >= cx && x < cx + cw && y >= cy && y < cy + ch;
      const choice = CHOICES.slice(0, 4).findIndex(inside);
      if (choice < 0 || (choice === 3 && inside(CHOICES[4]!))) return;
      this.setMode(choice + 1);
    });
    this.setMode(0);
  }

  close(): void {
    this.modal.close();
    this.o.onClose();
  }

  /** The X (`action` of `close_button`, `wnd_proc`'s WM_CLOSE): "Are you sure you want to quit this game?"; Yes quits. */
  private askQuit(): void {
    if (this.confirm?.cover.isConnected) return;
    this.confirm = confirmPopup(
      this.o.parent,
      this.o.provider,
      CONFIRM_QUIT,
      () => {
        this.modal.close();
        this.o.onQuit();
      },
      this.o.click,
    );
  }

  /** `set_mode`: the summary (0), a group's details (1-4) or the timeline (6). */
  setMode(mode: number): void {
    this.mode = mode;
    const timeline = mode === MODE_TIMELINE;
    const m = timeline ? { summary: S.timeline, titles: [], values: () => [] } : this.modes()[mode]!;
    const string = (id: number) => this.o.provider.string(id) ?? '';
    this.summary.textContent = string(m.summary);
    this.instruction.hidden = mode !== 0;
    // Mode 6 hides the names (`size` 0); `draw` puts the winner marks only on modes below 5.
    for (const el of this.names) el.hidden = timeline;
    this.timeline.el.hidden = !timeline;
    this.titles.forEach((el, i) => {
      el.hidden = i >= m.titles.length;
      el.textContent = i < m.titles.length ? string(m.titles[i]!) : '';
    });
    this.stats.forEach((row, i) => {
      const values = m.values(i + 1);
      row.forEach((el, column) => {
        el.hidden = column >= values.length;
        el.textContent = values[column] ?? '';
      });
    });
    for (const b of this.buttons.summary) b.hidden = mode !== 0;
    for (const b of this.buttons.detail) b.hidden = mode === 0;
  }

  private modes(): Mode[] {
    const { world, provider } = this.o;
    const list = (p: number) => world.victory.scores[p] ?? [];
    // `get_attribute_id` (the entry's attribute, truncated), `get_victory_points_id`, `get_victory_points_group`.
    const attr = (p: number, id: number) => Math.trunc(list(p).find((e) => e.id === id)?.current ?? 0);
    const points = (p: number, id: number) => list(p).find((e) => e.id === id)?.currPoints ?? 0;
    const group = (p: number, g: number) => list(p).reduce((sum, e) => sum + (e.group === g ? e.currPoints : 0), 0);
    const yes = (p: number, id: number) => (points(p, id) > 0 ? (provider.string(S.yes) ?? '') : '');
    const n = (v: number) => String(Math.trunc(v));
    return [
      {
        summary: S.summary,
        titles: [S.military, S.economy, S.religion, S.technology, S.survival, S.wonder, S.totalSummary],
        values: (p) => [n(group(p, 0)), n(group(p, 1)), n(group(p, 2)), n(group(p, 3)), yes(p, 22), yes(p, 23), n(world.victory.totals[p] ?? 0)],
      },
      {
        summary: S.military,
        titles: [S.kills, S.razings, S.losses, S.killsLosses, S.largestArmy, S.total],
        values: (p) => {
          const a = world.attributes[p]!;
          return [n(attr(p, 0)), n(attr(p, 1)), n(Math.fround(a[ATTR_TOTAL_UNITS]! - a[ATTR_POPULATION]!)), n(attr(p, 2)), yes(p, 3), n(group(p, 0))];
        },
      },
      {
        summary: S.economy,
        titles: [S.gold, S.villagerHigh, S.villagerBonus, S.exploration, S.mostExplored, S.tribute, S.total],
        values: (p) => [n(attr(p, 4)), n(attr(p, 5)), yes(p, 6), `${attr(p, 7)}%`, yes(p, 8), n(attr(p, 9)), n(group(p, 1))],
      },
      {
        summary: S.religion,
        titles: [S.conversions, S.mostConversions, S.ruins, S.artifacts, S.temples, S.allArtifactsRuins, S.total],
        values: (p) => [n(attr(p, 10)), yes(p, 11), n(attr(p, 12)), n(attr(p, 13)), n(attr(p, 14)), n(points(p, 16) + points(p, 15)), n(group(p, 2))],
      },
      {
        summary: S.technology,
        titles: [S.technologies, S.mostTechnologies, S.bronzeFirst, S.ironFirst, S.total],
        values: (p) => [n(attr(p, 17)), yes(p, 18), yes(p, 19), yes(p, 20), n(group(p, 3))],
      },
    ];
  }

  private rect([x, y, w, h]: [number, number, number, number]) {
    const s = this.scale;
    return { x: Math.round(x * s.x), y: Math.round(y * s.y), w: Math.round(w * s.x), h: Math.round(h * s.y) };
  }

  private box(r: [number, number, number, number], className: string): HTMLDivElement {
    const { x, y, w, h } = this.rect(r);
    return placed(this.modal.panel, 'div', className, x, y, w, h);
  }
}
