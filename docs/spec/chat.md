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
  (`processCheatCode`, not ported).
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

Our lobby has no teams, so the other player is an enemy (`isEnemy`) and not an
ally: Allies unchecks the other player (the message reaches this player's own
screen only), Enemies and Everyone check it.

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

- Cheat codes typed in chat (`processCheatCode`, before sending) and taunts
  (`TTaunt::PlayTauntStr` on a line that is a number).
- The Diplomacy dialog and team games, which would make Allies differ.
- More than 2 players' rows (the code handles up to 8).
