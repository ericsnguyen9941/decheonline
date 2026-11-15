import { Hasher } from '@aoe/sim';
import type { MapView } from './map-view';

/** What `?debug=map` and `?debug=net` expose as `window.__map`, for tests and manual poking. */
export interface MapDebug {
  source: 'pack' | 'debug';
  width: number;
  height: number;
  /** Hash of the map as the sim hashes it (terrain and elevation of every tile). */
  mapHash: number;
  camera(): { x: number; y: number };
  /** Centre the camera on the middle of tile (col, row). */
  centerOnTile(col: number, row: number): void;
  setCamera(x: number, y: number): void;
  drawnTiles(): number;
  /** Canvas pixel of the middle of tile (col, row) as drawn (on its hill) at the current camera. */
  tileScreenPos(col: number, row: number): { x: number; y: number };
  /** The tile drawn at a canvas pixel (on hills, the front-most surface there), or null off the map. */
  tileAt(canvasX: number, canvasY: number): { col: number; row: number } | null;
  /** Draw the whole map without fog from now on (the scenario editor's view), for screenshots. */
  showAll(): void;
  /** Terrain id, height level and slope shape (`tile_type`) of tile (col, row). */
  tileInfo(col: number, row: number): { terrain: number; height: number; type: number; border: number; borderShape: number };
  /** The map's terrains drawn with debug art because the provider has none for them (or for their `terrain_to_draw`). */
  debugTerrains(): number[];
}

declare global {
  interface Window {
    __map?: MapDebug;
  }
}

export function exposeMapDebug(view: MapView): MapDebug {
  const { map, camera } = view;
  const mapHasher = new Hasher();
  map.hashInto(mapHasher);
  const centre = (col: number, row: number) => view.ground.pixel(col + 0.5, row + 0.5);
  const debug: MapDebug = {
    source: view.source,
    width: map.width,
    height: map.height,
    mapHash: mapHasher.digest(),
    camera: () => ({ x: camera.x, y: camera.y }),
    centerOnTile(col, row) {
      const c = centre(col, row);
      view.centerOn(c.x, c.y);
    },
    setCamera(x, y) {
      camera.moveTo(x, y);
      view.refresh();
    },
    drawnTiles: () => view.drawnTiles,
    tileScreenPos(col, row) {
      const c = centre(col, row);
      return { x: c.x - camera.x, y: c.y - camera.y };
    },
    tileAt(x, y) {
      const t = view.ground.pointAt(x + camera.x, y + camera.y);
      const col = Math.floor(t.col);
      const row = Math.floor(t.row);
      return col >= 0 && row >= 0 && col < map.width && row < map.height ? { col, row } : null;
    },
    showAll: () => view.setFog(null),
    tileInfo: (col, row) => ({
      terrain: map.terrainAt(col, row),
      height: map.elevationAt(col, row),
      type: view.ground.type(col, row),
      border: view.borders.type[row * map.width + col]!,
      borderShape: view.borders.shape[row * map.width + col]!,
    }),
    debugTerrains: () => [...view.debugTerrains],
  };
  window.__map = debug;
  return debug;
}
