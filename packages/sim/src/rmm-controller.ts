/**
 * The random map controller (`TRIBE_RMM_Database_Controller`, src/rmm_tdbc.cpp, over `RGE_RMM_Database_Controller`,
 * src/rmm_dbct.cpp; docs/spec/random-maps.md §3-5) and `RGE_Map::map_generate2` (src/map.cpp:1159): from the map seed,
 * the map type and the player count, build the land, terrain, object and elevation tables and decide shallows and
 * cliffs (init), then reseed and run the modules in schedule order (generate). Every `rand()` the original draws is
 * drawn here in the same order, log draws included.
 */
import { f32 } from './num';
import { MapStack } from './rmm-base';
import { generateCliffs, type CliffsInfo } from './rmm-cliffs';
import { generateElevation, type ElevationInfo } from './rmm-elevation';
import { calcLandStart, generateLand, type LandInfo, type LandLine } from './rmm-land';
import { TERRAIN_CLIFF, type RmmMap } from './rmm-map';
import { ObjectGenerator, objectRowFromDat, type LandPoint, type ObjectInfo } from './rmm-objects';
import { generateShallows } from './rmm-shallows';
import { TerrainGenerator, type HotSpot, type TerrainInfo } from './rmm-terrain';
import { RANDOM_MAPS } from './unit-data';

/** `TRIBE_Game::MapType` (include/tribegam.h:109-119); the dat's random maps are indexed by it. */
export const MAP_ALL_WATER = 0;
export const MAP_MOSTLY_WATER = 1;
export const MAP_WATER_AND_LAND = 2;
export const MAP_MOSTLY_LAND = 3;
export const MAP_ALL_LAND = 4;
export const MAP_CONTINENTAL = 5;
export const MAP_LAKE = 6;
export const MAP_HILLY = 7;
export const MAP_ISTHMAS = 8;

/** Map sides by `TRIBE_Game::MapSize` (include/tribegam.h:35-40): Tiny .. Humongous. */
export const MAP_TINY = 72;
export const MAP_SMALL = 96;
export const MAP_MEDIUM = 120;
export const MAP_LARGE = 144;
export const MAP_HUGE = 200;
export const MAP_HUMONGOUS = 250;

const MASTER_OBJECT_MAN = 83;
const MASTER_OBJECT_TOWN_CENTER = 109;
const BERRIES = 59;
const GAZELLE = 65;
const GOLD = 66;
const STONE = 102;
/** `RGE_Land_Data` holds 99 lands; past the dat's rows they read as zero. */
const NO_LAND: readonly number[] = new Array<number>(13).fill(0);

/** The game options the controller reads. */
export interface RmmSettings {
  /** Map type, the index into the dat's random maps. */
  type: number;
  /** Players, Gaia excluded. */
  players: number;
  /** `!randomizePositions()`: re-order the land centres by team (src/rmm_dbct.cpp:490). */
  fixedPositions: boolean;
  /** Starting age Nomad: one Villager row group, no Town Center. */
  nomad: boolean;
  /** `players[p]->relation(q) == ALLY`, players 1..n. */
  allied(p: number, q: number): boolean;
}

/** One land the controller builds: a `LandLine` with a centre. */
type Land = LandLine;

function newLand(): Land {
  return { size: 0, terrain: 0, x: 0, y: 0, baseSize: 0, area: 0, zone: 0, clumpiness: 0, walls: [0, 0, 0, 0], fade: 0 };
}

/**
 * The controller between `init` and `generate`: the tables the modules copy, and the shallows and cliffs modules
 * `init` already made (as their info).
 */
export class RmmController {
  readonly w: number;
  readonly h: number;
  /** `land_info`: the lands (the first `landNum` are used), the base terrain, the table walls and fade. */
  readonly lands: Land[] = [];
  landNum = 0;
  baseTerrain = 0;
  walls: [number, number, number, number] = [0, 0, 0, 0];
  fade = 0;
  readonly terrain: TerrainInfo = { rows: [], hotSpots: [] };
  readonly objects: ObjectInfo = { rows: [], lands: [] };
  readonly elevation: ElevationInfo = { levels: [], hotSpots: [] };
  /** The shallows module's land centres, when `init` made one. */
  shallows: [number, number][] | null = null;
  /** The cliffs module's info, when `init` made one. */
  cliffs: CliffsInfo | null = null;
  private readonly map;

  constructor(
    private readonly m: RmmMap,
    private readonly settings: RmmSettings,
  ) {
    this.w = m.w;
    this.h = m.h;
    const map = RANDOM_MAPS[settings.type];
    if (!map) throw new Error(`no random map ${settings.type}`);
    this.map = map;
  }

  private landRow(i: number): readonly number[] {
    return this.map.lands[i] ?? NO_LAND;
  }

  /** `TRIBE init` (src/rmm_tdbc.cpp:27): the RGE init's four tables, then the cliffs decision. */
  init(): void {
    this.addLandModule();
    this.addTerrainModule();
    this.addObjectModule();
    this.addElevationModule();
    const rng = this.m.rng;
    if (rng.rand() <= 0x1fff) return;
    const w = this.w;
    let size = 0;
    let length = 0;
    if (w <= MAP_TINY) [size, length] = [3, 10];
    else if (w <= MAP_SMALL) [size, length] = [4, 12];
    else if (w <= MAP_MEDIUM) [size, length] = [6, 14];
    else if (w <= MAP_LARGE) [size, length] = [8, 16];
    else if (w <= MAP_HUGE) [size, length] = [18, 20];
    else if (w <= MAP_HUMONGOUS) [size, length] = [28, 20];
    switch (this.settings.type) {
      case MAP_ALL_WATER:
        [size, length] = [0, 0];
        break;
      case MAP_MOSTLY_WATER:
        size -= 5;
        length -= 6;
        break;
      case MAP_WATER_AND_LAND:
        size -= 3;
        length -= 2;
        break;
      case MAP_CONTINENTAL:
      case MAP_LAKE:
      case MAP_ISTHMAS:
        length -= 4;
        break;
    }
    if (length < 3) length = 3;
    const sizeVariance = length - 3 <= 0 ? 0 : Math.trunc((length - 3) / 2);
    const info: CliffsInfo = {
      count: size,
      countVariance: 2,
      averageSize: length - sizeVariance,
      sizeVariance,
      terrainSpacing: 2,
      cliffSpacing: 2,
      hotSpots: this.terrain.hotSpots.map((s) => ({ x: s.x, y: s.y, radius: s.radius })),
    };
    if (info.averageSize > 0 && info.count > 0) this.cliffs = info;
  }

  /** `RGE add_land_module` (src/rmm_dbct.cpp:428, L) under the TRIBE one (src/rmm_tdbc.cpp:113). */
  private addLandModule(): void {
    const { w, h, settings, map } = this;
    const type = settings.type;
    const n = settings.players;
    const rng = this.m.rng;
    let placementEdge = map.placementEdge;
    if ((type === MAP_CONTINENTAL || type === MAP_ISTHMAS) && w < 100) placementEdge = w >= 80 ? 25 : 20;

    const landTileNum = Math.trunc((map.landPercent * w * h) / 100);
    this.landNum = 0;
    for (const row of map.lands) this.landNum += row[9] !== 0 ? n : 1;
    this.baseTerrain = map.baseTerrain;
    this.walls = [map.edges[0], map.edges[1], w - map.edges[2], h - map.edges[3]];
    this.fade = map.fade & 0xff;
    const newLine = (row: readonly number[]): Land => ({
      ...newLand(),
      terrain: row[1]!,
      area: row[2]!,
      baseSize: row[3]!,
      clumpiness: row[12]!,
      walls: [...this.walls],
      fade: this.fade,
    });
    let index2 = 0;
    for (const row of map.lands) {
      const [, , , , zone, placement, x, y, percent, byPlayer] = row;
      if (byPlayer !== 0) {
        for (let p = 0; p < n; p++) this.lands[index2 + p] ??= newLand();
        calcLandStart(rng, w, h, this.lands, index2, placementEdge, n, placement!, x!, y!);
        for (let p = 0; p < n; p++) {
          const land = this.lands[index2]!;
          Object.assign(land, newLine(row), { x: land.x, y: land.y });
          land.zone = byPlayer === 1 ? zone! : p & 0xff;
          land.size = Math.trunc((percent! * landTileNum) / (n * 100));
          index2++;
        }
      } else {
        this.lands[index2] ??= newLand();
        calcLandStart(rng, w, h, this.lands, index2, placementEdge, 1, placement!, x!, y!);
        const land = this.lands[index2]!;
        Object.assign(land, newLine(row), { x: land.x, y: land.y });
        land.zone = zone!;
        land.size = Math.trunc((percent! * landTileNum) / 100);
        index2++;
      }
    }
    if (settings.fixedPositions) this.placeTeams();

    const all = () => this.lands.slice(0, this.landNum);
    const openWall = (i: number, value: number) => {
      this.walls[i] = value;
      for (const land of all()) land.walls[i] = value;
    };
    if (type < MAP_CONTINENTAL) {
      if (rng.rand() < 0x3fff) openWall(0, -1);
      if (rng.rand() < 0x3fff) openWall(1, -1);
      if (rng.rand() < 0x3fff) openWall(2, w);
      if (rng.rand() < 0x3fff) openWall(3, h);
    }
    if (type === MAP_ISTHMAS) {
      if (rng.rand() < 0x3fff) {
        openWall(0, -1);
        openWall(2, w);
      } else {
        openWall(1, -1);
        openWall(3, h);
      }
    }
    if ((type >= MAP_WATER_AND_LAND && type <= MAP_LAKE) || type === MAP_ISTHMAS) {
      if (rng.rand() < 0x3fff) {
        const even = rng.rand() < 0x3fff;
        for (let i = 0; i < this.landNum; i += 2) this.lands[i]!.zone = even ? 0 : i & 0xff;
        const odd = rng.rand() < 0x3fff;
        for (let i = 1; i < this.landNum; i += 2) this.lands[i]!.zone = odd ? 1 : i & 0xff;
        // `add_shallows_module` (src/rmm_tdbc.cpp:435): the module takes the land centres now, then a logged draw.
        this.shallows = all().map((l) => [l.x, l.y]);
        rng.rand();
      } else if (type === MAP_ALL_LAND) {
        for (const land of all()) land.zone = 0;
        this.baseTerrain = 0;
      } else if (type >= MAP_CONTINENTAL) {
        for (const land of all()) land.zone = 0;
      }
    }
    if (type === MAP_CONTINENTAL || type === MAP_ISTHMAS) {
      let edge = 20;
      // Only a map under 100 tiles moves its closed walls in (src/rmm_tdbc.cpp:196-216).
      if (w < 100) {
        edge = w >= 80 ? 15 : 10;
        const move = (walls: [number, number, number, number]) => {
          if (walls[0] > 0) walls[0] = edge;
          if (walls[1] > 0) walls[1] = edge;
          if (walls[2] < w) walls[2] = w - edge;
          if (walls[3] < h) walls[3] = h - edge;
        };
        move(this.walls);
        for (const land of all()) move(land.walls);
      }
      const area = (w - edge * 2) * (h - edge * 2);
      const each = Math.trunc(area * 0.8);
      for (const land of all()) land.size = Math.trunc(each / this.landNum);
    }
    rng.rand();
  }

  /**
   * The team re-ordering of `RGE add_land_module` (src/rmm_dbct.cpp:490-637, L): each team claims the lands nearest its
   * first unclaimed land, then land `i` takes the centre of the `i`-th land its player's team claimed. No RNG.
   */
  private placeTeams(): void {
    const num = this.landNum;
    const lands = this.lands;
    const distances: number[][] = [];
    for (let i1 = 0; i1 < num; i1++) {
      const d2: number[] = [];
      for (let i = 0; i < num; i++) {
        const dx = lands[i1]!.x - lands[i]!.x;
        const dy = lands[i1]!.y - lands[i]!.y;
        d2.push(dx * dx + dy * dy);
      }
      const order = Array.from({ length: num }, (_, i) => i);
      let sorted: boolean;
      do {
        sorted = true;
        for (let i = 1; i < num; i++) {
          if (d2[i - 1]! > d2[i]!) {
            [d2[i - 1], d2[i]] = [d2[i]!, d2[i - 1]!];
            [order[i - 1], order[i]] = [order[i]!, order[i - 1]!];
            sorted = false;
          }
        }
      } while (!sorted);
      distances.push(order);
    }
    const teams = new Array<number>(num).fill(-1);
    const teamSize: number[] = [];
    let current = 0;
    for (let i = 0; i < num; i++) {
      if (teams[i] !== -1) continue;
      teams[i] = current;
      teamSize[current] = 1;
      for (let i1 = 0; i1 < num; i1++) {
        if (this.settings.allied(i + 1, i1 + 1)) {
          teams[i1] = current;
          teamSize[current]!++;
        }
      }
      current++;
    }
    const claimed = new Array<number>(num).fill(-1);
    let startLand = 0;
    let otherLand = 0;
    for (let team = 0; team < current; team++) {
      let index = 0;
      while (index < num && claimed[index] !== -1) index++;
      let edge = 0;
      let wanted = teamSize[team]!;
      while (edge < teamSize[team]!) {
        let index2 = 0;
        for (; index2 < wanted; index2++) {
          const candidate = distances[index]![index2]!;
          if (claimed[candidate] === -1) {
            claimed[candidate] = team;
            break;
          }
        }
        if (index2 < wanted) {
          edge++;
          continue;
        }
        if (wanted < num) wanted++;
        for (index2 = num - 1; index2 >= 0; index2--) {
          const candidate = distances[index]![index2]!;
          if (claimed[candidate] === -1) {
            startLand = candidate;
            break;
          }
        }
        let otherTeam = -1;
        for (let ci = 0; ci < num; ci++) {
          let candidate = distances[startLand]![ci]!;
          if (claimed[candidate] !== team && claimed[candidate]! > -1) {
            otherTeam = claimed[candidate]!;
            otherLand = candidate;
            for (let wi = 0; wi < wanted; wi++) {
              candidate = distances[index]![wi]!;
              if (claimed[candidate] === otherTeam) {
                otherLand = candidate;
                break;
              }
            }
            break;
          }
        }
        claimed[startLand] = otherTeam;
        claimed[otherLand] = -1;
        for (index2 = num - 1; index2 >= 0; index2--) {
          const candidate = distances[otherTeam]![index2]!;
          if (claimed[candidate] !== otherTeam) continue;
          for (let wi = 0; wi < num; wi++) {
            const replacement = distances[startLand]![wi]!;
            if (claimed[replacement] === -1 && replacement !== otherLand) {
              claimed[candidate] = -1;
              claimed[replacement] = otherTeam;
              break;
            }
          }
        }
      }
    }
    const hash = new Array<number>(num).fill(-1);
    for (let i = 0; i < num; i++) {
      for (let i1 = 0; i1 < num; i1++) {
        if (hash[i1] === -1 && teams[i1] === claimed[i]) {
          hash[i1] = i;
          break;
        }
      }
    }
    const centres = hash.map((j) => [lands[j]!.x, lands[j]!.y] as const);
    centres.forEach(([x, y], i) => Object.assign(lands[i]!, { x, y }));
  }

  /** One hot spot per land of every land row with a radius (`hot_spot_index` also indexes the lands). */
  private hotSpots(): HotSpot[] {
    const spots: HotSpot[] = [];
    for (const row of this.map.lands) {
      const radius = row[10]!;
      if (radius < 0) continue;
      const count = row[9] !== 0 ? this.settings.players : 1;
      for (let i = 0; i < count; i++) {
        const land = this.lands[spots.length]!;
        spots.push({ x: land.x, y: land.y, radius, fade: row[11]! });
      }
    }
    return spots;
  }

  /** `RGE add_terrain_module` (src/rmm_dbct.cpp:640, L) under the TRIBE one (src/rmm_tdbc.cpp:229, L). */
  private addTerrainModule(): void {
    const { w, h, map } = this;
    const landArea = Math.trunc((w * h * map.landPercent) / 100);
    this.terrain.rows = map.terrains.map(([percent, terrain, clumps, spacing, base, clumpiness]) => ({
      // `(long)(percent * land_area * 0.01F)` on the x87: the product is not rounded to float before the cast.
      size: Math.trunc(percent! * landArea * f32(0.01)),
      terrain: terrain!,
      clumps: clumps!,
      spacing: spacing!,
      base: base!,
      clumpiness: clumpiness!,
      avoid: 1,
    }));
    this.terrain.hotSpots = this.hotSpots();
    const landTileNum = Math.trunc((map.landPercent * w * h) / 100);
    const ratio = f32(f32(landTileNum) * f32(0.00005));
    for (const row of this.terrain.rows) {
      if (row.terrain !== 6 && ratio > 1) row.clumps = Math.trunc(row.clumps * ratio);
    }
    const rng = this.m.rng;
    if (rng.rand() < 0x1fff) {
      for (const row of this.terrain.rows) {
        if (row.terrain === 13) {
          row.size *= 3;
          row.clumps *= 3;
          row.avoid = 2;
        } else if (row.terrain === 20 || row.terrain === 19) {
          row.size = Math.trunc(row.size / 2);
          row.clumps = Math.trunc(row.clumps / 2);
        } else if (row.terrain === 10) {
          row.size = Math.trunc(row.size / 2);
          row.clumps = Math.trunc(row.clumps / 2);
          row.avoid = 2;
        } else if (row.terrain === 6) {
          row.size *= 2;
          row.avoid = 0;
        }
      }
    } else {
      for (const row of this.terrain.rows) {
        if (row.terrain === 6) row.avoid = 0;
        else if (row.terrain === 10 || row.terrain === 13) row.avoid = 2;
      }
    }
    rng.rand();
  }

  /** `RGE add_object_module` (src/rmm_dbct.cpp:688, D) under the TRIBE one (src/rmm_tdbc.cpp:278, L). */
  private addObjectModule(): void {
    const { w, h, map, settings } = this;
    const rng = this.m.rng;
    const rows = map.objects.map(objectRowFromDat);
    // Land points: the lands' centres with the dat land id, players 1..n along a by-player row, else 0.
    const points: LandPoint[] = [];
    let player = this.landRow(0)[9] !== 0 ? 1 : 0;
    let mapLand = 0;
    for (let i = 0; i < this.landNum; i++) {
      points.push({ x: this.lands[i]!.x, y: this.lands[i]!.y, id: this.landRow(mapLand)[0]!, player });
      if (player > 0 && ++player > settings.players) player = 0;
      if (player === 0) {
        mapLand++;
        if (this.landRow(mapLand)[9] !== 0) player = 1;
      }
    }
    rng.rand();
    if (settings.nomad) {
      for (const row of rows) if (row.type === MASTER_OBJECT_MAN) row.groups = 1;
      for (const row of rows) if (row.type === MASTER_OBJECT_TOWN_CENTER) row.groups = 0;
    }
    if (settings.type === MAP_LAKE) {
      // Every land moves up one; land 0 becomes a lake in the middle (the land points keep the old order).
      const edge = Math.trunc(w / 6);
      const lake: Land = {
        ...newLand(),
        zone: this.landNum & 0xff,
        terrain: 1,
        area: 7,
        baseSize: 2,
        size: Math.trunc((h - edge * 2) * (w - edge * 2) * 0.7),
        clumpiness: 10,
        x: Math.trunc(w / 2),
        y: Math.trunc(h / 2),
        walls: [edge, edge, w - edge, h - edge],
        fade: 10,
      };
      this.lands.splice(0, 0, lake);
      this.landNum++;
    }
    if (settings.type < MAP_WATER_AND_LAND) {
      let count = Math.trunc((rng.rand() * 4) / 0x7fff) + 1;
      if (count + settings.players > 10) count = 10 - settings.players;
      const adjustment = Math.trunc(((w + h) * count) / this.landNum);
      for (const land of this.lands.slice(0, this.landNum)) land.size -= adjustment;
      for (let index = 0; index < count; index++) {
        const id = index + this.landNum;
        let tries = 0;
        let done: boolean;
        let x: number;
        let y: number;
        do {
          tries++;
          done = true;
          x = Math.trunc((rng.rand() * (w - 16)) / 0x7fff) + 8;
          y = Math.trunc((rng.rand() * (h - 16)) / 0x7fff) + 8;
          for (let prior = 0; prior < this.landNum && done; prior++) {
            const dx = x - this.lands[prior]!.x;
            const dy = y - this.lands[prior]!.y;
            if (dx * dx + dy * dy < 400) done = false;
          }
        } while (!done && tries < 1000);
        if (tries >= 1000) count = index;
        this.lands[id] = {
          ...newLand(),
          terrain: 0,
          area: 7,
          baseSize: 3,
          zone: id & 0xff,
          size: Math.trunc((w + h) * 1.25),
          clumpiness: 10,
          walls: [...this.walls],
          fade: this.fade,
          x,
          y,
        };
        rows.push({
          type: rng.rand() < 0x3fff ? STONE : GOLD,
          terrain: -1,
          groupFlag: 2,
          scale: false,
          perGroup: 8,
          variance: 0,
          groups: 1,
          area: 4,
          player: 0,
          landId: id,
          inner: 0,
          outer: 26,
          exclusion: 0,
        });
        points.push({ x, y, id, player: 0 });
      }
      this.landNum += count;
    }
    for (const row of rows) {
      if (row.landId >= 0) {
        if ([BERRIES, GAZELLE, GOLD, STONE].includes(row.type)) row.exclusion = 12;
      } else if (row.landId === -2) {
        if (row.type === GAZELLE) row.exclusion = Math.trunc(w / 8);
        else if ([BERRIES, GOLD, STONE].includes(row.type)) row.exclusion = Math.trunc(w / 6);
      }
    }
    this.objects.rows = rows;
    this.objects.lands = points;
    rng.rand();
  }

  /** `RGE add_elevation_module` (src/rmm_dbct.cpp:744) under the TRIBE one (src/rmm_tdbc.cpp:423). */
  private addElevationModule(): void {
    const { w, h, map } = this;
    const landArea = Math.trunc((w * map.landPercent * h) / 100);
    const level = (height: number, clumps: number, spacing: number, percent: number) => ({
      size: Math.trunc((landArea * percent) / 100),
      height,
      clumps,
      spacing,
      baseHeight: height - 1,
      baseTerrain: 0,
    });
    this.elevation.levels = [level(1, 10, 2, 10), level(2, 8, 1, 8), level(3, 6, 1, 6), level(4, 4, 1, 4)];
    // After the lake moved the lands up, so a lake map's first hot spot is the lake (src/rmm_dbct.cpp:779-797).
    this.elevation.hotSpots = this.hotSpots();
    const rng = this.m.rng;
    const r = rng.rand();
    // The retail exe keeps the scale on the x87 stack and never stores it as the decomp's `float` (Empiresx.exe
    // 0x4740b7-0x4740ee); at the CRT's 53-bit precision that is double math over the float constants.
    let scale = (70 - r * f32(-0.0018311106)) * f32(0.01);
    if (this.settings.type === MAP_HILLY) scale *= 5;
    for (const l of this.elevation.levels) l.size = Math.trunc(l.size * scale);
    rng.rand();
  }

  /**
   * `TRIBE generate` (src/rmm_tdbc.cpp:446) over the base module's `generate` (src/rmm_base.cpp:76): one logged draw,
   * then each module in schedule order (land 1.0, shallows 1.1, elevation 1.5, cliffs 1.75, terrain 2.0, objects
   * 3.0), each followed by a logged draw; then the impassable grass (16) the cliffs left becomes grass.
   */
  generate(): void {
    const { m } = this;
    const rng = m.rng;
    const stack = new MapStack(m.w, m.h);
    const search = new Uint8Array(m.w * m.h);
    // The four modules made now copy their tables (the land module only the lands in use).
    const land: LandInfo = { lands: this.lands.slice(0, this.landNum).map((l) => ({ ...l, walls: [...l.walls] })), baseTerrain: this.baseTerrain };
    const terrain = new TerrainGenerator(m, stack, search, this.terrain);
    const objects = new ObjectGenerator(m, stack, search, this.objects, true);
    const elevation: ElevationInfo = { levels: this.elevation.levels.map((l) => ({ ...l })), hotSpots: this.elevation.hotSpots.map((s) => ({ ...s })) };
    const modules: (() => void)[] = [() => generateLand(m, stack, search, land)];
    const shallows = this.shallows;
    if (shallows) modules.push(() => generateShallows(m, stack, search, shallows));
    modules.push(() => generateElevation(m, stack, search, elevation));
    const cliffs = this.cliffs;
    if (cliffs) modules.push(() => generateCliffs(m, stack, search, cliffs));
    modules.push(
      () => terrain.generate(),
      () => objects.generate(),
    );
    rng.rand();
    for (const run of modules) {
      run();
      rng.rand();
    }
    for (let i = 0; i < m.terrain.length; i++) if (m.terrain[i] === TERRAIN_CLIFF) m.terrain[i] = 0;
  }
}

/**
 * `RGE_Map::map_generate2` (src/map.cpp:1159) for the map seed `seed`: `srand(seed)` (the map is cleared with no
 * effect), `srand(seed)` and init, `srand(seed)` again and generate, then one logged draw. The map arrives as
 * `new_map` left it: terrain 0, height 1. Returns the controller (its tables, for tests).
 */
export function mapGenerate2(m: RmmMap, seed: number, settings: RmmSettings): RmmController {
  const rng = m.rng;
  rng.srand(seed);
  rng.srand(seed);
  const controller = new RmmController(m, settings);
  controller.init();
  rng.srand(seed);
  controller.generate();
  rng.rand();
  return controller;
}
