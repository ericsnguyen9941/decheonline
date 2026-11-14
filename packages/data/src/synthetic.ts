// A small, complete rule set built in code, for tests that must not depend on the
// Microsoft file (CI has none). Every record kind and every unit section is present.

import { BORDER_SLOTS, DAT_VERSION, TERRAIN_SLOTS, TILE_TYPES } from './layout';
import {
  UnitType,
  type Civ,
  type DatFile,
  type FrameData,
  type Graphic,
  type RandomMap,
  type RandomMapInfo,
  type ResourceAmount,
  type Tech,
  type Terrain,
  type TerrainBorder,
  type Unit,
} from './types';

const fill = <T>(n: number, make: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => make(i));
const frames = (n: number): FrameData[] => fill(n, (i) => ({ frameCount: 1, angleCount: 1, shapeId: i }));
const noResource = (): ResourceAmount => ({ type: -1, amount: 0, flag: 0 });

const animation = (name: string, slp: number) => ({
  enabled: 1,
  random: 0,
  name,
  slpName: name.slice(0, 8),
  slp,
  shapePtr: 0,
  soundId: -1,
  colours: [10, 20, 30],
  isAnimated: 0,
  animationFrames: 0,
  pauseFrames: 0,
  interval: 0,
  pauseBetweenLoops: 0,
  frame: 0,
  drawFrame: 0,
  animateLast: 0,
  frameChanged: 0,
  drawn: 0,
});

export function syntheticTerrain(name: string, slp: number): Terrain {
  return {
    ...animation(name, slp),
    cliffColours: [1, 2],
    passableTerrain: 0,
    impassableTerrain: 0,
    elevationGraphics: frames(TILE_TYPES),
    terrainToDraw: -1,
    terrainDimensions: [1, 1],
    borders: fill(TERRAIN_SLOTS, () => 0),
    terrainUnitIds: fill(30, () => -1),
    terrainUnitDensities: fill(30, () => 0),
    terrainUnitCentering: fill(30, () => 0),
    terrainUnitsUsed: 0,
    phantom: 0,
  };
}

export function syntheticBorder(name: string, slp: number): TerrainBorder {
  return {
    ...animation(name, slp),
    frames: fill(TILE_TYPES, () => frames(12)),
    drawTerrain: 0,
    underlayTerrain: 0,
    borderStyle: 0,
  };
}

export function syntheticGraphic(id: number, name: string, angleSounds = false): Graphic {
  return {
    name,
    fileName: name.slice(0, 12),
    slp: 1000 + id,
    isLoaded: 0,
    oldColourFlag: 0,
    layer: 20,
    playerColour: -1,
    transparentSelection: 1,
    coordinates: [-10, -20, 10, 5],
    soundId: -1,
    frameCount: 10,
    angleCount: 2,
    speedMultiplier: 1,
    frameDuration: 0.125,
    replayDelay: 0,
    sequenceType: 1,
    id,
    mirroringMode: 0,
    deltas: [{ graphicId: id, padding1: 0, spritePtr: 0, offsetX: 3, offsetY: -4, displayAngle: -1, padding2: 0 }],
    angleSounds: angleSounds
      ? fill(2, (i) => ({ frame1: i, sound1: 0, frame2: -1, sound2: -1, frame3: -1, sound3: -1 }))
      : null,
  };
}

/** A unit record with every section its `type` requires, filled with plain values. */
export function syntheticUnit(type: number, id: number, name: string): Unit {
  const u: Unit = {
    type,
    id,
    languageDllName: 5000 + id,
    languageDllCreation: 6000 + id,
    class: 0,
    standingGraphic: 0,
    dyingGraphic: -1,
    undeadGraphic: -1,
    undeadMode: 0,
    hitPoints: 25,
    lineOfSight: 4,
    garrisonCapacity: 0,
    collisionSize: [0.25, 0.25, 2],
    trainSound: -1,
    deadUnitId: -1,
    sortNumber: 1,
    canBeBuiltOn: 0,
    iconId: id,
    hideInEditor: 0,
    oldPortraitPict: -1,
    enabled: 1,
    placementSideTerrain: [-1, -1],
    placementTerrain: [-1, -1],
    clearanceSize: [0.25, 0.25],
    hillMode: 0,
    fogVisibility: 0,
    terrainRestriction: 1,
    flyMode: 0,
    resourceCapacity: 0,
    resourceDecay: 0,
    blastDefenseLevel: 2,
    combatLevel: 0,
    interactionMode: 0,
    minimapMode: 1,
    interfaceKind: 0,
    multipleAttributeMode: 0,
    minimapColour: 0,
    languageDllHelp: 100000 + id,
    languageDllHotKeyText: 150000 + id,
    hotKeyId: 16000 + id,
    recyclable: 0,
    enableAutoGather: 0,
    createDoppelgangerOnDeath: 0,
    resourceGatherGroup: 0,
    selectionEffect: 1,
    editorSelectionColour: 52,
    outlineSize: [0.25, 0.25, 2],
    resourceStorages: [{ type: 4, amount: 1, flag: 2 }, { type: -1, amount: 0, flag: 0 }, { type: -1, amount: 0, flag: 0 }],
    damageGraphics: [],
    selectionSound: -1,
    dyingSound: -1,
    oldAttackReaction: 0,
    convertTerrain: 0,
    name,
    copyId: id,
  };
  if (type < UnitType.Flag || type === UnitType.Tree) return u;
  u.speed = 1.25;
  if (type >= UnitType.DeadFish) {
    u.movement = {
      walkingGraphic: 0,
      runningGraphic: -1,
      rotationSpeed: 0,
      oldSizeClass: 0,
      trackingUnit: -1,
      trackingUnitMode: 0,
      trackingUnitDensity: 0,
      oldMoveAlgorithm: 0,
    };
  }
  if (type >= UnitType.Bird) {
    u.action = {
      defaultTaskId: -1,
      searchRadius: 4,
      workRate: 0.5,
      dropSites: [-1, -1],
      taskSwapGroup: 0,
      attackSound: -1,
      moveSound: -1,
      runPattern: 0,
      tasks: [
        {
          taskType: 1, id: 0, isDefault: 1, actionType: 7, classId: -1, unitId: -1, terrainId: -1,
          resourceIn: -1, resourceMultiplier: -1, resourceOut: -1, unusedResource: -1,
          workValue1: 0, workValue2: 0, workRange: 0, autoSearchTargets: 1, searchWaitTime: 0,
          enableTargeting: 1, combatLevelFlag: 0, gatherType: 0, workFlag2: 0, targetDiplomacy: 2,
          carryCheck: 0, pickForConstruction: 0, movingGraphicId: -1, proceedingGraphicId: -1,
          workingGraphicId: -1, carryingGraphicId: -1, resourceGatheringSoundId: -1,
          resourceDepositSoundId: -1,
        },
      ],
    };
  }
  if (type >= UnitType.Combatant) {
    u.combat = {
      baseArmour: 0,
      attacks: [{ class: 4, amount: 3 }],
      armours: [{ class: 4, amount: 1 }, { class: 3, amount: 0 }],
      defenseTerrainBonus: -1,
      maxRange: 0,
      blastWidth: 0,
      reloadTime: 1.5,
      projectileUnitId: -1,
      accuracyPercent: 100,
      breakOffCombat: 0,
      frameDelay: 0,
      graphicDisplacement: [0, 0, 0],
      blastAttackLevel: 0,
      minRange: 0,
      attackGraphic: 0,
      displayedMeleeArmour: 1,
      displayedAttack: 3,
      displayedRange: 0,
      displayedReloadTime: 1.5,
    };
  }
  if (type === UnitType.Projectile) {
    u.projectile = { projectileType: 0, smartMode: 0, hitMode: 1, vanishMode: 0, areaEffectSpecials: 1, projectileArc: 0.25 };
  }
  if (type >= UnitType.Creatable) {
    u.creatable = {
      costs: [{ type: 0, amount: 50, flag: 1 }, noResource(), noResource()],
      trainTime: 20,
      trainLocationId: 109,
      buttonId: 1,
      displayedPierceArmour: 0,
    };
  }
  if (type === UnitType.Building) {
    u.building = {
      constructionGraphicId: 0,
      adjacentMode: 0,
      graphicsAngle: 0,
      disappearsWhenBuilt: 0,
      stackUnitId: -1,
      foundationTerrainId: -1,
      oldOverlayId: -1,
      techId: -1,
      constructionSound: -1,
    };
  }
  return u;
}

export function syntheticTech(name: string, effectId: number): Tech {
  return {
    requiredTechs: [-1, -1, -1, -1],
    costs: [{ type: 0, amount: 120, flag: 1 }, { type: 3, amount: 60, flag: 1 }, { type: -1, amount: 0, flag: 0 }],
    requiredTechCount: 0,
    locationId: 109,
    languageDllName: 7000,
    languageDllDescription: 8000,
    researchTime: 30,
    effectId,
    type: 0,
    iconId: 1,
    buttonId: 1,
    languageDllHelp: 107000,
    languageDllTechTree: 157000,
    hotKeyId: -1,
    name,
  };
}

const mapInfo = (): RandomMapInfo => ({
  borderSouthWest: 0, borderNorthWest: 0, borderNorthEast: 0, borderSouthEast: 0,
  borderUsage: 0, waterShape: 4, baseTerrain: 0, landCoverage: 80, unusedId: 0,
  landsPtr: 0, terrainsPtr: 0, unitsPtr: 0, elevationsPtr: 0,
});

function syntheticMap(id: number): RandomMap {
  return {
    id,
    header: mapInfo(),
    body: mapInfo(),
    lands: [{
      landId: 1, terrain: 0, landSpacing: 8, baseSize: 7, zone: 0, placementType: 0, padding1: 0,
      baseX: 0, baseY: 0, landProportion: 100, byPlayerFlag: 1, padding2: 0, startAreaRadius: 10,
      terrainEdgeFade: 25, clumpiness: 8,
    }],
    terrains: [{ proportion: 10, terrain: 1, clumpCount: 4, edgeSpacing: 2, placementTerrain: 0, clumpiness: 6 }],
    units: [{
      unit: 3, hostTerrain: 0, groupPlacing: 1, scaleFlag: 0, padding1: 0, objectsPerGroup: 5,
      fluctuation: 0, groupsPerPlayer: 1, groupArea: 1, playerId: -1, setPlaceForAllPlayers: 1,
      minDistanceToPlayers: 4, maxDistanceToPlayers: 8,
    }],
    elevations: [],
  };
}

/** Units in each synthetic civ: one per unit type, unit id = slot index, one empty slot. */
const UNIT_TYPES = [
  UnitType.EyeCandy, UnitType.Flag, UnitType.DeadFish, UnitType.Bird, UnitType.Combatant,
  UnitType.Projectile, UnitType.Creatable, UnitType.Building, UnitType.Tree,
];

function syntheticCiv(name: string, playerType: number): Civ {
  const units: (Unit | null)[] = UNIT_TYPES.map((type, id) => syntheticUnit(type, id, `${name} unit ${type}`));
  units.push(null);
  return {
    playerType,
    name,
    techTreeId: -1,
    resources: [200, 200, 0, 150, 0, 0.5],
    iconSet: 1,
    unitPointers: units.map((u, i) => (u ? 0x1000 + i : 0)),
    units,
  };
}

/**
 * Builds a complete synthetic DatFile: Gaia plus two playable civs, two terrains in use,
 * a graphic table with a hole, one random map, effects and techs.
 */
export function buildSyntheticDat(): DatFile {
  const terrainsUsed = 2;
  const graphics = [syntheticGraphic(0, 'Villager stand', true), null, syntheticGraphic(2, 'Arrow')];
  return {
    version: DAT_VERSION,
    terrainsUsed,
    terrainRestrictionPointers: [0x100, 0x200],
    terrainRestrictions: [{ accessible: [0, 0] }, { accessible: [1, 0.5] }],
    playerColours: fill(2, (i) => ({ name: `Colour ${i + 1}`, id: i, resourceId: 500 + i, minimapColour: 16 * i, type: 0 })),
    sounds: [{ id: 0, playDelay: 0, cacheTime: 300000, items: [{ fileName: 'click.wav', resourceId: 5000, probability: 100 }] }],
    graphicPointers: graphics.map((g, i) => (g ? 0x2000 + i : 0)),
    graphics,
    terrainBlock: {
      vfPtr: 0, mapPtr: 0, mapWidth: 0, mapHeight: 0, worldWidth: 0, worldHeight: 0,
      tileSizes: fill(TILE_TYPES, () => ({ width: 64, height: 32, deltaY: 0 })),
      paddingTileSizes: 0,
      terrains: fill(TERRAIN_SLOTS, (i) => syntheticTerrain(i < terrainsUsed ? `Terrain ${i}` : '', 15000 + i)),
      borders: fill(BORDER_SLOTS, (i) => syntheticBorder(`Border ${i}`, 20000 + i)),
      mapRowOffset: 0, terrainsUsed, bordersUsed: BORDER_SLOTS, maxTerrain: terrainsUsed,
      tileWidth: 64, tileHeight: 32, tileHalfHeight: 16, tileHalfWidth: 32, elevHeight: 16,
      curRow: 0, curCol: 0, blockBegRow: 0, blockEndRow: 0, blockBegCol: 0, blockEndCol: 0,
      anyFrameChange: 0, searchMapPtr: 0, searchMapRowsPtr: 0, mapVisibleFlag: 0, fogFlag: 1,
      trailingBytes: [0, 0],
      trailingPointers: [0, 0, 0, 0, 0],
    },
    randomMaps: { randomMapsPtr: 0, maps: [syntheticMap(0), syntheticMap(1)] },
    effects: [
      { name: 'Tool Age', commands: [{ type: 4, a: 0, b: -1, c: 0, d: 2 }] },
      { name: 'Empty', commands: [] },
    ],
    civs: [syntheticCiv('Gaia', 0), syntheticCiv('Alpha', 1), syntheticCiv('Beta', 1)],
    techs: [syntheticTech('Tool Age', 0), syntheticTech('Nothing', -1)],
  };
}
