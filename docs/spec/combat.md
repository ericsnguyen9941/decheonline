# Combat: attacks, damage, projectiles, line of sight

Source: aoe1-decomp @ `6d6d8b1` (July 1998 RoR beta; see `README.md` for the
version caveat and reference format). Status letters: M matching,
D accepted_drift, L accepted_logic, N nonmatching. Numbers marked *dat* were
read from the retail `data2/empires.dat` (RoR 1.0a, `VER 3.7`) with a scratch
parser outside the repo (§9); everything else comes from the decomp.

Depends on `core.md` for the step loop, `world_time_delta_seconds` and the RNG.

## 0. Where the code is

| piece | function | ref | status |
| --- | --- | --- | --- |
| attack order → action | `RGE_Combat_Object::attack(int,int)` | `src/com_obj.cpp:520` | M |
| attack-ground order → action | `RGE_Combat_Object::attack(float,float,float,int)` | `src/com_obj.cpp:569` | M |
| task-driven attack action | `RGE_Action_List` case 7 | `src/act_list.cpp:125-156` | (see file) |
| attack state machine | `RGE_Action_Attack::set_state` | `src/act_atak.cpp:195` | M |
| | `RGE_Action_Attack::update` | `src/act_atak.cpp:263` | **L** |
| range / facing / visibility gate | `RGE_Action_Attack::ready_to_attack` | `src/act_atak.cpp:433` | **L** |
| fire | `RGE_Action_Attack::do_attack` | `src/act_atak.cpp:542` | M |
| launch (melee or missile) | `TRIBE_Combat_Object::attack` | `src/t_c_obj.cpp:300` | M |
| | `RGE_Combat_Object::attack(target, attacker)` | `src/com_obj.cpp:195` | **L** |
| | `RGE_Combat_Object::attack(x, y, z, attacker)` | `src/com_obj.cpp:237` | **L** |
| hit roll + damage call | `TRIBE_Combat_Object::do_attack` | `src/t_c_obj.cpp:308` | M |
| | `RGE_Combat_Object::do_attack` | `src/com_obj.cpp:268` | M |
| splash | `TRIBE_Combat_Object::area_attack` | `src/t_c_obj.cpp:894` | M |
| | `RGE_Combat_Object::area_attack` | `src/com_obj.cpp:117` | M |
| elevation modifier | `TRIBE_Combat_Object::calc_attack_modifier` | `src/t_c_obj.cpp:288` | M |
| | `TRIBE_Combat_Object::higher_than_target` | `src/t_c_obj.cpp:803` | **L** |
| | `TRIBE_Combat_Object::higher_check_for_cliff` | `src/t_c_obj.cpp:762` | M |
| damage (units) | `TRIBE_Combat_Object::damage` | `src/t_c_obj.cpp:212` | M |
| damage (buildings) | `TRIBE_Building_Object::damage` | `src/t_b_obj.cpp:771` | M |
| damage core | `RGE_Combat_Object::damage` | `src/com_obj.cpp:292` | M |
| armour formula | `RGE_Combat_Object::calculateDamage` | `src/com_obj.cpp:305` | M |
| reload timer | `RGE_Combat_Object::update`, `can_attack`, `reset_attack_timer` | `src/com_obj.cpp:425`, `:359`, `:366` | M |
| death trigger | `RGE_Static_Object::update` | `src/stat_obj.cpp:1166` | M |
| missile object | `RGE_Missile_Object::init_missile` | `src/misl_obj.cpp:60`, `:69` | M |
| | `RGE_Missile_Object::missile_move` | `src/misl_obj.cpp:77` | **L** |
| | `RGE_Missile_Object::make_object_collision_list` | `src/misl_obj.cpp:94` | M |
| missile action | `RGE_Action_Missile::intercept` | `src/act_misl.cpp:45` | M |
| | `RGE_Action_Missile::set_state` | `src/act_misl.cpp:57` | **L** |
| | `RGE_Action_Missile::update` | `src/act_misl.cpp:154` | **L** |
| combat data load | `RGE_Master_Combat_Object::setup(int,…)` | `src/m_co_obj.cpp:85` | M |
| | `TRIBE_Master_Combat_Object::setup(int,…)` | `src/tm_co_ob.cpp:49` | M |
| | `RGE_Master_Missile_Object::setup(int,…)` | `src/m_mi_obj.cpp:43` | M |
| LOS map | `RGE_Visible_Map::explore_terrain` / `unexplore_terrain` | `src/visible.cpp:397`, `:500` | **L** |
| | `RGE_Visible_Map::explore_terrain_sq` / `unexplore_terrain_sq` | `src/visible.cpp:591`, `:688` | **L** |
| | `RGE_Visible_Map::get_visible` | `src/visible.cpp:256` | M |
| | `RGE_Static_Object::explore_terrain` / `unexplore_terrain` | `src/stat_obj.cpp:2114`, `:2138` | M |

Note: `src/com_obj.cpp` is `RGE_Combat_Object` (the combat unit base
class), not DirectPlay; `INDEX.md` lists it under Combat.

Status counts that matter: the whole attack state machine
(`RGE_Action_Attack::update`, `ready_to_attack`), both missile-action bodies,
`missile_move`, `higher_than_target`, and all four LOS fill loops are **L**:
logic-equivalent but not byte-proven. The two `RGE_Action_Attack`
field constructors are **N** (`src/act_atak.cpp:44`, `:90`); the only
behaviour they carry is the default range (§3.1).

## 1. Data (per unit type, from `empires.dat`)

Read by `RGE_Master_Combat_Object::setup` (`src/m_co_obj.cpp:85-169`) after
the static/animated/moving/action blocks and the unit's task list.
`TRIBE_Master_Combat_Object::setup` (`src/tm_co_ob.cpp:49-100`) then reads
cost, train time, train location, button and `orig_pierce_armor`. Missiles
read five bytes and a float after the combat block
(`src/m_mi_obj.cpp:43-53`).

| field | type | meaning in combat | ref |
| --- | --- | --- | --- |
| `base_armor` | u8 | armour used when no armour entry matches the weapon class | `src/m_co_obj.cpp:91` |
| `weapon[weapon_num]` | (i16 class, i16 value) | attack entries | `src/m_co_obj.cpp:92-98` |
| `armor[armor_num]` | (i16 class, i16 value) | armour entries | `src/m_co_obj.cpp:100-106` |
| `defense_terrain_bonus` | i16 | row of the world terrain table (−1 = none) | `src/m_co_obj.cpp:108` |
| `weapon_range` | f32 | max range (tiles) | `src/m_co_obj.cpp:109` |
| `area_effect_range` | f32 | blast radius | `src/m_co_obj.cpp:110` |
| `speed_of_attack` | f32 | reload, seconds | `src/m_co_obj.cpp:111` |
| `missile_id` | i16 | missile unit id, −1 = melee | `src/m_co_obj.cpp:112` |
| `base_hit_chance` | i16 | percent | `src/m_co_obj.cpp:113` |
| `fire_missile_at_frame` | i16 | attack frame (0 = half the frames) | `src/m_co_obj.cpp:115` |
| `weapon_offset_x/y/z` | f32 ×3 | missile spawn offset | `src/m_co_obj.cpp:116-118` |
| `area_effect_level` | u8 | blast level; victims need `area_effect_object_level` ≥ it | `src/m_co_obj.cpp:119` |
| `minimum_weapon_range` | f32 | min range | `src/m_co_obj.cpp:120` |
| static: `hp` (i16), `los` (f32), `radius_x/y/z` (f32), `fog_flag`, `movement_type`, `area_effect_object_level` | | | `src/m_s_obj.cpp:164-190` |
| animated: `speed` (f32) | | missile speed (tiles/s) | `src/m_an_obj.cpp` setup |
| missile: `missile_type`, `targetting_type`, `missile_hit_info`, `missile_die_info`, `area_effect_specials` (u8 each), `ballistics_ratio` (f32) | | §5 | `src/m_mi_obj.cpp:47-52` |

Weapon/armour classes used below: **4 = melee**, **3 = pierce**
(`TRIBE_Combat_Object::get_armor` keeps class 4, `get_pierce_armor` class 3:
`src/t_c_obj.cpp:341-361`). Other classes act as bonus channels (§2.2).

*dat* values used by the worked examples (first unit table of
`data2/empires.dat`; the same values were found in a second civ's table):

| unit (id, dat name) | hp | weapons | armours | range | reload | hit % | missile | radius x/y/z | los | speed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Clubman (73, `Soldier-Inf1`) | 40 | (4,3) | (9,−5) (4,0) (3,0) | 0 | 1.5 | 100 | −1 | 0.3/0.3/1.8 | 4 | 1.2 |
| Axeman (74, `Soldier-Inf2`) | 50 | (4,5) | (9,−5) (4,0) (3,0) | 0 | 1.5 | 100 | −1 | 0.3/0.3/1.8 | 4 | 1.2 |
| Hoplite (93, `Soldier-Phal1`) | 120 | (4,17) | (4,5) (3,0) | 0 | 1.5 | 100 | −1 | 0.3/0.3/1.8 | 4 | 0.9 |
| Cavalry (37, `Soldier-Cavalry1`) | 150 | (9,0) (4,8) | (4,0) (8,−8) (3,0) | 0 | 1.5 | 100 | −1 | 0.4/0.4/2.5 | 4 | 2.0 |
| Villager (83, `Man`) | 25 | (4,3) (10,−150) | (12,0) | 0 | 1.5 | 100 | −1 | 0.2/0.2/1.7 | 4 | 1.1 |
| Bowman (4, `Soldier-Archer1`) | 35 | (3,3) | (1,−2) (4,0) | 5 | 1.4 | 100 | 9 | 0.3/0.3/1.8 | 7 | 1.2 |
| Arrow (9, `Missle-Arrow`) | 1 | (3,4) | — | 20 | 0 | 100 | −1 | 0.1/0.1/0 | −1 | 8.0 |

All have `base_armor` 0 and `defense_terrain_bonus` −1. Bowman:
`fire_missile_at_frame` 5, weapon offset (0, 0.5, 1.5), blast level 3,
blast range 0. Arrow: `missile_type` 0, `targetting_type` 0,
`missile_hit_info` 0, `ballistics_ratio` 0.05, `movement_type` 1 (flying).
Spear (100): `targetting_type` 1. Stone Thrower (35): weapons (6,0) (4,50),
range 10, min range 2, blast range 0.5, blast level 2, reload 5, missile 34.

## 2. Damage

### 2.1 Order of operations for one hit on a unit

`target->damage(weapon_num, weapon, modifier, attacking_player, attacker)`
where `weapon` is the **launcher's** weapon list (also for missiles: §5.4).

1. `TRIBE_Combat_Object::damage` (`src/t_c_obj.cpp:212`, M): remember
   `temp_hp = hp`. If `hp < 1.0` do nothing at all (`src/t_c_obj.cpp:217`).
2. `RGE_Combat_Object::damage` (`src/com_obj.cpp:292`, M):
   `hp -= calculateDamage(...)` (`:296`); notify the target's unit AI that
   it was attacked (`:297-299`); if `hp < 1.0` set `hp = 0`
   (`:300-302`).
3. Back in the TRIBE override: if the target is now below 1 hp and the
   killer's object group may not produce food from it, zero the carried
   resource (`src/t_c_obj.cpp:221-223`).
4. **Minimum damage**: if `temp_hp − hp < 1.0`, set `hp = temp_hp − 1.0`
   (`src/t_c_obj.cpp:225-227`). Every hit that reaches this function costs at
   least 1 hp, even a zero-damage hit and even when the roll in step 2 did
   nothing. Note this runs after step 2's clamp, so a unit at 1.5 hp hit for
   0 ends at 0.5 hp, not 0 (and dies next update, §2.4).
5. If the target's owner id > 0 and `hp < 1.0`, the attacking player's
   attribute `0x14` (kills) is incremented (`src/t_c_obj.cpp:229-231`).

Buildings use `TRIBE_Building_Object::damage` (`src/t_b_obj.cpp:771`, M):
skip if `hp ≤ 0`; call step 2; then the minimum loss is **0.1** if the
attacker's group is archer / chariot archer / horse archer / elephant
archer or it is one of the towers (watch, guard, sentry, mirror, Zenobia),
else **1.0** (`src/t_b_obj.cpp:784-793`; constants
`src/game_globals.cpp:317-320`); attribute `0x2B` (razings) on destruction
(`:795-797`).

### 2.2 `calculateDamage` (`src/com_obj.cpp:305`, M)

Inputs: the target's master `armor[]`, `base_armor`,
`defense_terrain_bonus`; the attacker's `weapon[]`; `modifier`.

- `mult = 1.0`; if `defense_terrain_bonus ≥ 0` and the target has a tile,
  `mult = world.terrains[defense_terrain_bonus][tile.terrain_type]`
  (`src/com_obj.cpp:315-320`). That table is loaded with the terrain data
  (not this spec). All *dat* units above use −1, so `mult = 1`.
- `total = 0` (f32). For each weapon entry `(class, value)` in order:
  - `armour = base_armor`; then scan **all** armour entries and, for each
    whose class equals the weapon class, set `armour = entry.value`
    (`src/com_obj.cpp:330-341`). If several entries share a class, the
    **last** one wins; no match means `base_armor`.
  - `d = (f32)value − (f32)armour`; `dmg = d × mult × modifier`
    (`src/com_obj.cpp:344-345`).
  - add `dmg` to `total` only if `dmg > 0` (`src/com_obj.cpp:347-349`).
- return `total` (f32, not rounded).

So weapon classes without a matching armour entry are reduced by
`base_armor` (0 for every unit checked), and negative armour values
(Clubman class 9 = −5, Cavalry class 8 = −8) are bonus damage taken from
attackers that carry that class.

`RGE_Static_Object::calculateDamage` (`src/stat_obj.cpp:2174`, M) is the
non-combat fallback: plain `Σ value × modifier`, no armour.

`RGE_Master_Combat_Object::calc_base_damage_ability`
(`src/m_co_obj.cpp:525`, **D**) is the same armour rule in integer form,
used for AI estimates, not for real damage.

### 2.3 Attack modifier (`TRIBE_Combat_Object::calc_attack_modifier`, `src/t_c_obj.cpp:288`, M)

Computed on the **launcher** at the moment the hit lands.

| attacker | condition | modifier |
| --- | --- | --- |
| has a missile (`missile_id ≥ 0`) | `higher_than_target(target)` | **1.5** (`:291-292`) |
| melee (`missile_id < 0`) | attacker `world_z` < target `world_z` | **0.6666** (`:294-295`) |
| otherwise | | 1.0 |

Melee attackers get no bonus from being higher; ranged attackers get no
penalty for being lower. The base class returns 1.0 (`src/com_obj.cpp:113`).

`higher_than_target` (`src/t_c_obj.cpp:803`, **L**): true at once if the
attacker's `world_z` > the target's. Otherwise walk from attacker to target
in `2 × |(int)major-axis delta|` equal steps (`:819-823`); at each new tile,
look for a cliff object on that tile or, failing that, on the two side
neighbours across the minor axis (`:862-879`). For each cliff whose facing
line (from `TRIBE_Cliff_Higher_Check_Table`, indexed by the cliff's facet)
crosses the attacker→target segment, count +1 if the direction to the
target lies inside the facet's angle window(s), else −1
(`src/t_c_obj.cpp:762-801`). Result: true if the count is ≥ 1
(`:885-891`). This needs `atan2` once (`:776`) — the port must supply a
deterministic version. *The cliff table contents were not transcribed;
unverified.*

### 2.4 Death

Damage never removes a unit by itself. On the target's next
`RGE_Static_Object::update` (`src/stat_obj.cpp:1166`, M), an active or
unbuilt object with `hp < 1.0` becomes *dying*, takes its death sprite and
runs the RNG fence `r = rand(); …sound…; srand(r)`
(`src/stat_obj.cpp:1190-1200`). Attack actions aimed at a target whose
state is ≥ dying drop it (`src/act_atak.cpp:276-280`); missiles drop it as
target too (`src/act_misl.cpp:169-171`).

## 3. Attack action and timing

### 3.1 Creating the action

A player attack command reaches `RGE_Combat_Object::attack(targetID, …)`
(`src/com_obj.cpp:520`, M). Unless already attacking that target, it builds
an `RGE_Action_Attack` with `range = weapon_range`,
`min_range = minimum_weapon_range`, `missile_id`, `fire_missile_at_frame`
from the master, replacing the action list (`:555-565`). A civilian is first
transformed into master `MASTER_OBJECT_MAN` (`:548-552`). Task-driven
attacks (right-click resolved through the task list) use the task's
`work_range` instead (`src/act_list.cpp:137-150`). A range of 0 is replaced
by `weapon_range`, and if that is 0 too by **0.4** (`src/act_atak.cpp:82-87`,
N constructor).

### 3.2 States (`set_state`, `src/act_atak.cpp:195`, M; `update`, `:263`, L)

| state | meaning | entered by / does |
| --- | --- | --- |
| 1 | done | update returns *remove* |
| 2 | target lost | waits for the current sprite to loop, then reports completion |
| 4 | moving into range | pushes `RGE_Action_Move_To(target, range)` (`:204-226`) |
| 6 | in range, waiting | calls `ready_to_attack`; if true: `reset_attack_timer`, → 7 (`:229-245`) |
| 7 | attacking | fight sprite, `need_to_attack = 1` (`:247-250`) |
| 13 | cannot attack | reports failure |
| 14 | target invalid | |

Each update first adds `world_time_delta_seconds` to the action's own
`timer` (`:264`), then drops the target if it vanished, is dying, became an
ally (`isAlly`, attacker owner ≠ 0) or is inside another object
(`:266-300`).

State 7 per update (`src/act_atak.cpp:359-397`):

1. If `need_to_attack == 0` and `can_attack()` (reload timer ≤ 0): if there
   is no target and this is not ground fire → state 2; else
   `reset_attack_timer`, `set_state(6)` (which re-checks range/visibility and
   may switch to 4 or 13 and stop here), then `set_state(7)` — a new swing.
2. If still `need_to_attack == 0`: keep going while the sprite has not
   looped; once it loops go to 6 (or 2 without target).
3. If `need_to_attack == 1`: the attack frame is `fire_missile_at_frame`,
   or `(short)(frame_num × 0.5)` when that is 0 (`:390-393`). When the
   sprite **passes** that frame this update (or loops), call `do_attack`
   (`:394-396`), which launches and clears `need_to_attack`
   (`src/act_atak.cpp:542-551`).

"Passes" is `RGE_Active_Animated_Sprite::frame_passed`
(`src/asprite.cpp:277`, M): the frame changed this update and either the
animation looped or `last_frame < f ≤ frame`. Frame advance timing is
`RGE_Active_Animated_Sprite::update` (`src/asprite.cpp:176`, M), driven by
the sprite's `duration`/`frame_num` from the graphics table and the unit's
speed; that belongs to the sprite/animation spec. `new_sprite` does not
restart an animation that is already showing (`src/stat_obj.cpp:1653-1660`),
so consecutive swings continue the running fight animation.

### 3.3 Reload timer

- `reset_attack_timer`: `attack_timer = speed_of_attack`
  (`src/com_obj.cpp:366-370`, M).
- `can_attack`: `attack_timer ≤ 0` (`src/com_obj.cpp:359-364`, M).
- Every `RGE_Combat_Object::update`, **before** the actions run: if
  `attack_timer > 0`, subtract `world_time_delta_seconds` and clamp at 0
  (`src/com_obj.cpp:428-433`, M). The action update follows in the same call
  (`:435`, through `RGE_Action_Object::update` → `RGE_Animated_Object::update`
  which advances sprites first, `src/ani_obj.cpp:44-71`, then the action list,
  `src/act_obj.cpp:372`).

So the timer is reset when a swing **starts** (state 6→7 or the state-7
restart), not when damage lands, and a swing starts on the first update in
which the decremented timer is ≤ 0. The swing period in steps is the number
of float32 subtractions needed to bring `speed_of_attack` to ≤ 0 (worked
example 2). Damage lands later inside the swing, when the animation crosses
the attack frame.

### 3.4 `ready_to_attack` (`src/act_atak.cpp:433`, L)

In order:

1. `turn_towards(target)` (`src/move_obj.cpp:368`, M) must report facing:
   the angle difference measured in facets (`angle_to_object`,
   `src/move_obj.cpp:340`) is within ±0.5. Otherwise the unit turns one facet
   if `turn_speed` seconds have passed since its last turn (world time ×
   0.001) and returns false (`src/act_atak.cpp:442-444`).
2. Ground target: in range if
   `distance_to_position ≤ √(rx²+ry²) + range + 0.3`, too close if
   `< min_range` (`:446-462`).
3. Unit target owned by a player > 0 and not a building/wall: its tile must
   be **visible** to the attacker (`get_visible` = 0x0F); a fogged tile
   (0x80) only if the target's `fog_flag` is set; else state 13
   (`:465-477`). Visibility uses the mutual-ally masks (§6.3).
4. If the target is within ±0.5 on each axis of the remembered target point,
   skip the range test (`:479-490`).
5. Range: `dist = distance_to_object(target)` (edge to edge, below) against
   `limit = √(rx²+ry²) + range + 0.3` (attacker radii;
   `src/act_atak.cpp:492-496`; `g_attack_radius_distance_adjustment = −0.3`
   is subtracted, `src/game_globals.cpp:186`). `dist < min_range` → too close
   (state 13 for stand-ground/immobile, else just false); `dist ≤ limit` →
   in range and the target point is updated; otherwise too far → state 4
   (move) or 13 if immobile / stand-ground (`:498-536`).
6. Ready = in range **and** `can_attack()` (`:538-539`).

`distance_to_object` (`src/stat_obj.cpp:2299`, M):
`gx = max(0, |dx| − rx_a − rx_t)`, `gy = max(0, |dy| − ry_a − ry_t)`,
`dist = √(gx² + gy²)`. `distance_to_position` (`:2323`, M) is the same with
only the attacker's radii.

## 4. Launch and hit roll

### 4.1 `TRIBE_Combat_Object::attack` (`src/t_c_obj.cpp:300`, M)

If the attacker has a missile and the target's owner id > 0, first create a
`MASTER_OBJECT_FLARE` (id 112) for the **target's** owner at the attacker's
position (`:302-304`; the minimap attack flare), then call the base.

### 4.2 `RGE_Combat_Object::attack(target, attacker)` (`src/com_obj.cpp:195`, L)

- Melee (`missile_id < 0`): `do_attack(target, attacker, own x, y, z)`
  immediately (`:230-232`).
- Missile: `max_range = √(rx²+ry²) + weapon_range + 6`
  (`g_combat_missile_range_adjustment = −6` subtracted;
  `src/com_obj.cpp:209-210`, `src/game_globals.cpp:212`). Spawn the missile
  object for the attacker's owner at
  `x + cos(angle)·off_y − sin(angle)·off_x`,
  `y + sin(angle)·off_y + cos(angle)·off_x`, `z + off_z`
  (`:218-222`), then `init_missile(attacker, target, max_range)` (`:223`).
  If `weapon_range > 1` and the target's owner is a computer player, notify
  it (`:226-229`). `angle` is the attacker's facing; `cos`/`sin` need
  deterministic replacements in the port.
- The ground-target overload (`:237`, L) does the same with a point and does
  nothing for melee units.

### 4.3 `do_attack` (`src/t_c_obj.cpp:308`, M → `src/com_obj.cpp:268`, M)

1. Cheat only (`quick_build` + hunter/lumberjack): kill outright
   (`src/t_c_obj.cpp:313-318`). Not in multiplayer play.
2. **Melee splash**: if `area_effect_range > 0` **and** `weapon_range < 0.99`:
   `area_attack(x, y, z, attacker, ignore = target)`, then a separate roll and
   direct hit on the target (`src/t_c_obj.cpp:323-336`).
3. Otherwise the base: if `area_effect_range > 0`, only `area_attack(…,
   ignore = none)` and return (`src/com_obj.cpp:274-277`) — the target is
   hit only if it is inside the blast. Else one roll and direct hit
   (`:279-288`).

The decomp comments note that both gates test blast **radius** where blast
**level** was intended (`src/t_c_obj.cpp:320-322`); the port must copy the
radius test.

Hit roll (both paths): `r = rand()`; `chance = (r × 100) / 0x7FFF` (C integer
division, 0..100); hit if `chance ≤ base_hit_chance`
(`src/com_obj.cpp:280-282`, `src/t_c_obj.cpp:327-328`). With
`base_hit_chance = 100` (every unit in §1) it always hits, but the draw is
always consumed. On a hit: `modifier = calc_attack_modifier(target)`, then
`target->damage(weapon_num, weapon, modifier, owner, attacker)`.

### 4.4 `area_attack` (`src/t_c_obj.cpp:894`, M)

- `R = area_effect_range`; return at once if `R ≤ 0` (`:906-907`).
- Scan tiles `x ∈ [(short)(x−R) − 2, (short)(x+R) + 2)`, same for y,
  clipped to the map (`:910-928`); objects in each tile's list order.
- Skip: the ignored object; the attacker itself; and own-player objects when
  the attacker is a war elephant, chariot, heavy chariot or armoured elephant
  (`:935-941`). Victims need `area_effect_object_level ≥` the attacker's
  `area_effect_level` (`:942-943`).
- Edge distance: `ex = max(0, |obj.x − x| − obj.rx)`, `ey` likewise; inside
  if `R² > ex² + ey²` (`:944-960`).
- Each victim inside gets its **own** roll (`rand`, same formula with a
  `(short)` cast), and on success
  `damage(…, calc_attack_modifier(victim), …)`; a victim brought below 1 hp
  has its carried resource zeroed (`:961-972`).

The RGE base version (`src/com_obj.cpp:117`, M) is the same without the
own-unit exclusion and the resource zeroing.

## 5. Projectiles

### 5.1 Creation

`init_missile` (`src/misl_obj.cpp:60-75`, M) stores `max_range` and adds an
`RGE_Action_Missile` with `target_obj = target`, `target_obj2 = launcher`
and the target's current position. `add_action` calls
`first_in_stack(1)` immediately (`src/act_list.cpp` `add_action`), which
goes to state 3 (aim) unless there is no target and no valid point
(`src/act_misl.cpp:33-43`). So **aiming happens at launch**, inside the
launcher's update.

### 5.2 Aim (`RGE_Action_Missile::set_state(3)`, `src/act_misl.cpp:61-145`, L)

1. Aim point (`intercept`, `src/act_misl.cpp:45-55`, M): target's `x`, `y`
   and `z + radius_z × 0.5`; for a ground shot the stored point.
2. `d = (dx, dy, dz)` from the missile to the aim point, `D = |d|`.
3. Leading (`targetting_type == 1` and the target is moving,
   `:76-101`): `v = getSpeed()` of the target, capped at 1.0 when the
   launcher is a stone thrower / catapult / heavy catapult; target velocity
   `(cos θ, sin θ)·v` from its facing; `k = D − |(dx + vx, dy + vy, dz)| +
   missile speed`; if `k > missile speed × 0.5`, add the target velocity
   `× D / k` to `dx, dy` and recompute `D`.
4. By `missile_type` (`:103-125`): **0** — unit direction `d / D`, timer 0;
   1, 2 — no direction (go straight to flying); **3** — direction `d`
   unnormalised (instant hit, §5.3).
5. Arc (`ballistics_ratio > 0`, `:128-143`): `T = D / speed` (or 0 if speed
   ≤ 0), `T ← T × 0.5`; `a = 2 × (−D × ratio) / T²`;
   `v0 = −T × a`. Without ratio both are 0. The vertical arc rises by
   `D × ratio` at mid-flight and returns to the straight line at `2T`.
6. State 4 (flying).

### 5.3 Flight per update (`RGE_Action_Missile::update`, `src/act_misl.cpp:154`, L)

With `t = world_time_delta_seconds` and `s = speed × t` (`:158-159`):

1. Drop the target if it vanished or is dying; same for the launcher
   (`:162-174`).
2. Type 0: `timer += s`; step `= direction × s`; if `timer ≥ max_range`
   → state 1 (dies at once via `die_die_die`) — the move and collision of
   this update still run (`:180-187`). Type 3: step = the full stored vector.
3. Arc: `Δ = a × t`; `vz += (v0 + Δ × 0.5) × t`; `v0 += Δ` (`:194-199`).
4. `missile_move` (`src/misl_obj.cpp:77-92`, L): new position = old + step;
   if outside `[0, width) × [0, height)` the missile dies (but still moves,
   clamped). `teleport` returns the ground height under the new position;
   a flying object (`movement_type 1`) is lifted to it if below
   (`src/stat_obj.cpp:1622-1633`). **Hit ground** = returned height ==
   `world_z` after the move (`src/misl_obj.cpp:91`).
5. Collision for types 0–2 (`make_object_collision_list(s)`,
   `src/misl_obj.cpp:94`, M): returns nothing if the missile's `rx` or `ry`
   ≤ 0. Scans tiles `[(int)(x−3), (int)(x+3)]` × same for y, clipped
   (`:114-133`); every other object with `rx, ry > 0` and
   `dz = obj.z − missile.z ∈ [−(obj.rz + 0.1), missile.rz + 0.1]`
   (`:147-149`; `g_missile_vertical_adjustment = −0.1`) and
   `|dx| ≤ obj.rx + missile.rx + s` and `|dy| ≤ obj.ry + missile.ry + s`
   (`:150-161`) is listed, in tile order.
6. For each listed object, by `missile_hit_info` (`src/act_misl.cpp:216-269`):
   - **0**: only the intended target: `source.do_attack(target, …)`, then
     state 1.
   - **1**: any object not owned by the missile's owner and not Gaia.
   - **2**: skip the launcher; enemy → `do_attack`, own/Gaia →
     `area_attack` at the missile.
   `source` = the launcher if it still exists, else the missile itself. The
   loop does **not** stop after a hit (`node = node->next` follows each
   case), so with hit info 1 or 2 several overlapping objects can be hit by
   one missile in one update. *Inferred from control flow; L body.*
7. Type 3: `source.do_attack(target)` at once and state 1 (`:276-285`).
8. If it hit the ground and is not already finished: `source.area_attack`
   at the missile's position, then state 1 (`:289-296`). For a launcher
   without blast radius that does nothing.

### 5.4 Who deals the damage

`do_attack` runs on the **launcher** (`source`), so the launcher's
`weapon[]`, `base_hit_chance`, blast radius and its *current* elevation
modifier apply. The arrow's own `weapon (3,4)` only matters if the launcher
died before impact.

## 6. Line of sight and fog

The port's rules, lifecycle call sites and vectors are in visibility.md;
this section is the first reading.

### 6.1 Per-player visible map

Each player has an `RGE_Visible_Map` with one byte per tile
(`include/visible.h:17-20`):

| byte | meaning |
| --- | --- |
| 0xFF | unexplored |
| 0x00 | explored, no viewer now |
| 1..0xF9 | number of own LOS sources covering the tile |

and a world-wide `unified_map_offsets[y][x]` u32 with bit `p` = visible to
player `p` and bit `p + 16` = explored by `p`
(`src/visible.cpp:225-227`, `RGE_VIS_EXPLORED_SHIFT 0x10`).

### 6.2 Explore / unexplore

`RGE_Static_Object::explore_terrain` (`src/stat_obj.cpp:2114`, M): radius =
`(int)master.los` unless overridden; nothing if ≤ 0. Type 0 → circular fill
around `((long)x, (long)y)`; type 1 (unbuilt buildings,
`src/t_b_obj.cpp:365-370`) → the footprint rectangle
`[(long)(x−rx), (long)(x+rx−0.01)] × […y…]`.

`RGE_Visible_Map::explore_terrain(tx, ty, radius, …)` (`src/visible.cpp:397`,
L):

1. Mix the call into `input_csum` (rotate-xor of a call tag, player id, tx,
   ty, radius, plus Square; `:411-423`) — part of the sync checksum.
2. Clamp radius to 16 (`RGE_LOS_MAX_RADIUS`); pick shape table
   `NormalLOS[radius]` (or `SquareLOS` if Square) (`:431-439`).
3. Each table row is `(dy, x1, x2)`: tiles `ty+dy`, `tx+x1 … tx+x2`,
   clipped to the map; terminated by `dy = 999` (`:443-455`).
4. Per tile: `v = byte + 1` (u8). If that wrapped to 0 (tile was
   unexplored): count it as revealed, add to the player's new-tile list, set
   the explored bit, `v = 1`. If `v == 1`: set the visible bit (and draw
   state). Cap `v` at 0xF9 (`:462-484`).
5. Return the number of newly explored tiles.

`unexplore_terrain` (`src/visible.cpp:500`, L): same shape; `v = byte − 1`,
an underflow (0 → 0xFF) becomes 0; on reaching 0 clear the visible bit
(`:566-578`). Tiles never become unexplored again.

When it happens: whenever an active object changes tile in `teleport`, LOS
is removed at the old position and added at the new one
(`src/stat_obj.cpp:1514-1529`); also on ownership change
(`src/t_c_obj.cpp:264-275`), on creation and on removal. Moving inside a
tile costs nothing.

Shape tables: `NormalLOS[0..16]` and `SquareLOS[0..16]` are static data in
`src/visible.cpp:11-73` (normal) and `:74-135` (square), pointer arrays `:136-143`. They are roughly
discs of radius r but **not** reproducible by a simple rounding rule (row
half-widths for r = 16 are 16,16,16,16,15,15,15,14,14,13,13,12,11,10,8,6,3
for |dy| = 0..16; neither `round(√(r²−dy²))` nor a constant offset matches
every row). The port needs the exact rows. Radius 4 (Clubman), for
example 1 below, is rows |dy| = 0, 1 → ±4; 2, 3 → ±3; 4 → ±1.

### 6.3 Query

`get_visible(x, y)` (`src/visible.cpp:256`, M): `0x0F` (visible) if the
unified cell has any bit of the player's `mutualVisibleMask`, `0x80` (fog)
if any bit of `mutualExploredMask`, else 0. The masks are rebuilt from the
alliance table (`src/world.cpp:3215-3240`), so allied vision is shared at
query time, not by writing to allies' maps.

### 6.4 Related side effects in `RGE_Combat_Object::update`

After the actions, an object with `id ≥ 0` outside any container compares
its tile's unified value with the last one; on change it updates the
visible-unit records (AI use), and if it has `capture_flag` set, the first
other player that sees it — scanning players 1.. — takes ownership if
that player is human (`src/com_obj.cpp:438-479`). Unit AI updates follow on
the owner's turn (`:483-487`).

## 7. RNG calls, in order

All via `debug_rand` → C `rand()` (`core.md` §4). An object's draws happen
inside its own update, in the per-player object order of `core.md` §1.2.

| when | draws | ref |
| --- | --- | --- |
| object created or recycled (missile, flare, any spawn) | `r = rand()`, then `srand(r)` — leaves state = r | `src/stat_obj.cpp:169-179`, `:279-286` |
| melee hit (no blast) | 1 `rand()` | `src/com_obj.cpp:280` |
| melee with blast (range < 0.99, radius > 0) | 1 per victim in the blast scan order, then 1 for the target | `src/t_c_obj.cpp:961`, `:327` |
| ranged launch at a player-owned target | creation fence for the flare, then for the missile | `src/t_c_obj.cpp:303`, `src/com_obj.cpp:218` |
| missile impact, direct | 1 `rand()` (launcher's `do_attack`) | `src/com_obj.cpp:280` |
| missile impact, blast launcher | 1 per victim | `src/t_c_obj.cpp:961` |
| target reaches < 1 hp | on its next update: `r = rand()`, `srand(r)` | `src/stat_obj.cpp:1193-1199` |
| building crossing a damage-sprite threshold with flag 1 | 2 `rand()` (sprite jitter) | `src/stat_obj.cpp:1286`, `:1293` |

Unverified: whether unit-AI reactions to the notifications sent by
`do_attack`/`damage` (`UNIT_AI_NOTIFY_ATTACKED`, 0x200, 0x20F) draw random
numbers; that is the unit-AI spec. Not consumers: the attack state machine,
`calculateDamage`, missile aim and flight, and the LOS code.

## 8. Worked examples (test vectors)

Floats are IEEE f32 with rounding at every store (`core.md` §3; the x87
precision mode is still unverified, so the last digit of non-exact values
may differ). Step size 50 ms: `world_time_delta_seconds = 50 × 0.001f =
0.050000000745` (f32).

### Example 1 — damage table (`calculateDamage` + minimum damage)

Refs: `src/com_obj.cpp:305-357`, `src/t_c_obj.cpp:212-238`,
`src/t_c_obj.cpp:288-298`. Modifier 1.0 unless stated; target at full hp.

| attacker → target | per weapon entry | total | target hp after |
| --- | --- | --- | --- |
| Axeman → Clubman | (4,5) vs armour 0 → 5 | 5 | 40 → 35 |
| Cavalry → Clubman | (9,0) vs −5 → 5; (4,8) vs 0 → 8 | 13 | 40 → 27 |
| Cavalry → Hoplite | (9,0) vs base 0 → 0 (dropped); (4,8) vs 5 → 3 | 3 | 120 → 117 |
| Clubman → Hoplite | (4,3) vs 5 → −2 (dropped) | 0 | 120 → **119** (minimum 1) |
| Villager → Clubman | (4,3) vs 0 → 3; (10,−150) vs base 0 → −150 (dropped) | 3 | 40 → 37 |
| Bowman → Clubman, level ground | (3,3) vs 0 → 3 | 3 | 40 → 37 |
| Bowman → Clubman, Bowman higher | 3 × 1.5 | 4.5 | 40 → 35.5 |
| Axeman → Clubman, Axeman lower | 5 × 0.6666f = 3.3329999447 | 3.333 | 40 → 36.6669998169 |

Kill counts at full hp: Axeman kills a Clubman in 8 hits, Cavalry in 4
(13×3 = 39 leaves 1.0, which is not < 1; the 4th hit kills), Clubman needs
120 hits on a Hoplite.

### Example 2 — reload cadence

Refs: `src/com_obj.cpp:359-370`, `:428-433`; `src/act_atak.cpp:350-388`.
Clubman, `speed_of_attack = 1.5`, 50 ms steps. After `reset_attack_timer`,
the timer is decremented once per step: after 30 steps it is
`3.0547e-07` (f32 rounding of 0.05000000075 thirty times), so it reaches 0
on the **31st** step. The next swing starts in that 31st update; the swing
period is **31 steps = 1.55 s**, not 30. Bowman (`1.4`): **29 steps**
(1.45 s). A port that uses exact decimal arithmetic or doubles gets 30 for
the Clubman and desyncs. 31 steps is the **reload**, not the hit cadence:
damage lands when the fight sprite crosses its attack frame or wraps, so
the Clubman's hits mostly come 30 steps apart (`sprites.md` §8, Example 1;
`src/act_atak.cpp:390-396`).

### Example 3 — in range or not

Refs: `src/act_atak.cpp:492-517`, `src/stat_obj.cpp:2299-2321`.
Bowman (r 0.3/0.3, range 5) attacks a Clubman (r 0.3/0.3) on the same row.
`limit = √0.18 + 5 + 0.3 = 5.7242641449`. Edge distance = center distance
− 0.6.

| center distance | edge distance | in range? |
| --- | --- | --- |
| 6.30 | 5.7000002861 | yes |
| 6.32 | 5.7200002670 | yes |
| 6.33 | 5.7300000191 | no → move (state 4) |

### Example 4 — arrow flight and hit step

Refs: `src/com_obj.cpp:205-223`, `src/act_misl.cpp:45-55`, `:61-145`,
`:154-296`, `src/misl_obj.cpp:77-177`.

Bowman at (10.5, 10.5, z 0) facing angle 0 (east), Clubman standing at
(15.5, 10.5, z 0), flat ground of height 0, 50 ms steps.

- Spawn: (10.5 + 0.5, 10.5, 0 + 1.5) = **(11.0, 10.5, 1.5)**;
  `max_range = √0.18 + 5 + 6 = 11.4242639542`.
- Aim point: (15.5, 10.5, 1.8 × 0.5 = 0.8999999762). `d = (4.5, 0,
  −0.6000000238)`, `D = 4.5398240089`; direction `(0.9912278652, 0,
  −0.1321637183)`.
- Arc (ratio 0.05, speed 8): `T = 0.2837390006`;
  `a = −5.6389851570`; `v0 = 1.6000000238`.
- Per step `s = 8 × 0.05 = 0.4`; the hit box on x is
  `|dx| ≤ 0.3 + 0.1 + 0.4 = 0.8`; z window `obj.z − missile.z ∈ [−1.9, 0.1]`.

| step | x | z | x-overlap |
| --- | --- | --- | --- |
| 1 | 11.39649 | 1.52009 | no |
| 5 | 12.98246 | 1.45945 | no |
| 9 | 14.56842 | 1.17326 | no (0.93158 > 0.8) |
| **10** | **14.96491** | **1.06647** | yes, z ok → hit |

At step 10 (0.5 s of flight; distance flown `timer = 4.0 < 11.42`) the
Bowman's `do_attack` runs: 1 `rand()`, always a hit at 100 %, modifier 1.0
(equal z, no cliffs), damage 3 → Clubman 40 → 37; the arrow goes to state 1
and is removed. "Step 1" is the first update the arrow itself receives;
whether that is the launch step depends on object-list order
(*unverified*).

### Example 5 — LOS fill

Refs: `src/stat_obj.cpp:2114-2136`, `src/visible.cpp:397-497`.
Fresh map (all 0xFF), at least 25 × 25 so nothing is clipped. A Clubman
(`los 4`) created at (10.3, 20.7) → `tx = 10, ty = 20`. Rows dy = −4..4 have
half-widths 1, 3, 3, 4, 4, 4, 3, 3, 1 → 3 + 7 + 7 + 9 + 9 + 9 + 7 + 7 + 3 =
**61 tiles** set to 1, explored and visible bits set, return value 61. A
second Clubman on the same tile: those 61 bytes become 2, return 0. The first
one then steps to (11.1, 20.7): the unexplore at (10, 20) brings the 61 tiles
back to 1 (still visible, the second Clubman covers them); the explore at
(11, 20) raises the overlap to 2 and adds one new tile at the right end of
each row (x = 11 + half-width: x = 15 for |dy| ≤ 1, 14 for |dy| = 2, 3, and
12 for |dy| = 4) → **9** newly explored, return 9. A Bowman (`los 7`) disc
covers **177 tiles**.

### Example 6 — RNG draw order for one kill

Refs: `src/com_obj.cpp:280-282`, `src/stat_obj.cpp:1190-1200`,
`core.md` §4.3. Step starts with `srand(14)`; suppose the only draws before
are none. An Axeman hits a Clubman at 4 hp in its update:
`rand() = 84` → `chance = 84 × 100 / 32767 = 0` ≤ 100 → hit, 5 damage, hp
`4 − 5 = −1 → 0`, minimum-damage rule does not apply. If the Clubman
updates later in the same step it draws `rand() = 27125` and reseeds
`srand(27125)`; the next draw anyone makes in that step is then from state
27125, i.e. `(27125 × 214013 + 2531011) mod 2³² >> 16 & 0x7FFF`, not the
raw stream's 9192. (If the Clubman updated before the Axeman, its death
draw happens one step later.)

### Example 7 — a Clubman kills an enemy Villager

Refs: §2.1, §2.4, §3; `unit-ai.md` §3. Test map, 50 ms steps. Player 1's
Clubman at (10.5, 10.5), player 2's Villager (25 hp, armour 0) at
(13.5, 10.5); player 1 issues `attack {units: [Clubman], target: Villager}`
(do_command_work at the target, `COMMAND_TYPE_IDS` 7). Once the command is
applied the Clubman's AI holds order ATTACK, action ATTACK, target the
Villager. Its weapon (4,3) vs armour 0 deals **3** per hit: the hp goes
25 → 22 → … → 1 in **8** hits, and the **9th** (3 damage on 1 hp) clamps it
to 0 (a loss of 1). Player 1's kills (attribute 20) become **1**. The
Villager switches to its dying sprite (graphic 196, unit 83's dying graphic),
and when it is removed it leaves a Dead_Man (unit 43) owned by player 2 at
its position. With the target gone the attack ends and the Clubman's AI
action returns to −1.

### Example 8 — a Bowman shoots a Villager dead

Refs: §4.2, §5; `unit-ai.md` §4.3. Player 1's Bowman at (10.5, 10.5),
player 2's Villager at (14.5, 10.5), `attack` ordered as in Example 7. Every
launch at a player's object first creates a Flare (unit 112) for the target's
owner, then the Arrow (unit 9): the objects created are exactly
**[112, 9] × 9**. Each arrow hits for (3,3) vs 0 = **3**: eight hits of 3,
the ninth clamped (a loss of 1), hp 0. Hit by a player's unit, the Villager
runs away (east, away from the Bowman), and the Bowman moves after it to keep
it in range: both end east of where they started.

### Example 9 — a building is damaged and destroyed

Refs: §2.1 (buildings), §2.4. Player 1's Clubman at (10.5, 10.5) attacks
player 2's finished House (unit 70, 75 hp; armour (4,0), (6,−140)) at (14, 10).
Every hit takes (4,3) vs 0 = **3** hp (above the building minimum loss), so the House
falls in **25** hits to 0 hp. Player 1's razings (attribute 43) become **1**
and its kills (attribute 20) stay 0. The House dies and, when removed,
leaves its dead unit (`dead_unit_id` 327, the rubble).

## 9. Implications for the port

- Keep `hp` as f32, apply the minimum-damage rule after the clamp exactly as
  in §2.1, and take the **last** matching armour entry.
- Model the reload timer in f32 with clamp at 0 and reset at swing start;
  cadence differences of one step are visible in example 2.
- Missile aim and spawn need deterministic `sqrt`, `sin`, `cos`, `atan2`
  (project rule: no `Math.*` transcendental in `packages/sim`).
- The hit roll consumes a draw even at 100 %; object creation (missiles,
  flares) and death each collapse the RNG state with a reseed.
- LOS tables must be carried exactly (§6.2); how to get them into the repo
  without copying decomp source is an open item.
- *dat* values here were read with a throw-away parser
  (`/tmp/spec-combat-scripts/unit.py`, not committed). Record layout it
  confirmed for `data2/empires.dat` unit records: static block, name,
  `copy_id` (2), animated `speed`, moving block, action block, **task list**
  (`count` i16, then per task a 2-byte type + 57 bytes, `src/task_lst.cpp:42-52`,
  `src/task.cpp:76-135`), then the combat block of §1, then the TRIBE block
  (units) or the missile block (missiles).
