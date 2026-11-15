// The in-game score (`TRIBE_Screen_Game::command_score`, `reset_score_display`, src/scr_game.cpp:3286, 3991): F4 or
// the score button shows or hides it. Eight 200 x 20 lines stacked up from 4 pixels above the main view's bottom right
// corner, each "name: score/team score", sorted best team first; refreshed every 3 s while shown. A defeated player's
// line is struck out. The latency and slow-player icons are not drawn.
import { STATUS_LOST, type World } from '@aoe/sim';
import { FONT, placed, textColours } from './easy-panel';

const LINES = 8;
/** `score_interval`. */
const REFRESH_MS = 3000;
/** Text colour and second colour by colour table (scr_game.cpp:3398-3438), Windows COLORREFs (0x00BBGGRR). */
const COLOURS: [number, number][] = [
  [0xff0000, 0xb3b3b3],
  [0x2139c6, 0],
  [0xffff, 0],
  [0x4f73a3, 0],
  [0x0f77f3, 0],
  [0xc700, 0],
  [0x7b90a2, 0],
  [0xadad00, 0],
];

const colorref = (c: number) => `rgb(${c & 0xff}, ${(c >> 8) & 0xff}, ${(c >> 16) & 0xff})`;

/** A line of the score display. */
export interface ScoreLine {
  player: number;
  text: string;
  struck: boolean;
}

/**
 * The lines in their order: `scr_game_score_compare` sorts by team score, then team id, then score, then player id,
 * all from the highest. Without allied victory each player is its own team, numbered in player order.
 */
export function scoreLines(world: World, names: readonly string[]): ScoreLine[] {
  const rows = Array.from({ length: world.players - 1 }, (_, i) => {
    const player = i + 1;
    const score = Math.trunc(world.victory.totals[player] ?? 0);
    return { player, team: player, score };
  });
  rows.sort((a, b) => b.score - a.score || b.team - a.team || b.player - a.player);
  return rows.map((r) => ({ player: r.player, text: `${names[r.player] ?? ''}: ${r.score}/${r.score}`, struck: world.playerStatus(r.player) === STATUS_LOST }));
}

export class ScoreDisplay {
  private readonly lines: HTMLDivElement[];
  private shown = false;
  private refreshedAt = -Infinity;
  private readonly onKey = (e: KeyboardEvent) => {
    // Unmodified F4 (Shift+F4 is a formation, not ported).
    if (e.key !== 'F4' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
    e.preventDefault();
    this.toggle();
  };

  constructor(
    view: HTMLElement,
    private readonly world: World,
    private readonly names: readonly string[],
  ) {
    this.lines = Array.from({ length: LINES }, (_, i) => {
      const el = placed(view, 'div', 'aoe-text', 0, 0, 200, 20);
      Object.assign(el.style, { left: '', top: '', right: '4px', bottom: `${4 + 20 * (LINES - 1 - i)}px`, textAlign: 'right' });
      el.dataset.testid = 'score-line';
      el.hidden = true;
      return el;
    });
    window.addEventListener('keydown', this.onKey);
  }

  get visible(): boolean {
    return this.shown;
  }

  /** `command_score(!score_displayed)`. */
  toggle(): void {
    this.shown = !this.shown;
    if (this.shown) this.refresh();
    else for (const el of this.lines) el.hidden = true;
  }

  update(now = performance.now()): void {
    if (this.shown && now - this.refreshedAt >= REFRESH_MS) this.refresh(now);
  }

  /** The lines shown now, top first (for the tests). */
  get texts(): string[] {
    return this.lines.flatMap((el) => (el.hidden ? [] : [el.textContent ?? '']));
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKey);
  }

  private refresh(now = performance.now()): void {
    this.refreshedAt = now;
    const lines = scoreLines(this.world, this.names);
    this.lines.forEach((el, i) => {
      const line = lines[i];
      el.hidden = !line;
      if (!line) return;
      el.textContent = line.text;
      el.className = `aoe-text ${line.struck ? FONT.strikeout : FONT.standard}`;
      const [c1, c2] = COLOURS[line.player - 1] ?? [0xffffff, 0];
      textColours(el, [colorref(c1), colorref(c2)]);
    });
  }
}
