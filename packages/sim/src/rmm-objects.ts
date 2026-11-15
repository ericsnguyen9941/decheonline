/**
 * The random map object module (`RGE_RMM_Object_Generator`, src/rmm_obj.cpp; docs/spec/random-maps.md §5.8): the
 * terrain objects (trees, decorations) of every tile, then each object row in table order: rows tied to a land (the
 * players' start objects), rows anywhere, rows away from every land. `placeRelicsAndRuins` is the second generator
 * `TRIBE_World::new_game` runs for relics and ruins (src/tworld.cpp:659-779).
 *
 * Candidate tiles come from the shared node lists (`MapStack`): one node per tile and one list per node, so building
 * a group's or cluster's list takes its tiles out of the row's list, as in the original.
 */
import { NONE, type MapStack } from './rmm-base';
import type { RmmMap } from './rmm-map';
import { f32 } from './num';
import type { SimRandomMap } from './unit-record';
import type { UnitType } from './units';

const GAIA = 0;
/** `generate_objects`' scale area: 144² (0x5100), a Large map. */
const SCALE_AREA = 0x5100;
export const RELIC = 159;
export const RUIN = 158;
/** The other ruin type counted by the ruins victory (0xa3). */
const RUIN2 = 163;
/** `MASTER_OBJECT_ARTIFACT_DISCOVERY1` as `add_quick_obj` places it. */
export const DISCOVERY = 10;
const VICTORY_SCORE = 3;

/** One `RGE_Object_Info_Line`. */
export interface ObjectRow {
  type: number;
  /** Required terrain under the start tile, −1 any. */
  terrain: number;
  /** 0 one object, 1 a group spread over `area`, 2 a cluster grown tile by tile. */
  groupFlag: number;
  /** `scale_flag`: `groups` is per 144×144 tiles. */
  scale: boolean;
  perGroup: number;
  variance: number;
  groups: number;
  /** `group_area`: half-size of a group's or cluster's square. */
  area: number;
  /** Owner; −1 the land's player (land rows) or Gaia. */
  player: number;
  /** ≥ 0 once per land point of this id; −1 anywhere; −2 away from every land by `inner`. */
  landId: number;
  inner: number;
  outer: number;
  /** `object_exclusion_zone`: half-size of the square no later start of this row may use. */
  exclusion: number;
}

/** One `RGE_Land_Point_Info_Line`: a land centre and the player its land belongs to (0 none). */
export interface LandPoint {
  x: number;
  y: number;
  id: number;
  player: number;
}

/** `RGE_Object_Info`. */
export interface ObjectInfo {
  rows: ObjectRow[];
  lands: LandPoint[];
}

/**
 * A dat object row (`SimRandomMap.objects`) as `RGE add_object_module` copies it (src/rmm_dbct.cpp:688): every field,
 * with exclusion 1. The TRIBE controller then changes some rows' exclusion (random-maps.md §4.3).
 */
export function objectRowFromDat(row: SimRandomMap['objects'][number]): ObjectRow {
  const [type, terrain, groupFlag, scale, perGroup, variance, groups, area, player, landId, inner, outer] = row;
  return {
    type: type!,
    terrain: terrain!,
    groupFlag: groupFlag!,
    scale: scale !== 0,
    perGroup: perGroup!,
    variance: variance!,
    groups: groups!,
    area: area!,
    player: player!,
    landId: landId!,
    inner: inner!,
    outer: outer!,
    exclusion: 1,
  };
}

export class ObjectGenerator {
  private readonly w: number;
  private readonly h: number;
  /** The module copies its info at construction (`memcpy`); `addQuickObj` adds to the copy. */
  readonly info: ObjectInfo;

  constructor(
    private readonly map: RmmMap,
    private readonly stack: MapStack,
    private readonly search: Uint8Array,
    info: ObjectInfo | null,
    private readonly addTerrainObjects: boolean,
  ) {
    this.w = map.w;
    this.h = map.h;
    this.info = info
      ? { rows: info.rows.map((r) => ({ ...r })), lands: info.lands.map((l) => ({ ...l })) }
      : { rows: [], lands: [] };
  }

  /** `add_quick_obj` (src/rmm_obj.cpp:27): `count` single Gaia objects anywhere, `exclusion` apart. */
  addQuickObj(type: number, count: number, exclusion: number): void {
    this.info.rows.push({
      type,
      terrain: -1,
      groupFlag: 0,
      scale: false,
      perGroup: 1,
      variance: 1,
      groups: count,
      area: 2,
      player: 0,
      landId: -1,
      inner: 0,
      outer: 1,
      exclusion,
    });
  }

  /** `generate` (src/rmm_obj.cpp:44). */
  generate(): void {
    // `set_terrain(gaia, 0, 0, W−1, H−1, 1, 0, 0)`: terrain unchanged, every tile's terrain objects made for Gaia.
    if (this.addTerrainObjects) this.map.setTerrainArea(GAIA, 0, 0, this.w - 1, this.h - 1, 1, false, false);
    this.stack.clear();
    for (const row of this.info.rows) this.generateObjects(row);
    this.map.deleteZoneMaps();
  }

  /** `generate_objects` (src/rmm_obj.cpp:72). The scaled group count is written back to the row. */
  private generateObjects(row: ObjectRow): void {
    if (row.scale) row.groups = Math.max(1, Math.trunc((this.w * this.h * row.groups) / SCALE_AREA));
    if (row.landId >= 0) {
      this.info.lands.forEach((land, i) => {
        if (land.id === row.landId) this.placeLandObjects(row, land.x, land.y, row.inner, row.outer, i);
      });
    } else if (row.landId === -1) {
      this.search.fill(1);
      this.placeAnywhere(row);
    } else if (row.landId === -2) {
      this.search.fill(1);
      for (const land of this.info.lands) this.setSearchArea(land.x, land.y, row.inner, 0);
      this.placeAnywhere(row);
    }
  }

  private clip(x: number, y: number, r: number): [number, number, number, number] {
    return [Math.max(0, x - r), Math.max(0, y - r), Math.min(this.w - 1, x + r), Math.min(this.h - 1, y + r)];
  }

  /** `set_search_area`. */
  private setSearchArea(x: number, y: number, r: number, value: number): void {
    const [x0, y0, x1, y1] = this.clip(x, y, r);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) this.search[ty * this.w + tx] = value;
  }

  /** `remove_area_from_lists`. */
  private removeArea(x: number, y: number, r: number): void {
    const [x0, y0, x1, y1] = this.clip(x, y, r);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) this.stack.remove(this.stack.node(tx, ty));
  }

  /**
   * `make_placement_stack` (src/rmm_obj.cpp:98, D): the searchable tiles of the clipped square (the whole map when x,
   * y or the radius is negative) in row order, then `(w·h)/4` random tiles moved to the front, with `w = x1 − x0 − 1`
   * and `h = y1 − y0 − 1`, so the last column and row are never drawn.
   */
  private placementStack(x: number, y: number, outer: number): number {
    const { stack, search } = this;
    const head = stack.head();
    const [x0, y0, x1, y1] = x < 0 || y < 0 || outer < 0 ? [0, 0, this.w - 1, this.h - 1] : this.clip(x, y, outer);
    let last = head;
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (search[ty * this.w + tx] === 0) continue;
        const node = stack.node(tx, ty);
        stack.add(last, node);
        last = node;
      }
    }
    const w = x1 - x0 - 1;
    const h = y1 - y0 - 1;
    if (w > 1 && h > 1) {
      const rng = this.map.rng;
      for (let count = Math.trunc((h * w) / 4); count > 0; count--) {
        const rx = Math.trunc((rng.rand() * w) / 0x7fff) + x0;
        const ry = Math.trunc((rng.rand() * h) / 0x7fff) + y0;
        if (search[ry * this.w + rx] !== 0) stack.add(head, stack.node(rx, ry));
      }
    }
    return head;
  }

  private pop(head: number): [number, number] | null {
    const node = this.stack.pop(head);
    return node === NONE ? null : [node % this.w, Math.trunc(node / this.w)];
  }

  private master(player: number, type: number): UnitType {
    const t = this.map.world.master(player, type);
    // The original reads the master without a check here; a missing one would crash it.
    if (!t) throw new Error(`random map object ${type} has no master for player ${player}`);
    return t;
  }

  /** A tile's object position: the tile corner, plus half a tile on each axis whose radius is not whole. */
  private static position(t: UnitType, x: number, y: number): [number, number] {
    return [t.radiusX - Math.trunc(t.radiusX) > 0 ? f32(x + 0.5) : x, t.radiusY - Math.trunc(t.radiusY) > 0 ? f32(y + 0.5) : y];
  }

  private tileTerrain(x: number, y: number): number {
    return this.map.terrain[y * this.w + x]!;
  }

  /** Place one start of a row on tile (x, y): a single object, a group or a cluster. */
  private placeStart(row: ObjectRow, x: number, y: number, fx: number, fy: number, player: number): void {
    this.removeArea(x, y, row.exclusion);
    if (row.groupFlag === 0) this.map.makeNewObject(player, row.type, fx, fy, true);
    else if (row.groupFlag === 1) this.placeGroup(row, x, y, player);
    else if (row.groupFlag === 2) this.placeCluster(row, x, y, player);
  }

  /**
   * `place_objects` (src/rmm_obj.cpp:314, L) and `place_avoid_objects` (`:251`, N), which differ only in the search
   * map their caller set: the row's `groups` starts on searchable tiles of the row's terrain, Gaia's when the row's
   * player is negative.
   */
  private placeAnywhere(row: ObjectRow): void {
    const head = this.placementStack(-1, -1, -1);
    const player = row.player <= -1 ? GAIA : row.player;
    let count = row.groups;
    for (let p = this.pop(head); p && count > 0; p = this.pop(head)) {
      const [x, y] = p;
      if (row.terrain >= 0 && this.tileTerrain(x, y) !== row.terrain) continue;
      const t = this.master(player, row.type);
      const [fx, fy] = ObjectGenerator.position(t, x, y);
      if (this.map.checkPlacement(t, fx, fy, true, true, false, true) !== 0) continue;
      this.placeStart(row, x, y, fx, fy, player);
      count--;
    }
    this.stack.deinit(head);
  }

  /**
   * `place_land_objects` (src/rmm_obj.cpp:372, M): starts within `outer` of the land centre but not strictly inside
   * its `inner` square, in the centre's zone for the object's terrain restriction, never within `inner` of any land
   * centre. A single object that fails on the last candidate is placed there anyway.
   */
  private placeLandObjects(row: ObjectRow, mx: number, my: number, inner: number, outer: number, landIndex: number): void {
    const [minX, minY, maxX, maxY] = this.clip(mx, my, inner);
    this.search.fill(1);
    for (const land of this.info.lands) this.setSearchArea(land.x, land.y, inner, 0);
    const head = this.placementStack(mx, my, outer);
    const landPlayer = this.info.lands[landIndex]!.player;
    const player = row.player > -1 ? row.player : landPlayer > 0 ? landPlayer : 0;
    const t = this.map.world.master(player, row.type);
    // Without a master the original returns before releasing the list.
    if (!t) return;
    const zones = this.map.zoneMap(t.terrainTable);
    const landZone = zones.at(this.w, mx, my);
    let count = row.groups;
    for (let p = this.pop(head); p && count > 0; p = this.pop(head)) {
      const [x, y] = p;
      if (zones.at(this.w, x, y) !== landZone) continue;
      if (row.terrain >= 0 && this.tileTerrain(x, y) !== row.terrain) continue;
      if (!(x <= minX || x >= maxX || y <= minY || y >= maxY)) continue;
      const [fx, fy] = ObjectGenerator.position(t, x, y);
      if (this.map.checkPlacement(t, fx, fy, true, true, true, true) === 0) {
        this.placeStart(row, x, y, fx, fy, player);
        count--;
      } else if (row.groupFlag === 0 && this.stack.next[head] === NONE) {
        this.map.makeNewObject(player, row.type, fx, fy, true);
      }
    }
    this.stack.deinit(head);
  }

  /** The group's object count: `per_group` ± `variance` by one draw, at least 1. */
  private groupCount(row: ObjectRow): number {
    const v = row.variance;
    return Math.max(1, row.perGroup + Math.trunc((this.map.rng.rand() * (v * 2)) / 0x7fff) - v);
  }

  /** `place_group` (src/rmm_obj.cpp:469, M): objects on searchable tiles of the row's terrain within `area`. */
  private placeGroup(row: ObjectRow, mx: number, my: number, player: number): void {
    const head = this.placementStack(mx, my, row.area);
    let count = this.groupCount(row);
    for (let p = this.pop(head); p && count > 0; p = this.pop(head)) {
      const [x, y] = p;
      if (row.terrain >= 0 && this.tileTerrain(x, y) !== row.terrain) continue;
      const t = this.master(player, row.type);
      const [fx, fy] = ObjectGenerator.position(t, x, y);
      if (this.map.checkPlacement(t, fx, fy, true, true, false, true) !== 0) continue;
      this.map.makeNewObject(player, row.type, fx, fy, true);
      count--;
    }
    this.stack.deinit(head);
  }

  /**
   * `place_cluster` (src/rmm_obj.cpp:512, L): grow from the start tile within `area`; each placed object's free
   * 4-neighbours (left, right, up, down) join the list at a random cost (one draw each).
   */
  private placeCluster(row: ObjectRow, mx: number, my: number, player: number): void {
    const { stack, search, w } = this;
    const rng = this.map.rng;
    const head = stack.head();
    stack.add(head, stack.node(mx, my));
    const [x0, y0, x1, y1] = this.clip(mx, my, row.area);
    this.setSearchArea(mx, my, row.area, 1);
    let count = this.groupCount(row);
    for (let p = this.pop(head); p && count > 0; p = this.pop(head)) {
      const [x, y] = p;
      const t = this.master(player, row.type);
      const [ax, ay] = ObjectGenerator.position(t, x, y);
      const [fx, fy] = this.map.alignment(t, ax, ay);
      if (this.map.checkPlacement(t, fx, fy, true, true, false, true) !== 0) continue;
      this.map.makeNewObject(player, row.type, fx, fy, true);
      count--;
      search[y * w + x] = 0;
      if (x > x0 && search[y * w + x - 1] !== 0) stack.push(head, x - 1, y, 0, rng.rand());
      if (x < x1 && search[y * w + x + 1] !== 0) stack.push(head, x + 1, y, 0, rng.rand());
      if (y > y0 && search[(y - 1) * w + x] !== 0) stack.push(head, x, y - 1, 0, rng.rand());
      if (y < y1 && search[(y + 1) * w + x] !== 0) stack.push(head, x, y + 1, 0, rng.rand());
    }
    stack.deinit(head);
  }
}

/** What `placeRelicsAndRuins` reads of the game: the victory settings and the objects already on the map. */
export interface RelicRuinSettings {
  /** `TRIBE_World::victory_type` (0 standard .. 3 score, 4 the special victories). */
  victoryType: number;
  /** The scenario's multiplayer artifacts, discoveries and ruins wanted (the special victories' amounts; else 0). */
  artifacts: number;
  discoveries: number;
  ruins: number;
  /** The number of objects of these types the players (Gaia included) already own. */
  owned(types: readonly number[]): number;
}

/**
 * The relic and ruin block of `TRIBE_World::new_game` for a random game (src/tworld.cpp:659-779, L): a second object
 * generator without terrain objects places the missing artifacts, discoveries and ruins of a special victory, then
 * 5 relics (always for the score victory, else on a draw `% 100 < 50`) and 5 ruins (a draw `% 100 < 50`), each
 * `W/5` tiles apart. Returns the world's `artifact_count` and `ruin_count` when set (5), else null.
 */
export function placeRelicsAndRuins(
  map: RmmMap,
  stack: MapStack,
  search: Uint8Array,
  settings: RelicRuinSettings,
): { artifactCount: number | null; ruinCount: number | null } {
  const generator = new ObjectGenerator(map, stack, search, null, false);
  const wanted: [number, number, readonly number[], number][] = [
    [settings.artifacts, RELIC, [RELIC], 0],
    [settings.discoveries, DISCOVERY, [DISCOVERY], 0],
    [settings.ruins, RUIN, [RUIN, RUIN2], 0],
  ];
  for (const [want, type, counted] of wanted) {
    if (!(want > 0)) continue;
    const missing = want - settings.owned(counted);
    if (missing > 0) generator.addQuickObj(type, missing, 0);
  }
  let artifactCount: number | null = null;
  let ruinCount: number | null = null;
  const spacing = Math.trunc(map.w / 5);
  if (settings.victoryType === VICTORY_SCORE || map.rng.rand() % 100 < 50) {
    generator.addQuickObj(RELIC, 5, spacing);
    artifactCount = 5;
  }
  if (map.rng.rand() % 100 < 50) {
    generator.addQuickObj(RUIN, 5, spacing);
    ruinCount = 5;
  }
  generator.generate();
  return { artifactCount, ruinCount };
}
