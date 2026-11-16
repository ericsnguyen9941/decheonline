# Sprites: animation timing, the attack frame, damage overlays

Source: aoe1-decomp @ `6d6d8b1` (July 1998 RoR beta; see `README.md` for the
version caveat and reference format). Status letters: M matching,
D accepted_drift, L accepted_logic, N nonmatching. Numbers marked *dat* were
read from the retail `data2/empires.dat` (RoR 1.0a) with `@aoe/data`
`parseDat` in a scratch script outside the repo.

Depends on `core.md` (step loop, `world_time_delta_seconds`, RNG),
`combat.md` §3 (attack state machine, reload timer) and `movement.md`
(object `speed`, random initial facing).

Why the sim cares: sprite animation is **not** presentation-only. The frame
counter of the object's main sprite decides the step on which an attack
deals damage, death animations decide when a body becomes `DEAD`, and making
certain sprites active draws from the game RNG.

## 0. Where the code is

| piece | function | ref | status |
| --- | --- | --- | --- |
| sprite record load (dat) | `RGE_Sprite::RGE_Sprite(int, …)` | `src/sprite.cpp:60-129` | D |
| active sprite factory | `RGE_Sprite::make_active_sprite` | `src/sprite.cpp:905-910` | M |
| static active sprite | `RGE_Active_Sprite` (update/frame_passed/looped are no-ops returning 0) | `src/asprite.cpp:45`, `:65-82` | M |
| animated active sprite: create | `RGE_Active_Animated_Sprite::RGE_Active_Animated_Sprite(RGE_Sprite*)` | `src/asprite.cpp:114-149` | M |
| animated: advance | `RGE_Active_Animated_Sprite::update` | `src/asprite.cpp:176-230` | M |
| animated: queries | `is_animating`, `frame_passed`, `looped` | `src/asprite.cpp:262-271`, `:277-287`, `:289-291` | M |
| per-object sprite list | `RGE_Active_Sprite_List::add_sprite` | `src/asp_list.cpp:130-167` | **L** |
| | `remove_sprite`, `update`, `frame_passed`, `looped`, `is_animating` | `src/asp_list.cpp:169-193`, `:195-207`, `:277-288`, `:290-301`, `:253-264` | M |
| object main sprite swap | `RGE_Static_Object::new_sprite` | `src/stat_obj.cpp:1653-1664` | M |
| sprite advance call site | `RGE_Animated_Object::update` | `src/ani_obj.cpp:44-71` | M |
| damage overlays | `RGE_Static_Object::check_damage_sprites` | `src/stat_obj.cpp:1242-1327` | **L** |
| damage overlay data load | `RGE_Master_Static_Object::setup(int, …)` | `src/m_s_obj.cpp:233-246` | M |
| attack frame test | `RGE_Action_Attack::update` (state 7) | `src/act_atak.cpp:358-397` | **L** |
| attack sprites per state | `RGE_Action_Attack::set_state` | `src/act_atak.cpp:229-256` | M |
| constants | `g_sprite_minimum_animation_interval`, `g_sprite_random_frame_scale` | `src/game_globals.cpp:207-208` | data |
| | `g_damage_health_percent_scale`, `g_damage_sprite_random_scale` | `src/game_globals.cpp:310-311` | data |

`world.cpp`'s per-frame `RGE_Sprite::update` (`src/sprite.cpp:924`, called
from `core.md` §1.2 step 4) only manages shape loading with the wall clock;
it does not touch any active sprite's frame.

## 1. Sprite record fields

Read in this order by `src/sprite.cpp:82-89` (dat names from
`packages/data/src/layout.ts` in brackets):

| decomp field | dat name | type | meaning |
| --- | --- | --- | --- |
| `frame_num` | `frameCount` | i16 | frames per facet |
| `facet_num` | `angleCount` | i16 | facets (directions) |
| `base_speed` | `speedMultiplier` | f32 | 0 = frame rate independent of movement speed |
| `duration` | `frameDuration` | f32 | seconds per frame |
| `pause_between_loops` | `replayDelay` | f32 | extra seconds held on the last frame before looping |
| `flags` | `sequenceType` | u8 | bit flags below |
| `mirror_flag` | `mirroringMode` | u8 | draw only |

`flags` bits:

| bit | meaning | ref |
| --- | --- | --- |
| 1 | animated: `make_active_sprite` builds an `RGE_Active_Animated_Sprite`; without it the active sprite never changes frame and every frame query returns 0 | `src/sprite.cpp:906-909`, `src/asprite.cpp:65-82` |
| 2 | has facings: moving objects pick a random initial facing and turn by facets (`movement.md`) | `src/move_obj.cpp:118`, `:342`, `:408` |
| 4 | random start frame: **one `rand()`** when the animated active sprite is made (§4) | `src/asprite.cpp:128-140` |
| 8 | play once: after the first loop, stop on the last frame | `src/asprite.cpp:226-229` |

Bit 4 matters only together with bit 1 (it is read inside the animated
constructor). *dat* census of all 941 graphics by `sequenceType`:
0:483, 1:15, 2:87, 3:154, 5:16, 6:12, 7:63, 8:2, 9:17, 10:1, 11:88, 13:2,
15:1. So the RNG-drawing kinds are 5, 7, 13 and 15 (82 graphics). Of the
115 units of type 60–79 in civ 1, **75** have a standing graphic with bit 4
(Clubman "Fidget Inf1" is type 7), and so do Watch/Sentry Tower standing
sprites (type 5) and every damage overlay (§6).

Damage overlay records (`damageGraphics`) are read as
`sprite i16, damage_percent (2 bytes into a u8 field), flag u8`
(`src/m_s_obj.cpp:239-241`): the second read writes 2 bytes starting at
`damage_percent`, so `damage_percent` is the **low byte** of the i16 that
`@aoe/data` calls `damagePercent`, and `flag` is the following byte
(`applyMode`). Retail values: raw 281/306/331 → 25/50/75.

## 2. Active sprites and the sprite list

Each object owns an `RGE_Active_Sprite_List`; `object.sprite` points at its
main sprite, overlays live in the same list.

- `add_sprite(sprite, order, x, y)` (`src/asp_list.cpp:130-167`, L): null →
  nothing. If a node for the **same sprite** exists, increment its `count`
  and return (no new active sprite, no RNG). Otherwise insert a new node
  after every node with `order ≤` the new order and call
  `make_active_sprite`. Main sprites use order `0x3C`, damage overlays
  `0x5A` (`src/stat_obj.cpp:1661`, `:1310`).
- `remove_sprite(sprite)` (`:169-193`, M): first node with that sprite; if
  `count > 0` decrement it (`+0xFF` on a byte), else unlink and delete.
- `new_sprite(s)` (`src/stat_obj.cpp:1653-1664`, M): `s = null` → the
  master's standing sprite. Does nothing when `s` is already the main
  sprite, or when the main sprite is the master's (non-null) death sprite.
  Otherwise remove the old main sprite, add `s`, set `facet = 0`. A swap
  always starts a **fresh** active sprite (frame 0 or random, §4); keeping
  the same sprite keeps its running animation.
- Queries by sprite (`frame_passed`, `looped`, `is_animating`) return the
  first node with that sprite, or 0 if none.

## 3. Frame advance

### 3.1 When

`RGE_Animated_Object::update` (`src/ani_obj.cpp:44-71`, M) runs, in order:
`RGE_Static_Object::update` (damage overlays, death trigger;
`src/stat_obj.cpp:1166-1200`), the dying/death-animation state switch, then
`sprite_list->update(world_time_delta_seconds, this->speed)` for **every**
node in list order (`src/asp_list.cpp:195-207`). For combat units this
whole call sits inside `RGE_Action_Object::update` **before** the action
list runs (`src/act_obj.cpp:395`, `:415`), and that sits after the reload
timer decrement (`src/com_obj.cpp:428-435`). Per object per step:

1. reload timer −= dt (`combat.md` §3.3);
2. damage overlays (§6) and hp < 1 → dying;
3. all sprites advance by dt;
4. actions run and read this step's `frame_changed` / `frame_looped`.

A sprite created in step 4 (e.g. by `set_state(7)`) has its first advance
in the **next** step. A death sprite created in step 2 advances in step 3
of the same update.

`speed` is `RGE_Animated_Object::speed`: 0 for buildings and for any
moving object not currently moving; while moving,
`master.speed × base_speed` (or `master.speed` when `base_speed` is 0),
then scaled by slope/terrain (`src/move_obj.cpp:1069-1077`, L;
`:1382-1403`). Attacking, gathering and idle units have `speed = 0`.

### 3.2 `RGE_Active_Animated_Sprite::update(dt, speed)` (`src/asprite.cpp:176-230`, M)

State: `frame`, `last_frame` (i16), `animate_interval`, `animate_last`
(f32), `frame_changed`, `frame_looped`, `animate_flag` (u8; 0 stopped,
1 running, 2 holding the loop pause). All float arithmetic is f32.

1. Clear `frame_changed` and `frame_looped`.
2. If `animate_flag ≠ 0`: clamp `frame` to `frame_num − 1`; if
   `flags & 1`:
   1. `animate_last += dt`.
   2. If `animate_last ≥ animate_interval`:
      - `frame_changed = 1`, `last_frame = frame`;
      - `count = (short)(animate_last / animate_interval)`,
        `animate_last −= count × animate_interval`;
      - if `speed > 0` **or** `base_speed == 0`: `frame += (u8)count`;
        `frame_looped = 1` if `frame ≥ frame_num`;
      - `animate_interval = duration` if `base_speed == 0` or
        `speed == 0`, else `duration × base_speed / speed`; if below
        `0.001` (a double constant) use `0.001f`;
      - if looped: when `pause_between_loops ≤ 0` or `animate_flag == 2`,
        set `animate_flag = 1` and subtract `frame_num` until
        `frame < frame_num`; otherwise **hold**: `animate_interval =
        pause − (frame − frame_num) × duration`, `frame = frame_num − 1`,
        `animate_flag = 2`, `frame_looped = 0`.
3. If `frame_looped` and `flags & 8`: `animate_flag = 0`,
   `frame = frame_num − 1` (stopped for good).

Consequences:

- Excess time carries over (`animate_last` keeps the remainder), and one
  step can skip several frames (`count > 1`).
- A sprite with `base_speed ≠ 0` (*dat*: 86 graphics, e.g. walk sprites) on
  an object with `speed = 0` sets `frame_changed` but does not move.
- A pause loop reports `frame_looped` once, on the step the pause ends,
  not when the last frame is reached; the hold is `pause` seconds measured
  from the step that overflowed.
- `is_animating` = `animate_flag ≠ 0` and `flags & 1`
  (`src/asprite.cpp:262-271`).

### 3.3 `frame_passed(f)` and `looped()` (`src/asprite.cpp:277-291`, M)

`frame_passed(f)` is true iff `frame_changed` **and**
(`frame_looped` **or** `last_frame < f ≤ frame`). Note the loop case: on a
step that wraps, **every** `f` counts as passed. `looped()` returns
`frame_looped`. Both describe the most recent `update` only.

## 4. Random start frame (flag 4)

`RGE_Active_Animated_Sprite(sprite)` (`src/asprite.cpp:114-149`, M):
`animate_interval = duration` (or `0.001f` if below the minimum). If
`flags & 4`:

1. `tot = frame_num × duration + pause_between_loops`.
2. `r = rand()` (`debug_rand`, the game RNG, `core.md` §4).
3. `t = r × tot × 3.051851e-05f` (≈ 1/32767,
   `src/game_globals.cpp:208`), evaluated left to right in f32.
4. `frame = (short)(t / duration)`; if `frame ≥ frame_num`:
   `frame = frame_num − 1` and `animate_interval = t − frame × duration`
   (time *already spent* in the pause, used as the remaining wait; the
   flag stays 1, so the next overflow starts a full pause as well).
5. `last_frame = frame`.

Otherwise `frame = last_frame = 0`. Always `animate_last = 0`,
`frame_changed = frame_looped = 0`, `animate_flag = 1`.

So every `new_sprite` / `add_sprite` that creates an active sprite of a
type-5/7/13/15 graphic draws exactly one `rand()` at that point, in the
middle of whatever update caused it. Known sites:

- object creation: `RGE_Static_Object::setup` calls
  `new_sprite(master.sprite)` (`src/stat_obj.cpp:268-269`) **before** the
  creation fence `rand()`/`srand()` (`:279-286`), so a unit with a
  flag-4 standing sprite consumes one extra draw from the live stream;
- attack state changes to the wait sprite (§5.3);
- any task/state change that shows the standing sprite again (idle after
  moving, gathering, …; *not traced per action*, see §9);
- damage overlays (§6).

## 5. When an attack's damage lands

### 5.1 Sprites of the attack action

`RGE_Action_Attack` sprites default to the master's `fight_sprite`
(`combat.attackGraphic`) and, for `wait_sprite`, the master's standing
sprite (`src/act_atak.cpp:76-81`, N constructor). `set_state`
(`src/act_atak.cpp:229-256`, M):

- state 6: if `ready_to_attack` → reset reload, `set_state(7)`. Else
  `new_sprite(fight)` for melee (`missile_id == −1`), `new_sprite(wait)`
  for missile users.
- state 7: `new_sprite(fight)`, `need_to_attack = 1`.
- states 1, 13, 14: `new_sprite(wait)`.

`ready_to_attack` ends with `return can_attack()` when facing and range are
fine (`src/act_atak.cpp:537-540`, L): it is false while the reload timer
runs.

### 5.2 State 7, per update (`src/act_atak.cpp:358-397`, L)

1. `need_to_attack == 0` and reload done: reset reload, `set_state(6)`
   (re-checks facing/range; melee keeps the fight sprite, missile users
   switch to the wait sprite), then `set_state(7)` (`new_sprite(fight)`;
   for missile users this is a fresh fight sprite at frame 0 / random).
2. Still `need_to_attack == 0`: if the main sprite is animated and has not
   `looped()` this step → stop for this update. If it looped (or is not
   animated) → `set_state(6)` (to 2 if no target) and stop.
3. `need_to_attack == 1`: attack frame `af = fire_missile_at_frame`
   (`combat.frameDelay`), or `(short)(frame_num × 0.5f)` when that is 0.
   If `frame_passed(af)` on the main sprite → `do_attack()`: melee damage
   (or missile launch) happens **now**, and `need_to_attack = 0`.

State 6 update (`:350-357`): when `ready_to_attack` → reset reload and
`set_state(7)`; no frame test in that update.

### 5.3 What this means

- **Damage step = first step after the swing starts on which the fight
  sprite crosses `af` or wraps.** Because the sprite advances before the
  action, a swing that starts in the same update in which the frame reaches
  `af` misses that crossing; the hit then waits for the wrap.
- **Melee** (`missile_id = −1`): the fight sprite is never swapped between
  swings, so the animation runs continuously; the reload only gates when
  `need_to_attack` is re-armed. Hits follow the animation period while the
  swing start comes before `af` in the cycle; when it drifts past, the hit
  moves to the wrap step (example 1).
- **Missile users**: each swing goes 7 → 6 (wait sprite) → 7 (fresh fight
  sprite), so the launch is `af` frames after the swing start and the cycle
  is reload-bound (examples 3–4). If the wait sprite has flag 4 that is
  **one `rand()` per swing** (Bowman, towers); a flag-4 fight sprite (Sentry
  Tower, type 5) adds another.
- A wrap in the very first advance (tiny `duration`, e.g. towers'
  `0.001`) fires on the first update after the swing start.
- Play-once fight sprites (flag 8, e.g. Catapult type 11) report `looped`
  only on the overflow step; afterwards the action waits for the reload.
- A non-animated fight sprite never passes a frame: the unit never deals
  damage. *dat*: Hero_Demon (229, graphic 815, type 0) is the only such
  attacker in civ 1 (scenario-only).
- `do_attack` itself and its RNG are `combat.md` §4–§5.

## 6. Damage overlays: `check_damage_sprites` (`src/stat_obj.cpp:1242-1327`, L)

Called from `RGE_Static_Object::update` for **active** objects not inside
another object, before the hp < 1 death test (`src/stat_obj.cpp:1185-1188`),
and twice from an upgrade's `copy_obj` (`src/stat_obj.cpp:1817`, `:1834`;
`techs.md` §4.5). Damage itself does not call it: overlays change on the
target's next own update.

1. Return if the master's `hp ≤ 0` or it has no overlays.
2. `pct = (long)(hp × 100.0f / master_hp)` (truncation toward 0, f32),
   `new = (u8)(100 − pct)`. Return if `new == curr_damage_percent`
   (initially 0; saved with the object).
3. If `new < 100`, scan all overlays in order: `want` = last index with
   `damage_percent < new`; `had` = last index with
   `damage_percent < curr_damage_percent`. (Decomp names are swapped:
   `curr_damage_loc` is `want`, `new_damage_loc` is `had`.) If
   `new ≥ 100` both stay −1.
4. If `want == had`: store `curr_damage_percent = new`, return.
5. If `want ≥ 0`, by the overlay's `flag`:
   - 0: `add_sprite(overlay, 0x5A, 0, 0)`;
   - 1: `rx = rand() × radius_x × 6.103702e-05f − radius_x` plus the
     fractional part of `world_x`; then `ry` the same with `rand()`,
     `radius_y`, `world_y` (`:1286-1298`); map them to a screen offset
     (`get_point`) and `add_sprite(overlay, 0x5A, x, y)`;
   - 2: `new_sprite(overlay)` (replaces the main sprite) and skip the add;
   - other: skip.
6. If `had ≥ 0`: flag < 2 → `remove_sprite(had overlay)`; flag 2 and the
   `want` overlay is not also flag 2 → `new_sprite(master.sprite)`.
7. `curr_damage_percent = new`.

RNG per overlay change: flag 1 draws **x then y**, then `add_sprite`
draws a **third** `rand()` for the start frame when the overlay sprite is
animated with flag 4 and not already in the list (every retail overlay is:
"Damage … A/B/C" are type 5, ship "Flame" overlays type 7). Flag 0 draws
only the start-frame `rand()`; flag 2 draws one only if the replacement
sprite has flags 1+4 (retail wall overlays are type 2: none). Draws happen
even for objects nobody can see.

*dat* (civ 1): 48 masters have overlays: `25/50/75` flag 1 (30: buildings
and Hero_Tower 236), `50/75` and `50/65/80` flag 1 (15: every boat, ids
13–21, 250, 277, 292, 360, and heroes 297, 377), walls flag 2 (`50` for
Wall_Small, `35/70` for the two larger walls). So **units have overlays
too**. Across all civs every flag-1 overlay graphic is type 5 or 7 and
every flag-2 one is type 2.

Thresholds are strict: an overlay at 50 shows only when damage is ≥ 51 %
of max hp (example 6). Healing or repair runs the same logic backwards
and only removes (no draw when `want = −1`).

The dat's entry is `graphic` (i16), two bytes and one byte; the game reads
the two into `damage_percent` and `flag` and the third over `flag`
(`src/m_s_obj.cpp:239-241`), so the percent is the low byte of the dat
reader's `damagePercent` (281 = 0x119 reads 25) and the flag its
`applyMode`.

Drawing. The list draws in order, so an overlay (0x5A) comes over the main
sprite (0x3C), and stays through the death animation: at 100 % damage
step 3 leaves both indexes at −1, nothing is removed, and `new_sprite`
swaps only the main sprite (`RGE_Static_Object::draw`, `src/stat_obj.cpp:495`).
An animated active sprite draws at the object's point and **ignores its
offset** (`RGE_Active_Animated_Sprite::draw`, `src/asprite.cpp:232-242`;
only the still `RGE_Active_Sprite::draw`, `:48-53`, adds it), so flag 1's
random point is drawn for its RNG only: every flag-0/1 overlay in the dat is
animated. The "Damage 1x1/5x5" graphics (805-807, 811-813) are draw lists of
the flame graphics 324-329 and 131-133 at their own offsets; the overlays
carry sound 72 (fire), played on their frame changes like any sprite's.

Port: `packages/sim/src/damage.ts` `checkDamageSprites`, called by
`objects.ts` `staticUpdate` and `techs.ts` `copyObject`; the masters'
`damageSprites` come from the dat (`sim-tables.ts`, `unit-data.ts`
`damage`). An object's overlays are `Entity.overlays` (graphic, `count`,
the start frame from the add's `rand()`) and `Entity.damagePercent`, both
hashed and in the snapshot; an overlay's own frame advance is not kept in the
sim (nothing reads it). The client draws them in `units/unit-layer.ts` over
the object's sprite from the start frame by wall-clock time. Not ported: the
fire sound 72 of the overlays. Tests `damage.test.ts`, real art
`e2e/real/real-burning.spec.ts`.

## 7. Death animation length

`RGE_Static_Object::update` sets `DYING` and `new_sprite(death_sprite)` in
the update where hp < 1 (`src/stat_obj.cpp:1189-1192`);
`RGE_Animated_Object::update` then moves `DYING` → `DEATH_ANIMATION` (or
`DEAD` if no death sprite) and, in later updates, `DEATH_ANIMATION` →
`DEAD` once `is_animating` is false — checked **before** that update's
sprite advance (`src/ani_obj.cpp:47-69`). Death sprites are typically type
11 (1+2+8: play once) with a pause, so the corpse state follows
`frame_num × duration + pause` (example 7).

## 8. Worked examples

All use f32 arithmetic (`Math.fround` at every step), constant `dt`, a
target that stays in range, facing and alive, and "step 0" = the update in
which the unit enters state 6 with its reload at 0. Step lengths: 50 ms
(as `combat.md` example 2) and 100 ms (`core.md`: `world_time_delta` is
whatever the network cycle and game speed give; both are plausible).
Computed with a scratch replica of §3.2 and §5.2.

### Example 1 — Clubman, 50 ms: hits follow the animation, not the reload

Refs: `src/asprite.cpp:176-230`, `:277-287`; `src/act_atak.cpp:229-256`,
`:349-397`; `src/com_obj.cpp:359-370`, `:428-433`.
*dat*: Clubman (73) reload 1.5, `frameDelay` 0; fight "Battle Inf1"
(g30) 15 frames × 0.1 s, pause 0, type 3. `af = (short)(15 × 0.5) = 7`.
`dt = 0.05f`: a frame advances every 2nd step (0.05f + 0.05f = 0.1f exactly).

- Step 0: ready → reload 1.5, state 7, fight sprite created at frame 0.
- Frame 7 is reached in step 14 → `frame_passed(7)` → **hit at step 14**.
- Step 30: sprite wraps (`looped`); reload still 3.05e-7 > 0 → state 6,
  sprite kept. Step 31: reload 0 → state 7, re-armed. Frame 7 again in
  step 44 → hit.
- Hits: 14, 44, 74, …, 404 (every **30** steps); the swing restart is
  31 steps after the previous one, so it drifts one step later each cycle.
  At step 434 the restart lands on the step the frame becomes 7 (sprite
  advanced first, state 6 does not test frames), the crossing is missed and
  the hit waits for the wrap at **450** (gap 46). Next gaps are 30 again,
  hitting on wrap steps, until another drift gives a 44 gap (930 → 974).
- No RNG: the fight sprite is type 3 and never swapped.

`combat.md` example 2's "swing period 31 steps" holds for the reload, but
not for the Clubman's damage cadence.

### Example 2 — Clubman, 100 ms: steady state hits on the wrap

Same unit, `dt = 0.1f`: one frame per step. Hits at steps **7, 15, 30,
45, …**. In step 15 the sprite wraps and the reload (1.5 − 15 × 0.1f)
reaches 0 in the same update: rule 5.2.1 re-arms, then 5.2.3 sees
`frame_passed(7)` true because of the wrap → hit at frame 0. From then on
every hit is on the wrap step, 15 steps apart.

### Example 3 — Bowman: launch 5 frames after each swing start, 1 draw per swing

*dat*: Bowman (4) reload 1.4, `frameDelay` 5; fight "Battle Arch1"
(g15) 10 × 0.07 s, type 3; standing "Fidget Arch1" (g281) 5 × 1 s, pause 3,
**type 7**. `af = 5`, missile user.

- 50 ms: frames 0,0,1,2,2,3,4,5 at steps 0–7 → **launch at step 7**. The
  fight sprite wraps at step 14 → state 6, `new_sprite(wait)` →
  **1 `rand()`** (start frame). Reload ready at step 29 → state 7, fresh
  fight sprite. Launches 7, 36, 65, 94: every **29** steps.
- 100 ms: frames per step 0,1,2,4,5 → launch at step **4**; wait sprite
  (1 draw) at step 7; launches 4, 18, 32, …: every **14** steps.

### Example 4 — Watch Tower and Sentry Tower

*dat*: Watch Tower (79) and Sentry Tower (199): reload 1.5, `frameDelay` 0,
fight 10 frames × **0.001** s (g "EWatch T Battle" type 1, "Sentry Twr
Batt" **type 5**); standing "… Fire" 10 × 0.05 s, **type 5**; missile 9.
`af = 5`.

- First advance: `count = (short)(0.05f / 0.001f)` ≈ 50 → wraps →
  `frame_passed` true → **launch at step 1**. Step 2 wraps again → state 6
  → wait sprite → 1 draw. Reload ready at step 31 → fight sprite (Sentry:
  1 more draw). Launches 1, 32, 63 (every **31** steps at 50 ms); 1, 16,
  31, … (every 15) at 100 ms.
- RNG per shot: Watch Tower 1, Sentry Tower 2.

### Example 5 — random start frame

Ref: `src/asprite.cpp:128-140`; scale `src/game_globals.cpp:208`.
"Fidget Inf1" (g304): 6 frames × 1 s, pause 1 → `tot = 7`.

| `rand()` | `t` (f32) | start `frame` | `animate_interval` |
| --- | --- | --- | --- |
| 0 | 0 | 0 | 1 |
| 16384 | 3.5001068 | 3 | 1 |
| 30000 | 6.4088869 | 5 (clamped from 6) | 1.4088869 |
| 32767 | 7 | 5 (clamped) | 2 |

"Damage 1x1 A" (g805): 20 × 0.05 s, pause 0 → `tot = 1`; `rand() = 12345`
→ `t = 0.37675101` → frame 7. `rand() = 32767` → `t = 1`, `t / 0.05f`
rounds to 20 → clamped to 19, interval `1 − 19 × 0.05f = 0.05000001`.

### Example 6 — House damage overlays

*dat*: House (70) hp 75, radius 1 × 1, overlays g805/806/807 at 25/50/75,
flag 1, all type 5. Refs: `src/stat_obj.cpp:1242-1327`, `:1185-1188`.

| hp after hits | `hp × 100 / 75` | `pct` | `new` | `want` / `had` | action | `rand()` |
| --- | --- | --- | --- | --- | --- | --- |
| 75 | 100 | 100 | 0 | — | equal to curr 0, return | 0 |
| 57 | 76 | 76 | 24 | −1 / −1 | store 24 | 0 |
| 56 | 74.666664 | 74 | 26 | 0 / −1 | add g805 at random offset | 3 |
| 38 | 50.666668 | 50 | 50 | 0 / 0 | store 50 (50 is not < 50) | 0 |
| 37 | 49.333332 | 49 | 51 | 1 / 0 | add g806, remove g805 | 3 |
| 75 (repaired) | 100 | 100 | 0 | −1 / 1 | remove g806 | 0 |

Offsets for `rand() = 0 / 16384 / 32767` with radius 1: `−1 / 0.0000305 /
+1` tiles plus the fractional position. The three draws per add come in the
House's own update, after its owner's earlier objects and before its later
ones.

### Example 7 — Clubman death animation

*dat*: "Death Axeman" (g171) 10 × 0.1 s, pause 3, type 11 (1+2+8).
Refs: `src/stat_obj.cpp:1189-1192`, `src/ani_obj.cpp:47-69`,
`src/asprite.cpp:208-229`. Update 0 = the update where hp < 1.

- 50 ms: the sprite holds frame 9 from update 19 (pause starts), wraps and
  stops (flag 8) in update 80; update 81 sees `is_animating = 0` →
  `DEAD`.
- 100 ms: pause from update 9, stops in update 40, `DEAD` in update 41.

## 9. Implications for the port

- Keep, per object, a sprite list with the fields of §3.2 and advance it
  inside the object update at the point of §3.1; the attack action must
  read `frame_passed`/`looped` from that state. Render code may read the
  same frames but must not drive them.
- Every graphic's `frameCount`, `frameDuration`, `replayDelay`,
  `speedMultiplier` and `sequenceType` is sim data, as are each unit's
  `frameDelay`, `attackGraphic` and `damageGraphics`.
- Any place that swaps to or adds a flag-1+4 sprite must draw `rand()`
  at the same point as the original, including objects off screen.
  Tracing every `new_sprite` call per action/task (gather, build, idle,
  move) for its sprite type is follow-up work; the attack, creation,
  overlay and death sites are covered here.
- The x87 precision of the f32 steps above is assumed, as in `combat.md`
  (unverified on retail).

## 10. Points that disagreed with other specs (since corrected there)

- `techs.md` §5 item 2 says a flag-1 overlay draws **two** `rand()`; with
  the start-frame draw of §4 it is **three** for every retail overlay.
- `techs.md` §5 item 2 infers units have no damage sprites; boats and
  three heroes do (§6).
- `combat.md` §3.3 / example 2: the 31-step swing period is the reload
  cadence; actual melee hits follow §5.3 (examples 1–2).

## 11. Which facet a still object draws (read for the client, `apps/client/src/units/unit-layer.ts`)

- A moving object draws its heading (`facet`, movement.md). A building draws `building_facet` (dat
  `building.graphicsAngle`, 0 for the Town Center; `src/t_b_obj.cpp:156,256`), and while unbuilt a facet that
  grows with build points (`t_b_obj.cpp:336-342`). Every other still object starts at facet 0
  (`src/stat_obj.cpp:141,246`) and only gets another from scenario or map data (`make_scenario_obj`,
  `src/tplayer.cpp:311`): the mines' pile variants, for one. The sim keeps no facet for still objects, so the client
  draws mines with `id % angles` until the map generator places them with a facet.
- Play-once sprites (death animations, `flags & 8`) hold the last frame once the sim's `animate_flag` is 0; the client
  animates by wall clock between turns and only trusts the sim for that stop and for the start frame (§4).
