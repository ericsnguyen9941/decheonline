import { deflateStored, inflateRaw } from './inflate';
import { Io } from './io';
import { datFile } from './layout';
import type { DatFile } from './types';

/** Parses inflated empires.dat bytes. Throws unless the layout consumes every byte. */
export function parseDatBytes(bytes: Uint8Array): DatFile {
  const io = Io.reader(bytes);
  const dat = {} as DatFile;
  datFile(io, dat);
  if (io.offset !== io.length) {
    throw new Error(`dat: ${io.length - io.offset} bytes left after the last record (offset ${io.offset})`);
  }
  return dat;
}

/** Serializes to inflated bytes, the inverse of parseDatBytes. */
export function serializeDatBytes(dat: DatFile): Uint8Array {
  const io = Io.writer();
  datFile(io, dat);
  return io.result();
}

/** Parses empires.dat as stored on disk (raw DEFLATE). */
export function parseDat(file: Uint8Array): DatFile {
  return parseDatBytes(inflateRaw(file));
}

/**
 * Writes a dat in the on-disk format. The DEFLATE stream uses stored blocks only, so it
 * is larger than the original but readable by the game and by parseDat.
 */
export function writeDat(dat: DatFile): Uint8Array {
  return deflateStored(serializeDatBytes(dat));
}
