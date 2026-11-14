import { pixelToTileCoords, tileCoordsToPixel } from './iso';

/** Scroll speed of keys and screen edges, in map pixels per second. */
const SCROLL_SPEED = 800;
/** Pointer this close to the canvas edge (CSS pixels) scrolls the map. */
const EDGE = 12;

/** How far inside the map edge (in tiles) the view centre stays, so it is always over a tile. */
const EDGE_INSET = 0.1;

/** Top-left of the viewport in map pixels. Its centre is kept over the map, so the view never leaves it entirely. */
export class Camera {
  x = 0;
  y = 0;

  constructor(
    private readonly mapWidth: number,
    private readonly mapHeight: number,
    readonly viewW: number,
    readonly viewH: number,
  ) {}

  /** Move so the viewport's top-left is `(x, y)`, clamped; returns whether the camera moved. */
  moveTo(x: number, y: number): boolean {
    const t = pixelToTileCoords(x + this.viewW / 2, y + this.viewH / 2, this.mapWidth);
    const c = tileCoordsToPixel(
      Math.min(Math.max(t.col, 0), this.mapWidth - EDGE_INSET),
      Math.min(Math.max(t.row, 0), this.mapHeight - EDGE_INSET),
      this.mapWidth,
    );
    const nx = Math.round(c.x - this.viewW / 2);
    const ny = Math.round(c.y - this.viewH / 2);
    const moved = nx !== this.x || ny !== this.y;
    this.x = nx;
    this.y = ny;
    return moved;
  }

  centerOn(mapX: number, mapY: number): boolean {
    return this.moveTo(mapX - this.viewW / 2, mapY - this.viewH / 2);
  }
}

const KEY_DIRECTIONS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  a: [-1, 0],
  d: [1, 0],
  w: [0, -1],
  s: [0, 1],
};

/**
 * Camera input: arrow / WASD keys, the pointer at a canvas edge, and dragging with the middle button (left selects,
 * right gives orders). `update` applies the held input; it returns whether the camera moved.
 */
export class CameraControls {
  private readonly keys = new Set<string>();
  private pointer: { x: number; y: number } | null = null;
  private drag: { id: number; x: number; y: number } | null = null;
  private readonly cleanup: (() => void)[] = [];

  constructor(
    private readonly camera: Camera,
    private readonly canvas: HTMLElement,
  ) {
    const on = <T extends EventTarget>(target: T, type: string, fn: (e: never) => void) => {
      target.addEventListener(type, fn as EventListener);
      this.cleanup.push(() => target.removeEventListener(type, fn as EventListener));
    };
    on(window, 'keydown', (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (KEY_DIRECTIONS[key]) {
        this.keys.add(key);
        e.preventDefault();
      }
    });
    on(window, 'keyup', (e: KeyboardEvent) => this.keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
    on(window, 'blur', () => this.keys.clear());
    on(canvas, 'pointermove', (e: PointerEvent) => {
      const box = canvas.getBoundingClientRect();
      this.pointer = { x: e.clientX - box.left, y: e.clientY - box.top };
      if (this.drag?.id === e.pointerId) {
        this.camera.moveTo(this.camera.x - (e.clientX - this.drag.x), this.camera.y - (e.clientY - this.drag.y));
        this.drag.x = e.clientX;
        this.drag.y = e.clientY;
      }
    });
    on(canvas, 'pointerleave', () => (this.pointer = null));
    on(canvas, 'pointerdown', (e: PointerEvent) => {
      if (e.button !== 1) return;
      e.preventDefault();
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    });
    const endDrag = (e: PointerEvent) => {
      if (this.drag?.id === e.pointerId) this.drag = null;
    };
    on(canvas, 'pointerup', endDrag);
    on(canvas, 'pointercancel', endDrag);
  }

  /** Apply held keys and edge scrolling for `dtMs`; drags move the camera as they happen. */
  update(dtMs: number): void {
    let dx = 0;
    let dy = 0;
    for (const key of this.keys) {
      dx += KEY_DIRECTIONS[key]![0];
      dy += KEY_DIRECTIONS[key]![1];
    }
    if (this.pointer && !this.drag) {
      const { x, y } = this.pointer;
      if (x < EDGE) dx -= 1;
      if (x >= this.camera.viewW - EDGE) dx += 1;
      if (y < EDGE) dy -= 1;
      if (y >= this.camera.viewH - EDGE) dy += 1;
    }
    dx = Math.sign(dx);
    dy = Math.sign(dy);
    if (dx || dy) {
      const step = (SCROLL_SPEED * dtMs) / 1000;
      this.camera.moveTo(this.camera.x + dx * step, this.camera.y + dy * step);
    }
  }

  destroy(): void {
    for (const fn of this.cleanup) fn();
  }
}
