# Simulation subsystem index

Map from each simulation subsystem to the files and entry functions in
aoe1-decomp @ `6d6d8b1` (paths relative to the clone root; see `README.md`).

**Status.** The decomp records a status per function in
`config/functions/src/<file>.json`. Per-file counts below are
`M/D/L/N` = matching / accepted_drift / accepted_logic / nonmatching.
After a function, `[M]` etc. is that function's own status. `L` and `N`
bodies are not byte-proven: read them with extra care and prefer golden
recordings to settle doubts. Totals over the whole decomp (clone
`README.md`): 5,013 M, 140 D, 217 L, 56 N of 5,426 functions.

**Naming.** `RGE_*` classes are the generic engine ("Genie"); `TRIBE_*`
classes are the AoE-specific subclasses that override them. A behaviour spec
usually needs both: the `TRIBE_` override, then the `RGE_` base it calls.

Spec column: where the written spec lives or will live (R2/R3 are later
tasks).

## Update loop, time step

| file | M/D/L/N | entry points | spec |
| --- | --- | --- | --- |
| `src/world.cpp` | 88/1/1/1 | `RGE_Game_World::update` :1206 [M], `check_game_state` :1377 [M], `set_game_speed` :875 [M] | core.md §1 |
| `src/scr_game.cpp` | 88/2/4/2 | `TRIBE_Screen_Game::handle_game_update` :1086 [M] | core.md §1.1 |
| `src/tribegam.cpp` | 114/1/3/0 | `TRIBE_Game::handle_idle` :3835 [M] | core.md §1.1 |
| `src/basegame.cpp` | 195/4/2/1 | `RGE_Base_Game::run` :884 [M] | core.md §1.1 |
| `src/player.cpp` | 114/2/1/0 | `RGE_Player::update` :870 [M] | core.md §1.2 |
| `src/obj_list.cpp` | 21/0/0/0 | `RGE_Object_List::update` :226 [M] | R2 |
| `src/stat_obj.cpp` | 106/4/5/0 | `RGE_Static_Object::update` :1166 [M] (base per-object step, dying/dead states) | R2 |

## Commands, turns, lockstep, sync

| file | M/D/L/N | entry points | spec |
| --- | --- | --- | --- |
| `src/com_hand.cpp` | 136/3/7/0 | `TCommunications_Handler::DoCycle` :453 [D], `NewCommand` :399 [M], `get_command` :385 [M], `AddCommand` :379 [M], `CommOut` (stamps execute-turn, :2810) [D], `ExecuteIncoming` :2106 [M] | core.md §2 |
| `src/com_q.cpp` | 17/0/0/1 | `RGE_Communications_Queue::AddItem` :189 [M], `GetNextItemOrdered` :296 [M], `GetNextSequence` :335 [M] | core.md §2.3–2.4 |
| `src/com_spd.cpp` | 26/0/1/0 | `RGE_Communications_Speed::BufferTimeToUse` :147 [M], `ReloadBufferFrames` :140 [M], `AnalyzeGameSpeed` :326 [L] | core.md §2.2 |
| `src/com_sync.cpp` | 11/0/1/0 | `RGE_Communications_Synchronize::DoChecksum` :132 [M] | core.md §2.5 |
| `src/Command.cpp` | 44/5/2/0 | `RGE_Command::do_commands` :67 [M], `do_command` :80 [M], `command_order` :845 | core.md §2.4; R2 per command |
| `src/tcommand.cpp` | 39/3/0/0 | `TRIBE_Command::do_command` :36 [M], `command_make` :545 | R2 per command |
| `src/com_obj.cpp`, `com_sess.cpp`, `com_serv.cpp`, `com_loby.cpp`, `dpl_obj.cpp` | (DirectPlay sessions/lobby) | not simulation; our transport replaces them | — |

## RNG

| file | M/D/L/N | entry points | spec |
| --- | --- | --- | --- |
| `src/basegame.cpp` | 195/4/2/1 | `debug_rand` :3989 [M], `debug_srand` :4015 [M] (wrap CRT `rand`/`srand`, not in decomp) | core.md §4 |
| `src/world.cpp` | 88/1/1/1 | seeding in `new_game` (`initial_seed` :983) [N], `new_scenario` :1096 [L]; per-step reseed in `update` | core.md §4.2 |
| `src/com_hand.cpp` | 136/3/7/0 | `SetRandomSeed` :3558 [M], `GetRandomSeed` :3574 [M] | core.md §4.2 |

## Numbers

No single file: field types are in headers (`include/world.h`,
`include/stat_obj.h`, `include/player.h`, `include/m_s_obj.h`) and tuning
constants in `src/game_globals.cpp` / `include/game_globals.h`. Spec:
core.md §3.

## Movement, pathing

| file | M/D/L/N | entry points | spec |
| --- | --- | --- | --- |
| `src/move_obj.cpp` | 47/2/2/0 | `RGE_Moving_Object::findPath` :557 [M] (48 `RGE_Moving_Object` methods) | R2 |
| `src/pathsys.cpp` | 16/1/2/1 | `PathingSystem::findTilePath` :210 [L], `passable` [L], `checksum` :1172 [M], `decrementObstruction` [N] | R2 |
| `src/Path.cpp` | 30/0/0/0 | `Path` waypoint container | R2 |
| `src/zone_map.cpp` | 21/1/0/0 | `RGE_Zone_Map::do_zone_map` :109 [M] (connectivity zones) | R2 |
| `src/act_move.cpp` | 8/1/0/0 | `RGE_Action_Move_To::update` :120 [M] | R2 |
| `src/m_mo_obj.cpp` | 14/0/0/0 | master (type) data for moving units | R2 |

## Gather, build, train

| file | M/D/L/N | entry points | spec |
| --- | --- | --- | --- |
| `src/act_gath.cpp` | 10/0/2/0 | `RGE_Action_Gather::update` :227 [M] | R2 |
| `src/tact_hnt.cpp` | 11/0/1/0 | `TRIBE_Action_Hunt` (9 methods) | R2 |
| `src/tact_bld.cpp` | 8/1/0/0 | `TRIBE_Action_Build::update` :136 [M] | R2 |
| `src/t_b_obj.cpp` | 37/2/0/1 | `TRIBE_Building_Object::build` :700 [M], `damage`, `heal`, `explore_terrain` | R2 |
| `src/tact_mob.cpp` | 9/0/0/1 | `TRIBE_Action_Make_Obj::update` :102 [M] (training) | R2 |
| `src/act_make.cpp` | 5/0/0/0 | `RGE_Action_Make` | R2 |
| `src/tplayer.cpp` | 92/7/3/1 | `TRIBE_Player::trainUnit` :1547 [M], `research` :1569 [M], `buildObject`, `make_new_object` | R2 |
| `src/tcommand.cpp` | 39/3/0/0 | `command_make` :545 | R2 |

## Combat, projectiles, line of sight

| file | M/D/L/N | entry points | spec |
| --- | --- | --- | --- |
| `src/act_atak.cpp` | 9/0/2/2 | `RGE_Action_Attack::update` :263 [L], `ready_to_attack` [L], `do_attack` [M]; two constructors [N] | R2 |
| `src/t_c_obj.cpp` | 38/0/1/0 | `TRIBE_Combat_Object::update` :146 [M], `damage` :212 [M], `do_attack` :308 [M] | R2 |
| `src/stat_obj.cpp` | 106/4/5/0 | `RGE_Static_Object::damage` :2161 [M], `heal` [M] | R2 |
| `src/m_co_obj.cpp`, `src/tm_co_ob.cpp` | 13/1/0/1, 15/0/0/0 | master combat data (attack/armor/range) | R2 |
| `src/act_misl.cpp` | 5/0/2/0 | `RGE_Action_Missile::update` :154 [L], `intercept` [M] | R2 |
| `src/misl_obj.cpp` | 10/0/1/0 | `RGE_Missile_Object::update` :56 [M], `missile_move` :77 [L] | R2 |
| `src/m_mi_obj.cpp` | 14/0/0/0 | `RGE_Master_Missile_Object` | R2 |
| `src/visible.cpp` | 21/1/4/1 | `RGE_Visible_Map::explore_terrain` :397 [L], `unexplore_terrain` [L], `checksumVisible` :863 [M] | R2 |
| `src/vis_unit.cpp` | 10/1/2/0 | `Visible_Unit_Manager`, `Visible_Resource_Manager` | R2 |
| `src/map.cpp` | 54/2/6/2 | `RGE_Map` tiles, terrain, elevation | R2 |

## Techs, effects

| file | M/D/L/N | entry points | spec |
| --- | --- | --- | --- |
| `src/tech.cpp` | 29/2/0/2 | `TRIBE_Tech::do_tech` :133 [M], `TRIBE_Player_Tech::do_tech` :267 [M], `research` [M] | R3 |
| `src/tact_tek.cpp` | 9/0/0/0 | `TRIBE_Action_Make_Tech::update` :71 [M] | R3 |
| `src/effects.cpp` | 3/1/0/1 | `RGE_Effects::do_effect` :153 [M] | R3 |
| `src/teffects.cpp` | 4/0/0/0 | `TRIBE_Effects::do_effect` :11 [M], `do_tech_effect` :40 [M] | R3 |

## Convert, heal, repair, trade (and artifacts, wonders)

| file | M/D/L/N | entry points | spec |
| --- | --- | --- | --- |
| `src/tact_cnv.cpp` | 9/0/0/0 | `TRIBE_Action_Convert::update` :204 [M] | R3 |
| `src/tact_hea.cpp` | 7/0/0/0 | `TRIBE_Action_Heal::update` :117 [M] | R3 |
| `src/tact_rep.cpp` | 11/0/0/1 | `TRIBE_Action_Repair::update` :167 [M] | R3 |
| `src/tact_trd.cpp` | 11/0/1/0 | `TRIBE_Action_Trade::update` :186 [M] | R3 |
| `src/t_c_obj.cpp` | 38/0/1/0 | `TRIBE_Combat_Object::convert` :525, `heal` :552, `repair` :579, `trade` :638 (all [M]) | R3 |
| `src/tact_art.cpp`, `tact_dar.cpp`, `tact_wnd.cpp` | 11/0/0/0, 8/0/0/0, 6/0/0/0 | artifact capture, discovery, wonder | R3 |

## Victory, score

| file | M/D/L/N | entry points | spec |
| --- | --- | --- | --- |
| `src/victory.cpp` | 49/7/0/2 | `RGE_Victory_Conditions::update` :320 [M], `update_for_object` :339 [M], `victory_achieved` [M] | R3 |
| `src/tvictory.cpp` | 6/0/0/0 | `TRIBE_Victory_Conditions::handle_condition` :17, `handle_tech` :25 | R3 |
| `src/tworld.cpp` | 27/1/2/0 | `TRIBE_World::check_game_state` :923 [M], `fill_in_score` :1281 (zone score report) | R3 |
| `src/scr_game.cpp`, `src/scr_ach.cpp` | 88/2/4/2, 6/0/1/1 | in-game score display and achievements screen | R3 |

Score formula location: **not pinned yet**. Candidates are the score panel in
`src/scr_game.cpp` (`score_interval` :132) and player attributes; to locate in
R3.

## Random maps

| file | M/D/L/N | entry points | spec |
| --- | --- | --- | --- |
| `src/rmm_base.cpp` | 21/1/2/0 | `RGE_Random_Map_Module::generate` :76 [M], `find_path` [M]/[L], `randomize_stack` [L] | R3 |
| `src/rmm_dbct.cpp` | 7/1/4/0 | `RGE_RMM_Database_Controller::generate` :259, `add_land_module` :428, `add_terrain_module` :640, `add_object_module` :688, `add_elevation_module` :744 | R3 |
| `src/rmm_tdbc.cpp` | 8/0/2/0 | `TRIBE_RMM_Database_Controller` | R3 |
| `src/rmm_land.cpp`, `rmm_terr.cpp`, `rmm_elev.cpp`, `rmm_clif.cpp`, `rmm_obj.cpp`, `rmm_shal.cpp`, `rmm_cntr.cpp` | 2/0/2/1, 9/1/0/1, 5/0/2/3, 6/0/0/0, 9/1/2/1, 2/0/1/0, 4/0/2/0 | land, terrain, elevation, cliffs, objects, shallows, connections | R3 |
| `src/tmap.cpp` | 26/0/3/0 | `TRIBE_Map::load_random_map` :93, `data_load_random_map` :89 | R3 |
| `src/map.cpp` | 54/2/6/2 | `RGE_Map::new_map` :231 [M] | R3 |

Random-map generation has the highest share of `L`/`N` functions of any
simulation area (`rmm_elev.cpp` 3 N of 10, `rmm_land.cpp` 1 N of 5): expect
golden-map comparisons to be needed.

## Unit auto-behaviour (unit AI, tasks)

| file | M/D/L/N | entry points | spec |
| --- | --- | --- | --- |
| `src/aiuaimod.cpp` | 107/0/6/1 | `UnitAIModule::update` :409 [M], `updateGroup` :583, `attackObject`, `convertObject`, `healObject`, `repairObject`, `gatherObject`, `explore` | R3 |
| `src/taiuaimd.cpp` | 60/0/2/1 | per-class unit AI: civilian, priest, soldier, ranged, tower, building, ships, animals (hunted, predator, lion, elephant), artifact | R3 |
| `src/task.cpp`, `task_lst.cpp`, `ttsk_lst.cpp`, `tact_lst.cpp` | 6/0/0/0, 11/0/0/0, 1/0/1/0, 4/0/0/0 | right-click task tables (which action a unit takes on which target) | R2 |
| `src/action.cpp`, `act_list.cpp`, `act_obj.cpp`, `taction.cpp` | 29/0/0/0, 25/0/0/0, 35/0/0/0, 5/0/0/0 | action stack per unit | R2 |

## Computer player AI

Out of the first milestone (computer players in M5), indexed for later.

| file | M/D/L/N | entry points | spec |
| --- | --- | --- | --- |
| `src/aimodule.cpp` | 66/0/0/0 | `AIModule::update` :238 [M] (time-budgeted) | M5 |
| `src/taimdmd.cpp` | 18/0/1/0 | `TribeMainDecisionAIModule::update` :160 [M] | M5 |
| `src/taitacmd.cpp` | 185/6/22/3 | `TribeTacticalAIModule::update` :1746 [M] — largest `L` count of any file | M5 |
| `src/taistrmd.cpp` | 31/0/2/0 | `TribeStrategyAIModule::update` :930 [L] | M5 |
| `src/taiinfmd.cpp` | 102/3/12/4 | information module (map knowledge) | M5 |
| `src/taibldmd.cpp`, `taiconmd.cpp`, `tairesmd.cpp`, `taipbook.cpp`, `aipbook.cpp`, `taicrule.cpp`, `aidipmod.cpp`, `aiemomod.cpp` and other `ai*.cpp` | see `config/functions/src/` | build, construction, resource, playbook, rules, diplomacy, emotion modules | M5 |

The per-step AI time budget is set in `RGE_Game_World::update`
(`src/world.cpp:1220`); whether the budget makes AI results depend on wall
time is **unverified** (matters only for computer players).

## Scenarios

| file | M/D/L/N | entry points | spec |
| --- | --- | --- | --- |
| `src/scenario.cpp` | 44/4/0/0 | `RGE_Scenario::update` :701 [M] (called every world step) | later |
| `src/tscenaro.cpp` | 82/0/0/0 | `T_Scenario` (load/save, player setup) | later |
| `src/sceninfo.cpp`, `src/campaign.cpp` | 6/0/0/0, 9/0/0/0 | scenario info, campaigns | later |
| `src/world.cpp` | — | `RGE_Game_World::new_scenario` :1096 [L] | core.md §4.2 |

## Not simulation

Drawing (`drawarea.cpp`, `Shape.cpp`, `sprite.cpp`, `view.cpp`, `*.asm`),
UI panels and screens (`Panel*.cpp`, `pnl_*.cpp`, `scr_*.cpp`, `dlg_*.cpp`,
`tpnl_*.cpp`), sound/music, registry and file I/O are presentation or
platform code. They matter for look-and-feel tasks, not for the simulation.
Note one coupling: sound playback calls `rand`, which the engine fences off
(core.md §4.2).
