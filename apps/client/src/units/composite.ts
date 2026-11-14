import { Container, Rectangle, Sprite, Texture, type Renderer } from 'pixi.js';
import type { AssetProvider, GraphicInfo, SpriteFrame } from '../assets';
import { facingFrame } from './facing';

/** `RGE_Sprite::draw` draws a part whose `draw_level` is at most this at the object's shadow point. */
export const GROUND_LAYER = 10;

/**
 * A part whose hotspot is beyond this many pixels draws far off the screen in the original (`shape_draw` puts it at
 * `x - hotspot`): the Barracks' part 14 (Barrack1c, SLP 229) has a 3x3 frame with hotspots near -2^31. Baking it would
 * stretch the texture over the whole map, so it is left out.
 */
const OFF_SCREEN = 1 << 16;

/** Which parts to bake: all of them, the ones drawn at the object (`air`), or the ones drawn on the ground. */
export type PartSet = 'all' | 'air' | 'ground';

/** Does graphic `info`'s draw list have parts that draw on the ground as well as parts that do not? */
export function splitsShadow(provider: AssetProvider, info: GraphicInfo): boolean {
  const layers = info.deltas.map((d) => (d.graphic === -1 ? info : provider.graphicInfo(d.graphic))?.layer ?? info.layer);
  return layers.some((l) => l <= GROUND_LAYER) && layers.some((l) => l > GROUND_LAYER);
}

/**
 * A graphic with a draw list (most buildings: the House is its walls, roof, smoke and fire) drawn as
 * `RGE_Sprite::draw` (src/sprite.cpp:541) does: each part in list order at its offset, shown at the part's angle or at
 * every angle, at the part's facet `part_facets * facet / facets` and the same frame. The parts are baked into one
 * texture per facet and frame so the result hit-tests and sorts like any sprite. The frames come back in facet-major
 * order with no mirroring (`info.mirroringMode` 0). `parts` bakes only the parts drawn at the object (`air`) or at
 * its shadow point (`ground`: `draw_level` 10 or less, sprite.cpp:553), which differ for a missile in flight.
 */
export async function composeGraphic(
  provider: AssetProvider,
  renderer: Renderer,
  graphic: number,
  info: GraphicInfo,
  owner: number,
  parts: PartSet = 'all',
): Promise<SpriteFrame[]> {
  const baked = await Promise.all(
    info.deltas.map(async (delta) => {
      // Graphic -1 is the graphic's own SLP; a part's own draw list is not followed (`do_draw` draws its SLP only).
      const id = delta.graphic === -1 ? graphic : delta.graphic;
      const partInfo = id === graphic ? info : provider.graphicInfo(id);
      const ground = (partInfo?.layer ?? info.layer) <= GROUND_LAYER;
      const wanted = parts === 'all' || (parts === 'ground') === ground;
      return { delta, info: partInfo, frames: partInfo && wanted ? await provider.graphicFrames(id, owner) : [] };
    }),
  );
  const out: SpriteFrame[] = [];
  for (let facet = 0; facet < info.angleCount; facet++) {
    for (let frame = 0; frame < info.frameCount; frame++) {
      const c = new Container();
      for (const { delta, info: part, frames } of baked) {
        if (!part || frames.length === 0 || (delta.angle >= 0 && delta.angle !== facet)) continue;
        const partFacet = Math.trunc((part.angleCount * facet) / info.angleCount);
        const pick = facingFrame(partFacet, frame % Math.max(part.frameCount, 1), part.angleCount, part.frameCount, part.mirroringMode);
        const f = frames[pick.index];
        if (!f || Math.abs(f.hotspotX) > OFF_SCREEN || Math.abs(f.hotspotY) > OFF_SCREEN) continue;
        const s = new Sprite(f.texture);
        s.scale.x = pick.flipped ? -1 : 1;
        s.position.set(pick.flipped ? delta.offsetX + f.hotspotX : delta.offsetX - f.hotspotX, delta.offsetY - f.hotspotY);
        c.addChild(s);
      }
      const b = c.getLocalBounds();
      if (c.children.length === 0 || b.width <= 0 || b.height <= 0) {
        out.push({ texture: Texture.EMPTY, hotspotX: 0, hotspotY: 0 });
      } else {
        const frameRect = new Rectangle(Math.floor(b.x), Math.floor(b.y), Math.ceil(b.width), Math.ceil(b.height));
        out.push({ texture: renderer.generateTexture({ target: c, frame: frameRect }), hotspotX: -frameRect.x, hotspotY: -frameRect.y });
      }
      c.destroy({ children: true });
    }
  }
  return out;
}
