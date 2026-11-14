import { Hasher } from '@aoe/sim';
import type { MapView } from './map-view';
import { tileAtPixel, tileOrigin } from './iso';

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
  /** Canvas pixel of the middle of tile (col, row) at the current camera. */
  tileScreenPos(col: number, row: number): { x: number; y: number };
  tileAt(canvasX: number, canvasY: number): { col: number; row: number } | null;
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
  const centre = (col: number, row: number) => {
    const o = tileOrigin(col, row, map.width);
    return { x: o.x + 32, y: o.y + 16 };
  };
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
    tileAt: (x, y) => tileAtPixel(x + camera.x, y + camera.y, map.width, map.height),
  };
  window.__map = debug;
  return debug;
}
