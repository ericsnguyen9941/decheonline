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
- **Ambient files**: 58 dat sound items point at a resource that is in no archive, or at -1: a loose file
  `sound/<name>` (`TDigital`), the terrain sounds (§6).
- **Music**: 13 `.mid` files in the install's `sound/`: Music1-9, Open, Won, Lost, xlost (§7).

The import (pack version 9) writes every wav of the sound archives and the interface archives (`data2` overriding
`data`) to `sounds/<id>.wav`, 208 from the 1.0a install, and adds `manifest.sounds` (each dat sound's
`[resource id, percent]` items), `manifest.unitSounds` (each master's sounds, §3), `PackGraphic.sound` and
`frameSounds` (§4), and `manifest.wavs` (the ids present). Pack version 16 adds each sound's file names
(`PackSound.files`), the loose `sound/*.wav` files they name at `sounds/file/<name>` (`manifest.soundFiles`), each
terrain's sound (`PackTerrain.sound`) and the music (`manifest.music`, §7). The server serves `.wav`, `.mid`, `.dls` and
`.sf2` from the pack (`apps/server/src/assets.ts`); before that every wav was a 404 and nothing was heard.

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
- **Chat received, tribute, player killed** (`TRIBE_Game::notification`, event `message`): 2 chatrcvd.wav for a chat
  line from another player (docs/spec/chat.md §3), a late turn and a desync (`hud/game-hud.ts`); 4 tribute.wav for a
  tribute received (docs/spec/diplomacy.md §7.4); 6 pkilled.wav when a player resigns or is defeated
  (`hud/game-over.ts`).
- **Can't do** (`TRIBE_Game::notification`, src/tribegam.cpp:1773-1817, 2090-2134): 3 cantdo.wav for the player
  told, on these notifications: not close enough to land (1) and not enough room to unload (2), from the transport's
  owner notifications 0x207 / 0x206; cannot trade with an enemy (3), from 0x20C (`TRIBE_Player::notify`,
  src/tplayer.cpp:1765-1774; `unit-ai.ts` `playerNotify`); no room to place a trained unit (0x68, `buildings.ts`
  `updateTrain`, the cost is paid back); cannot repair, the owner short of the cost (0x6B, `repair.ts`); a conversion
  refused: no faith (0x76), a Priest without Monotheism (0x77), a building without Monotheism (0x78), a Town Center
  (0x79), a Wonder (0x7A) (`priest.ts`; a wall, artifact or flag is refused silently). The sim logs them through
  `ctx.notify` in `World.log.notifications` (hashed, so both clients log alike; `game-log.ts`
  `CANT_DO_NOTIFICATIONS`); `GameSounds.update` plays the sound for each new one whose first value is its player. An
  order the player gives where it cannot go plays it from the client (order modes, event `cant-do`). The message text
  of these notifications is not shown.
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

Taunts (`TTaunt`, docs/spec/chat.md §8): a chat line that reads as a number plays `sound/TauntNNN.wav` of the install
(taunts 1-50, pack `sounds/taunt<n>.wav`, `PackManifest.taunts`), through `GameSounds.chatLine` (event `taunt`).

## 6. Terrain sounds

`TRIBE_Screen_Game::handle_terrain_sound` (src/scr_game.cpp:3570-3633), once a frame while the game is on (not in the
game over mode): 20 s after the last check, the terrain with the most explored tiles drawn on screen that has a sound
(`RGE_Tile_Set::sound`, `PackTerrain.sound`; the lowest id on a tie) plays one of its sound's files, picked as a wav is
(§2), as a stream. While it plays it is checked every second and cut once it has played 6 s. The clock starts as the
game screen is made. Code: `sound-rules.ts` `terrainSound` and the `TERRAIN_SOUND_*` times, `GameSounds.terrain`
(event `terrain`, the file in `SoundTrigger.file`), `map-view.ts` `drawnTerrains`, `SoundPlayer.playStream`. The
streams play at the sound volume (the real spec hears dat sound 95, wind2.wav).

## 7. Music

`TMusic_System` (src/music.cpp) plays CD audio tracks when there is a game CD (`MCI_DEVTYPE_CD_AUDIO`), else the
`sound/music%d.mid` files through Windows' MIDI synthesizer. Here it is always the MIDI files, synthesized in an
AudioWorklet by spessasynth_lib (`apps/client/src/audio/music-player.ts`) with a General MIDI sound bank.

- **What plays when**: the menu plays `open.mid` once as it opens (`start_menu`, src/tribegam.cpp:1360-1368; here the
  lobby, also when a game is left). A game plays `music1.mid` to the last `music<n>.mid` in order, looped
  (`start_game`, src/tribegam.cpp:3469-3478). The next track starts when one ends (`after_end_track`). The end of the
  game (the achievements' game over) plays `won.mid` or `lost.mid` once, by this player's status (`hud/game-hud.ts`).
- **Volume and on/off** (`TRIBE_Dialog_Config`, src/dlg_conf.cpp:108-133, 477-496): a "Music\nVolume" slider (string
  9435) left of the sound's, the same 100 stops and gain as §5. Without a saved one it is in the middle, 50
  (`setup_music_system`, src/basegame.cpp:1780). OK with it at "Off" shuts the music down (`use_music` off); OK with it
  moved up from "Off" starts every track again, looped. Cancel puts the old position back. Kept in `localStorage`
  (`aoe1web.musicVolume`).
- **Sound bank**: the original's MIDI played on the machine's synthesizer, so the bank is not a game file. The import
  copies one into the pack as `music/bank.dls` (or `.sf2`): env `MUSIC_BANK`, else macOS's CoreAudio GS bank, else
  Windows' `gm.dls`. Without a bank or without `sound/music1.mid`, `manifest.music` is null and nothing plays. The
  `.mid` files are copied lower case to `music/<name>`.
- The music starts, like the sounds, on the first user gesture (§5); a request made before then waits for it.

## 8. Test hook

`window.__game.sounds()` (`?debug=net`) lists every trigger as
`{ event, sound (dat id or -1), game (index or -1), wav, source }`, whether or not audio is running.
`e2e/tests/sounds.spec.ts` injects the real dat ids for Villager, Builder, House and Town Center into the
synthetic manifest and checks them. The mapping's unit tests are in `apps/client/src/audio/sound-rules.test.ts`.

`window.__game.audioLevels()` gives `{ running, sound, music }`: is the `AudioContext` running, and the peak absolute
sample since the last call on two `AnalyserNode`s, one after the sound volume's gain and one after the music's.
`window.__game.music()` gives `{ playing, on, volume, tracks }`. `e2e/real/real-sounds.spec.ts` (real pack) clicks to
start audio and checks that a button's wav, a terrain sound, `music1.mid`, `lost.mid` and the music slider's "Off" are
measured at the outputs. Terrain and music tests: `sound-rules.test.ts`, `music-player.test.ts`.

## 9. Not done

- Player dropped (7, pdropped.wav): no sender in the decomp; a dropped player resigns, which plays 6 pkilled.wav.
- convdone (14) is never played by 1.0a. convwarn (13) plays for the old owner when another player converts its
  object (`GAME_NOTIFY_CONVERSION_SUCCEEDED`, src/tact_cnv.cpp:321, :380; `game-sounds.ts` event `converted`; an
  artifact changing hands is not a conversion).
- Gather and drop-off sounds (`resourceGatheringSoundId`, `resourceDepositSoundId` of a task): -1 for every 1.0a
  task.
- CD audio music (§7): the MIDI files are always used.
