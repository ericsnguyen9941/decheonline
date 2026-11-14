// The slice of the client's `window.__assetsDebug` (apps/client/src/assets/debug-view.ts) that tests read.
interface Window {
  __assetsDebug?: {
    source: 'pack' | 'debug';
    terrainFrames: number;
    terrainRects: { x: number; y: number; width: number; height: number }[];
    unitRect: { x: number; y: number; width: number; height: number } | null;
    pixel(x: number, y: number): [number, number, number, number];
  };
}

// The slice of `window.__game` (apps/client/src/multiplayer.ts, `?debug=net`) that tests read.
interface Window {
  __game?: {
    issueTest(x: number, y: number): void;
    turn(): number;
    hash(turn: number): number | undefined;
    applied(): { type: string }[][];
    entityOwners(): number[];
    player(): number;
    units(): { id: number; owner: number; type: number; x: number; y: number; col: number; row: number; facet: number; moving: boolean }[];
    issueMove(units: number[], x: number, y: number): void;
    selection(): number[] | null;
    unitScreenPos(id: number): { x: number; y: number } | null;
    packSprites(): number;
  };
}

// The slice of `window.__map` (apps/client/src/map/debug.ts, `?debug=map` or `?debug=net`) that tests read.
interface Window {
  __map?: {
    source: 'pack' | 'debug';
    width: number;
    height: number;
    mapHash: number;
    camera(): { x: number; y: number };
    centerOnTile(col: number, row: number): void;
    setCamera(x: number, y: number): void;
    drawnTiles(): number;
    tileScreenPos(col: number, row: number): { x: number; y: number };
    tileAt(canvasX: number, canvasY: number): { col: number; row: number } | null;
  };
}
