/** The Group button's first id; 1-10 are the digit groups. */
export const FIRST_GROUP = 11;
/** `groups_used` has 127 slots; ids 1-126 are given out. */
const LAST_GROUP = 0x7e;

/**
 * `RGE_Player::group_objects(-1)`'s id allocation (src/player.cpp:1454): the first id from 11 up that `groups_used` does not
 * hold, which then holds it for good. When none is left the set is rebuilt from the groups the objects are still in and
 * the first free id from 1 up is taken; null when all 126 are in use.
 */
export class GroupIds {
  private readonly used = new Set<number>();

  next(inUse: Iterable<number>): number | null {
    const take = (from: number): number | null => {
      for (let i = from; i <= LAST_GROUP; i++) {
        if (!this.used.has(i)) {
          this.used.add(i);
          return i;
        }
      }
      return null;
    };
    const id = take(FIRST_GROUP);
    if (id !== null) return id;
    this.used.clear();
    for (const g of inUse) this.used.add(g);
    return take(1);
  }
}
