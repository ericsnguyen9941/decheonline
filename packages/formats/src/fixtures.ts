// Builders for synthetic DRS / SLP bytes; tests never read real game files except in real-files.test.ts.

function u32(...values: number[]): number[] {
  return values.flatMap((v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]);
}

function u16(...values: number[]): number[] {
  return values.flatMap((v) => [v & 0xff, (v >>> 8) & 0xff]);
}

function ascii(text: string, length: number): number[] {
  return Array.from({ length }, (_, i) => text.charCodeAt(i) || 0);
}

export interface FixtureResource {
  type: string;
  id: number;
  data: Uint8Array | number[];
}

export function buildDrs(resources: FixtureResource[]): Uint8Array {
  const types = [...new Set(resources.map((r) => r.type))];
  const headerSize = 0x40 + types.length * 12;
  const entriesSize = resources.length * 12;
  const dataStart = headerSize + entriesSize;
  const out: number[] = [
    ...ascii('Copyright (c) 1997 Ensemble Studios.\r\n\x1a', 40),
    ...ascii('1.00', 4),
    ...ascii('tribe', 12),
    ...u32(types.length, dataStart),
  ];
  let entryAt = headerSize;
  for (const type of types) {
    const count = resources.filter((r) => r.type === type).length;
    out.push(...[...type.padEnd(4, ' ')].reverse().map((c) => c.charCodeAt(0)), ...u32(entryAt, count));
    entryAt += count * 12;
  }
  let dataAt = dataStart;
  const blobs: number[] = [];
  for (const type of types) {
    for (const r of resources.filter((x) => x.type === type)) {
      out.push(...u32(r.id, dataAt, r.data.length));
      blobs.push(...r.data);
      dataAt += r.data.length;
    }
  }
  return Uint8Array.from([...out, ...blobs]);
}

export interface FixtureRow {
  left: number;
  right: number;
  /** Raw command bytes, including the closing 0x0f; omit for an empty row. */
  commands?: number[];
}

export interface FixtureFrame {
  width: number;
  hotspotX?: number;
  hotspotY?: number;
  rows: FixtureRow[];
}

export function buildSlp(frames: FixtureFrame[], comment = 'synthetic'): Uint8Array {
  const headerSize = 32 + frames.length * 32;
  const out: number[] = [...ascii('2.0N', 4), ...u32(frames.length), ...ascii(comment, 24)];
  const body: number[] = [];
  const infos: number[] = [];
  for (const frame of frames) {
    const height = frame.rows.length;
    const outlineAt = headerSize + body.length;
    for (const row of frame.rows) {
      body.push(...(row.commands ? u16(row.left, row.right) : u16(0x8000, 0x8000)));
    }
    const cmdTableAt = headerSize + body.length;
    const tableLength = height * 4;
    const cmds: number[] = [];
    const offsets: number[] = [];
    for (const row of frame.rows) {
      offsets.push(cmdTableAt + tableLength + cmds.length);
      cmds.push(...(row.commands ?? [0x0f]));
    }
    for (const offset of offsets) body.push(...u32(offset));
    body.push(...cmds);
    infos.push(
      ...u32(cmdTableAt, outlineAt, 0, 0, frame.width, height, frame.hotspotX ?? 0, frame.hotspotY ?? 0),
    );
  }
  return Uint8Array.from([...out, ...infos, ...body]);
}

/** A 256-entry palette where colour `i` is (i, 255 - i, i ^ 0x55). */
export function syntheticPalette(): Uint8Array {
  return Uint8Array.from({ length: 768 }, (_, i) => {
    const c = Math.floor(i / 3);
    return [c, 255 - c, c ^ 0x55][i % 3] as number;
  });
}
