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
    shownObjects(): number;
    resources(player?: number): { food: number; wood: number; gold: number; stone: number };
    resourcesAt(turn: number, player: number): { food: number; wood: number; gold: number; stone: number } | undefined;
    objects(): { id: number; owner: number; type: number; x: number; y: number; state: number; heldType: number; heldAmount: number; graphic: number; frame: number }[];
    issueWork(units: number[], target: number, x: number, y: number): void;
    objectScreenPos(id: number): { x: number; y: number } | null;
    population(player?: number): { count: number; headroom: number; limit: number };
    buildings(): {
      id: number;
      owner: number;
      type: number;
      x: number;
      y: number;
      state: number;
      hp: number;
      progress: number;
      graphic: number;
      facet: number;
      queue: { records: { unit: number; count: number }[]; training: { unit: number; progress: number } | null };
      research: { tech: number; progress: number } | null;
    }[];
    queue(id: number): { records: { unit: number; count: number }[]; training: { unit: number; progress: number } | null } | null;
    ghost(): { unit: number; x: number; y: number; fits: boolean } | null;
    net(): { granularity: number; frames: number; frameMs: number; rtt: number[] };
    delayPongs(ms: number): void;
    age(player?: number): number;
    techState(tech: number, player?: number): number;
    tileVisibility(col: number, row: number, player?: number): number;
    minimapPoint(col: number, row: number): { x: number; y: number } | null;
    sounds(): { event: string; sound: number; game: number; wav: number | null; source: number }[];
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

// The slice of `window.__skirmish` (apps/client/src/skirmish.ts, `?debug=combat`) that tests read.
interface Window {
  __skirmish?: {
    turn(): number;
    objects(): { id: number; owner: number; type: number; x: number; y: number; z: number; state: number; graphic: number }[];
    packSprites(): number;
    shownObjects(): number;
    objectScreenPos(id: number): { x: number; y: number } | null;
  };
}
