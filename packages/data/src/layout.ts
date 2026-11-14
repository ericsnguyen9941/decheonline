// The empires.dat layout for AoE1 1.0c / RoR 1.0a ("VER 3.7"), written from the format
// as documented by genieutils (GV_RoR branch) and checked against a real file to its
// last byte. Each function both reads and writes its record (see io.ts).

import type { Io, NumKind } from './io';
import {
  UnitType,
  type Civ,
  type DatFile,
  type Effect,
  type Graphic,
  type RandomMap,
  type RandomMapInfo,
  type RandomMaps,
  type ResourceAmount,
  type Sound,
  type Tech,
  type Terrain,
  type TerrainBlock,
  type TerrainBorder,
  type Unit,
  type UnitAction,
  type UnitBuilding,
  type UnitCombat,
  type UnitCreatable,
  type UnitMovement,
  type UnitProjectile,
} from './types';

export const DAT_VERSION = 'VER 3.7';
/** Tile shape variants (flat, slopes, ...) with their own size and graphics. */
export const TILE_TYPES = 19;
/** Terrain table length in the AoE1 terrain block (not all slots are used). */
export const TERRAIN_SLOTS = 32;
export const BORDER_SLOTS = 16;
const BORDER_FRAMES = 12;
const TERRAIN_UNITS = 30;

function resourceAmount(amount: NumKind, flag: NumKind) {
  return (io: Io, r: ResourceAmount): void => {
    io.i16(r, 'type');
    io.field(r, 'amount', amount);
    io.field(r, 'flag', flag);
  };
}
const techCost = resourceAmount('i16', 'u8');
const unitStorage = resourceAmount('f32', 'u8');
const unitCost = resourceAmount('i16', 'i16');

export function datFile(io: Io, d: DatFile): void {
  io.str(d, 'version', 8);
  if (io.reading && d.version !== DAT_VERSION) {
    throw new Error(`dat: unsupported version "${d.version}", expected "${DAT_VERSION}"`);
  }
  const restrictions = io.size('i16', () => d.terrainRestrictions.length);
  io.i16(d, 'terrainsUsed');
  io.nums(d, 'terrainRestrictionPointers', 'i32', restrictions);
  io.list(d, 'terrainRestrictions', restrictions, (io, r) => io.nums(r, 'accessible', 'f32', d.terrainsUsed));

  io.list(d, 'playerColours', io.size('i16', () => d.playerColours.length), (io, c) => {
    io.str(c, 'name', 30);
    io.i16(c, 'id');
    io.i16(c, 'resourceId');
    io.u8(c, 'minimapColour');
    io.u8(c, 'type');
  });

  io.list(d, 'sounds', io.size('i16', () => d.sounds.length), sound);

  const graphics = io.size('i16', () => d.graphics.length);
  io.nums(d, 'graphicPointers', 'i32', graphics);
  io.pointed(d, 'graphics', d.graphicPointers, graphic);

  io.sub(d, 'terrainBlock', terrainBlock);
  io.sub(d, 'randomMaps', randomMaps);
  io.list(d, 'effects', io.size('i32', () => d.effects.length), effect);
  io.list(d, 'civs', io.size('i16', () => d.civs.length), civ);
  io.list(d, 'techs', io.size('i16', () => d.techs.length), tech);
}

function sound(io: Io, s: Sound): void {
  io.i16(s, 'id');
  io.i16(s, 'playDelay');
  const items = io.size('i16', () => s.items.length);
  io.i32(s, 'cacheTime');
  io.list(s, 'items', items, (io, item) => {
    io.str(item, 'fileName', 13);
    io.i32(item, 'resourceId');
    io.i16(item, 'probability');
  });
}

function graphic(io: Io, g: Graphic): void {
  io.str(g, 'name', 21);
  io.str(g, 'fileName', 13);
  io.i32(g, 'slp');
  io.u8(g, 'isLoaded');
  io.u8(g, 'oldColourFlag');
  io.u8(g, 'layer');
  io.i16(g, 'playerColour');
  io.u8(g, 'transparentSelection');
  io.nums(g, 'coordinates', 'i16', 4);
  const deltas = io.size('i16', () => g.deltas.length);
  io.i16(g, 'soundId');
  const angleSoundsUsed = io.size('u8', () => (g.angleSounds ? 1 : 0));
  io.i16(g, 'frameCount');
  io.i16(g, 'angleCount');
  io.f32(g, 'speedMultiplier');
  io.f32(g, 'frameDuration');
  io.f32(g, 'replayDelay');
  io.u8(g, 'sequenceType');
  io.i16(g, 'id');
  io.u8(g, 'mirroringMode');
  io.list(g, 'deltas', deltas, (io, delta) => {
    io.i16(delta, 'graphicId');
    io.i16(delta, 'padding1');
    io.i32(delta, 'spritePtr');
    io.i16(delta, 'offsetX');
    io.i16(delta, 'offsetY');
    io.i16(delta, 'displayAngle');
    io.i16(delta, 'padding2');
  });
  if (angleSoundsUsed === 0) {
    g.angleSounds = null;
    return;
  }
  io.list(g, 'angleSounds', g.angleCount, (io, a) => {
    io.i16(a, 'frame1');
    io.i16(a, 'sound1');
    io.i16(a, 'frame2');
    io.i16(a, 'sound2');
    io.i16(a, 'frame3');
    io.i16(a, 'sound3');
  });
}

function terrainBlock(io: Io, b: TerrainBlock): void {
  io.u32(b, 'vfPtr');
  io.u32(b, 'mapPtr');
  io.i32(b, 'mapWidth');
  io.i32(b, 'mapHeight');
  io.i32(b, 'worldWidth');
  io.i32(b, 'worldHeight');
  io.list(b, 'tileSizes', TILE_TYPES, (io, t) => {
    io.i16(t, 'width');
    io.i16(t, 'height');
    io.i16(t, 'deltaY');
  });
  io.i16(b, 'paddingTileSizes');
  io.list(b, 'terrains', TERRAIN_SLOTS, terrain);
  io.list(b, 'borders', BORDER_SLOTS, terrainBorder);
  io.u32(b, 'mapRowOffset');
  io.i16(b, 'terrainsUsed');
  io.i16(b, 'bordersUsed');
  io.i16(b, 'maxTerrain');
  io.i16(b, 'tileWidth');
  io.i16(b, 'tileHeight');
  io.i16(b, 'tileHalfHeight');
  io.i16(b, 'tileHalfWidth');
  io.i16(b, 'elevHeight');
  io.i16(b, 'curRow');
  io.i16(b, 'curCol');
  io.i16(b, 'blockBegRow');
  io.i16(b, 'blockEndRow');
  io.i16(b, 'blockBegCol');
  io.i16(b, 'blockEndCol');
  io.u32(b, 'anyFrameChange');
  io.u32(b, 'searchMapPtr');
  io.u32(b, 'searchMapRowsPtr');
  io.u8(b, 'mapVisibleFlag');
  io.u8(b, 'fogFlag');
  io.nums(b, 'trailingBytes', 'u8', 2);
  io.nums(b, 'trailingPointers', 'u32', 5);
}

function terrainAnimation(io: Io, t: Terrain | TerrainBorder, cliffColours: boolean): void {
  io.u8(t, 'enabled');
  io.u8(t, 'random');
  io.str(t, 'name', 13);
  io.str(t, 'slpName', 13);
  io.i32(t, 'slp');
  io.i32(t, 'shapePtr');
  io.i32(t, 'soundId');
  io.nums(t, 'colours', 'u8', 3);
  if (cliffColours) {
    const terrain = t as Terrain;
    io.nums(terrain, 'cliffColours', 'u8', 2);
    io.u8(terrain, 'passableTerrain');
    io.u8(terrain, 'impassableTerrain');
  }
  io.u8(t, 'isAnimated');
  io.i16(t, 'animationFrames');
  io.i16(t, 'pauseFrames');
  io.f32(t, 'interval');
  io.f32(t, 'pauseBetweenLoops');
  io.i16(t, 'frame');
  io.i16(t, 'drawFrame');
  io.f32(t, 'animateLast');
  io.u8(t, 'frameChanged');
  io.u8(t, 'drawn');
}

function frameData(io: Io, f: { frameCount: number; angleCount: number; shapeId: number }): void {
  io.i16(f, 'frameCount');
  io.i16(f, 'angleCount');
  io.i16(f, 'shapeId');
}

function terrain(io: Io, t: Terrain): void {
  terrainAnimation(io, t, true);
  io.list(t, 'elevationGraphics', TILE_TYPES, frameData);
  io.i16(t, 'terrainToDraw');
  io.nums(t, 'terrainDimensions', 'i16', 2);
  io.nums(t, 'borders', 'i16', TERRAIN_SLOTS);
  io.nums(t, 'terrainUnitIds', 'i16', TERRAIN_UNITS);
  io.nums(t, 'terrainUnitDensities', 'i16', TERRAIN_UNITS);
  io.nums(t, 'terrainUnitCentering', 'u8', TERRAIN_UNITS);
  io.i16(t, 'terrainUnitsUsed');
  io.i16(t, 'phantom');
}

function terrainBorder(io: Io, t: TerrainBorder): void {
  terrainAnimation(io, t, false);
  const r = t as unknown as Record<string, unknown>;
  const frames = io.reading ? [] : t.frames;
  if (!io.reading && frames.length !== TILE_TYPES) throw new Error(`dat: border frames must have ${TILE_TYPES} rows`);
  for (let i = 0; i < TILE_TYPES; i++) {
    const row = { frames: io.reading ? [] : frames[i]! };
    io.list(row, 'frames', BORDER_FRAMES, frameData);
    frames[i] = row.frames;
  }
  r.frames = frames;
  io.i16(t, 'drawTerrain');
  io.i16(t, 'underlayTerrain');
  io.i16(t, 'borderStyle');
}


const MAP_LISTS = [
  ['lands', 'landsPtr'],
  ['terrains', 'terrainsPtr'],
  ['units', 'unitsPtr'],
  ['elevations', 'elevationsPtr'],
] as const;

function randomMaps(io: Io, m: RandomMaps): void {
  const count = io.size('u32', () => m.maps.length);
  io.i32(m, 'randomMapsPtr');
  const headerCounts: number[][] = [];
  io.list(m, 'maps', count, (io, map: RandomMap) => {
    io.i32(map, 'id');
    const counts: number[] = [];
    io.sub(map, 'header', (io, info: RandomMapInfo) => {
      randomMapInfoFields(io, info);
      for (const [list, ptr] of MAP_LISTS) {
        counts.push(io.size('u32', () => map[list].length));
        io.i32(info, ptr);
      }
    });
    headerCounts.push(counts);
  });
  m.maps.forEach((map, i) => {
    io.sub(map, 'body', (io, info: RandomMapInfo) => {
      randomMapInfoFields(io, info);
      const counts: number[] = [];
      const listHead = (list: (typeof MAP_LISTS)[number][0], ptr: (typeof MAP_LISTS)[number][1]): number => {
        const n = io.size('u32', () => map[list].length);
        io.i32(info, ptr);
        counts.push(n);
        return n;
      };
      io.list(map, 'lands', listHead('lands', 'landsPtr'), (io, l) => {
        io.i32(l, 'landId');
        io.u32(l, 'terrain');
        io.i32(l, 'landSpacing');
        io.i32(l, 'baseSize');
        io.u8(l, 'zone');
        io.u8(l, 'placementType');
        io.i16(l, 'padding1');
        io.i32(l, 'baseX');
        io.i32(l, 'baseY');
        io.u8(l, 'landProportion');
        io.u8(l, 'byPlayerFlag');
        io.i16(l, 'padding2');
        io.i32(l, 'startAreaRadius');
        io.i32(l, 'terrainEdgeFade');
        io.i32(l, 'clumpiness');
      });
      io.list(map, 'terrains', listHead('terrains', 'terrainsPtr'), (io, t) => {
        io.i32(t, 'proportion');
        io.i32(t, 'terrain');
        io.i32(t, 'clumpCount');
        io.i32(t, 'edgeSpacing');
        io.i32(t, 'placementTerrain');
        io.i32(t, 'clumpiness');
      });
      io.list(map, 'units', listHead('units', 'unitsPtr'), (io, u) => {
        io.i32(u, 'unit');
        io.i32(u, 'hostTerrain');
        io.u8(u, 'groupPlacing');
        io.u8(u, 'scaleFlag');
        io.i16(u, 'padding1');
        io.i32(u, 'objectsPerGroup');
        io.i32(u, 'fluctuation');
        io.i32(u, 'groupsPerPlayer');
        io.i32(u, 'groupArea');
        io.i32(u, 'playerId');
        io.i32(u, 'setPlaceForAllPlayers');
        io.i32(u, 'minDistanceToPlayers');
        io.i32(u, 'maxDistanceToPlayers');
      });
      io.list(map, 'elevations', listHead('elevations', 'elevationsPtr'), (io, e) => {
        io.i32(e, 'proportion');
        io.i32(e, 'terrain');
        io.i32(e, 'clumpCount');
        io.i32(e, 'baseTerrain');
        io.i32(e, 'baseElevation');
        io.i32(e, 'tileSpacing');
      });
      if (counts.join() !== headerCounts[i]!.join()) {
        throw new Error(`dat: random map ${map.id} list counts differ between header and body`);
      }
    });
  });
}

function randomMapInfoFields(io: Io, info: RandomMapInfo): void {
  io.i32(info, 'borderSouthWest');
  io.i32(info, 'borderNorthWest');
  io.i32(info, 'borderNorthEast');
  io.i32(info, 'borderSouthEast');
  io.i32(info, 'borderUsage');
  io.i32(info, 'waterShape');
  io.i32(info, 'baseTerrain');
  io.i32(info, 'landCoverage');
  io.i32(info, 'unusedId');
}

function effect(io: Io, e: Effect): void {
  io.str(e, 'name', 31);
  io.list(e, 'commands', io.size('i16', () => e.commands.length), (io, c) => {
    io.u8(c, 'type');
    io.i16(c, 'a');
    io.i16(c, 'b');
    io.i16(c, 'c');
    io.f32(c, 'd');
  });
}

function civ(io: Io, c: Civ): void {
  io.u8(c, 'playerType');
  io.str(c, 'name', 20);
  const resources = io.size('i16', () => c.resources.length);
  io.i16(c, 'techTreeId');
  io.nums(c, 'resources', 'f32', resources);
  io.u8(c, 'iconSet');
  io.nums(c, 'unitPointers', 'i32', io.size('i16', () => c.units.length));
  io.pointed(c, 'units', c.unitPointers, unit);
}

function tech(io: Io, t: Tech): void {
  io.nums(t, 'requiredTechs', 'i16', 4);
  io.list(t, 'costs', 3, techCost);
  io.i16(t, 'requiredTechCount');
  io.i16(t, 'locationId');
  io.i16(t, 'languageDllName');
  io.i16(t, 'languageDllDescription');
  io.i16(t, 'researchTime');
  io.i16(t, 'effectId');
  io.i16(t, 'type');
  io.i16(t, 'iconId');
  io.u8(t, 'buttonId');
  io.i32(t, 'languageDllHelp');
  io.i32(t, 'languageDllTechTree');
  io.i32(t, 'hotKeyId');
  io.str(t, 'name', io.size('i16', () => t.name.length + 1));
}

function unit(io: Io, u: Unit): void {
  io.u8(u, 'type');
  const nameLength = io.size('i16', () => u.name.length + 1);
  io.i16(u, 'id');
  io.i16(u, 'languageDllName');
  io.i16(u, 'languageDllCreation');
  io.i16(u, 'class');
  io.i16(u, 'standingGraphic');
  io.i16(u, 'dyingGraphic');
  io.i16(u, 'undeadGraphic');
  io.u8(u, 'undeadMode');
  io.i16(u, 'hitPoints');
  io.f32(u, 'lineOfSight');
  io.u8(u, 'garrisonCapacity');
  io.nums(u, 'collisionSize', 'f32', 3);
  io.i16(u, 'trainSound');
  io.i16(u, 'deadUnitId');
  io.u8(u, 'sortNumber');
  io.u8(u, 'canBeBuiltOn');
  io.i16(u, 'iconId');
  io.u8(u, 'hideInEditor');
  io.i16(u, 'oldPortraitPict');
  io.u8(u, 'enabled');
  io.nums(u, 'placementSideTerrain', 'i16', 2);
  io.nums(u, 'placementTerrain', 'i16', 2);
  io.nums(u, 'clearanceSize', 'f32', 2);
  io.u8(u, 'hillMode');
  io.u8(u, 'fogVisibility');
  io.i16(u, 'terrainRestriction');
  io.u8(u, 'flyMode');
  io.i16(u, 'resourceCapacity');
  io.f32(u, 'resourceDecay');
  io.u8(u, 'blastDefenseLevel');
  io.u8(u, 'combatLevel');
  io.u8(u, 'interactionMode');
  io.u8(u, 'minimapMode');
  io.u8(u, 'interfaceKind');
  io.f32(u, 'multipleAttributeMode');
  io.u8(u, 'minimapColour');
  io.i32(u, 'languageDllHelp');
  io.i32(u, 'languageDllHotKeyText');
  io.i32(u, 'hotKeyId');
  io.u8(u, 'recyclable');
  io.u8(u, 'enableAutoGather');
  io.u8(u, 'createDoppelgangerOnDeath');
  io.u8(u, 'resourceGatherGroup');
  io.u8(u, 'selectionEffect');
  io.u8(u, 'editorSelectionColour');
  io.nums(u, 'outlineSize', 'f32', 3);
  io.list(u, 'resourceStorages', 3, unitStorage);
  io.list(u, 'damageGraphics', io.size('u8', () => u.damageGraphics.length), (io, g) => {
    io.i16(g, 'graphicId');
    io.i16(g, 'damagePercent');
    io.u8(g, 'applyMode');
  });
  io.i16(u, 'selectionSound');
  io.i16(u, 'dyingSound');
  io.u8(u, 'oldAttackReaction');
  io.u8(u, 'convertTerrain');
  io.str(u, 'name', nameLength);
  io.i16(u, 'copyId');

  if (u.type < UnitType.Flag || u.type === UnitType.Tree) return;
  io.f32(u, 'speed');
  if (u.type >= UnitType.DeadFish) io.sub(u, 'movement', unitMovement);
  if (u.type >= UnitType.Bird) io.sub(u, 'action', unitAction);
  if (u.type >= UnitType.Combatant) io.sub(u, 'combat', unitCombat);
  if (u.type === UnitType.Projectile) io.sub(u, 'projectile', unitProjectile);
  if (u.type >= UnitType.Creatable) io.sub(u, 'creatable', unitCreatable);
  if (u.type === UnitType.Building) io.sub(u, 'building', unitBuilding);
}

function unitMovement(io: Io, m: UnitMovement): void {
  io.i16(m, 'walkingGraphic');
  io.i16(m, 'runningGraphic');
  io.f32(m, 'rotationSpeed');
  io.u8(m, 'oldSizeClass');
  io.i16(m, 'trackingUnit');
  io.u8(m, 'trackingUnitMode');
  io.f32(m, 'trackingUnitDensity');
  io.u8(m, 'oldMoveAlgorithm');
}

function unitAction(io: Io, a: UnitAction): void {
  io.i16(a, 'defaultTaskId');
  io.f32(a, 'searchRadius');
  io.f32(a, 'workRate');
  io.nums(a, 'dropSites', 'i16', 2);
  io.u8(a, 'taskSwapGroup');
  io.i16(a, 'attackSound');
  io.i16(a, 'moveSound');
  io.u8(a, 'runPattern');
  io.list(a, 'tasks', io.size('i16', () => a.tasks.length), (io, t) => {
    io.i16(t, 'taskType');
    io.i16(t, 'id');
    io.u8(t, 'isDefault');
    io.i16(t, 'actionType');
    io.i16(t, 'classId');
    io.i16(t, 'unitId');
    io.i16(t, 'terrainId');
    io.i16(t, 'resourceIn');
    io.i16(t, 'resourceMultiplier');
    io.i16(t, 'resourceOut');
    io.i16(t, 'unusedResource');
    io.f32(t, 'workValue1');
    io.f32(t, 'workValue2');
    io.f32(t, 'workRange');
    io.u8(t, 'autoSearchTargets');
    io.f32(t, 'searchWaitTime');
    io.u8(t, 'enableTargeting');
    io.u8(t, 'combatLevelFlag');
    io.i16(t, 'gatherType');
    io.i16(t, 'workFlag2');
    io.u8(t, 'targetDiplomacy');
    io.u8(t, 'carryCheck');
    io.u8(t, 'pickForConstruction');
    io.i16(t, 'movingGraphicId');
    io.i16(t, 'proceedingGraphicId');
    io.i16(t, 'workingGraphicId');
    io.i16(t, 'carryingGraphicId');
    io.i16(t, 'resourceGatheringSoundId');
    io.i16(t, 'resourceDepositSoundId');
  });
}

function unitCombat(io: Io, c: UnitCombat): void {
  io.u8(c, 'baseArmour');
  const attackOrArmour = (io: Io, a: { class: number; amount: number }): void => {
    io.i16(a, 'class');
    io.i16(a, 'amount');
  };
  io.list(c, 'attacks', io.size('i16', () => c.attacks.length), attackOrArmour);
  io.list(c, 'armours', io.size('i16', () => c.armours.length), attackOrArmour);
  io.i16(c, 'defenseTerrainBonus');
  io.f32(c, 'maxRange');
  io.f32(c, 'blastWidth');
  io.f32(c, 'reloadTime');
  io.i16(c, 'projectileUnitId');
  io.i16(c, 'accuracyPercent');
  io.u8(c, 'breakOffCombat');
  io.i16(c, 'frameDelay');
  io.nums(c, 'graphicDisplacement', 'f32', 3);
  io.u8(c, 'blastAttackLevel');
  io.f32(c, 'minRange');
  io.i16(c, 'attackGraphic');
  io.i16(c, 'displayedMeleeArmour');
  io.i16(c, 'displayedAttack');
  io.f32(c, 'displayedRange');
  io.f32(c, 'displayedReloadTime');
}

function unitProjectile(io: Io, p: UnitProjectile): void {
  io.u8(p, 'projectileType');
  io.u8(p, 'smartMode');
  io.u8(p, 'hitMode');
  io.u8(p, 'vanishMode');
  io.u8(p, 'areaEffectSpecials');
  io.f32(p, 'projectileArc');
}

function unitCreatable(io: Io, c: UnitCreatable): void {
  io.list(c, 'costs', 3, unitCost);
  io.i16(c, 'trainTime');
  io.i16(c, 'trainLocationId');
  io.u8(c, 'buttonId');
  io.i16(c, 'displayedPierceArmour');
}

function unitBuilding(io: Io, b: UnitBuilding): void {
  io.i16(b, 'constructionGraphicId');
  io.u8(b, 'adjacentMode');
  io.i16(b, 'graphicsAngle');
  io.u8(b, 'disappearsWhenBuilt');
  io.i16(b, 'stackUnitId');
  io.i16(b, 'foundationTerrainId');
  io.i16(b, 'oldOverlayId');
  io.i16(b, 'techId');
  io.i16(b, 'constructionSound');
}
