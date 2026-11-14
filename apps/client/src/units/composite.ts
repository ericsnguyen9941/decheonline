import { Container, Rectangle, Sprite, Texture, type Renderer } from 'pixi.js';
import type { AssetProvider, GraphicInfo, SpriteFrame } from '../assets';
import { facingFrame } from './facing';

/**
 * A graphic with a draw list (most buildings: the House is its walls, roof, smoke and fire) drawn as
 * `RGE_Sprite::draw` (src/sprite.cpp:541) does: each part in list order at its offset, shown at the part's angle or at
 * every angle, at the part's facet `part_facets * facet / facets` and the same frame. The parts are baked into one
 * texture per facet and frame so the result hit-tests and sorts like any sprite. The frames come back in facet-major
 * order with no mirroring (`info.mirroringMode` 0).
 */
export async function composeGraphic(
  provider: AssetProvider,
  renderer: Renderer,
  graphic: number,
  info: GraphicInfo,
  owner: number,
): Promise<SpriteFrame[]> {
  const parts = await Promise.all(
    info.deltas.map(async (delta) => {
      // Graphic -1 is the graphic's own SLP; a part's own draw list is not followed (`do_draw` draws its SLP only).
      const id = delta.graphic === -1 ? graphic : delta.graphic;
      const partInfo = id === graphic ? info : provider.graphicInfo(id);
      return { delta, info: partInfo, frames: partInfo ? await provider.graphicFrames(id, owner) : [] };
    }),
  );
  const out: SpriteFrame[] = [];
  for (let facet = 0; facet < info.angleCount; facet++) {
    for (let frame = 0; frame < info.frameCount; frame++) {
      const c = new Container();
      for (const { delta, info: part, frames } of parts) {
        if (!part || frames.length === 0 || (delta.angle >= 0 && delta.angle !== facet)) continue;
        const partFacet = Math.trunc((part.angleCount * facet) / info.angleCount);
        const pick = facingFrame(partFacet, frame % Math.max(part.frameCount, 1), part.angleCount, part.frameCount, part.mirroringMode);
        const f = frames[pick.index];
        if (!f) continue;
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
