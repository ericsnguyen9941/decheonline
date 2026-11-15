/**
 * The map operations the random map generator calls (`RGE_Map` src/map.cpp, `TRIBE_Map` src/tmap.cpp,
 * `RGE_Zone_Map` src/zone_map.cpp; docs/spec/random-maps.md): terrain and elevation writes and clean-ups, tile shapes,
 * terrain objects, placement checks, zone maps, and the cliff brush. Tile terrain is 5 bits and height 3 bits
 * (`RGE_Tile`, include/map.h:28). Objects are made through `RmmWorld`, which keeps the RNG draws of object creation;
 * `RmmMap` keeps the per-tile object lists (`tile->objects`, newest first) the checks read.
 */
import type { Entity } from './entities';
import { ObjectState } from './entities';
import type { TileMap } from './map';
import { add32, f32, sub32 } from './num';
import type { CrtRand } from './rng';
import { TERRAIN_OBJECTS, TERRAIN_IMPASSABLE } from './unit-data';
import type { UnitType } from './units';

/** What the generator needs from the world: masters, and creating and removing objects. */
export interface RmmWorld {
  /** `player->master_objects[type]`, null when the player has none. */
  master(owner: number, type: number): UnitType | null;
  /** `make_new_obj` (z 0): create and set up, with its RNG draws. */
  create(owner: number, type: number, x: number, y: number): Entity;
  /** `destroy_obj`: pending removal. */
  destroy(e: Entity): void;
  /** `delete`: gone at once. */
  remove(e: Entity): void;
  /** `build(10000)` for a building. */
  complete(e: Entity): void;
  typeOf(e: Entity): UnitType;
}

const MASTER_TYPE_BUILDING = 80;
/** `-3.051851e-05f`: a draw times this is minus a fraction of a tile. */
const RAND_TILE = f32(-3.051851e-5);
/** `g_static_object_coordinate_epsilon`. */
const EPSILON = f32(0.001);
const BOUNDS = f32(3);
const GAIA = 0;
const CLIFF_FIRST = 264;
const CLIFF_LAST = 273;
export const TERRAIN_CLIFF = 16;

/** One `TRIBE_Master_Cliff_Info`: the piece for a cell whose edges (right, down, left, up) are `info`. */
interface CliffType {
  id: number;
  facet: number;
  id2: number;
  facet2: number;
  offsetX: number;
  offsetY: number;
  info: [number, number, number, number];
}

/** `TRIBE_Map` constructor (src/tmap.cpp:40-59): `[r, d, l, u, id, facet, id2, facet2, offset x, offset y]`. */
const CLIFF_TYPES: readonly (readonly number[])[] = [
  [1, 0, 0, 0, 0x108, 0x10, -1, -1, 1.5, 1.5],
  [0, 1, 0, 0, 0x108, 0x12, -1, -1, 1.5, 1.5],
  [0, 0, 1, 0, 0x108, 0x11, -1, -1, 1.5, 1.5],
  [0, 0, 0, 1, 0x108, 0x13, -1, -1, 1.5, 1.5],
  [-1, 0, 0, 0, 0x10a, 0x14, -1, -1, 1.5, 1.5],
  [0, -1, 0, 0, 0x109, 0x16, -1, -1, 1.5, 1.5],
  [0, 0, -1, 0, 0x10a, 0x15, -1, -1, 1.5, 1.5],
  [0, 0, 0, -1, 0x109, 0x17, -1, -1, 1.5, 1.5],
  [-1, 1, 0, 0, 0x10e, 0, -1, -1, 1.5, 2.0],
  [0, -1, -1, 0, 0x110, 9, -1, -1, 1.0, 2.0],
  [0, 0, 1, -1, 0x10c, 6, -1, -1, 1.0, 1.5],
  [1, 0, 0, 1, 0x108, 3, -1, -1, 1.5, 1.5],
  [1, -1, 0, 0, 0x10b, 0xc, -1, -1, 2.0, 1.5],
  [0, 1, 1, 0, 0x108, 0xf, -1, -1, 1.5, 1.5],
  [0, 0, -1, 1, 0x10d, 0xe, -1, -1, 1.5, 1.0],
  [-1, 0, 0, -1, 0x10f, 0xd, -1, -1, 2.0, 1.0],
  [1, 0, 1, 0, 0x108, 4, 0x108, 5, 1.5, 1.5],
  [0, 1, 0, 1, 0x108, 1, 0x108, 2, 1.5, 1.5],
  [-1, 0, -1, 0, 0x10a, 0xb, 0x10a, 10, 1.5, 1.5],
  [0, -1, 0, -1, 0x109, 8, 0x109, 7, 1.5, 1.5],
];

function cliffIndex(info: readonly number[]): number {
  return ((info[0]! * 4 + info[1]!) * 4 + info[2]!) * 4 + info[3]! + 0x55;
}

function cliffTable(): CliffType[] {
  const table: CliffType[] = Array.from({ length: 0x100 }, () => ({
    id: -1,
    facet: -1,
    id2: -1,
    facet2: -1,
    offsetX: 0,
    offsetY: 0,
    info: [0, 0, 0, 0] as [number, number, number, number],
  }));
  for (const [r, d, l, u, id, facet, id2, facet2, ox, oy] of CLIFF_TYPES) {
    table[cliffIndex([r!, d!, l!, u!])] = {
      id: id!,
      facet: facet!,
      id2: id2!,
      facet2: facet2!,
      offsetX: f32(ox!),
      offsetY: f32(oy!),
      info: [r!, d!, l!, u!],
    };
  }
  return table;
}

/** `TRIBE_Map::water`: water, shallows and deep water. */
export function isWater(terrain: number): boolean {
  return terrain === 1 || terrain === 4 || terrain === 22;
}

/** `RGE_Zone_Map` (src/zone_map.cpp:70-160): 4-connected areas of tiles of one passability, numbered in row order. */
export class ZoneMap {
  readonly zones: Uint8Array;

  constructor(m: RmmMap, readonly passable: readonly boolean[]) {
    const w = m.w;
    const h = m.h;
    this.zones = new Uint8Array(w * h).fill(0xff);
    let counter = 0;
    const queue: number[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (this.zones[y * w + x] !== 0xff) continue;
        if (counter >= 255) counter = 0;
        const group = this.pass(m.terrain[y * w + x]!);
        this.zones[y * w + x] = counter;
        queue.length = 0;
        queue.push(y * w + x);
        while (queue.length > 0) {
          const i = queue.pop()!;
          const cx = i % w;
          const cy = (i - cx) / w;
          const visit = (j: number) => {
            if (this.zones[j] === 0xff && this.pass(m.terrain[j]!) === group) {
              this.zones[j] = counter;
              queue.push(j);
            }
          };
          if (cx > 0) visit(i - 1);
          if (cy > 0) visit(i - w);
          if (cx < w - 1) visit(i + 1);
          if (cy < h - 1) visit(i + w);
        }
        counter++;
      }
    }
  }

  private pass(terrain: number): boolean {
    return this.passable[terrain] ?? false;
  }

  at(w: number, x: number, y: number): number {
    return this.zones[y * w + x]!;
  }
}

export class RmmMap {
  readonly w: number;
  readonly h: number;
  /** Views of the `TileMap`'s arrays. */
  readonly terrain: Uint8Array;
  readonly height: Uint8Array;
  /** `tile_type`: the tile's slope shape, 0 flat (`get_tile_type`). */
  readonly tileType: Uint8Array;
  /** `tile->objects` per tile, newest first. */
  readonly tiles: Entity[][];
  /** `map_zones`: zone maps made for terrain restriction rows, kept until `deleteZoneMaps`. */
  private zoneMaps: ZoneMap[] = [];
  private readonly cliffs = cliffTable();
  private oldCliffX = -1;
  private oldCliffY = -1;
  private safeCliffX = -1;
  private safeCliffY = -1;
  private oldCliffDirection = -1;

  constructor(
    map: TileMap,
    readonly rng: CrtRand,
    readonly world: RmmWorld,
  ) {
    this.w = map.width;
    this.h = map.height;
    this.terrain = map.terrain;
    this.height = map.elevation;
    this.tileType = new Uint8Array(this.w * this.h);
    this.tiles = Array.from({ length: this.w * this.h }, () => []);
  }

  // --- objects -----------------------------------------------------------------------------------------------------

  /** `make_new_obj`. */
  makeNewObj(owner: number, type: number, x: number, y: number): Entity {
    const e = this.world.create(owner, type, x, y);
    this.tiles[Math.trunc(e.y) * this.w + Math.trunc(e.x)]!.unshift(e);
    return e;
  }

  /** `TRIBE_Player::make_new_object(id, x, y, 0, build_all_the_way)` (src/tplayer.cpp:657). */
  makeNewObject(owner: number, type: number, x: number, y: number, buildAllTheWay: boolean): Entity | null {
    const t = this.world.master(owner, type);
    if (type < 0 || !t) return null;
    const e = this.makeNewObj(owner, type, x, y);
    if (buildAllTheWay) {
      this.checkDestructables(owner, type, x, y, false);
      if (t.masterType === MASTER_TYPE_BUILDING) this.world.complete(e);
    }
    return e;
  }

  /** `delete object`. */
  deleteObject(e: Entity): void {
    const list = this.tiles[Math.trunc(e.y) * this.w + Math.trunc(e.x)]!;
    const i = list.indexOf(e);
    if (i !== -1) list.splice(i, 1);
    this.world.remove(e);
  }

  private dispose(e: Entity, deleteObj: boolean): void {
    if (deleteObj) this.deleteObject(e);
    else this.world.destroy(e);
  }

  /** `TRIBE_World::check_destructables` (src/tworld.cpp:272): what can be built on and overlaps goes. */
  checkDestructables(owner: number, type: number, col: number, row: number, deleteFlag: boolean): void {
    const t = this.world.master(owner, type);
    if (!t || !(t.radiusX > 0 || t.radiusY > 0)) return;
    let x0 = Math.trunc(sub32(col, BOUNDS));
    let y0 = Math.trunc(sub32(row, BOUNDS));
    let x1 = Math.trunc(add32(col, BOUNDS));
    let y1 = Math.trunc(add32(row, BOUNDS));
    if (x0 < 0) x0 = 0;
    if (x1 >= this.w) x1 = this.w - 1;
    if (y0 < 0) y0 = 0;
    if (y1 >= this.h) y1 = this.h - 1;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        for (const o of [...this.tiles[y * this.w + x]!]) {
          const ot = this.world.typeOf(o);
          if (ot.id === type || ot.canBeBuiltOn === 0) continue;
          const dy = Math.abs(sub32(o.y, row));
          const dx = Math.abs(sub32(o.x, col));
          if (dx < add32(ot.radiusX, t.radiusX) && dy < add32(ot.radiusY, t.radiusY)) this.dispose(o, deleteFlag);
        }
      }
    }
  }

  /**
   * `RGE_Master_Static_Object::check_placement` (src/m_s_obj.cpp:843) without the visibility test: 0 when `t` fits at
   * (col, row), else 7 off the map, 1 tile requirement, 2 terrain, 3 slope, 6 an object in the way.
   */
  checkPlacement(t: UnitType, col: number, row: number, flat: boolean, construction: boolean, builtOn: boolean, objects: boolean): number {
    const w = this.w;
    const rx = construction ? t.clearanceX : t.radiusX;
    const ry = construction ? t.clearanceY : t.radiusY;
    const minX = sub32(col, rx);
    const maxX = sub32(add32(col, rx), EPSILON);
    const minY = sub32(row, ry);
    const maxY = sub32(add32(row, ry), EPSILON);
    if (!(minX >= 0) || !(maxX < w) || !(minY >= 0) || !(maxY < this.h)) return 7;
    const x1 = Math.trunc(minX);
    const x2 = Math.trunc(maxX);
    const y1 = Math.trunc(minY);
    const y2 = Math.trunc(maxY);
    let ex1 = x1;
    let ex2 = x2;
    let ey1 = y1;
    let ey2 = y2;
    const [c1, c2] = t.placementTerrain;
    if (c1 >= 0 || c2 >= 0) {
      const cy = Math.trunc(row);
      const cx = Math.trunc(col);
      const center = this.terrain[cy * w + cx]!;
      if (center !== c1 && center !== c2) return 1;
      ex1 = ex2 = cx;
      ey1 = ey2 = cy;
    }
    const [r1, r2] = t.placementSideTerrain;
    if (r1 >= 0 || r2 >= 0) {
      let found = false;
      const look = (x: number, y: number) => {
        const terrain = this.terrain[y * w + x]!;
        if (terrain === r1 || terrain === r2) found = true;
      };
      if (ey1 - 1 >= 0) for (let x = ex1; x <= ex2; x++) look(x, ey1 - 1);
      if (ex2 + 1 < w) for (let y = ey1; y <= ey2; y++) look(ex2 + 1, y);
      if (ey2 + 1 < this.h) for (let x = ex2; x >= ex1; x--) look(x, ey2 + 1);
      if (ex1 - 1 >= 0) for (let y = ey2; y >= ey1; y--) look(ex1 - 1, y);
      if (!found) return 1;
    }
    for (let x = x1; x <= x2; x++) {
      for (let y = y1; y <= y2; y++) {
        if (!((t.terrainTable[this.terrain[y * w + x]!] ?? 0) > 0)) return 2;
        if (flat) {
          const shape = this.tileType[y * w + x]!;
          if (t.elevationMode === 1) {
            if (shape !== 0 && shape !== 5 && shape !== 7 && shape !== 6 && shape !== 8) return 3;
          } else if (t.elevationMode === 2 && shape !== 0) return 3;
        }
      }
    }
    if (!(rx > 0) && !(ry > 0)) return 0;
    if (!objects || !(builtOn || t.radiusZ > 0)) return 0;
    let ox0 = Math.trunc(sub32(col, BOUNDS));
    let oy0 = Math.trunc(sub32(row, BOUNDS));
    let ox1 = Math.trunc(add32(col, BOUNDS));
    let oy1 = Math.trunc(add32(row, BOUNDS));
    if (ox0 < 0) ox0 = 0;
    if (ox1 >= w) ox1 = w - 1;
    if (oy0 < 0) oy0 = 0;
    if (oy1 >= this.h) oy1 = this.h - 1;
    for (let y = oy0; y <= oy1; y++) {
      for (let x = ox0; x <= ox1; x++) {
        for (const o of this.tiles[y * w + x]!) {
          if (o.state >= ObjectState.PendingRemoval) continue;
          const ot = this.world.typeOf(o);
          if (builtOn && ot.canBeBuiltOn === 1 && t.canBeBuiltOn === 0) continue;
          if (!(ot.radiusX > 0) || !(ot.radiusY > 0)) continue;
          if (ot.radiusZ > 0 !== t.radiusZ > 0) continue;
          const dy = Math.abs(sub32(o.y, row));
          const dx = Math.abs(sub32(o.x, col));
          if (!(dx >= add32(ot.radiusX, rx)) && !(dy >= add32(ot.radiusY, ry))) return 6;
        }
      }
    }
    return 0;
  }

  /** `RGE_Master_Static_Object::alignment(col, row, world, 1)` (src/m_s_obj.cpp:1058): snap a footprint to tiles. */
  alignment(t: UnitType, col: number, row: number): [number, number] {
    let dx1 = sub32(col, t.radiusX);
    let dy1 = sub32(row, t.radiusY);
    let dx2 = add32(col, t.radiusX);
    let dy2 = add32(row, t.radiusY);
    const mapW = sub32(this.w, f32(0.00001));
    const mapH = sub32(this.h, f32(0.00001));
    if (dx1 < 0) {
      dx1 = -dx1;
      dx2 = add32(dx2, dx1);
      col = add32(col, dx1);
      dx1 = 0;
    }
    if (dy1 < 0) {
      dy1 = -dy1;
      dy2 = add32(dy2, dy1);
      row = add32(row, dy1);
      dy1 = 0;
    }
    if (dx2 >= mapW) {
      dx1 = add32(dx1, sub32(mapW, dx2));
      col = add32(col, sub32(mapW, dx2));
      dx2 = mapW;
    }
    if (dy2 >= mapH) {
      dy1 = add32(dy1, sub32(mapH, dy2));
      row = add32(row, sub32(mapH, dy2));
      dy2 = mapH;
    }
    dx1 = Math.abs(dx1);
    dy1 = Math.abs(dy1);
    dx2 = Math.abs(dx2);
    dy2 = Math.abs(dy2);
    dx1 = sub32(dx1, Math.trunc(dx1));
    dy1 = sub32(dy1, Math.trunc(dy1));
    dx2 = sub32(1, sub32(dx2, Math.trunc(dx2)));
    dy2 = sub32(1, sub32(dy2, Math.trunc(dy2)));
    let x = col;
    let y = row;
    if (add32(dx1, dx2) >= 1) x = dx1 > dx2 ? add32(col, sub32(1, dx1)) : sub32(col, sub32(1, dx2));
    if (add32(dy1, dy2) >= 1) y = dy1 > dy2 ? add32(row, sub32(1, dy1)) : sub32(row, sub32(1, dy2));
    return [x, y];
  }

  // --- terrain objects ---------------------------------------------------------------------------------------------

  /** True when `type` is in the object list of terrain `terrain` (the original also reads one slot past its end). */
  private inTerrainList(terrain: number, type: number): boolean {
    return (TERRAIN_OBJECTS[terrain]?.[0] ?? []).includes(type);
  }

  /** The placement loop of `create_terrain_object` / `place_terrain_object` (fill flag 0), src/map.cpp:1679-1724. */
  private placeTerrainObjects(owner: number, row: number, col: number): void {
    const [ids, densities, centred] = TERRAIN_OBJECTS[this.terrain[row * this.w + col]!] ?? [[], [], []];
    for (let i = 0; i < ids!.length; i++) {
      const type = ids![i]!;
      if (type === -1) continue;
      const t = this.world.master(owner, type);
      let density = densities![i]!;
      const flag = centred![i]!;
      if (!t || !(density > 0)) continue;
      let left = density;
      let x = 0;
      let y = 0;
      do {
        if (flag === 0) {
          x = sub32(col, f32(this.rng.rand() * RAND_TILE));
          y = sub32(row, f32(this.rng.rand() * RAND_TILE));
        } else if (flag === 1) {
          x = f32(col + 0.5);
          y = f32(row + 0.5);
        }
        const place = density >= 1000 || Math.trunc((this.rng.rand() * 1000) / 0x7fff) < left;
        if (place && this.checkPlacement(t, x, y, true, true, false, true) === 0) this.makeNewObj(owner, type, x, y);
        density -= 1000;
        left -= 1000;
      } while (density > 0);
    }
  }

  /** `create_terrain_object` (src/map.cpp:1643): clear the owner's objects of the old terrain, then place the new. */
  createTerrainObject(owner: number, row: number, col: number, oldTerrain: number, deleteObj: boolean): void {
    const i = row * this.w + col;
    if ((TERRAIN_OBJECTS[this.terrain[i]!]?.[0]?.length ?? 0) === 0) return;
    for (const o of [...this.tiles[i]!]) {
      if (o.owner !== owner) continue;
      if (oldTerrain < 0 || this.inTerrainList(oldTerrain, o.type)) this.dispose(o, deleteObj);
    }
    this.placeTerrainObjects(owner, row, col);
  }

  /**
   * `clear_terrain_object(row, col, old, 1, 0, 0)` (src/map.cpp:1729): every object but type 0 that belonged to the old
   * terrain, or no longer fits, is deleted.
   */
  private clearTerrainObject(row: number, col: number, oldTerrain: number): void {
    for (const o of [...this.tiles[row * this.w + col]!]) {
      if (o.type === 0) continue;
      if (oldTerrain < 0 || this.inTerrainList(oldTerrain, o.type)) {
        this.deleteObject(o);
        continue;
      }
      if (this.checkPlacement(this.world.typeOf(o), o.x, o.y, true, true, false, false) !== 0) this.deleteObject(o);
    }
  }

  // --- terrain -----------------------------------------------------------------------------------------------------

  /** The one-tile `set_terrain(world, col, row, terrain, 0, 0)` (src/map.cpp:2140): Gaia's terrain objects follow. */
  setTerrain(col: number, row: number, terrain: number): void {
    const i = row * this.w + col;
    const old = this.terrain[i]!;
    if (old === terrain) return;
    this.terrain[i] = terrain;
    this.clearTerrainObject(row, col, old);
    this.placeTerrainObjects(GAIA, row, col);
  }

  /**
   * The area `set_terrain(owner, world, x1, y1, x2, y2, terrain, set_flag, delete_obj)` (src/map.cpp:2187). The
   * original first checks the terrain has a frame for each tile's shape; every terrain it is called with (0, 1, 16)
   * has all 17 shapes, so the check always passes.
   */
  setTerrainArea(owner: number | null, x1: number, y1: number, x2: number, y2: number, terrain: number, set: boolean, deleteObj: boolean): void {
    if (y1 > y2) [y1, y2] = [y2, y1];
    if (x1 > x2) [x1, x2] = [x2, x1];
    if (y1 < 0) y1 = 0;
    if (y2 >= this.h) y2 = this.h - 1;
    if (x1 < 0) x1 = 0;
    if (x2 >= this.w) x2 = this.w - 1;
    if (!set && owner === null) return;
    for (let row = y1; row <= y2; row++) {
      for (let col = x1; col <= x2; col++) {
        const i = row * this.w + col;
        const old = this.terrain[i]!;
        if (old !== terrain && set) this.terrain[i] = terrain;
        if (owner !== null) this.createTerrainObject(owner, row, col, old, deleteObj);
      }
    }
  }

  /** The 8-neighbour diagonal test shared by `clean_terrain`'s second pass and `clean_elevation`. */
  private static diagonalFix(nw: boolean, n: boolean, ne: boolean, e: boolean, se: boolean, s: boolean, sw: boolean, w: boolean): boolean {
    if (nw && ((ne && !n) || (e && !ne) || (sw && !w) || (s && !sw) || (se && !s && !e))) return true;
    if (ne && ((nw && !n) || (w && !nw) || (se && !e) || (s && !se) || (sw && !w && !s))) return true;
    if (se && ((ne && !e) || (n && !ne) || (sw && !s) || (w && !sw) || (nw && !w && !n))) return true;
    if (sw && ((nw && !w) || (n && !nw) || (se && !s) || (e && !se) || (ne && !e && !n))) return true;
    return false;
  }

  /** `RGE_Map::clean_terrain` (src/map.cpp:843): fill one-tile gaps and pinches with `replacement`, until stable. */
  cleanTerrain(x1: number, y1: number, x2: number, y2: number, replacement: number): void {
    const w = this.w;
    if (x1 < 0) x1 = 0;
    if (y1 < 0) y1 = 0;
    if (x2 >= w) x2 = w - 1;
    if (y2 >= this.h) y2 = this.h - 1;
    for (;;) {
      let changed = false;
      if (x1 > 0) x1--;
      if (y1 > 0) y1--;
      if (x2 < w - 1) x2++;
      if (y2 < this.h - 1) y2++;
      for (let pass = 0; pass < 2; pass++) {
        for (let row = y1; row <= y2; row++) {
          for (let col = x1; col <= x2; col++) {
            const i = row * w + col;
            if (this.terrain[i] === replacement) continue;
            const is = (j: number) => this.terrain[j] === replacement;
            const n = row > 0 && is(i - w);
            const s = row < this.h - 1 && is(i + w);
            const west = col > 0 && is(i - 1);
            const east = col < w - 1 && is(i + 1);
            let fix: boolean;
            if (pass === 0) fix = (n && s) || (east && west);
            else {
              const nw = row > 0 && col > 0 && is(i - w - 1);
              const ne = row > 0 && col < w - 1 && is(i - w + 1);
              const sw = row < this.h - 1 && col > 0 && is(i + w - 1);
              const se = row < this.h - 1 && col < w - 1 && is(i + w + 1);
              fix = RmmMap.diagonalFix(nw, n, ne, east, se, s, sw, west);
            }
            if (fix) {
              this.setTerrain(col, row, replacement);
              changed = true;
            }
          }
        }
      }
      if (!changed) return;
    }
  }

  // --- elevation ---------------------------------------------------------------------------------------------------

  heightAt(x: number, y: number): number {
    return this.height[y * this.w + x]!;
  }

  setHeight(i: number, value: number): void {
    this.height[i] = value & 7;
  }

  /** `RGE_Map::get_tile_type` (src/map.cpp:2268): the slope shape from the 8 neighbours' heights. */
  getTileType(col: number, row: number): number {
    const w = this.w;
    const h = this.h;
    if (col < 0 || col >= w || row < 0 || row >= h) return 0;
    const c = this.heightAt(col, row);
    const up = c + 1;
    const down = c - 1;
    const nw = row > 0 && col < w - 1 ? this.heightAt(col + 1, row - 1) : c;
    const n = row > 0 ? this.heightAt(col, row - 1) : c;
    const e = col < w - 1 ? this.heightAt(col + 1, row) : c;
    const sw = col > 0 && row < h - 1 ? this.heightAt(col - 1, row + 1) : c;
    const west = col > 0 ? this.heightAt(col - 1, row) : c;
    const s = row < h - 1 ? this.heightAt(col, row + 1) : c;
    const ne = row > 0 && col > 0 ? this.heightAt(col - 1, row - 1) : c;
    const se = row < h - 1 && col < w - 1 ? this.heightAt(col + 1, row + 1) : c;
    if (n === up && e === up) return 0x0e;
    if (west === up && s === up) return 0x0d;
    if (n === up && west === up) return 0x10;
    if (e === up && s === up) return 0x0f;
    if (n === up) return 6;
    if (e === up) return 8;
    if (west === up) return 5;
    if (s === up) return 7;
    if (nw === up) return west === down && s === down ? 2 : 0x0a;
    if (sw === up) return n === down && e === down ? 1 : 9;
    if (ne === up) return e === down && s === down ? 3 : 0x0b;
    if (se === up) return n === down && west === down ? 4 : 0x0c;
    return 0;
  }

  /** `set_elev(x1, y1, x2, y2, 0, 0, 0)`: recompute the tile shapes one tile around the area. */
  refreshTileTypes(x1: number, y1: number, x2: number, y2: number): void {
    if (y1 > y2) [y1, y2] = [y2, y1];
    if (x1 > x2) [x1, x2] = [x2, x1];
    if (y1 < 0) y1 = 0;
    if (y2 >= this.h) y2 = this.h - 1;
    if (x1 < 0) x1 = 0;
    if (x2 >= this.w) x2 = this.w - 1;
    if (y1 > 0) y1--;
    if (y2 < this.h - 1) y2++;
    if (x1 > 0) x1--;
    if (x2 < this.w - 1) x2++;
    for (let row = y1; row <= y2; row++) {
      for (let col = x1; col <= x2; col++) this.tileType[row * this.w + col] = this.getTileType(col, row);
    }
  }

  /** `postclean_elevation` (src/map.cpp:530): step tiles toward `level` where a neighbour is more than one off. */
  private postcleanElevation(x1: number, y1: number, x2: number, y2: number, level: number): boolean {
    const w = this.w;
    let bad = false;
    if (x1 > 0) x1--;
    if (y1 > 0) y1--;
    if (x2 < w - 1) x2++;
    if (y2 < this.h - 1) y2++;
    for (let row = y1; row <= y2; row++) {
      for (let col = x1; col <= x2; col++) {
        const i = row * w + col;
        const current = this.height[i]!;
        let next = current;
        let fix = false;
        const higher = (j: number) => this.height[j]! > next;
        const lower = (j: number) => this.height[j]! < next;
        const test = current < level ? higher : current > level ? lower : null;
        if (test) {
          next = current < level ? current + 1 : current - 1;
          if (row > 0 && test(i - w)) fix = true;
          if (row < this.h - 1 && test(i + w)) fix = true;
          if (col > 0 && test(i - 1)) fix = true;
          if (col < w - 1 && test(i + 1)) fix = true;
          if (row > 0) {
            if (col > 0 && test(i - w - 1)) fix = true;
            if (col < w - 1 && test(i - w + 1)) fix = true;
          }
          if (row < this.h - 1) {
            if (col > 0 && test(i + w - 1)) fix = true;
            if (col < w - 1 && test(i + w + 1)) fix = true;
          }
        }
        if (fix) {
          bad = true;
          this.setHeight(i, next);
        }
      }
    }
    return bad;
  }

  /** `preclean_elevation` (src/map.cpp:618): a tile between two higher opposite neighbours is evened out. */
  private precleanElevation(x1: number, y1: number, x2: number, y2: number, level: number): void {
    const w = this.w;
    let changed: boolean;
    do {
      changed = false;
      if (x1 > 0) x1--;
      if (y1 > 0) y1--;
      if (x2 < w - 1) x2++;
      if (y2 < this.h - 1) y2++;
      for (let row = y1; row <= y2; row++) {
        for (let col = x1; col <= x2; col++) {
          const i = row * w + col;
          const elevation = this.height[i]!;
          const up = (j: number) => this.height[j]! > elevation;
          const n = row > 0 && up(i - w);
          const s = row < this.h - 1 && up(i + w);
          const west = col > 0 && up(i - 1);
          const e = col < w - 1 && up(i + 1);
          const nw = row > 0 && col > 0 && up(i - w - 1);
          const ne = row > 0 && col < w - 1 && up(i - w + 1);
          const sw = row < this.h - 1 && col > 0 && up(i + w - 1);
          const se = row < this.h - 1 && col < w - 1 && up(i + w + 1);
          if (!((n && s) || (e && west))) continue;
          if (elevation >= level) {
            if (nw) this.setHeight(i - w - 1, elevation);
            if (n) this.setHeight(i - w, elevation);
            if (ne) this.setHeight(i - w + 1, elevation);
            if (e) this.setHeight(i + 1, elevation);
            if (se) this.setHeight(i + w + 1, elevation);
            if (s) this.setHeight(i + w, elevation);
            if (sw) this.setHeight(i + w - 1, elevation);
            if (west) this.setHeight(i - 1, elevation);
          } else {
            this.setHeight(i, elevation + 1);
          }
          changed = true;
        }
      }
    } while (changed);
  }

  /** `RGE_Map::clean_elevation` (src/map.cpp:709), then `set_elev` over the cleaned area. */
  cleanElevation(x1: number, y1: number, x2: number, y2: number, level: number): void {
    const w = this.w;
    if (x1 < 0) x1 = 0;
    if (y1 < 0) y1 = 0;
    if (x2 >= w) x2 = w - 1;
    if (y2 >= this.h) y2 = this.h - 1;
    for (;;) {
      let changed = false;
      x1 = Math.max(0, x1 - 2);
      y1 = Math.max(0, y1 - 2);
      x2 = Math.min(w - 1, x2 + 2);
      y2 = Math.min(this.h - 1, y2 + 2);
      this.precleanElevation(x1, y1, x2, y2, level);
      for (let row = y1; row <= y2; row++) {
        for (let col = x1; col <= x2; col++) {
          const i = row * w + col;
          const current = this.height[i]!;
          const up = (j: number) => this.height[j]! > current;
          const n = row > 0 && up(i - w);
          const s = row < this.h - 1 && up(i + w);
          const west = col > 0 && up(i - 1);
          const e = col < w - 1 && up(i + 1);
          const nw = row > 0 && col > 0 && up(i - w - 1);
          const ne = row > 0 && col < w - 1 && up(i - w + 1);
          const sw = row < this.h - 1 && col > 0 && up(i + w - 1);
          const se = row < this.h - 1 && col < w - 1 && up(i + w + 1);
          if (!RmmMap.diagonalFix(nw, n, ne, e, se, s, sw, west)) continue;
          if (current >= level) {
            if (nw) this.setHeight(i - w - 1, current);
            if (n) this.setHeight(i - w, current);
            if (ne) this.setHeight(i - w + 1, current);
            if (e) this.setHeight(i + 1, current);
            if (se) this.setHeight(i + w + 1, current);
            if (s) this.setHeight(i + w, current);
            if (sw) this.setHeight(i + w - 1, current);
            if (west) this.setHeight(i - 1, current);
          } else {
            this.setHeight(i, current + 1);
          }
          changed = true;
        }
      }
      if (this.postcleanElevation(x1, y1, x2, y2, level)) changed = true;
      if (!changed) {
        this.refreshTileTypes(x1, y1, x2, y2);
        return;
      }
    }
  }

  // --- zone maps ---------------------------------------------------------------------------------------------------

  /** `RGE_Zone_Map_List::get_zone_map` (src/zone_map.cpp:429): reuse a map of the same passability, else make one. */
  zoneMap(terrainTable: readonly number[]): ZoneMap {
    const passable = Array.from({ length: 32 }, (_, i) => (terrainTable[i] ?? 0) > 0);
    for (const z of this.zoneMaps) if (z.passable.length === 32 && z.passable.every((p, i) => p === passable[i])) return z;
    const z = new ZoneMap(this, passable);
    this.zoneMaps.push(z);
    return z;
  }

  /**
   * `create_zone_map(table, 99)` with `table[i] = i` (src/rmm_terr.cpp:31-39): grass (0) one class, every other
   * terrain the other. Its 99-entry table never matches a terrain restriction row, so it is not shared.
   */
  terrainZoneMap(): ZoneMap {
    const z = new ZoneMap(
      this,
      Array.from({ length: 99 }, (_, i) => i > 0),
    );
    this.zoneMaps.push(z);
    return z;
  }

  deleteZoneMaps(): void {
    this.zoneMaps = [];
  }

  // --- TRIBE terrain brush and cliffs (src/tmap.cpp) ---------------------------------------------------------------

  /** `TRIBE_Map::do_terrain_brush_check`: no sloped tile around (x, y). */
  private brushCheck(x: number, y: number): boolean {
    const w = this.w;
    const i = y * w + x;
    const t = this.tileType;
    if (x > 0 && t[i - 1] !== 0) return false;
    if (x < w - 1 && t[i + 1] !== 0) return false;
    if (y > 0) {
      if (t[i - w] !== 0) return false;
      if (x > 0 && t[i - w - 1] !== 0) return false;
      if (x < w - 1 && t[i - w + 1] !== 0) return false;
    }
    if (y < this.h - 1) {
      if (t[i + w] !== 0) return false;
      if (x > 0 && t[i + w - 1] !== 0) return false;
      if (x < w - 1 && t[i + w + 1] !== 0) return false;
    }
    return true;
  }

  /** `TRIBE_Map::do_terrain_brush`. */
  private terrainBrush(x: number, y: number, size: number, terrain: number): void {
    const x1 = Math.max(0, x - size);
    const x2 = Math.min(this.w - 1, x + size);
    const y1 = Math.max(0, y - size);
    const y2 = Math.min(this.h - 1, y + size);
    const water = isWater(terrain);
    for (let cy = y1; cy <= y2; cy++) {
      for (let cx = x1; cx <= x2; cx++) if (!water || this.brushCheck(cx, cy)) this.setTerrain(cx, cy, terrain);
    }
  }

  /** `RGE_Map::do_*_brush_stroke`'s walk: `brush` at the start, each step along the line, and the end if missed. */
  private stroke(x1: number, y1: number, x2: number, y2: number, brush: (x: number, y: number) => void): void {
    if (x1 < 0) x1 = 0;
    if (x2 >= this.w) x2 = this.w - 1;
    if (y1 < 0) y1 = 0;
    if (y2 >= this.h) y2 = this.h - 1;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const steps = Math.trunc(Math.sqrt(dx * dx + dy * dy));
    const stepX = dx / steps;
    const stepY = dy / steps;
    let x = x1;
    let y = y1;
    brush(x1, y1);
    for (let n = steps; n > 0; n--) {
      x = stepX + x;
      y = stepY + y;
      brush(Math.trunc(x), Math.trunc(y));
    }
    if (x2 !== x || y2 !== y) brush(x2, y2);
  }

  /** `TRIBE_Map::do_terrain_brush_stroke` (src/tmap.cpp:234): the stroke, then `tribe_clean_terrain` around it. */
  terrainBrushStroke(x1: number, y1: number, x2: number, y2: number, size: number, terrain: number): void {
    const half = size >> 1;
    this.stroke(x1, y1, x2, y2, (x, y) => this.terrainBrush(x, y, half, terrain));
    if (x1 < x2) {
      x1 -= size;
      x2 += size;
    } else {
      const tmp = x1;
      x1 = x2 - size;
      x2 = tmp + size;
    }
    if (y1 < y2) {
      y1 -= size;
      y2 += size;
    } else {
      const tmp = y1;
      y1 = y2 - size;
      y2 = tmp + size;
    }
    this.tribeCleanTerrain(x1 - 2, y1 - 2, x2 + 2, y2 + 2, terrain);
  }

  /** `TRIBE_Map::tribe_clean_terrain(x1, y1, x2, y2, 1, replacement)` (src/tmap.cpp:874), then `clean_borders`. */
  private tribeCleanTerrain(x1: number, y1: number, x2: number, y2: number, replacement: number): void {
    const w = this.w;
    if (x1 < 0) x1 = 0;
    if (y1 < 0) y1 = 0;
    if (x2 >= w) x2 = w - 1;
    if (y2 >= this.h) y2 = this.h - 1;
    let changed: boolean;
    do {
      changed = false;
      if (x1 > 0) x1--;
      if (y1 > 0) y1--;
      if (x2 < w - 1) x2++;
      if (y2 < this.h - 1) y2++;
      for (let pass = 0; pass < 2; pass++) {
        for (let row = y1; row <= y2; row++) {
          for (let col = x1; col <= x2; col++) {
            const i = row * w + col;
            if (isWater(this.terrain[i]!)) continue;
            const wet = (j: number) => isWater(this.terrain[j]!);
            const p3 = row > 0 && wet(i - w);
            const p7 = row < this.h - 1 && wet(i + w);
            const west = col > 0 && wet(i - 1);
            const p5 = col < w - 1 && wet(i + 1);
            const p2 = row > 0 && col > 0 && wet(i - w - 1);
            const p4 = row > 0 && col < w - 1 && wet(i - w + 1);
            const p8 = row < this.h - 1 && col > 0 && wet(i + w - 1);
            const p6 = row < this.h - 1 && col < w - 1 && wet(i + w + 1);
            let fix = false;
            if (pass === 0) fix = (p3 && p7) || (p5 && west);
            else {
              if (p2 && ((p4 && !p3) || (p5 && !p4) || (p8 && !west) || (p7 && !p8) || (p6 && !p7 && !p5))) fix = true;
              if (p4 && !fix && ((p2 && !p3) || (west && !p2) || (p6 && !p5) || (p7 && !p6) || (p8 && !west && !p7))) fix = true;
              if (p6 && !fix && ((p4 && !p5) || (p3 && !p4) || (p8 && !p7) || (west && !p8) || (p2 && !west && !p3))) fix = true;
              if (p8 && !fix && ((p2 && !west) || (p3 && !p2) || (p6 && !p7) || (p5 && !p6) || (p4 && !p5 && !p3))) fix = true;
            }
            if (!fix) continue;
            if (!isWater(replacement)) {
              if (p2) this.setTerrain(col - 1, row - 1, replacement);
              if (p3) this.setTerrain(col, row - 1, replacement);
              if (p4) this.setTerrain(col + 1, row - 1, replacement);
              if (p5) this.setTerrain(col + 1, row, replacement);
              if (p6) this.setTerrain(col + 1, row + 1, replacement);
              if (p7) this.setTerrain(col, row + 1, replacement);
              if (p8) this.setTerrain(col - 1, row + 1, replacement);
              if (west) this.setTerrain(col - 1, row, replacement);
            } else {
              if (!this.brushCheck(col, row)) continue;
              this.setTerrain(col, row, replacement);
            }
            changed = true;
          }
        }
      }
    } while (changed);
    this.cleanBorders(x1, y1, x2, y2, replacement);
  }

  /** `TRIBE_Map::clean_borders` (src/tmap.cpp:761): beach only next to water. */
  private cleanBorders(x1: number, y1: number, x2: number, y2: number, terrain: number): void {
    const w = this.w;
    const maxX = w - 1;
    const maxY = this.h - 1;
    if (x1 < 0) x1 = 0;
    if (y1 < 0) y1 = 0;
    if (x2 >= w) x2 = maxX;
    if (y2 >= this.h) y2 = maxY;
    for (let y = y1; y <= y2; y++) {
      for (let x = x1; x <= x2; x++) {
        const i = y * w + x;
        const here = this.terrain[i]!;
        if (here !== 2 && isWater(here)) continue;
        const wet = (j: number) => isWater(this.terrain[j]!);
        let border = (y > 0 && wet(i - w)) || (y < maxY && wet(i + w));
        if (x > 0 && (wet(i - 1) || (y > 0 && wet(i - w - 1)) || (y < maxY && wet(i + w - 1)))) border = true;
        if (x < maxX && (wet(i + 1) || (y > 0 && wet(i - w + 1)) || (y < maxY && wet(i + w + 1)))) border = true;
        if (here === 2) {
          if (!border) this.setTerrain(x, y, terrain);
        } else if (border) {
          this.setTerrain(x, y, 2);
        }
      }
    }
  }

  /** `TRIBE_Map::find_cliff`: the cliff piece on cell (x, y)'s centre tiles. */
  private findCliff(x: number, y: number): Entity | null {
    const x1 = x * 3 + 1;
    const y1 = y * 3 + 1;
    if (x1 + 1 > this.w || y1 + 1 > this.h) return null;
    for (const [cx, cy] of [
      [x1, y1],
      [x1, y1 + 1],
      [x1 + 1, y1],
      [x1 + 1, y1 + 1],
    ] as const) {
      for (const o of this.tiles[cy * this.w + cx] ?? []) if (o.type >= CLIFF_FIRST && o.type <= CLIFF_LAST) return o;
    }
    return null;
  }

  private cliffInfo(cliff: Entity | null): [number, number, number, number] {
    if (!cliff) return [0, 0, 0, 0];
    for (const c of this.cliffs) {
      if ((c.id === cliff.type && c.facet === cliff.facet) || (c.id2 === cliff.type && c.facet2 === cliff.facet)) return [...c.info];
    }
    return [0, 0, 0, 0];
  }

  private cliffValid(info: readonly number[]): boolean {
    return this.cliffs[cliffIndex(info)]!.id >= 0;
  }

  /** `TRIBE_Map::make_new_cliff` (src/tmap.cpp:381): a piece (one draw when it has a variant), clearing beneath it. */
  private makeNewCliff(x: number, y: number, info: readonly number[]): void {
    const c = this.cliffs[cliffIndex(info)]!;
    const wx = add32(f32(x * 3), c.offsetX);
    const wy = add32(f32(y * 3), c.offsetY);
    let id = c.id;
    let facet = c.facet;
    if (c.id2 > -1 && this.rng.rand() * 2 > 0x7fff) {
      id = c.id2;
      facet = c.facet2;
    }
    if (id < 0) return;
    const cliff = this.makeNewObject(GAIA, id, wx, wy, false);
    if (cliff) cliff.facet = facet & 0xff;
    this.checkDestructables(GAIA, id, wx, wy, true);
  }

  private static reverse(direction: number): number {
    const r = direction + 2;
    return r >= 4 ? r - 4 : r;
  }

  /** `TRIBE_Map::remove_cliff_edge` (src/tmap.cpp:423). */
  private removeCliffEdge(x: number, y: number, direction: number): void {
    switch (direction) {
      case 0:
        x++;
        if (x >= this.w) return;
        break;
      case 2:
        if (x <= 0) return;
        x--;
        break;
      case 3:
        if (y <= 0) return;
        y--;
        break;
      case 1:
        y++;
        if (y >= this.h) return;
        break;
    }
    const cliff = this.findCliff(x, y);
    const info = this.cliffInfo(cliff);
    if (!cliff) return;
    this.deleteObject(cliff);
    info[RmmMap.reverse(direction)] = 0;
    this.makeNewCliff(x, y, info);
  }

  /** `TRIBE_Map::add_cliff_edge` (src/tmap.cpp:479). */
  private addCliffEdge(x: number, y: number, direction: number, facing: number, saveDirection: number): number {
    const cliff = this.findCliff(x, y);
    const info = this.cliffInfo(cliff);
    let facing1 = -1;
    let direction1 = 0;
    let facing2 = -1;
    let direction2 = 0;
    if (info[direction] !== 0) {
      if (facing === 0) return info[direction]!;
      if (facing === info[direction]) return facing;
    }
    if (cliff) this.deleteObject(cliff);
    if (saveDirection === direction) saveDirection = -1;
    if (saveDirection >= 0) {
      for (let i = 0; i < 4; i++) {
        if (i === saveDirection) continue;
        this.removeCliffEdge(x, y, i);
        info[i] = 0;
      }
    } else {
      let count = 0;
      for (let i = 0; i < 4; i++) if (info[i] !== 0 && i !== direction) count++;
      if (count === 2) {
        for (let i = 0; i < 4; i++) {
          if (info[i] === 0 || i === direction) continue;
          if (facing1 < 0) {
            facing1 = i;
            direction1 = info[i]!;
          } else {
            facing2 = i;
            direction2 = info[i]!;
          }
          info[i] = 0;
        }
      }
    }
    let result: number;
    const removeOthers = () => {
      for (let i = 0; i < 4; i++) {
        if (i !== direction && info[i] !== 0) {
          this.removeCliffEdge(x, y, i);
          info[i] = 0;
        }
      }
    };
    if (facing !== 0) {
      result = facing;
      info[direction] = facing;
      if (facing1 > -1) {
        info[facing1] = direction1;
        if (!this.cliffValid(info)) {
          info[facing1] = 0;
          this.removeCliffEdge(x, y, facing1);
        }
      }
      if (facing2 > -1) {
        info[facing2] = direction2;
        if (!this.cliffValid(info)) {
          info[facing2] = 0;
          this.removeCliffEdge(x, y, facing2);
        }
      }
      if (!this.cliffValid(info)) removeOthers();
    } else {
      result = info[direction] = 1;
      // Try the two saved edges with this facing, then with the other.
      const tryEdge = (f: number, d: number, clear: () => void): boolean => {
        if (f <= -1) return false;
        info[f] = d;
        if (!this.cliffValid(info)) {
          info[f] = 0;
          return false;
        }
        clear();
        return true;
      };
      const clear1 = () => {
        direction1 = 0;
      };
      const clear2 = () => {
        direction2 = 0;
      };
      if (!tryEdge(facing1, direction1, clear1) && !tryEdge(facing2, direction2, clear2) && !this.cliffValid(info)) {
        result = info[direction] = -1;
        if (!tryEdge(facing1, direction1, clear1) && !tryEdge(facing2, direction2, clear2) && !this.cliffValid(info)) removeOthers();
      }
      if (direction1 !== 0) this.removeCliffEdge(x, y, facing1);
      if (direction2 !== 0) this.removeCliffEdge(x, y, facing2);
    }
    this.makeNewCliff(x, y, info);
    return result;
  }

  /** `TRIBE_Map::do_cliff_brush(x, y, 0, 0)` (src/tmap.cpp:672): join the last cliff cell to this one. */
  private cliffBrush(x: number, y: number): void {
    let cx = Math.trunc(x / 3);
    let cy = Math.trunc(y / 3);
    const oldX = this.oldCliffX;
    this.safeCliffX = cx;
    this.safeCliffY = cy;
    if (oldX === cx && this.oldCliffY === cy) return;
    if (cx * 3 + 2 >= this.w || cy * 3 + 2 >= this.h || cx < 0 || cy < 0) return;
    if (oldX !== -1 && this.oldCliffY !== -1) {
      const dx = x - oldX * 3;
      const dy = y - this.oldCliffY * 3;
      if (dx >= 3 || dx <= -1) cy = this.oldCliffY;
      else if (dy < 3 && dy > -1) return;
      else cx = oldX;
    }
    if (cx === oldX && cy === this.oldCliffY) return;
    if (oldX === -1) {
      this.oldCliffDirection = -1;
      this.oldCliffX = cx;
      this.oldCliffY = cy;
      return;
    }
    let direction: number;
    if (cx > oldX) direction = 0;
    else if (oldX > cx) direction = 2;
    else direction = this.oldCliffY >= cy ? 3 : 1;
    const facing = this.addCliffEdge(oldX, this.oldCliffY, direction, 0, this.oldCliffDirection);
    direction = RmmMap.reverse(direction);
    this.oldCliffDirection = direction;
    this.oldCliffX = cx;
    this.oldCliffY = cy;
    this.addCliffEdge(cx, cy, direction, facing, -1);
  }

  /** `TRIBE_Map::do_cliff_brush_stroke(x1, y1, x2, y2, 0, 0)` (src/tmap.cpp:737). */
  cliffBrushStroke(x1: number, y1: number, x2: number, y2: number): void {
    if (this.safeCliffX !== Math.trunc(x1 / 3) || this.safeCliffY !== Math.trunc(y1 / 3)) {
      this.oldCliffX = -1;
      this.oldCliffY = -1;
      this.safeCliffX = -1;
      this.safeCliffY = -1;
      this.oldCliffDirection = -1;
    }
    this.stroke(x1, y1, x2, y2, (x, y) => this.cliffBrush(x, y));
  }

  /** `TRIBE_Map::check_tile...`: `terrain_types[t].impassable_terrain`. */
  impassableTwin(terrain: number): number {
    return TERRAIN_IMPASSABLE[terrain] ?? -1;
  }
}
