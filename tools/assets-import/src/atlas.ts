import type { PackFrame } from './manifest';

const MAX_SIDE = 4096;

export interface Placement {
  x: number;
  y: number;
}

export interface AtlasLayout {
  width: number;
  height: number;
  placements: Placement[];
}

/** Shelf-packs rectangles (in the given order) into one image no larger than 4096 on a side. */
export function packShelves(sizes: { w: number; h: number }[]): AtlasLayout {
  const widest = Math.max(1, ...sizes.map((s) => s.w));
  for (let width = Math.max(64, nextPow2(widest)); width <= MAX_SIDE; width *= 2) {
    const placed = tryPack(sizes, width);
    if (placed.height <= MAX_SIDE) return { width, ...placed };
  }
  throw new Error('atlas: frames do not fit in 4096x4096');
}

function tryPack(sizes: { w: number; h: number }[], width: number): { height: number; placements: Placement[] } {
  const placements: Placement[] = [];
  let x = 0;
  let y = 0;
  let shelf = 0;
  for (const { w, h } of sizes) {
    if (x + w > width) {
      y += shelf;
      x = 0;
      shelf = 0;
    }
    placements.push({ x, y });
    x += w;
    shelf = Math.max(shelf, h);
  }
  return { height: Math.max(1, y + shelf), placements };
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/** Copies one frame's RGBA rows into the atlas at its frame rectangle. */
export function blit(atlas: Uint8Array, atlasWidth: number, frame: PackFrame, rgba: Uint8Array): void {
  for (let row = 0; row < frame.h; row++) {
    atlas.set(rgba.subarray(row * frame.w * 4, (row + 1) * frame.w * 4), ((frame.y + row) * atlasWidth + frame.x) * 4);
  }
}
