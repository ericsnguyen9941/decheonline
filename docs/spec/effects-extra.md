# Effects, extra: codes 100/101, attribute 29, cliff higher-check table

Source: aoe1-decomp @ `6d6d8b1` (July 1998 RoR beta; see `README.md`).
Status letters: M matching, D accepted_drift, L accepted_logic,
N nonmatching. Numbers marked *dat* were read from the retail
`data2/empires.dat` with `@aoe/data` `parseDat` in a scratch script outside
the repo. Follows up open points of `techs.md` §4.3 (codes 100/101), §3.2
(attribute 29) and `combat.md` §2.3 (cliff table).

## 1. Effect attribute code 100 (`'d'`): unit cost amounts

Master side only, in `TRIBE_Master_Combat_Object` (so every master of type
70 or 80; lower classes fall through to the RGE defaults, which ignore
100). Each touches only the **flagged** cost slots (`build_inventory[i]`
with `flag ≠ 0`, the slots that are actually paid; dat `costs[i].flag`):

| effect type | operation on each flagged slot | ref | status |
| --- | --- | --- | --- |
| 0 set | `amount = (short)(int)d` | `src/tm_co_ob.cpp:183-189` | M |
| 4 add | `amount += (short)d` | `src/tm_co_ob.cpp:243-254` | M |
| 5 mul | `amount = (short)((float)amount × d)` | `src/tm_co_ob.cpp:256-271` | M |

All three are truncations toward zero into a 16-bit amount. No instance
code handles 100: `RGE_Static_Object::modify` only knows codes 0 and 1
(`src/stat_obj.cpp:1724`, M) and `TRIBE_Combat_Object::modify` only 101
(`src/t_c_obj.cpp:158-176`, M). Existing objects are unaffected; the new
amount is read when training/building is checked and paid
(`TRIBE_Player::check_obj_cost` / `pay_obj_cost`,
`src/tplayer.cpp:1031-1078`, `:1080-1099`, M). Unflagged slots (the
population-headroom slot of units, type 4; the type-30 slot of buildings)
are never touched by 100.

`effect_type 0/4/5` with `a ≥ 0` hits one master id, with `a = −1` every
master whose `object_group` (class) is `b`; for each, the player's existing
objects of that master run `modify` first, then the master
(`RGE_Player::modify_tobj`, `src/player.cpp:1122-1156`, M; same order for
`_delta`/`_percent` at `:1159-1231`).

*dat* rows (all are civ tech-tree bonuses; `effects[civ.techTreeId]`):

| civ (effect) | rows | targets | d |
| --- | --- | --- | --- |
| Shang (89) | set ×1 | class 4 (villagers) | 35 |
| Minoan (86) | mul ×4 | classes 22, 2, 21, 20 (war, trade, fishing, transport boats) | 0.7 |
| Phoenician (88) | mul ×3 | units 46, 25, 345 (elephants) | 0.75 |
| Choson (91) | mul ×2 | units 125, 394 (priests) | 0.68 |
| Yamato (92) | mul ×6 | units 37, 38, 283, 299, 39, 281 (cavalry, scout) | 0.75 |
| Macedonian (206) | mul ×1 | class 13 (siege) | 0.5 |
| Palmyra (207) | mul ×1 | class 4 (villagers) | 1.5 |
| Roman (208) | mul ×23 | towers 79, 199 at 0.5; 21 buildings at 0.85 | |

Totals match `techs.md` §4.3 (set 100:1, mul 100:40; no add rows).

### Precision trap (Minoan)

`(float)amount × d` with `d = 0.7f = 0.699999988…`: in f32 the product
`50 × 0.7f` rounds to exactly `35.0`, in exact (x87 extended) arithmetic it
is `34.9999994` and truncates to **34**. Over the 89 flagged slots the
retail mul rows reach, only Minoan boat costs differ between the two
(f32 / extended): Fishing Boat 13, 14 and Trade Boat 15, 16 … wood
`50 → 35/34`, `100 → 70/69`; Transport 17, 18 `150 → 105/104`; Raft 292
`40 → 28/27`; War boat 360 gold `40 → 28/27`. Which one the retail exe
produces depends on whether the product is stored to f32 before `_ftol`;
**unverified** — check one Minoan Fishing Boat cost in a retail game.

## 2. Effect attribute code 101 (`'e'`): population weight

Only `set` (type 0) does anything special; add/mul with 101 fall through
to `RGE_Master_Combat_Object`, which ignores it (`src/tm_co_ob.cpp:244-246`,
`:257-259`, M).

Per affected master, with `d` the effect amount, instances first (the
`modify_tobj` order above), then the master:

1. **Each existing object** (`TRIBE_Combat_Object::modify`,
   `src/t_c_obj.cpp:158-176`, M; buildings forward to it,
   `src/t_b_obj.cpp:447-452`, M). For each of the master's three held
   slots (still the **old** values):
   - held type 4: owner attr 4 (population headroom) `−= old_held`,
     then `+= d`;
   - held type 11: owner attr 11 (population) `−= old_held`, then `−= d`;
   - held type 19: owner attr 19 (total units owned) `−= old_held`, then
     `−= d`.
   Then `RGE_Static_Object::modify`, which ignores 101.
2. **Master** (`TRIBE_Master_Combat_Object::modify`,
   `src/tm_co_ob.cpp:191-236`, M): every cost slot with `flag == 0`
   (including empty `type −1` slots) gets `amount = (short)(int)(−d)`;
   held slots of type 4 get `d`, of type 11 `−d`, of type 19 `−d`.

So each object's running contribution to attrs 4/11/19 is replaced by the
new held values (attribute ids: `include/player.h:28`, `:33`, `:36`). That
is exact for objects that had given their held amounts to the owner
(`give_attribute_to_owner`, flags 1–2, `src/stat_obj.cpp:445-456`, L);
the instance step does not check the flag (inferred harmless: units hold
4/11 with flag 2 and 19 with flag 1, *dat*).

*dat*: used only by **Logistics** (tech 121; food 180, gold 100; 60 s;
researched at the Government Center, 82), effect 200: `type 1 a=21 +1`
(technology count), `set 101 class 6 d=−0.5`, `set 101 class 39 d=−0.5`.
Class 6 = Soldier-Inf1–6 (clubman, axeman, swordsman lines) plus some heroes and specials, class 39 = Slinger (347).

Effect on training (`check_obj_cost`, `src/tplayer.cpp:1049-1075`, M): the
headroom slot (type 4, flag 0) first fails if population ≥ population
limit (attr 32), then fails if `headroom < amount`. After Logistics the
amount is `(short)(int)0.5 = 0`, so the second test can no longer fail for
these units; the population-limit test still applies.

### Worked example: Logistics with 10 Clubmen

Refs: `src/player.cpp:1122-1136`, `src/t_c_obj.cpp:158-176`,
`src/tm_co_ob.cpp:191-236`. *dat* Clubman (73): costs
`[food 50 flag 1, −1, headroom 1 flag 0]`, held
`[4: −1 (flag 2), 11: +1 (flag 2), 19: +1 (flag 1)]`.

Before: 10 Clubmen + 5 villagers, 2 Houses + Town Center giving headroom
`12` (inferred figure; only the deltas matter). Attrs: headroom
`12 − 15 = −3`, population 15, units 15.

`set 101 class 6 d = −0.5`, per Clubman: headroom `−(−1) + (−0.5) = +0.5`,
population `−1 − (−0.5) = −0.5`, units `−0.5`. After 10 Clubmen: headroom
`2`, population `10`, units `10`. Master 73: held `4: −0.5, 11: 0.5,
19: 0.5`, cost slots 1 and 2 (`flag 0`) → `amount 0`. A new Clubman then
adds `−0.5 / +0.5 / +0.5`; villagers still count 1.

## 3. Player attribute 29 (`PLAYER_ATTRIBUTE_GOLD_REPLACEMENT`)

Readers (all gate "gold may cover a missing flagged resource" on
`attr29 ≥ 1`): `TRIBE_Player_Tech` cost check and research start
(`src/tech.cpp:313`, `:382`, D/L per `techs.md` §3.2), unit cost check
(`src/tplayer.cpp:1036-1042`, M). Define at `include/player.h:46`.

There is **no named writer**: `grep GOLD_REPLACEMENT` finds only the three
readers. Every generic path that can write an attribute id taken from data
or from a command, checked at `6d6d8b1` and against the retail dat:

| writer | ref | can it hit 29 in retail? |
| --- | --- | --- |
| player creation copies the civ's starting attributes | `src/player.cpp:171-174` (ctor at `:110`, L) | no: `civ.resources[29] = 0` for all 17 civs (*dat*) |
| effect type 1 (set/add attribute `a`) | `src/effects.cpp:183-195` → `src/player.cpp:843-859` | no: none of the 101 type-1 rows has `a = 29` (*dat*) |
| give/take held attributes (objects, buildings) | `src/stat_obj.cpp:445-466`, `src/t_b_obj.cpp:193`, `:201`, `:399`, `:441`, `:691` | no: no master holds type 29 (*dat*, all civs) |
| task production / gather / hunt / trade | `src/act_make.cpp:65`, `src/act_gath.cpp:422`, `src/tact_hnt.cpp:458`, `src/tact_trd.cpp:322` | no: no task has 29 in any of its four attribute fields (*dat*) |
| scenario start resources | `src/tscenaro.cpp:557-560` | no: food/stone/gold/wood only |
| `new_game` options | `src/tworld.cpp:857-875` | no: 30, 31, 32, 33, 45 |
| RGE add-attribute command | `src/Command.cpp:468-471` | no issuer: `RGE_Player::command_add_attribute` (`src/player.cpp:1846`) has no callers |
| TRIBE inventory command | `src/tcommand.cpp:416-417` | no issuer: `command_inventory` (`src/tcommand.cpp:794`) has no callers |
| give-attribute / tribute commands | `src/Command.cpp:473-478`, `src/tcommand.cpp:453-480` | issued only with ids 0–3 (diplomacy dialog `src/dlg_dip.cpp:459-480`; AI tribute loop `src/taitacmd.cpp:9412-9445`) |

Conclusion: attribute 29 is 0 for the whole of a retail game, and the gold
substitution branches never run. **Implication for the port:** keep
attribute 29 at 0 and implement the plain "every flagged resource ≥ cost"
check; reject tribute/give commands whose attribute id is not 0–3 (the
original does not validate the id; a hostile peer could otherwise set 29).
This tightens `techs.md` §3.2's "scenario-only (inferred)": scenarios
cannot set it either.

## 4. `TRIBE_Cliff_Higher_Check_Table`

Data: `src/game_globals.cpp:432-449` (25 records of 8 floats); layout
`include/game_globals.h:85-94` (`from_angle1, to_angle1, from_angle2,
to_angle2, line_x1, line_y1, line_x2, line_y2`). Used only by
`TRIBE_Combat_Object::higher_check_for_cliff` (`src/t_c_obj.cpp:762-801`,
M). Index = the cliff object's `facet`; retail cliff units 264–273 use
graphics with 25 angles (*dat*), set by `TRIBE_Map::make_new_cliff`
(`src/tmap.cpp:381`, M; facet at `:396-414`).

| facet | from1 | to1 | from2 | to2 | line x1 | line y1 | line x2 | line y2 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 3.14 | 4.71 | −1 | −1 | 1.5 | −1 | 1 | 1 |
| 1 | 1.58 | 4.7 | −1 | −1 | 1.5 | −1.5 | 1.5 | 1.5 |
| 2 | 1.58 | 4.7 | −1 | −1 | 1.5 | −1.5 | 1.5 | 1.5 |
| 3 | 1.57 | 3.14 | −1 | −1 | 1 | −1.5 | 1.5 | −1 |
| 4 | 0.01 | 3.13 | −1 | −1 | −1.5 | −1.5 | 1.5 | −1.5 |
| 5 | 0.01 | 3.13 | −1 | −1 | −1.5 | −1.5 | 1.5 | −1.5 |
| 6 | 0 | 1.57 | −1 | −1 | −1 | −1 | 1 | −1.5 |
| 7 | 4.72 | 6.28 | 0 | 1.56 | 0.5 | −1.5 | 0.5 | 1.5 |
| 8 | 4.72 | 6.28 | 0 | 1.56 | 0.5 | −1.5 | 0.5 | 1.5 |
| 9 | 4.71 | 6.28 | −1 | −1 | −1 | −1 | 1 | 1 |
| 10 | 3.15 | 6.27 | −1 | −1 | −1.5 | −0.5 | 1.5 | −0.5 |
| 11 | 3.15 | 6.27 | −1 | −1 | −1.5 | −0.5 | 1.5 | −0.5 |
| 12 | 0 | 1.57 | −1 | −1 | 1 | −1.5 | 0 | 1.5 |
| 13 | 4.71 | 6.28 | −1 | −1 | 0 | −1 | 1 | 0 |
| 14 | 3.14 | 4.71 | −1 | −1 | −1.5 | 0 | 1.5 | −1 |
| 15 | 1.57 | 3.14 | −1 | −1 | −1.5 | −1.5 | 1.5 | 1.5 |
| 16 | 0.01 | 3.13 | −1 | −1 | −1.5 | 0 | 1.5 | −1.5 |
| 17 | 0.01 | 3.13 | −1 | −1 | −1.5 | −1.5 | 1.5 | 0 |
| 18 | 1.58 | 4.7 | −1 | −1 | 0 | −1.5 | 1.5 | 1.5 |
| 19 | 1.58 | 4.7 | −1 | −1 | 1.5 | −1.5 | 0 | 1.5 |
| 20 | 3.15 | 6.27 | −1 | −1 | −1.5 | 0 | 1.5 | −1 |
| 21 | 3.15 | 6.27 | −1 | −1 | −1.5 | −1 | 1.5 | 0 |
| 22 | 4.72 | 6.28 | 0 | 1.56 | 0 | −1.5 | 1 | 1.5 |
| 23 | 4.72 | 6.28 | 0 | 1.56 | 1 | −1.5 | 0 | 1.5 |
| 24 | 1.57 | 3.14 | −1 | −1 | −1.5 | −1.5 | 1.5 | 1.5 |

All values are f32 literals (`3.14f` etc.), compare as f32.

### How the table is used

`higher_check_for_cliff(target, tx, ty, …)` (`src/t_c_obj.cpp:762-801`):

1. Tile off the map → 0.
2. Walk the tile's object list; take the **first** object of class 34
   (`OBJECT_GROUP_CLIFF`, `include/m_s_obj.h:51`).
3. On the first such hit in the whole walk, compute
   `angle = atan2(target.y − self.y, target.x − self.x)` and, if negative,
   add 2π (`g_angle_negative_two_pi = −6.2831855f` is subtracted,
   `src/game_globals.cpp:326`). Range `[0, 2π)`.
4. `lines_intersect(...)` is called with the segment and the
   facet's `line_*` offsets, but it **always returns 1**
   (`src/t_c_obj.cpp:758-760`, M). The four `line_*` columns therefore
   have no effect; only the angle windows matter.
5. "Outside window k" = `angle < from_k || angle > to_k`. If (facet ≥ 25
   or outside window 1) **and** outside window 2 → count −1; else +1.
   Return 1 (stop scanning this tile).

Rows with `from2 = to2 = −1` have no second window (angles are ≥ 0). A
facet ≥ 25 would read past the table in step 4 first (no retail cliff has
one).

`higher_than_target` (`src/t_c_obj.cpp:803-892`, L; summarised in
`combat.md` §2.3) probes each new tile on the attacker→target line and, only
if a probe finds no cliff, the next side neighbour; the count is clamped
and the result is `count ≥ 1`.

### Worked example: cliff check

Refs: `src/t_c_obj.cpp:762-801`, `:803-892`; table above. Attacker at
(10.5, 10.5), target at (13.2, 11.0), equal `world_z`.

- `Dx = 2.7`, `Dy = 0.5`; `NumSteps = 2 × (int)2.7 = 4`; steps
  `(0.675, 0.125)`; `Dx > Dy`, so side neighbours are `(0, −1)` then
  `(0, +1)`.
- Points `(11.175, 10.625)`, `(11.85, 10.75)`, `(12.525, 10.875)`,
  `(13.2, 11.0)` → new tiles `(11,10)`, `(12,10)`, `(13,11)` (the second
  point repeats `(11,10)` and is skipped). The attacker's own tile is never
  probed; the target's is.
- `angle = atan2(0.5, 2.7) ≈ 0.1831` rad.
- One cliff on `(12,10)`, nothing else:
  - facet 6 (window `[0, 1.57]`): inside → +1 → **higher** (ranged
    attacker gets the bonus of `combat.md` §2.3);
  - facet 9 (window `[4.71, 6.28]`, no second): outside → −1 → clamp 0 →
    not higher;
  - facet 7 (windows `[4.72, 6.28]`, `[0, 1.56]`): inside window 2 → +1 →
    higher.
- If `(12,10)` had no cliff but `(12,9)` had one, `(12,9)` counts and
  `(12,11)` is not probed.

**Implication for the port:** store the table as data (angle columns are
enough; keep the line columns only for fidelity), use a deterministic
`atan2` evaluated once per call chain, and reproduce "first cliff per
probed tile, side neighbours only on a miss". A short shot with
`|(int)major delta| = 0` gives `NumSteps = 0`, no probe, result false
(the division by zero before the loop yields an unused infinity on x87,
unverified).
