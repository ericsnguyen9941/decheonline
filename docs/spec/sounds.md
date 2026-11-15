# Sounds

Which sound the original plays, when, and for whom. Refs are to aoe1-decomp @ `6d6d8b1` (paths relative to the
clone root); numbers from `data2/empires.dat` (`AOE1_DIR=<install> npm run dat:dump -- sound <id>`, `unit <id>`,
`graphic <id>`). Code: `apps/client/src/audio/` (`sound-rules.ts` the mapping, `game-sounds.ts` the triggers,
`sound-player.ts` the playback), the import in `tools/assets-import/src/import.ts`.

## 1. Where the sounds are

- **Dat sounds** (`RGE_Sound`, src/Sound.cpp): `empires.dat` has 234. Each lists wavs as `[file name, resource id,
  percent]`. `TDigital` (src/Sounddrv.cpp) loads a wav from the sound DRS archives by resource id, or from a file
  under `sound/` when the id is -1. The wavs are in `data/sounds.drs` (144) and `data2/sounds.drs` (46, Rise of
  Rome; it replaces 5070 of `data/`).
- **Game sounds** (`TRIBE_Game::sounds`, src/tribegam.cpp:646-682): 17 wavs by index, `interfac.drs` 50300-50316
  (50315 and 50316 only in `data2/Interfac.drs`): 0 button1, 1 button2, 2 chatrcvd, 3 cantdo, 4 tribute, 5
  resdone, 6 pkilled, 7 pdropped, 8 mstart, 9 mdone, 10 mkilled, 11 artheld, 12 artlost, 13 convwarn, 14 convdone,
  15 res, 16 farmdie.
- **Ambient files**: 58 dat sound items point at a resource that is in no archive, or at -1 (`sound/*.wav`, the
  terrain sounds). They stay silent here (§6).

The import (pack version 9) writes every wav of the sound archives and the interface archives (`data2` overriding
`data`) to `sounds/<id>.wav`, 208 from the 1.0a install, and adds `manifest.sounds` (each dat sound's
`[resource id, percent]` items), `manifest.unitSounds` (each master's sounds, §3), `PackGraphic.sound` and
`frameSounds` (§4), and `manifest.wavs` (the ids present).

## 2. Picking a wav

`RGE_Sound::play` (src/Sound.cpp:146-190) draws `rand() * 100 / 0x7fff` (an integer) and takes each wav's percent
off it in turn. The first wav that takes it to 0 or below plays. If the percents run out first (they add up to
less than 100), nothing plays. `pickWav` does this. The original's draws come from the sim's RNG, fenced so the
stream does not change (core.md §4.2). Here they come from `Math.random`, outside the sim, so lockstep is
untouched.

`play(1)` queues the sound, and the queue plays after the next paint. Each wav has one DirectSound buffer
(`TDigital`), so playing a wav that is still playing restarts it. There is no pan and no distance: every sound
plays at full level, under the sound volume (§5).

## 3. Master sounds

A master (`RGE_Master_Static_Object` and its action subclass) has six sounds. `PackUnitSounds` keeps them in this
order:

| slot | field (dat name) | plays when | for whom | ref |
| --- | --- | --- | --- | --- |
| 0 | `selected_sound` (selectionSound) | the player clicks the object into the selection | owner is the player, or Gaia | `RGE_Player::select_one_object` src/player.cpp:1359-1364 |
| 1 | `created_sound` (trainSound) | the object is made (trained, foundation placed, ...) | owner is `curr_player` | `RGE_Static_Object::init` src/stat_obj.cpp:170-179, 280-286 |
| 2 | `death_sound` (dyingSound) | hp drops below 1: the object starts dying | owner is `curr_player` | src/stat_obj.cpp:1193-1199 |
| 3 | `command_sound` (action attackSound) | an order on an object is acknowledged | the player who ordered | `RGE_Master_Action_Object::play_command_sound`; see below |
| 4 | `move_sound` (action moveSound) | a move order is acknowledged | the player who ordered | `RGE_Player::command_make_move` src/player.cpp:1772 |
| 5 | `construction_sound` (building constructionSound) | a building becomes active (finished) | owner is `curr_player` | `TRIBE_Building_Object::set_object_state` src/t_b_obj.cpp:239 |

Which object's sound an order plays:
- **move**: the first selected unit's move sound.
- **work / attack on an object**: `get_command_master` (src/act_obj.cpp:287) is the master the unit turns into for
  that target (a Villager on a tree is the Lumberjack 123, command sound 207). Its command sound plays. The client
  uses `workTaskType` and falls back to the unit's own master.
- **build** (a foundation placed): the Builder's (118) command sound, 201, whoever is selected
  (`TRIBE_Player::command_make_building`, src/tplayer.cpp:874).
- **stop**: the first object's command sound.

Selection: a left click on an object plays its sound (src/vw_main.cpp:484, 518), and so does a click that adds to
the selection. A box selection (`pick_multi`, src/view.cpp:1313) and a double-click group are silent. Another
player's object is selected without a sound.

Examples (1.0a dat, the same for every civ): Villager 83 `[47, 114, -1, 206, 206, -]`, Builder 118 `[47, 144, -1,
201, 206, -]`, Clubman 73 `[126, 128, -1, 127, 127, -]`, House 70 `[113, -1, -1, -1, -1, 113]`, Town Center 109
`[185, -1, 70, -1, -1, 185]`.

The objects a game starts with are made without sounds (they are placed before the player watches). The client
reads the sim's state after each step (`GameSounds.update`), because the sim keeps no event list:
- an own object with a sprite that was not there before is "created";
- `Unbuilt -> Active` is "built";
- `<= Active -> >= Dying` is "death".

## 4. Sprite sounds

A dat graphic has a main sound and, per facet, up to three `[frame, sound]` pairs (`sound_list`).
`RGE_Sprite::play_sound` (src/sprite.cpp:372-409) runs as the drawn frame changes:
- The main sound plays on leaving frame 0, or when the frame wraps past the end onto a frame other than 0.
- A facet's frame sound plays when its frame was passed: `[last, new)`, or across the wrap.

Examples: graphic 196, a death, main sound 52. Attack graphic 465 (Clubman), sound 121 at frame 10. Rubble 492,
main sound 70.

Only a drawn sprite plays its sounds: `RGE_Active_Animated_Sprite::draw` calls `play_sound` only when the object
is drawn and not under the fog (`fog_next_shape == 0`, src/asprite.cpp:238). So sprite sounds are on-screen only,
and only for what the player sees now. Explored-but-fogged objects and the black never sound. `unit-layer.ts`
calls `GameSounds.sprite` for a frame change of an object whose fog is `plain` and whose sprite overlaps the map
area of the canvas (not under the top strip or the bottom panel).

## 5. Game sounds and volume

- **Buttons**: the game screen's buttons (command grid, top strip) are made with `get_sound(1)`, button2.wav
  (src/scr_game.cpp:227, 466). A left or right mouse-down on an enabled button stops it and plays it again.
- **Research completed** (`GAME_NOTIFY_RESEARCH_COMPLETED`, src/tact_tek.cpp:96 -> `TRIBE_Game::notification`
  src/tribegam.cpp:1751-1761): Tool, Bronze and Iron Age (techs 101-103) play 5 resdone.wav; any other tech plays 15
  res.wav. Only for the player who researched.
- **Under attack** (`TRIBE_Player::notify` 0x201, src/tplayer.cpp:1740): if the player's alert countdown is 0, it
  is set to 20 (one less each second) and dat sound `attributes[26]` (`PLAYER_ATTRIBUTE_ATTACK_WARNING_SOUND`,
  include/player.h:43; 10 attack.wav for every civ) plays. The sim keeps the countdown in `World.alertCooldown`. The
  client plays the sound when the countdown goes up.
- **Farm died** (`GAME_NOTIFY_OBJECT_DEPLETED`, src/act_make.cpp:46-56 -> `TRIBE_Game::notification`
  src/tribegam.cpp:1728-1733): a Farm that has made all its food and is empty plays 16 farmdie.wav, only for its
  owner (economy.md §4.7). The sim counts the notifications per player in `World.depleted`. The client plays the
  sound when the count goes up.
- **All relics or ruins held / lost** (`GAME_NOTIFY_ARTIFACTS_CAPTURED` / `_LOST`, `GAME_NOTIFY_RUINS_CAPTURED` /
  `_LOST`, src/tribegam.cpp:1990-2087): 11 artheld.wav when a team starts holding all of them, 12 artlost.wav when it
  stops, on every player's screen, Standard game only (victory.md §10). The client plays them when
  `World.victory.artifactHeld` / `ruinHeld` leave or return to −1 (`hud/relics.ts`, hud.md "Relics and ruins").
- **Wonder started / completed / destroyed** (`GAME_NOTIFY_WONDER_STARTED` / `_COMPLETED` / `_DESTROYED`,
  src/tribegam.cpp:1905-1988): 8 mstart.wav, 9 mdone.wav, 10 mkilled.wav on every player's screen; destroyed only in a
  Standard game (victory.md §8). The client plays them when a Wonder's action (`Entity.wonder`) appears, reaches state
  6, or goes (`hud/relics.ts` `wonderNotices`, hud.md "Wonder").
- A unit trained or a building finished has no game sound, only its own master sound (§3).
- `RGE_Base_Game::play_sound` (src/basegame.cpp:3894) leaves a game sound alone while it is still playing. A
  button restarts its sound.

Volume (`TRIBE_Dialog_Config`, src/dlg_conf.cpp:131): a vertical slider with 100 stops, "High" (string 9436) at
the top and "Off" (9437) at the bottom, labelled "Sound\nVolume" (9438), in "Game Settings" (9431). Moving it
changes the volume at once. Cancel puts the old volume back (src/dlg_conf.cpp:554-573). `TSound_Driver::set_volume`
(src/Sounddrv.cpp:170-186) sets the mixer to `(volume + 10000) / 10000` of its range for `volume = -100 *
position`, a gain of `1 - position / 100`. Here the bottom stop is silent. The HUD's Menu button opens the dialog
(`hud/options.ts`; the original goes through the game menu's "Game Settings..."). The position is kept in
`localStorage` (`aoe1web.soundVolume`).

Browsers start audio only after a user gesture. `SoundPlayer` makes the `AudioContext` on the first pointer-down or
key-down. Sounds triggered before that are logged but not played.

## 6. Not done

- Terrain ambient sounds (`TRIBE_Screen_Game::handle_terrain_sound`, src/scr_game.cpp:3570): every 20 s, a
  terrain sound from `sound/*.wav` plays for at most 6 s.
- Music (src/music.cpp): CD audio tracks first (`MCI_DEVTYPE_CD_AUDIO`), else `sound/music%d.mid`.
- Chat received (2) plays for chat (docs/spec/chat.md §3), a late turn and a desync; tribute (4) for a tribute received (docs/spec/diplomacy.md §7.4). Can't do (3), player killed or dropped (6, 7),
  conversion (13, 14): their features or notifications are not in the client yet.
- Gather and drop-off sounds (`resourceGatheringSoundId`, `resourceDepositSoundId` of a task): -1 for every 1.0a
  task.

## 7. Test hook

`window.__game.sounds()` (`?debug=net`) lists every trigger as
`{ event, sound (dat id or -1), game (index or -1), wav, source }`, whether or not audio is running.
`e2e/tests/sounds.spec.ts` injects the real dat ids for Villager, Builder, House and Town Center into the
synthetic manifest and checks them. The mapping's unit tests are in `apps/client/src/audio/sound-rules.test.ts`.
