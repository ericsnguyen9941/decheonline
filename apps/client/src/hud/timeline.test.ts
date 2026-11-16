import { expect, test } from 'vitest';
import { HISTORY_BRONZE_AGE, HISTORY_TOOL_AGE } from '@aoe/sim';
import { AXIS_FONT, BODY_FONT, timelineDrawing, type TimelineDrawing, type TimelineHistory, type TimelineInput } from './timeline';

const RED = 'red';
const BLUE = 'blue';
const input = (history: TimelineHistory[], width = 620, height = 330): TimelineInput => ({
  width,
  height,
  history,
  colours: [BLUE, RED],
  names: ['Alice - Egyptian', 'Bob - Greek'],
  strings: { population: 'World Population', time: 'Time (Hr:Min)', ages: ['Tool Age', 'Bronze Age', 'Iron Age'] },
});

/** Every player's band per pixel column: x -> [colour, y, length][]. */
function columns(d: TimelineDrawing): Map<number, [string, number, number][]> {
  const out = new Map<number, [string, number, number][]>();
  for (const r of d.rects) if (r.w === 1 && (r.colour === RED || r.colour === BLUE)) out.set(r.x, [...(out.get(r.x) ?? []), [r.colour, r.y, r.h]]);
  return out;
}

// 640 x 480: the panel is 620 x 330, the graph 571 pixels wide (`width - 49`), 240 high less 3, from (27, 47).
const Y_START = AXIS_FONT.hgt * 2 + 15;
const Y_MAX = 330 - AXIS_FONT.hgt * 4 - 26 - 3;

test('the axes are four white 2-pixel rectangles round the graph, the titles above and centred below', () => {
  const d = timelineDrawing(input([{ population: [3, 4, 4, 5], events: [] }, { population: [3, 3, 4, 4], events: [] }]));
  expect(d.page).toBe(4);
  expect(d.bar).toBeCloseTo(142.75, 5);
  const white = d.rects.filter((r) => r.colour === '#ffffff');
  const a = AXIS_FONT.hgt * 2;
  // X_axis_length = 4 x 142.75 + 4 = 575; Y_axis_length = 330 - 4a - 26 = 240.
  expect(white).toEqual([
    { x: 25, y: a + 12 + 240, w: 575, h: 2, colour: '#ffffff' },
    { x: 25, y: a + 13, w: 575, h: 2, colour: '#ffffff' },
    { x: 25, y: a + 13, w: 2, h: 241, colour: '#ffffff' },
    { x: 598, y: a + 13, w: 2, h: 241, colour: '#ffffff' },
  ]);
  const axis = d.texts.filter((t) => t.kind.startsWith('axis'));
  expect(axis).toEqual([
    { x: 8, y: 5, text: 'World Population', font: 'axis', colour: '#ffffff', kind: 'axis-population' },
    { x: 27 - (13 * AXIS_FONT.wid) / 2 + 287, y: 330 - AXIS_FONT.hgt - 5, text: 'Time (Hr:Min)', font: 'axis', colour: '#ffffff', kind: 'axis-time' },
  ]);
});

test("each column stacks every player's share of the entry's total in its colour, filling the graph's height", () => {
  const d = timelineDrawing(input([{ population: [3, 4, 4, 5], events: [] }, { population: [3, 3, 4, 4], events: [] }]));
  const cols = columns(d);
  // 142.75 a column: 142, then 143 three times as the error catches up, 571 pixel lines in all.
  expect(cols.size).toBe(571);
  expect(Math.min(...cols.keys())).toBe(27);
  expect(Math.max(...cols.keys())).toBe(27 + 570);
  for (const bands of cols.values()) {
    expect(bands.map((b) => b[0])).toEqual([BLUE, RED]);
    expect(bands[0]![1]).toBe(Y_START);
    expect(bands[1]![1]).toBe(Y_START + bands[0]![2]);
    expect(bands[0]![2] + bands[1]![2]).toBe(Y_MAX);
  }
  // The first column is entry 0's 3 of 6; the shares ease towards the next entry's across a column.
  expect(cols.get(27)![0]![2]).toBe(Math.trunc(Math.fround(Math.fround(3 / 6) * Y_MAX)));
  expect(cols.get(27 + 141)![0]![2]).toBeGreaterThan(cols.get(27)![0]![2]);
  // The totals over the graph and the times (15 s an entry, h:mm) under it, one per entry when there are fewer than 12.
  expect(d.texts.filter((t) => t.kind === 'total').map((t) => t.text)).toEqual(['9', '8', '7', '6']);
  expect(d.texts.filter((t) => t.kind === 'time').map((t) => t.text)).toEqual(['0:00', '0:00', '0:00', '0:00']);
  // Newest first: the first entry's labels are last, at its x plus 2 (the others minus 2).
  const first = d.texts.filter((t) => t.kind === 'total').at(-1)!;
  expect(first).toMatchObject({ text: '6', x: 2 + 27, y: 8 + AXIS_FONT.hgt, font: 'body' });
});

test('the names sit at the middle of each band of the first entry, in black', () => {
  const d = timelineDrawing(input([{ population: [3, 4], events: [] }, { population: [1, 3], events: [] }]));
  const names = d.texts.filter((t) => t.kind === 'name');
  const seg = Math.trunc(Math.fround(Math.fround(3 / 4) * Y_MAX));
  expect(names).toEqual([
    { x: 30, y: Y_START + Math.trunc(seg / 2) - Math.trunc(BODY_FONT.hgt / 2), text: 'Alice - Egyptian', font: 'body', colour: '#000000', kind: 'name' },
    { x: 30, y: Y_START + seg + Math.trunc(Math.trunc(Math.fround(Math.fround(1 / 4) * Y_MAX)) / 2) - Math.trunc(BODY_FONT.hgt / 2), text: 'Bob - Greek', font: 'body', colour: '#000000', kind: 'name' },
  ]);
});

test("an age reached draws a black line over the player's band and the age's name; the Bronze Age's name sits at the top", () => {
  const history = [
    { population: [4, 4, 4, 4, 4], events: [{ time: 2, event: HISTORY_TOOL_AGE }, { time: 3, event: HISTORY_BRONZE_AGE }] },
    { population: [4, 4, 4, 4, 4], events: [] },
  ];
  const d = timelineDrawing(input(history));
  const black = d.rects.filter((r) => r.colour === '#000000').slice(1);
  // 571 / 5 = 114.2 a column: entry 2 starts at 27 + 228, entry 3 at 27 + 342; the player's top half.
  const half = Math.trunc(Math.fround(Math.fround(4 / 8) * Y_MAX));
  expect(black).toEqual([
    { x: 27 + 342, y: Y_START, w: 1, h: half, colour: '#000000' },
    { x: 27 + 228, y: Y_START, w: 1, h: half, colour: '#000000' },
  ]);
  const ages = d.texts.filter((t) => t.kind === 'age');
  expect(ages).toEqual([
    { x: 27 + 342 + 2, y: Y_START + 2, text: 'Bronze Age', font: 'body', colour: '#000000', kind: 'age' },
    { x: 27 + 228 + 2, y: Y_START + half - BODY_FONT.hgt - 2, text: 'Tool Age', font: 'body', colour: '#000000', kind: 'age' },
  ]);
});

test('with more entries than pixels, entries without an event are dropped; with no history only the axes show', () => {
  const population = Array.from({ length: 60 }, (_, i) => 3 + (i % 5));
  const d = timelineDrawing(input([{ population, events: [{ time: 50, event: HISTORY_TOOL_AGE }] }, { population, events: [] }], 100, 330));
  expect(d.drop).toBe(true);
  expect(d.page).toBe(51);
  expect(columns(d).size).toBe(51);
  expect(d.texts.filter((t) => t.kind === 'age')).toHaveLength(1);

  const empty = timelineDrawing(input([{ population: [], events: [] }, { population: [], events: [] }]));
  expect(columns(empty).size).toBe(0);
  expect(empty.texts.map((t) => t.kind)).toEqual(['axis-population', 'axis-time']);
  expect(empty.rects).toHaveLength(5);
});
