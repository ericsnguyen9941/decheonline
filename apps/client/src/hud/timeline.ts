// The achievements screen's timeline (`Time_Line_Panel`, src/tpnl_tml.cpp): every player's share of the world
// population at each history entry (`TRIBE_History_Info`, the sim's `World.log.history`, docs/spec/victory.md §16),
// stacked in the players' colours, with the totals and times over and under it, the ages reached and the players' names.
// `timelineDrawing` lays it out as the original draws it, pixel for pixel; `TimelinePanel` paints that on a canvas,
// the texts as elements over it. Spec: docs/spec/victory.md §17.
import type { HistoryEvent } from '@aoe/sim';
import { FONT, placed } from './easy-panel';

/** `STRING_ID_WORLD_POPULATION`, `STRING_ID_TIME_HOUR_MINUTE`, `STRING_ID_AGE_TOOL` .. `_IRON` (events 0-2). */
export const TIMELINE_STRINGS = { population: 0x2c57, time: 0x2c56, ages: [0x106a, 0x106b, 0x106c] } as const;

/**
 * A font's `font_wid` / `font_hgt` (`tmAveCharWidth`, `tmHeight + tmExternalLeading`, src/basegame.cpp:1939): the
 * layout's only text metrics. GDI's metrics of Arial 10 bold (font 11, the axis font) and Arial 9 bold (font 9, the
 * body font) at 96 dpi; not measured on Windows.
 */
export const AXIS_FONT = { wid: 6, hgt: 16 };
export const BODY_FONT = { wid: 6, hgt: 15 };

/** One player's history: a population byte per 15 s entry and the ages reached (`time` = the entry count then). */
export interface TimelineHistory {
  population: readonly number[];
  events: readonly Pick<HistoryEvent, 'time' | 'event'>[];
}

export interface TimelineInput {
  /** The panel's size: (620, 330) of 640 x 480 scaled to the screen (`create_timeline`). */
  width: number;
  height: number;
  /** Per player, player 1 first (Gaia keeps none). */
  history: readonly TimelineHistory[];
  /** Per player: the colour of its colour table (the achievements' `color_table->id` switch), CSS. */
  colours: readonly string[];
  /** Per player: "name - civilization". */
  names: readonly string[];
  /** The language strings of `TIMELINE_STRINGS`: population, time, the three ages. */
  strings: { population: string; time: string; ages: readonly [string, string, string] };
}

/** A filled rectangle, `x`..`x + w - 1` by `y`..`y + h - 1`, in panel pixels. */
export interface TimelineRect {
  x: number;
  y: number;
  w: number;
  h: number;
  colour: string;
}

export interface TimelineText {
  x: number;
  y: number;
  text: string;
  /** The axis font (11) or the body font (9). */
  font: 'axis' | 'body';
  colour: string;
  kind: 'axis-population' | 'axis-time' | 'total' | 'time' | 'age' | 'name';
}

export interface TimelineDrawing {
  /** In drawing order. */
  rects: TimelineRect[];
  texts: TimelineText[];
  /** `num_entries_page`, `bar_thickness`, `drop_flag`: what the graph shows. */
  page: number;
  bar: number;
  drop: boolean;
}

const WHITE = '#ffffff';
const BLACK = '#000000';
const f = Math.fround;

/** `Special_Events`: a population label (event 3) or a player's age reached (0-2) at a column. */
interface Special {
  event: number;
  slice: number;
  x: number;
  y: number;
  segment: number;
  popTotal: number;
}

/** `get_history_event(time_slice, event)`: the newest event at that entry (the original's list is newest first). */
function eventAt(h: TimelineHistory | undefined, slice: number): number | null {
  if (!h) return null;
  for (let i = h.events.length - 1; i >= 0; i--) if (h.events[i]!.time === slice) return h.events[i]!.event;
  return null;
}

/** `get_history_entry(0, time)`: 0 outside the history. */
const entry = (h: TimelineHistory | undefined, slice: number): number => (h && slice >= 0 && slice < h.population.length ? h.population[slice]! & 0xff : 0);

/** The timeline's drawing: `init_timeline`, then `draw` (background, border, axis, timeline, events, names). */
export function timelineDrawing(input: TimelineInput): TimelineDrawing {
  const { width, height, history, colours } = input;
  const players = history.length;
  const rects: TimelineRect[] = [];
  const texts: TimelineText[] = [];
  const fill = (x1: number, y1: number, x2: number, y2: number, colour: string) => rects.push({ x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1) + 1, h: Math.abs(y2 - y1) + 1, colour });
  const vert = (x: number, y: number, len: number, colour: string) => {
    if (len >= 1) rects.push({ x, y, w: 1, h: len, colour });
  };
  const a = AXIS_FONT;
  const b = BODY_FONT;

  // `init_timeline` (src/tpnl_tml.cpp:339-389).
  let entries = 0;
  for (const h of history) entries = Math.max(entries, h.population.length);
  const usableX = width - 49;
  let flag = true;
  if (entries === 0) {
    entries = 1;
    flag = false;
  }
  let dropRate = 0;
  let bar = f(usableX / entries);
  let page = entries;
  let drop = false;
  let toDrop = 0;
  if (bar < 1) {
    bar = 1;
    page = usableX;
    drop = true;
    toDrop = entries - usableX;
    dropRate = f(usableX / toDrop);
  }
  const xLen = Math.trunc(f(page * bar)) + 4;
  const yLen = height - a.hgt * 4 - 26;
  const xStart = 27;
  const yStart = a.hgt * 2 + 15;
  const yMax = yLen - 3;
  const xMax = xLen - 2;
  const popRate = page < 12 ? 1 : Math.trunc(f((page - 1) * f(1 / 12)));

  // `draw_background`: the back colour (black, `set_back_color` in `setup`); `draw_border`: bevel 3, `DrawBevel2` of
  // the screen's bevel colours 6, 5, 2, 1 — drawn by the caller, which has the look.
  fill(0, 0, width - 1, height - 1, BLACK);

  // `draw_axis` (:630-687): four white 2-pixel rectangles and the two titles.
  fill(25, a.hgt * 2 + 12 + yLen, 24 + xLen, a.hgt * 2 + 13 + yLen, WHITE);
  fill(25, a.hgt * 2 + 13, 24 + xLen, a.hgt * 2 + 14, WHITE);
  fill(25, a.hgt * 2 + 13, 26, a.hgt * 2 + 13 + yLen, WHITE);
  fill(23 + xLen, a.hgt * 2 + 13, 24 + xLen, a.hgt * 2 + 13 + yLen, WHITE);
  if (input.strings.population) texts.push({ x: 8, y: 5, text: input.strings.population, font: 'axis', colour: WHITE, kind: 'axis-population' });
  if (input.strings.time) {
    const x = xStart - Math.trunc((input.strings.time.length * a.wid) / 2) + Math.trunc(xLen / 2);
    texts.push({ x, y: height - a.hgt - 5, text: input.strings.time, font: 'axis', colour: WHITE, kind: 'axis-time' });
  }

  // `draw_timeline` (:928-1155): a column of `bar` pixels per entry shown, each player's share of that entry's total
  // as a vertical line, eased towards the next entry's share across the column; entries without an event are dropped
  // when there are more than pixels.
  const specials: Special[] = [];
  draw: if (flag) {
    let labelCounter = 0;
    let thicknessError = 0;
    let sliceCounter = 0;
    let sampleCounter = 0;
    let displayed = 0;
    let dropped = 1;
    let x = xStart;
    for (let slice = 0; slice < entries; slice++) {
      if (displayed >= page) break;
      let popTotal = 0;
      let special = false;
      for (const h of history) {
        if (eventAt(h, slice) !== null) special = true;
        popTotal = f(popTotal + entry(h, slice));
      }
      if (popTotal === 0) break draw;
      const baseDrop = Math.trunc(dropRate);
      const dropLimit = Math.trunc(f(dropped * dropRate)) + (1 - dropped) * baseDrop - sliceCounter;
      if (drop && !special && sampleCounter >= dropLimit && dropped - 1 < toDrop) {
        dropped++;
        sampleCounter = 0;
        if (dropLimit > baseDrop) sliceCounter++;
        continue;
      }
      sampleCounter++;
      displayed++;
      let nextTotal = popTotal;
      if (slice !== page - 1) {
        nextTotal = 0;
        for (const h of history) nextTotal = f(nextTotal + entry(h, slice + 1));
        if (nextTotal === 0) break draw;
      }
      if (labelCounter === popRate - 1 || slice === 0) {
        specials.push({ event: 3, slice, x, y: 0, segment: 0, popTotal: Math.trunc(popTotal) });
        labelCounter = 0;
      } else labelCounter++;

      const next = slice + 1;
      let thickness = Math.trunc(f(next * bar));
      const base = Math.trunc(bar);
      const regular = base * next;
      if (regular < thickness - thicknessError) {
        thickness = thickness - thicknessError - regular + base;
        thicknessError++;
      } else thickness = base;

      for (let column = 0; column < thickness; column++, x++) {
        let y = yStart;
        let total = 0;
        let remainder = 0;
        history.forEach((h, i) => {
          const pop = entry(h, slice);
          let segment = Math.trunc(f(f(pop / popTotal) * yMax));
          if (pop >= 1 && segment < 1) segment = 1;
          if (bar !== 1) {
            const nextPop = slice === page - 1 ? pop : entry(h, next);
            const nextSegment = Math.trunc(f(f(nextPop / nextTotal) * yMax));
            const eased = f(segment + f((nextSegment - segment) * f(column / bar)));
            segment = Math.trunc(eased);
            if (pop >= 1 && segment < 1) segment = 1;
            remainder = f(f(remainder + eased) - segment);
            if (remainder > 1) {
              remainder = f(remainder - 1);
              segment++;
            }
          }
          // The last player takes what is left, so the column always fills `Y_line_max_length`.
          if (i === players - 1) segment = yMax - total;
          vert(x, y, segment, colours[i] ?? WHITE);
          // `record_special_event`: an age reached at this entry, on the column's first pixel line.
          const event = column === 0 ? eventAt(h, slice) : null;
          if (event !== null) specials.push({ event, slice, x, y, segment, popTotal: 0 });
          y += segment;
          total += segment;
        });
      }
    }
  }

  // `draw_special_events` (:689-800), newest first: an age's black line over its player's band, then the texts: the
  // age's name in black beside it, the totals and times in white above and below the graph.
  if (flag) {
    const list = [...specials].reverse();
    const right = xStart + xMax;
    const bottom = yStart + yMax;
    const labels: TimelineText[] = [];
    for (const s of list) {
      if (s.event >= 0 && s.event <= 2) {
        vert(s.x, s.y, s.segment, BLACK);
        const text = input.strings.ages[s.event]!;
        const w = b.wid * text.length;
        // `calculate_icon_location` (:456-613): beside the line, or left of the graph's right edge; event 1 (Bronze)
        // sits at the top of the graph, 0 and 2 at the bottom of the band.
        const tx = s.x + w + 2 < right ? s.x + 2 : right - w - (s.event === 1 ? 8 : 3);
        let ty: number;
        if (s.event === 1) ty = s.y + b.hgt + 2 < bottom ? yStart + 2 : bottom - b.hgt - 2;
        else {
          ty = s.y + s.segment - b.hgt - 2;
          if (ty <= yStart) ty = yStart + 2;
          else if (ty >= bottom) ty = bottom - b.hgt - 3;
        }
        if (text) labels.push({ x: tx, y: ty, text, font: 'body', colour: BLACK, kind: 'age' });
      } else if (s.event === 3) {
        // `draw_icon` case 3: the total, and the entry's time as h:mm (15 s an entry), centred by the axis font's width.
        const total = String(s.popTotal);
        const seconds = s.slice * 15;
        const time = `${Math.trunc(seconds / 3600)}:${String(Math.trunc(seconds / 60) % 60).padStart(2, '0')}`;
        const offset = s.slice !== 0 ? -2 : 2;
        labels.push({ x: offset - (total.length >> 1) * a.wid + s.x, y: 8 + a.hgt, text: total, font: 'body', colour: WHITE, kind: 'total' });
        labels.push({ x: offset - (time.length >> 1) * a.wid + s.x, y: height - a.hgt * 2 - 7, text: time, font: 'body', colour: WHITE, kind: 'time' });
      }
    }
    texts.push(...labels);

    // `draw_civilization_names` (:874-926): "name - civ" in black at the middle of each player's band in the first entry.
    let firstTotal = 0;
    for (const h of history) firstTotal = f(firstTotal + entry(h, 0));
    if (firstTotal !== 0) {
      let y = yStart;
      history.forEach((h, i) => {
        const segment = Math.trunc(f(f(entry(h, 0) / firstTotal) * yMax));
        texts.push({ x: xStart + 3, y: y + (Math.trunc(segment / 2) - Math.trunc(b.hgt / 2)), text: input.names[i] ?? '', font: 'body', colour: BLACK, kind: 'name' });
        y += segment;
      });
    }
  }
  return { rects, texts, page, bar, drop };
}

/** The timeline's panel: a canvas at (x, y) of `parent`, the texts over it, clipped to it. */
export class TimelinePanel {
  readonly el: HTMLDivElement;
  readonly drawing: TimelineDrawing;

  /** `bevels`: the screen's six bevel colours, for the panel's `DrawBevel2` border (bevel type 3). */
  constructor(parent: HTMLElement, x: number, y: number, input: TimelineInput, bevels: readonly string[]) {
    const { width, height } = input;
    this.el = placed(parent, 'div', 'aoe-text', x, y, width, height);
    this.el.dataset.testid = 'achievements-timeline-panel';
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.dataset.testid = 'timeline-canvas';
    Object.assign(canvas.style, { position: 'absolute', left: '0', top: '0', imageRendering: 'pixelated' });
    this.el.append(canvas);
    this.drawing = timelineDrawing(input);
    const ctx = canvas.getContext('2d');
    const [background, ...rest] = this.drawing.rects;
    if (ctx && background) {
      const rect = (r: TimelineRect) => {
        ctx.fillStyle = r.colour;
        ctx.fillRect(r.x, r.y, r.w, r.h);
      };
      rect(background);
      for (const r of bevel2(width, height, bevels)) rect(r);
      for (const r of rest) rect(r);
    }
    for (const t of this.drawing.texts) {
      const font = t.font === 'axis' ? AXIS_FONT : BODY_FONT;
      const el = placed(this.el, 'div', `aoe-text ${t.font === 'axis' ? FONT.standard : FONT.arial9bold}`, t.x, t.y, Math.max(1, t.text.length) * 12, font.hgt);
      Object.assign(el.style, { overflow: 'visible', lineHeight: `${font.hgt}px`, color: t.colour });
      el.dataset.testid = `timeline-${t.kind}`;
      el.textContent = t.text;
    }
  }

  remove(): void {
    this.el.remove();
  }
}

/** `DrawBevel2(x1, y1, x2, y2, c6, c5, c2, c1)` (src/drawarea.cpp:1992-2028) round the whole panel. */
function bevel2(width: number, height: number, bevels: readonly string[]): TimelineRect[] {
  const [c1, c2, c3, c4] = [bevels[5], bevels[4], bevels[1], bevels[0]].map((c) => c ?? BLACK) as [string, string, string, string];
  const x2 = width - 1;
  const y2 = height - 1;
  const out: TimelineRect[] = [];
  const horz = (x: number, y: number, len: number, colour: string) => len >= 1 && out.push({ x, y, w: len, h: 1, colour });
  const vert = (x: number, y: number, len: number, colour: string) => len >= 1 && out.push({ x, y, w: 1, h: len, colour });
  horz(1, 0, width - 1, c1);
  vert(x2, 1, height - 2, c1);
  horz(2, 1, width - 3, c2);
  vert(x2 - 1, 2, height - 4, c2);
  horz(0, y2, width, c4);
  vert(0, 0, height - 1, c4);
  horz(1, y2 - 1, width - 2, c3);
  vert(1, 1, height - 3, c3);
  return out;
}
