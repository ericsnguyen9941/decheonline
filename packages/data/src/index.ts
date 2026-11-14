export const packageName = '@aoe/data';

export { parseDat, parseDatBytes, serializeDatBytes, writeDat } from './dat';
export { deflateStored, inflateRaw } from './inflate';
export { BORDER_SLOTS, DAT_VERSION, TERRAIN_SLOTS, TILE_TYPES } from './layout';
export { RuleSet } from './rules';
export { renderSimTables, simTableCiv, simUnitClosure, simUnitRecord } from './sim-tables';
export {
  buildSyntheticDat,
  syntheticBorder,
  syntheticGraphic,
  syntheticTech,
  syntheticTerrain,
  syntheticUnit,
} from './synthetic';
export * from './types';
