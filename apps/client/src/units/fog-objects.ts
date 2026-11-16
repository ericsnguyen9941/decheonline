// Which objects the map view and the minimap show under the fog, and the remembered copies (doppelgangers) of the
// trees, mines and bushes a player last saw. docs/spec/hud.md "Fog of war".
import { ObjectState, TILE_BLACK, TILE_FOGGED, TILE_VISIBLE, type World } from '@aoe/sim';

/**
 * How an object (or the parts of its graphic at one draw level) is drawn: not at all, as it is, with every other pixel
 * black (`fog_next_shape` 1), or clipped to the terrain (`terrain`): plain under the fog overlay, so it shows plain on
 * visible terrain, fogged on fogged terrain and not at all on unexplored terrain.
 */
export type FogDraw = 'hidden' | 'plain' | 'fogged' | 'terrain';

/**
 * The draw levels `RGE_View::draw` draws through the terrain's clip masks (src/view.cpp:2335-2377, levels 0 to 5): each
 * part plain where the terrain is drawn plain, fogged where it is drawn fogged, and nowhere on unexplored terrain.
 */
export const TERRAIN_LAYER = 5;

/**
 * `RGE_Object_List::draw` (src/obj_list.cpp:117) as `view_function_terrain` calls it per tile (src/view.cpp:2170-2185):
 * on a fogged tile by its master's `fog_flag`: 0 not drawn (units, buildings), 1 drawn (mines, bushes, animals,
 * corpses), 2 drawn until it dies (trees), 4 not drawn where a doppelganger stands on the tile (stumps). On an unexplored
 * tile the fog flag is not read, but only draw levels up to 5 are queued (`SetCaptureLevel(0, 5)`), and those are
 * clipped to the terrain, so only their pixels over explored terrain show. Levels above 5 draw plain on a visible tile
 * and fogged on a fogged one.
 */
export function fogDraw(fogFlag: number, state: number, tile: number, layer: number, doppelgangerOnTile: boolean): FogDraw {
  if (tile === TILE_FOGGED && hiddenInFog(fogFlag, state, doppelgangerOnTile)) return 'hidden';
  if (layer <= TERRAIN_LAYER) return 'terrain';
  if (tile === TILE_VISIBLE) return 'plain';
  return tile === TILE_BLACK ? 'hidden' : 'fogged';
}

function hiddenInFog(fogFlag: number, state: number, doppelgangerOnTile: boolean): boolean {
  switch (fogFlag) {
    case 0:
    case 3:
      return true;
    case 2:
      return state > ObjectState.Active;
    case 4:
      return doppelgangerOnTile;
    default:
      return false;
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
  /** The last `update` that found the object. */
  look: number;
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
  private look = 0;

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
    const look = ++this.look;
    for (const e of world.entities.all()) {
      const flag = this.flagOf(e.type);
      if (flag === 0 || !e.sprite) continue;
      const visible = tile(e.x, e.y) === TILE_VISIBLE;
      const now = this.seen.get(e.id);
      if (!now) {
        const copy: Doppelganger = { id: e.id, type: e.type, owner: e.owner, x: e.x, y: e.y, z: e.z, graphic: e.sprite.graphic, frame: e.sprite.frame, facet: e.facet };
        this.seen.set(e.id, { copy, state: e.state, visible, look });
        continue;
      }
      // Updated in place, not copied: thousands of trees are looked at every step.
      const state = now.state;
      const wasVisible = now.visible;
      const c = now.copy;
      c.type = e.type;
      c.owner = e.owner;
      c.x = e.x;
      c.y = e.y;
      c.z = e.z;
      c.graphic = e.sprite.graphic;
      c.frame = e.sprite.frame;
      c.facet = e.facet;
      now.state = e.state;
      now.visible = visible;
      now.look = look;
      if (flag === 2 && e.state >= ObjectState.Dying) {
        if (state < ObjectState.Dying || (wasVisible && !visible)) keep(now);
      }
      if (flag === 1 && state < ObjectState.PendingRemoval && e.state >= ObjectState.PendingRemoval) keep(now);
    }
    for (const [id, s] of this.seen) {
      if (s.look === look) continue;
      this.seen.delete(id);
      // Removed between two looks: as at `remove_visible_resource`, from where it last was.
      if (this.flagOf(s.copy.type) === 1 && s.state < ObjectState.PendingRemoval) keep(s);
    }
    for (const [id, c] of this.copies) if (tile(c.x, c.y) === TILE_VISIBLE) this.copies.delete(id);
  }
}
