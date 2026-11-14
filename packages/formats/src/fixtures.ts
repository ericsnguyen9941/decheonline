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

/**
 * A minimal PE32 file with one `.rsrc` section holding RT_STRING tables for `strings` (id -> text). `extraLanguage`
 * adds a second language to every block, with every string replaced by `text + '?'`, after the first.
 */
export function buildPe(strings: Record<number, string>, { extraLanguage = false } = {}): Uint8Array {
  const SECTION_RVA = 0x1000;
  const SECTION_FILE = 0x200;
  const blocks = new Map<number, string[]>();
  for (const [key, text] of Object.entries(strings)) {
    const id = Number(key);
    const block = blocks.get((id >> 4) + 1) ?? Array.from({ length: 16 }, () => '');
    block[id & 15] = text;
    blocks.set((id >> 4) + 1, block);
  }
  const languages = extraLanguage ? [0x409, 0x40c] : [0x409];
  const tableBytes = (block: string[], language: number): number[] =>
    block.flatMap((text) => {
      const t = language === 0x409 || text === '' ? text : `${text}?`;
      return [...u16(t.length), ...u16(...[...t].map((c) => c.charCodeAt(0)))];
    });

  // Resource tree: root (1 type) -> type dir (n blocks) -> one dir per block (languages) -> data entries -> data.
  const dir = (entries: [number, number][]): number[] => [...u32(0, 0), ...u16(0, 0, 0, entries.length), ...entries.flatMap(([id, to]) => u32(id, to))];
  const ids = [...blocks.keys()].sort((a, b) => a - b);
  const typeDirAt = 16 + 8;
  const blockDirsAt = typeDirAt + 16 + ids.length * 8;
  const blockDirSize = 16 + languages.length * 8;
  const dataEntriesAt = blockDirsAt + ids.length * blockDirSize;
  const dataAt = dataEntriesAt + ids.length * languages.length * 16;
  const tree: number[] = [...dir([[6, 0x80000000 | typeDirAt]]), ...dir(ids.map((id, i) => [id, 0x80000000 | (blockDirsAt + i * blockDirSize)]))];
  ids.forEach((_, i) => tree.push(...dir(languages.map((lang, l) => [lang, dataEntriesAt + (i * languages.length + l) * 16]))));
  const blobs: number[] = [];
  for (const id of ids) {
    for (const language of languages) {
      const bytes = tableBytes(blocks.get(id) as string[], language);
      tree.push(...u32(SECTION_RVA + dataAt + blobs.length, bytes.length, 0, 0));
      blobs.push(...bytes);
    }
  }
  const section = [...tree, ...Array.from({ length: dataAt - tree.length }, () => 0), ...blobs];

  const pe = 0x40;
  const optionalSize = 96 + 16 * 8;
  const header: number[] = [
    ...u16(0x5a4d),
    ...Array.from({ length: 0x3a }, () => 0),
    ...u32(pe),
    ...u32(0x4550),
    ...u16(0x14c, 1),
    ...u32(0, 0, 0),
    ...u16(optionalSize, 0x2102),
    ...u16(0x10b),
    ...Array.from({ length: 94 }, () => 0),
    ...u32(0, 0, 0, 0),
    ...u32(SECTION_RVA, section.length),
    ...Array.from({ length: 13 * 8 }, () => 0),
    ...ascii('.rsrc', 8),
    ...u32(section.length, SECTION_RVA, section.length, SECTION_FILE, 0, 0),
    ...u16(0, 0),
    ...u32(0x40000040),
  ];
  return new Uint8Array([...header, ...Array.from({ length: SECTION_FILE - header.length }, () => 0), ...section]);
}
