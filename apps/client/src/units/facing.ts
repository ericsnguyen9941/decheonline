/**
 * Which SLP frame shows a unit facing `facet` (0 .. angles - 1, facet 0 centred on sim angle pi/4, i.e. screen east,
 * then clockwise on screen). A mirrored graphic (`mirror` = the sprite's mirror flag, angles/2 + angles/4) stores
 * only the facets from angles/4 to `mirror` (south round to north through west); the others reuse the facet
 * reflected about the north-south axis, drawn flipped (`RGE_Sprite::get_facetindex`, src/sprite.cpp:411).
 */
export function facingFrame(
  facet: number,
  frame: number,
  angles: number,
  framesPerAngle: number,
  mirror: number,
): { index: number; flipped: boolean } {
  if (mirror === 0) return { index: framesPerAngle * facet + frame, flipped: false };
  if (angles === 2) return { index: frame, flipped: facet !== 0 };
  const first = angles >> 2;
  if (facet > mirror || facet < first) {
    const half = angles >> 1;
    const reflected = facet > half ? half - facet + angles : half - facet;
    return { index: (reflected - first) * framesPerAngle + frame, flipped: true };
  }
  return { index: (facet - first) * framesPerAngle + frame, flipped: false };
}
