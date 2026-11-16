import { Assets, Container, Rectangle, Sprite, Texture } from 'pixi.js';
import type { AssetProvider } from '../assets/provider';

/** moveto.shp (`RGE_Base_Game::setup_shapes`, src/basegame.cpp:1850; interfac.drs 50405): the red X an order on the ground leaves. */
export const MOVE_TO_SLP = 50405;
/** Its frames: the X shrinks away (frames 0 and 7 are empty 3x3 ones). */
export const MOVE_TO_FRAMES = 8;
/** `add_overlay_sprite` draw interval of the right click's move (src/vw_main.cpp:1281): each frame shows this long, in ms. */
export const MOVE_INTERVAL_MS = 90;
/** The interval of the Attack Ground and Unload clicks (src/tvw_main.cpp:398, 472). */
export const GROUND_INTERVAL_MS = 125;

/** A marker on the map: where it was put (layer coordinates), when it started and how long each frame shows. */
interface Marker {
  x: number;
  y: number;
  start: number;
  interval: number;
  sprite: Sprite;
}

/**
 * The overlay sprites of `RGE_View::draw` (src/view.cpp:2237, display function 2): a marker is put at the clicked pixel
 * when an order on open ground is given, shows frame 0 and moves on one frame per `interval`, and goes after the last
 * (`interval` x 8 ms in all). A new marker does not end an older one; an order on an object (`reset_overlay_sprites`) ends all.
 */
export class MoveMarkers {
  readonly container = new Container();
  private readonly textures: (Texture | null)[] = [];
  private readonly hotspots: { x: number; y: number }[] = [];
  private markers: Marker[] = [];

  constructor(provider: AssetProvider) {
    for (let n = 0; n < MOVE_TO_FRAMES; n++) {
      const frame = provider.interfaceFrame(MOVE_TO_SLP, n);
      if (!frame) continue;
      // The empty frames carry an absurd hotspot (the SLP's "no hotspot" value): nothing to draw.
      if (Math.abs(frame.hotspotX) > 1e6 || Math.abs(frame.hotspotY) > 1e6) continue;
      this.hotspots[n] = { x: frame.hotspotX, y: frame.hotspotY };
      void Assets.load<Texture>(frame.url)
        .then((atlas) => {
          this.textures[n] = new Texture({ source: atlas.source, frame: new Rectangle(frame.x, frame.y, frame.w, frame.h) });
        })
        .catch(() => undefined);
    }
  }

  /** `add_overlay_sprite(shapes[2], 0, x, y, 0, 0x0F, 0, 2, interval)`: a marker at layer point (x, y). */
  add(x: number, y: number, interval: number, now: number): void {
    const sprite = this.container.addChild(new Sprite());
    sprite.visible = false;
    this.markers.push({ x, y, start: now, interval, sprite });
  }

  /** `reset_overlay_sprites`. */
  clear(): void {
    for (const m of this.markers) m.sprite.destroy();
    this.markers = [];
  }

  /** The frame each marker shows at `now`; those past the last frame go. */
  update(now: number): void {
    this.markers = this.markers.filter((m) => {
      if (this.frameOf(m, now) < MOVE_TO_FRAMES) return true;
      m.sprite.destroy();
      return false;
    });
    for (const m of this.markers) {
      const frame = this.frameOf(m, now);
      const texture = this.textures[frame];
      const hotspot = this.hotspots[frame];
      m.sprite.visible = !!texture && !!hotspot;
      if (!texture || !hotspot) continue;
      m.sprite.texture = texture;
      m.sprite.position.set(m.x - hotspot.x, m.y - hotspot.y);
    }
  }

  /** The markers showing, for the tests: layer point, frame and age in ms. */
  list(now: number): { x: number; y: number; frame: number; shown: boolean }[] {
    return this.markers.map((m) => ({ x: m.x, y: m.y, frame: this.frameOf(m, now), shown: m.sprite.visible }));
  }

  private frameOf(m: Marker, now: number): number {
    return Math.floor((now - m.start) / m.interval);
  }
}
