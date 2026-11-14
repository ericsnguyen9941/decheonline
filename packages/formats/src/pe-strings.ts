// RT_STRING resources of a Windows PE file (the game's language.dll / languagex.dll). Strings sit in blocks of 16:
// block id `n` holds string ids `(n - 1) * 16` to `(n - 1) * 16 + 15`, each a u16 length and that many UTF-16LE units.

const RT_STRING = 6;
const RESOURCE_DIRECTORY = 2;

/** Every non-empty string of the file's string tables by id; the first language of a block wins. */
export function readPeStrings(bytes: Uint8Array): Map<number, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const need = (offset: number, size: number, what: string): void => {
    if (offset < 0 || offset + size > bytes.length) throw new Error(`PE: ${what} past end of file`);
  };
  need(0, 0x40, 'DOS header');
  if (view.getUint16(0, true) !== 0x5a4d) throw new Error('PE: no MZ signature');
  const pe = view.getUint32(0x3c, true);
  need(pe, 24, 'PE header');
  if (view.getUint32(pe, true) !== 0x4550) throw new Error('PE: no PE signature');
  const sectionCount = view.getUint16(pe + 6, true);
  const optionalSize = view.getUint16(pe + 20, true);
  const optional = pe + 24;
  need(optional, 2, 'optional header');
  const magic = view.getUint16(optional, true);
  if (magic !== 0x10b && magic !== 0x20b) throw new Error(`PE: unknown optional header magic ${magic.toString(16)}`);
  const directories = optional + (magic === 0x10b ? 96 : 112);
  const strings = new Map<number, string>();
  if (directories + (RESOURCE_DIRECTORY + 1) * 8 > optional + optionalSize) return strings;
  const resourceRva = view.getUint32(directories + RESOURCE_DIRECTORY * 8, true);
  if (resourceRva === 0) return strings;

  const sections = optional + optionalSize;
  need(sections, sectionCount * 40, 'section table');
  const fileOffset = (rva: number): number => {
    for (let i = 0; i < sectionCount; i++) {
      const s = sections + i * 40;
      const virtualSize = view.getUint32(s + 8, true);
      const address = view.getUint32(s + 12, true);
      const rawSize = view.getUint32(s + 16, true);
      if (rva >= address && rva < address + Math.max(virtualSize, rawSize)) return view.getUint32(s + 20, true) + rva - address;
    }
    throw new Error(`PE: address ${rva.toString(16)} in no section`);
  };
  const root = fileOffset(resourceRva);

  /** The entries of the resource directory at `offset` (relative to the resource root): id and target offset. */
  const entries = (offset: number): { id: number; target: number; directory: boolean }[] => {
    const at = root + offset;
    need(at, 16, 'resource directory');
    const named = view.getUint16(at + 12, true);
    const count = named + view.getUint16(at + 14, true);
    need(at + 16, count * 8, 'resource directory');
    return Array.from({ length: count }, (_, i) => {
      const name = view.getUint32(at + 16 + i * 8, true);
      const target = view.getUint32(at + 20 + i * 8, true);
      return { id: name & 0x80000000 ? -1 : name, target: target & 0x7fffffff, directory: (target & 0x80000000) !== 0 };
    });
  };

  const type = entries(0).find((e) => e.id === RT_STRING && e.directory);
  if (!type) return strings;
  for (const block of entries(type.target)) {
    if (block.id < 1 || !block.directory) continue;
    const language = entries(block.target).find((e) => !e.directory);
    if (!language) continue;
    need(root + language.target, 16, 'resource data entry');
    const dataRva = view.getUint32(root + language.target, true);
    const size = view.getUint32(root + language.target + 4, true);
    let at = fileOffset(dataRva);
    need(at, size, 'string table');
    const end = at + size;
    for (let i = 0; i < 16 && at + 2 <= end; i++) {
      const length = view.getUint16(at, true);
      at += 2;
      need(at, length * 2, 'string');
      if (length > 0) {
        let text = '';
        for (let c = 0; c < length; c++) text += String.fromCharCode(view.getUint16(at + c * 2, true));
        strings.set((block.id - 1) * 16 + i, text);
      }
      at += length * 2;
    }
  }
  return strings;
}

/** Merges string tables: later ones override earlier ones (Rise of Rome's languagex.dll over language.dll). */
export function mergeStrings(...tables: Map<number, string>[]): Map<number, string> {
  const merged = new Map<number, string>();
  for (const table of tables) for (const [id, text] of table) merged.set(id, text);
  return merged;
}
