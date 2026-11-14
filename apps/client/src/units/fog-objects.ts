// Which objects the map view and the minimap show under the fog, and the remembered copies (doppelgangers) of the
// trees, mines and bushes a player last saw. docs/spec/hud.md "Fog of war".
import { ObjectState, TILE_BLACK, TILE_FOGGED, TILE_VISIBLE, type World } from '@aoe/sim';

/** How an object is drawn: not at all, as it is, or with every other pixel black (`fog_next_shape` 1). */
export type FogDraw = 'hidden' | 'plain' | 'fogged';

/** `SetCaptureLevel(0, 5)`: on an unexplored tile only the graphics drawn at `draw_level` 5 or lower are kept. */
const BLACK_TILE_LAYER = 5;

/**
 * `RGE_Object_List::draw` (src/obj_list.cpp:117) as `view_function_terrain` calls it per tile (src/view.cpp:2170-2185):
 * on a visible tile every object draws plain; elsewhere fogged, and on a fogged tile by its master's `fog_flag`: 0 not
 * drawn (units, buildings), 1 drawn (mines, bushes, animals, corpses), 2 drawn until it dies (trees), 4 not drawn where a
 * doppelganger stands on the tile (stumps). On an unexplored tile the fog flag is not read, but only low layers draw.
 */
export function fogDraw(fogFlag: number, state: number, tile: number, layer: number, doppelgangerOnTile: boolean): FogDraw {
  if (tile === TILE_VISIBLE) return 'plain';
  if (tile === TILE_BLACK) return layer <= BLACK_TILE_LAYER ? 'fogged' : 'hidden';
  switch (fogFlag) {
    case 0:
    case 3:
      return 'hidden';
    case 2:
      return state > ObjectState.Active ? 'hidden' : 'fogged';
    case 4:
      return doppelgangerOnTile ? 'hidden' : 'fogged';
    default:
      return 'fogged';
  }
}

/** A remembered copy of an object (`RGE_Doppleganger_Object`): its look when the player last saw it. */
export interface Doppelganger {
  /** The copied object's id (`doppledObjectID`); a player has at most one copy of an object (`validate`). */
  id: number;
  type: number;
  owner: number;
  x: number;
  y: number;
  z: number;
  graphic: number;
  frame: number;
  facet: number | undefined;
}

interface Seen {
  copy: Doppelganger;
  state: number;
  /** A dying tree's tile was visible at the last check (`RGE_Doppleganger_Creator`'s `Last_Map_Value` bit). */
  visible: boolean;
}

/**
 * One player's doppelgangers, kept by the client from the sim's objects and the player's visibility. An object whose
 * master has `create_doppleganger_on_death` leaves a copy for every player with its tile explored but not visible:
 * 2 (trees) when it starts dying (`create_doppleganger_when_dying`, src/stat_obj.cpp:1902) and whenever its tile stops
 * being visible to a player while it is dying (`perform_doppleganger_checks`, src/dpl_obj.cpp:403); 1 (mines, bushes)
 * when it is removed (`remove_visible_resource`, src/stat_obj.cpp:1866). A copy goes once its tile is visible again
 * (`RGE_Doppleganger_Object::update`, src/dpl_obj.cpp:223). The original only makes them for players 1 and up.
 */
export class Doppelgangers {
  readonly copies = new Map<number, Doppelganger>();
  private readonly seen = new Map<number, Seen>();

  constructor(
    private readonly player: number,
    /** `create_doppleganger_on_death` of master `type` (0 none). */
    private readonly flagOf: (type: number) => number,
  ) {}

  /** Is a copy on tile (col, row)? */
  onTile(col: number, row: number): boolean {
    for (const c of this.copies.values()) if (Math.floor(c.x) === col && Math.floor(c.y) === row) return true;
    return false;
  }

  /** Follow the world after a sim step. */
  update(world: World): void {
    if (this.player < 1) return;
    const tile = (x: number, y: number) => world.tileVisibility(this.player, Math.floor(x), Math.floor(y));
    const keep = (s: Seen) => {
      if (tile(s.copy.x, s.copy.y) === TILE_FOGGED) this.copies.set(s.copy.id, { ...s.copy });
    };
    const present = new Set<number>();
    for (const e of world.entities.all()) {
      const flag = this.flagOf(e.type);
      if (flag === 0 || !e.sprite) continue;
      present.add(e.id);
      const at = tile(e.x, e.y);
      const copy: Doppelganger = { id: e.id, type: e.type, owner: e.owner, x: e.x, y: e.y, z: e.z, graphic: e.sprite.graphic, frame: e.sprite.frame, facet: e.facet };
      const before = this.seen.get(e.id);
      const now: Seen = { copy, state: e.state, visible: at === TILE_VISIBLE };
      this.seen.set(e.id, now);
      if (!before) continue;
      if (flag === 2 && e.state >= ObjectState.Dying) {
        if (before.state < ObjectState.Dying || (before.visible && !now.visible)) keep(now);
      }
      if (flag === 1 && before.state < ObjectState.PendingRemoval && e.state >= ObjectState.PendingRemoval) keep(now);
    }
    for (const [id, s] of this.seen) {
      if (present.has(id)) continue;
      this.seen.delete(id);
      // Removed between two looks: as at `remove_visible_resource`, from where it last was.
      if (this.flagOf(s.copy.type) === 1 && s.state < ObjectState.PendingRemoval) keep(s);
    }
    for (const [id, c] of this.copies) if (tile(c.x, c.y) === TILE_VISIBLE) this.copies.delete(id);
  }
}
