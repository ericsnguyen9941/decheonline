export interface DrsEntry {
  /** Resource id, unique within its table type. */
  id: number;
  /** Table type with the on-disk reversal undone and padding removed: `slp`, `wav`, `bina`, `shp`. */
  type: string;
  offset: number;
  size: number;
}

const HEADER_SIZE = 0x40;
const TABLE_INFO_SIZE = 12;
const ENTRY_SIZE = 12;

function readType(bytes: Uint8Array, at: number): string {
  // Stored reversed ("slp " is written as " pls").
  let text = '';
  for (let i = 3; i >= 0; i--) text += String.fromCharCode(bytes[at + i] ?? 0);
  return text.trim();
}

export class DrsArchive {
  readonly version: string;
  readonly kind: string;
  readonly entries: readonly DrsEntry[];
  readonly #bytes: Uint8Array;
  readonly #index = new Map<string, DrsEntry>();

  private constructor(bytes: Uint8Array, version: string, kind: string, entries: DrsEntry[]) {
    this.#bytes = bytes;
    this.version = version;
    this.kind = kind;
    this.entries = entries;
    for (const entry of entries) this.#index.set(`${entry.type}:${entry.id}`, entry);
  }

  static parse(bytes: Uint8Array): DrsArchive {
    if (bytes.length < HEADER_SIZE) throw new Error('DRS: file shorter than its header');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const text = (from: number, length: number): string => {
      let out = '';
      for (let i = 0; i < length; i++) {
        const c = bytes[from + i] ?? 0;
        if (c === 0) break;
        out += String.fromCharCode(c);
      }
      return out;
    };
    if (!text(0, 9).startsWith('Copyright')) throw new Error('DRS: missing copyright banner');
    const version = text(0x28, 4);
    const kind = text(0x2c, 12);
    const tableCount = view.getUint32(0x38, true);
    const tablesEnd = HEADER_SIZE + tableCount * TABLE_INFO_SIZE;
    if (tablesEnd > bytes.length) throw new Error('DRS: table list runs past end of file');

    const entries: DrsEntry[] = [];
    for (let t = 0; t < tableCount; t++) {
      const at = HEADER_SIZE + t * TABLE_INFO_SIZE;
      const type = readType(bytes, at);
      const tableOffset = view.getUint32(at + 4, true);
      const count = view.getUint32(at + 8, true);
      if (tableOffset + count * ENTRY_SIZE > bytes.length) {
        throw new Error(`DRS: ${type} table runs past end of file`);
      }
      for (let i = 0; i < count; i++) {
        const e = tableOffset + i * ENTRY_SIZE;
        const entry = { id: view.getUint32(e, true), type, offset: view.getUint32(e + 4, true), size: view.getUint32(e + 8, true) };
        if (entry.offset + entry.size > bytes.length) {
          throw new Error(`DRS: ${type} ${entry.id} runs past end of file`);
        }
        entries.push(entry);
      }
    }
    return new DrsArchive(bytes, version, kind, entries);
  }

  find(type: string, id: number): DrsEntry | undefined {
    return this.#index.get(`${type}:${id}`);
  }

  list(type: string): DrsEntry[] {
    return this.entries.filter((entry) => entry.type === type);
  }

  /** Bytes of one resource (a view into the archive, not a copy), or undefined when absent. */
  read(type: string, id: number): Uint8Array | undefined {
    const entry = this.find(type, id);
    return entry && this.#bytes.subarray(entry.offset, entry.offset + entry.size);
  }
}
