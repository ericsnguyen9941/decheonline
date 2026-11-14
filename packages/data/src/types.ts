// Typed records of empires.dat as written by AoE1 1.0c / Rise of Rome 1.0a (header
// "VER 3.7", genieutils' GV_AoE 7.2 / GV_RoR 7.24 share this layout). Field order in
// layout.ts is the file order; names follow the community names where they exist.
// Fields named `*Ptr`, `*Pointer(s)` and `padding*` are memory or alignment leftovers kept
// only so a write reproduces the layout.

export interface DatFile {
  /** "VER 3.7" for AoE1 and RoR. */
  version: string;
  terrainsUsed: number;
  terrainRestrictionPointers: number[];
  terrainRestrictions: TerrainRestriction[];
  playerColours: PlayerColour[];
  sounds: Sound[];
  graphicPointers: number[];
  /** Indexed by graphic id; null where the original table has a hole. */
  graphics: (Graphic | null)[];
  terrainBlock: TerrainBlock;
  randomMaps: RandomMaps;
  effects: Effect[];
  /** Index 0 is Gaia; the playable civilizations follow. */
  civs: Civ[];
  techs: Tech[];
}

export interface TerrainRestriction {
  /** Per terrain: 0 impassable, otherwise passable (and the damage multiplier). */
  accessible: number[];
}

export interface PlayerColour {
  name: string;
  id: number;
  resourceId: number;
  minimapColour: number;
  type: number;
}

export interface Sound {
  id: number;
  playDelay: number;
  cacheTime: number;
  items: SoundItem[];
}

export interface SoundItem {
  fileName: string;
  resourceId: number;
  probability: number;
}

export interface Graphic {
  name: string;
  fileName: string;
  slp: number;
  isLoaded: number;
  oldColourFlag: number;
  layer: number;
  playerColour: number;
  transparentSelection: number;
  coordinates: number[];
  soundId: number;
  frameCount: number;
  angleCount: number;
  speedMultiplier: number;
  frameDuration: number;
  replayDelay: number;
  sequenceType: number;
  id: number;
  mirroringMode: number;
  deltas: GraphicDelta[];
  /** One entry per angle, present when the file flags angle sounds as used. */
  angleSounds: GraphicAngleSound[] | null;
}

export interface GraphicDelta {
  graphicId: number;
  padding1: number;
  spritePtr: number;
  offsetX: number;
  offsetY: number;
  displayAngle: number;
  padding2: number;
}

export interface GraphicAngleSound {
  frame1: number;
  sound1: number;
  frame2: number;
  sound2: number;
  frame3: number;
  sound3: number;
}

export interface TileSize {
  width: number;
  height: number;
  deltaY: number;
}

export interface FrameData {
  frameCount: number;
  angleCount: number;
  shapeId: number;
}

export interface TerrainBlock {
  vfPtr: number;
  mapPtr: number;
  mapWidth: number;
  mapHeight: number;
  worldWidth: number;
  worldHeight: number;
  tileSizes: TileSize[];
  paddingTileSizes: number;
  terrains: Terrain[];
  borders: TerrainBorder[];
  mapRowOffset: number;
  terrainsUsed: number;
  bordersUsed: number;
  maxTerrain: number;
  tileWidth: number;
  tileHeight: number;
  tileHalfHeight: number;
  tileHalfWidth: number;
  elevHeight: number;
  curRow: number;
  curCol: number;
  blockBegRow: number;
  blockEndRow: number;
  blockBegCol: number;
  blockEndCol: number;
  anyFrameChange: number;
  searchMapPtr: number;
  searchMapRowsPtr: number;
  mapVisibleFlag: number;
  fogFlag: number;
  trailingBytes: number[];
  trailingPointers: number[];
}

interface TerrainAnimation {
  enabled: number;
  random: number;
  name: string;
  slpName: string;
  slp: number;
  shapePtr: number;
  soundId: number;
  colours: number[];
  isAnimated: number;
  animationFrames: number;
  pauseFrames: number;
  interval: number;
  pauseBetweenLoops: number;
  frame: number;
  drawFrame: number;
  animateLast: number;
  frameChanged: number;
  drawn: number;
}

export interface Terrain extends TerrainAnimation {
  cliffColours: number[];
  passableTerrain: number;
  impassableTerrain: number;
  elevationGraphics: FrameData[];
  terrainToDraw: number;
  terrainDimensions: number[];
  /** Border id to draw against each terrain. */
  borders: number[];
  terrainUnitIds: number[];
  terrainUnitDensities: number[];
  terrainUnitCentering: number[];
  terrainUnitsUsed: number;
  phantom: number;
}

export interface TerrainBorder extends TerrainAnimation {
  /** 19 tile types x 12 frames. */
  frames: FrameData[][];
  drawTerrain: number;
  underlayTerrain: number;
  borderStyle: number;
}

export interface RandomMaps {
  randomMapsPtr: number;
  maps: RandomMap[];
}

export interface RandomMapInfo {
  borderSouthWest: number;
  borderNorthWest: number;
  borderNorthEast: number;
  borderSouthEast: number;
  borderUsage: number;
  waterShape: number;
  baseTerrain: number;
  landCoverage: number;
  unusedId: number;
  landsPtr: number;
  terrainsPtr: number;
  unitsPtr: number;
  elevationsPtr: number;
}

/**
 * The file stores every map twice: a table of headers (with the map id), then each map
 * again without the id and with its lists. `header` and `body` keep both copies.
 */
export interface RandomMap {
  id: number;
  header: RandomMapInfo;
  body: RandomMapInfo;
  lands: MapLand[];
  terrains: MapTerrain[];
  units: MapUnit[];
  elevations: MapElevation[];
}

export interface MapLand {
  landId: number;
  terrain: number;
  landSpacing: number;
  baseSize: number;
  zone: number;
  placementType: number;
  padding1: number;
  baseX: number;
  baseY: number;
  landProportion: number;
  byPlayerFlag: number;
  padding2: number;
  startAreaRadius: number;
  terrainEdgeFade: number;
  clumpiness: number;
}

export interface MapTerrain {
  proportion: number;
  terrain: number;
  clumpCount: number;
  edgeSpacing: number;
  placementTerrain: number;
  clumpiness: number;
}

export interface MapUnit {
  unit: number;
  hostTerrain: number;
  groupPlacing: number;
  scaleFlag: number;
  padding1: number;
  objectsPerGroup: number;
  fluctuation: number;
  groupsPerPlayer: number;
  groupArea: number;
  playerId: number;
  setPlaceForAllPlayers: number;
  minDistanceToPlayers: number;
  maxDistanceToPlayers: number;
}

export interface MapElevation {
  proportion: number;
  terrain: number;
  clumpCount: number;
  baseTerrain: number;
  baseElevation: number;
  tileSpacing: number;
}

/** A technology effect ("techage"): a named list of commands. */
export interface Effect {
  name: string;
  commands: EffectCommand[];
}

export interface EffectCommand {
  type: number;
  a: number;
  b: number;
  c: number;
  d: number;
}

export interface Civ {
  playerType: number;
  name: string;
  techTreeId: number;
  /** Starting resources and civ attributes, indexed by resource id. */
  resources: number[];
  iconSet: number;
  unitPointers: number[];
  /** Indexed by unit id; null where the civ has no such unit. */
  units: (Unit | null)[];
}

export interface ResourceAmount {
  type: number;
  amount: number;
  flag: number;
}

export interface Tech {
  requiredTechs: number[];
  costs: ResourceAmount[];
  requiredTechCount: number;
  locationId: number;
  languageDllName: number;
  languageDllDescription: number;
  researchTime: number;
  effectId: number;
  type: number;
  iconId: number;
  buttonId: number;
  languageDllHelp: number;
  languageDllTechTree: number;
  hotKeyId: number;
  name: string;
}

export const UnitType = {
  EyeCandy: 10,
  Flag: 20,
  DeadFish: 30,
  Bird: 40,
  Combatant: 50,
  Projectile: 60,
  Creatable: 70,
  Building: 80,
  Tree: 90,
} as const;

export interface DamageGraphic {
  graphicId: number;
  damagePercent: number;
  applyMode: number;
}

/** Every unit record has these; the optional sections follow by `type`. */
export interface Unit {
  type: number;
  id: number;
  languageDllName: number;
  languageDllCreation: number;
  class: number;
  standingGraphic: number;
  dyingGraphic: number;
  undeadGraphic: number;
  undeadMode: number;
  hitPoints: number;
  lineOfSight: number;
  garrisonCapacity: number;
  collisionSize: number[];
  trainSound: number;
  deadUnitId: number;
  sortNumber: number;
  canBeBuiltOn: number;
  iconId: number;
  hideInEditor: number;
  oldPortraitPict: number;
  enabled: number;
  placementSideTerrain: number[];
  placementTerrain: number[];
  clearanceSize: number[];
  hillMode: number;
  fogVisibility: number;
  terrainRestriction: number;
  flyMode: number;
  resourceCapacity: number;
  resourceDecay: number;
  blastDefenseLevel: number;
  combatLevel: number;
  interactionMode: number;
  minimapMode: number;
  interfaceKind: number;
  multipleAttributeMode: number;
  minimapColour: number;
  languageDllHelp: number;
  languageDllHotKeyText: number;
  hotKeyId: number;
  recyclable: number;
  enableAutoGather: number;
  createDoppelgangerOnDeath: number;
  resourceGatherGroup: number;
  selectionEffect: number;
  editorSelectionColour: number;
  outlineSize: number[];
  resourceStorages: ResourceAmount[];
  damageGraphics: DamageGraphic[];
  selectionSound: number;
  dyingSound: number;
  oldAttackReaction: number;
  convertTerrain: number;
  name: string;
  copyId: number;
  /** type >= Flag (20), except trees (90). */
  speed?: number;
  /** type >= DeadFish (30). */
  movement?: UnitMovement;
  /** type >= Bird (40). */
  action?: UnitAction;
  /** type >= Combatant (50). */
  combat?: UnitCombat;
  /** type === Projectile (60). */
  projectile?: UnitProjectile;
  /** type >= Creatable (70). */
  creatable?: UnitCreatable;
  /** type === Building (80). */
  building?: UnitBuilding;
}

export interface UnitMovement {
  walkingGraphic: number;
  runningGraphic: number;
  rotationSpeed: number;
  oldSizeClass: number;
  trackingUnit: number;
  trackingUnitMode: number;
  trackingUnitDensity: number;
  oldMoveAlgorithm: number;
}

export interface UnitAction {
  defaultTaskId: number;
  searchRadius: number;
  workRate: number;
  dropSites: number[];
  taskSwapGroup: number;
  attackSound: number;
  moveSound: number;
  runPattern: number;
  tasks: UnitTask[];
}

export interface UnitTask {
  taskType: number;
  id: number;
  isDefault: number;
  actionType: number;
  classId: number;
  unitId: number;
  terrainId: number;
  resourceIn: number;
  resourceMultiplier: number;
  resourceOut: number;
  unusedResource: number;
  workValue1: number;
  workValue2: number;
  workRange: number;
  autoSearchTargets: number;
  searchWaitTime: number;
  enableTargeting: number;
  combatLevelFlag: number;
  gatherType: number;
  workFlag2: number;
  targetDiplomacy: number;
  carryCheck: number;
  pickForConstruction: number;
  movingGraphicId: number;
  proceedingGraphicId: number;
  workingGraphicId: number;
  carryingGraphicId: number;
  resourceGatheringSoundId: number;
  resourceDepositSoundId: number;
}

export interface AttackOrArmour {
  class: number;
  amount: number;
}

export interface UnitCombat {
  baseArmour: number;
  attacks: AttackOrArmour[];
  armours: AttackOrArmour[];
  defenseTerrainBonus: number;
  maxRange: number;
  blastWidth: number;
  reloadTime: number;
  projectileUnitId: number;
  accuracyPercent: number;
  breakOffCombat: number;
  frameDelay: number;
  graphicDisplacement: number[];
  blastAttackLevel: number;
  minRange: number;
  attackGraphic: number;
  displayedMeleeArmour: number;
  displayedAttack: number;
  displayedRange: number;
  displayedReloadTime: number;
}

export interface UnitProjectile {
  projectileType: number;
  smartMode: number;
  hitMode: number;
  vanishMode: number;
  areaEffectSpecials: number;
  projectileArc: number;
}

export interface UnitCreatable {
  costs: ResourceAmount[];
  trainTime: number;
  trainLocationId: number;
  buttonId: number;
  displayedPierceArmour: number;
}

export interface UnitBuilding {
  constructionGraphicId: number;
  adjacentMode: number;
  graphicsAngle: number;
  disappearsWhenBuilt: number;
  stackUnitId: number;
  foundationTerrainId: number;
  oldOverlayId: number;
  techId: number;
  constructionSound: number;
}
