# Chat

Source: aoe1-decomp @ `6d6d8b1` (July 1998 RoR beta; see `README.md` for the
version caveat and reference format). Status letters: M matching,
D accepted_drift, L accepted_logic, from `config/functions/src/<file>.cpp.json`.
Client: `apps/client/src/hud/chat.ts` (the entries), `hud/game-hud.ts`
(`commandChat`, `sendChat`, `receiveChat`), `hud/game-over.ts` `ChatLines`,
`lobby/session.ts` + `lobby/lobby-view.ts` (the setup screen's chat); relay
`apps/server/src/rooms.ts` `chat`; message `chat` in `packages/protocol`.

## 1. Functions and status

| function | file | status | role |
| --- | --- | --- | --- |
| `TRIBE_Screen_Game::key_down_action` | `src/scr_game.cpp:1838-1840` | M | Enter: `command_quick_chat` |
| `TRIBE_Screen_Game::command_chat` / `command_quick_chat` | `src/scr_game.cpp:3797-3820` | M | open the dialog or the bar; refuse after defeat |
| `TribeSendQuickMessageDialog` (ctor, `action`, `handle_mouse_down`) | `src/dlg_smsg.cpp:362-444` | M | the one-line chat bar |
| `TribeSendMessageDialog` (ctor D, `action`, `checkButtons`, `draw`) | `src/dlg_smsg.cpp:23-358` | D/M | the Send Messages dialog |
| `TCommunications_Handler::SendGroupChatMsg` / `SendChatMsgAll` / `TXChat` | `src/com_hand.cpp:1905-1990` | M | recipients, local copy, the 255-character cap |
| `TCommunications_Handler::ExecuteIncoming` case `'C'` | `src/com_hand.cpp:1358-1368` | M | receive: only when this player is a recipient |
| `TChat::AddChatMsg` | `src/Chat.cpp:34-60` | M | "Name: text", posts `CHAT_RECEIVED`, taunts |
| `TRIBE_Game` `CHAT_RECEIVED` | `src/tribegam.cpp:4047-4052` | — | sound 2, `handleChatReceived` |
| `TRIBE_Screen_Game::handleChatReceived` / `display_system_message` | `src/scr_game.cpp:1395-1415` | M | the next of 8 chat lines, white |
| `TMessagePanel::handle_idle` | `src/Pnl_msg.cpp:306-316` | M | a chat line goes after 8000 ms (`show_message_interval`, :12) |
| `TribeMPSetupScreen` ctor / `action` / `fillChat` | `src/scr_mps.cpp:52-55`, `:222-247`, `:750-754`, `:1704-1716` | L/L/M | the setup screen's chat box |

## 2. Opening the entry (game screen)

- **Enter** (`VK_RETURN`, no Ctrl or Alt; nothing while a modal dialog is open,
  scr_game.cpp:1421) opens the chat bar (`command_quick_chat`).
- The **Chat** button of the top strip (`TRIBE_UI_COMMAND_CHAT`, string 4113)
  opens the Send Messages dialog in a multiplayer game (`command_chat`; a
  single-player game opens the bar instead).
- Both are refused while the game screen is in the game over mode for this
  player but the game itself goes on (`game_ended == 0 && prog_mode ==
  ProgModeGameOver`: this player resigned or was defeated): "You cannot chat
  after you have resigned or been defeated." (`STRING_ID_ERROR_CHAT_AFTER_DEFEAT`
  3070) on the message line. Once the whole game is over the entries open, but
  a message typed then is not sent (§3).

### 2.1 The chat bar (`TribeSendQuickMessageDialog`, mode `AsChat`)

Modal, 540 x 35, centred on the screen, in the in-game dialogs' look
(`dlg6_<culture>`, bina 50006). "Chat" (`STRING_ID_SEND_MESSAGE_CHAT` 9832) at
(5, 5, 120 x 25), Copperplate 12, centred; the input at (130, 5, 405 x 25),
65 characters (`create_edit(..., 65, ...)`, dlg_smsg.cpp:365), focused.

- Enter with text: the bar closes, then the line is sent (§3).
- Enter on an empty line, Esc, or a click outside the bar: it closes, nothing
  sent (dlg_smsg.cpp:388-444).

### 2.2 The Send Messages dialog (`TribeSendMessageDialog`)

Modal, 520 x 465, centred. Title "Send Messages to" (9831) at (5, 10,
w - 40 x 30), Copperplate 21. One row per player, from y 40, 30 apart:

- the name at (50, y, 190 x 30), struck out when the player is defeated
  (`game_status == 2`) or no longer in the game (humanity neither human nor
  computer); under it `dlg_plbn.shp` (interfac.drs 0xC63A) in the player's
  colour, drawn at (50, y) (`draw`, dlg_smsg.cpp:332-355);
- the civilization's name at (260, y, 120 x 30);
- for every other player still in the game, a check box at (10, y, 30 x 30),
  checked when the player is in the chat group (`chat->inChatGroup`).

"Chat" (9832) at (10, 315), the input at (130, 315, 380 x 23), 65 characters,
focused. Four radio buttons, 30 x 30, labels 30 to the right: Allies (9833) at
(45, 350), Enemies (9834) at (275, 350), Everyone (9835) at (45, 385), Select
Player (9838) at (275, 385, selected at the start). Return to Game (9836) at
(100, 425, 300 x 30), Copperplate 12, hotkey Esc.

- Allies checks each player this one is allied with, Enemies each enemy,
  Everyone every box; Select Player changes nothing; clicking a check box
  selects Select Player (dlg_smsg.cpp:268-310). After any of them the boxes
  become the chat group (`checkButtons`, :318-330).
- Enter with text sends it (§3) and empties the input; the dialog stays.
- Return to Game (or Esc) keeps the boxes as the chat group, closes the
  dialog and sends what is typed, if anything.

Check boxes and radio buttons are `TButtonPanel`s with the info file's
`button_file` (`btn6_0`, interfac.drs 50605): check box frames 0 / 2, radio
4 / 6 for off / on, centred in the button (`auto_pic_pos`), bevel type 4
(Panel_ez.cpp:892-990). The input is a `TEditPanel` with bevel type 3, the
info file's background colour and its focus colours (Panel_ez.cpp:1139-1179).

## 3. Sending and receiving

- **Chat group** (`TChat::chatGroupPlayers`): the setup screen puts every
  player in it (scr_mps.cpp:53-55), the game start this player again
  (tribegam.cpp:3488), and a player with allies at the start gets them only
  (tplayer.cpp:1252-1261; no teams in our lobby, so it stays everyone). Only
  the Send Messages dialog changes it; it lasts for the rest of the game.
- `SendGroupChatMsg`: the recipients are the chat group's players who are still
  human (`IsPlayerHuman`). In the game over mode (`prog_mode ==
  ProgModeGameOver`) nothing is sent. Cheat codes are tried first
  (`processCheatCode`, §7): a line that is one is not sent.
- `TXChat`: when this player is a recipient, its own copy is added at once
  (`AddChatMsg(..., Local = 1)`); the text is cut to 255 characters and goes
  out as message `'C'` with the recipients' map, outside the command turns.
- `ExecuteIncoming` `'C'`: a client adds the message only when it is a
  recipient (or is in the setup screen).
- `AddChatMsg`: the line is "Name: text" (`sprintf("%s: %s")`, the sender's
  comm name, no player colour); taunt numbers are played from it (not ported).
  `CHAT_RECEIVED` then plays game sound 2 (chatrcvd, docs/spec/sounds.md) and
  `handleChatReceived` writes the line.
- **Chat lines**: 8 panels of 620 x 20 from (4, 34) of the main view, 20
  apart, used in turn; white text (`TMessagePanel::WhiteColor`), standard font;
  each line goes 8 s after it was written. System messages ("%s resigned.",
  "Problem communicating with %s...") share them.

Our port: the client sends `{ t: 'chat', text, to: [slots] }`; the relay
forwards `{ t: 'chat', from, text }` to each named player but the sender whose
socket is here, in the lobby and in the game. It never enters a turn batch, the
sim or the hash, so it cannot desync a game; a message sent while a socket is
away is lost, as on a broken DirectPlay link.

## 4. Diplomacy in a 2-player game

Our lobby has no teams, so at the start the other player is an enemy
(`isEnemy`) and not an ally: Allies unchecks the other player (the message
reaches this player's own screen only), Enemies and Everyone check it. The
buttons read this player's own stance (`World.isAlly` / `isEnemy`,
[diplomacy.md](diplomacy.md) §1): once it calls the other an ally, Allies checks
it and Enemies does not; at neutral, neither does.

## 5. The setup screen's chat (`TribeMPSetupScreen`)

Multiplayer only: "Chat" (`STRING_ID_MP_CHAT_LABEL` 9687) at (10, 280), a text
box (10, 300, 400 x 96) with a scroll bar, and an input (10, 402, 400 x 23)
of 247 characters (scr_mps.cpp:222-247). The screen starts with an empty chat
and everyone in the chat group (:52-55). Enter with text sends it to every
player (`SendChatMsgAll`, :750-754), this one included, and empties the input.
`fillChat` (:1704-1716) word-wraps the line into the box, keeps 100 lines and
scrolls to the newest only when the box showed the last line. No sound.

Our lobby is its own DOM (not the original's art); the chat box sits between
the settings and the ready buttons, with the same lengths and behaviour.

## 6. Not ported

- Taunts (`TTaunt::PlayTauntStr` on a line that is a number).
- The single-player cheats (§7.3), GAIA, and the cheats' feedback on screen.
- Team games, which would make Allies differ. (The Diplomacy dialog changes this
  player's stance, which Allies and Enemies read: diplomacy.md §7.)
- More than 2 players' rows (the code handles up to 8).

## 7. Cheat codes

Read from the 1.0a exe (`Empiresx.exe`): `TRIBE_Game::processCheatCode`
(0x5061e0) and `TRIBE_World::cheat` (0x50ecb0, jump tables 0x50f3ec, 0x50f368).
The beta decomp (`tribegam.cpp:3150-3290`, `tworld.cpp`) differs: 1.0a sends
the resource cheats as cheat codes 20-23 instead of `command_add_attribute`,
and has POW where the beta has MINIWINSETT.

### 7.1 Typing one

Both chat entries (§2.1, §2.2) call `processCheatCode(player, text)` before
sending; when it returns nonzero the line is not sent as chat. It returns 0 at
once unless `allowCheatCodes()` (the game option byte at +0x982, the setup
screen's Enable Cheating, [lobby.md](lobby.md) §2.2; off by default in a
multiplayer game). The text is uppercased; six codes match as substrings
(`strstr`), the rest must be the whole line. A match sends a command to every
peer (`command_cheat(player, code)`: `TRIBE_GAME_COMMAND_ID_CHEAT` 6, the code
as an unsigned char) and nothing else, except where the table says.

| text | match | code / command |
| --- | --- | --- |
| PHOTON MAN | whole | 0 |
| E=MC2 TROOPER | whole | 1 |
| JACK BE NIMBLE | whole | 2 |
| BIG BERTHA | whole | 3 |
| FLYING DUTCHMAN | whole | 4 |
| UPSIDFLINTMOBILE | whole | 7 |
| HOYOHOYO | whole | 8 |
| DARK RAIN | whole | 10 |
| BLACK RIDER | whole | 11 |
| MEDUSA | whole | 12 |
| ICBM | whole | 13 |
| STORMBILLY | substring | 14 |
| CONVERT THIS! | substring | 15 |
| BIG MOMMA | substring | 16 |
| POW | substring | 17 |
| GRANTLINKSPENCE | substring | 18 |
| KING ARTHUR | substring | 19 |
| PEPPERONI PIZZA | whole | 20 |
| COINAGE | whole | 21 |
| QUARRY | whole | 22 |
| WOODSTOCK | whole | 23 |
| HARI KARI | whole | 101 |
| RESIGN | whole | 103 |
| BIGDADDY | whole | 220 |
| REVEAL MAP | whole | 230 |
| NO FOG | whole | 231 |
| STEROIDS | whole | `command_quick_build(!quick_build)`: game command 4 |

The substring tests run first, in the table's order, so "POWER" is POW.

### 7.2 What a code does (`TRIBE_World::cheat`)

Every peer runs it when the command executes; it does nothing unless
`allowCheatCodes()`.

- 0, 1, 14, 15, 16, 17, 220, for a player other than Gaia: the player's first
  Town Center (master 109) that is finished gets `command_make` of unit 274
  (Photon Man), 248 (Nuke Trooper), 386 (Stormbilly), 394 (Saint Francis), 397
  (Big Momma), 398 (Pow) or 372 (Bigdaddy). `do_command_make`
  (`tcommand.cpp:104-125`) does nothing while the building trains or
  researches; else its only action becomes a make action that is not pre-paid:
  the cost is paid at once (`first_in_stack`, `tact_mob.cpp:55-90`; these units
  cost nothing in the dat), and the production queue empties without a refund
  while it runs (`t_b_obj.cpp:974-1029`, economy.md §5.1). It ends as a train
  (§5.2): the unit is placed on its train time (0 for all seven), with no
  population check.
- 2-13: `do_effect` of effect 125 + code for the player (2 JACK BE NIMBLE 127,
  3 BIG BERTHA 128, 4 FLYING DUTCHMAN 129, 7 UPSIDFLINTMOBILE 132, 8 HOYOHOYO
  133, 10 DARK RAIN 135, 11 BLACK RIDER 136, 12 MEDUSA 137, 13 ICBM 138); code
  5 (130) goes to Gaia. 5, 6 and 9 have no text.
- 18, 19: effects 216 (GRANTLINKSPENCE) and 217 (KING ARTHUR) on Gaia.
- 20-23: 1000 added to food (20), gold (21), stone (22), wood (23).
- 100 (DIEDIEDIE): every object of every other player not on the cheater's
  side dies. 101: every object of the player dies (`die_die_die`). 102: the
  player wins (`win_game_now`). 103: `loss_if_game_on`, which is not a
  resignation (no notice, the player is not marked resigned).
- 200-209 (KILLn): player n's objects die.
- 230: `set_map_visible(1)`; 231: `set_map_fog(0)`. Both are drawing flags of
  the shared map (`diam_map.cpp:468-734`): the whole map drawn as explored, no
  fog. They change no unit's sight.

`quick_build` (game command 4 sets it to its value; `do_command_game`, not gated)
is one game-wide flag. While set: a train's work jumps to 1000
(`tact_mob.cpp:107`), a build's and a research's work per step is 1000
(`tact_bld.cpp:216`, `tact_tek.cpp:85`), a gatherer or hunter takes the whole
amount the target holds (`act_gath.cpp:347`, `tact_hnt.cpp:384`), and a Hunter
or Lumberjack's attack kills its target outright (`t_c_obj.cpp:313`).

### 7.3 Single-player only

HOME RUN (102), DIEDIEDIE (100) and KILL1-KILL7, KILL9 (201-207, 209) are
tried only in a single-player game (the check at 0x41bd00); GAIA switches the
local view to Gaia (`set_player(0)`, no command). SELECTOBJ, RUNPLAY and ZEUS
are debug and computer-player codes.

### 7.4 Our port

Commands `cheat` (`{ code }`) and `quick-build` (`{ on }`), type ids 21 and 22;
`World` option `cheating` from the lobby; `World.cheat` codes 0-23, 101, 103,
220, 230, 231, which the chat can send (100, 102 and 200-209 are ignored);
`World.mapVisible`, `mapFog`, `quickBuild`. The client tries the line
(`processCheatCode` in `apps/client`) before sending chat in both entries.
