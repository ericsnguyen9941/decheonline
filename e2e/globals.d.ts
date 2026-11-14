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
