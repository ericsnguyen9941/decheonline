// The map's objects by where they stand, so the view walks only the objects on the tiles it shows, as `RGE_View::draw`
// draws only the view's tiles and their objects (src/view.cpp:789). docs/spec/hud.md "Drawing only the view".
import type { Entity, World } from '@aoe/sim';
import type { TileRange } from '../map/iso';

/** Tiles per side of a chunk, the grid's cell. */
export const CHUNK = 8;

/** Whether to walk the chunk of tiles `range`. */
export type ChunkTest = (range: TileRange) => boolean;

/**
 * Object ids by chunk of `CHUNK` × `CHUNK` tiles. An object with a mover (units, missiles, the sim's buildings and
 * dead units) is moved to its chunk after every step; any other (trees, mines, bushes) never moves, so it is filed once,
 * when it appears, and where it is drawn is worked out once. A removed object leaves its chunk when the chunk is walked
 * or, for a mover, at the next step.
 */
export class ObjectGrid {
  private readonly cells: Set<number>[];
  private readonly cellOf = new Map<number, number>();
  private readonly movers = new Set<number>();
  /** The drawn map pixel of each object that never moves. */
  private readonly anchors = new Map<number, { x: number; y: number }>();
  private readonly columns: number;
  private readonly rows: number;
  /** The first object id not filed yet: ids are handed out in increasing order and never reused. */
  private next = 1;

  constructor(
    private readonly world: World,
    /** The map pixel an object at map point (x, y) is drawn at (`Ground.pixel`). */
    private readonly pixel: (x: number, y: number) => { x: number; y: number },
  ) {
    this.columns = Math.ceil(world.map.width / CHUNK);
    this.rows = Math.ceil(world.map.height / CHUNK);
    this.cells = Array.from({ length: this.columns * this.rows }, () => new Set<number>());
    this.update();
  }

  /** Follow the world after a sim step: file the objects made since the last call and move the movers. */
  update(): void {
    const { entities } = this.world;
    const end = entities.nextEntityId;
    for (let id = this.next; id < end; id++) {
      const e = entities.get(id);
      if (!e) continue;
      this.file(e);
      if (e.mover) this.movers.add(id);
    }
    this.next = end;
    for (const id of this.movers) {
      const e = entities.get(id);
      if (e) this.file(e);
      else this.drop(id);
    }
  }

  /** The objects in the chunks that hold tiles `range` and pass `test`, chunk by chunk. */
  *objects(range: TileRange, test: ChunkTest = () => true): Generator<Entity> {
    const { entities } = this.world;
    const c0 = Math.floor(range.col0 / CHUNK);
    const c1 = Math.floor(range.col1 / CHUNK);
    const r0 = Math.floor(range.row0 / CHUNK);
    const r1 = Math.floor(range.row1 / CHUNK);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (!test({ col0: c * CHUNK, col1: c * CHUNK + CHUNK - 1, row0: r * CHUNK, row1: r * CHUNK + CHUNK - 1 })) continue;
        for (const id of this.cells[r * this.columns + c]!) {
          const e = entities.get(id);
          if (e) yield e;
          else this.drop(id);
        }
      }
    }
  }

  /** The map pixel object `e` is drawn at, its sim position on the drawn ground. */
  at(e: Entity): { x: number; y: number } {
    if (e.mover) return this.pixel(e.x, e.y);
    let p = this.anchors.get(e.id);
    if (!p) this.anchors.set(e.id, (p = this.pixel(e.x, e.y)));
    return p;
  }

  private cellAt(e: Entity): number {
    const c = Math.min(Math.max(Math.floor(e.x / CHUNK), 0), this.columns - 1);
    const r = Math.min(Math.max(Math.floor(e.y / CHUNK), 0), this.rows - 1);
    return r * this.columns + c;
  }

  private file(e: Entity): void {
    const cell = this.cellAt(e);
    const before = this.cellOf.get(e.id);
    if (before === cell) return;
    if (before !== undefined) this.cells[before]!.delete(e.id);
    this.cells[cell]!.add(e.id);
    this.cellOf.set(e.id, cell);
  }

  private drop(id: number): void {
    const cell = this.cellOf.get(id);
    if (cell !== undefined) this.cells[cell]!.delete(id);
    this.cellOf.delete(id);
    this.movers.delete(id);
    this.anchors.delete(id);
  }
}
