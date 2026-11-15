import type { Application, Ticker } from 'pixi.js';
import { ATTR_FOOD, ATTR_HEADROOM, ATTR_POPULATION, ATTR_POPULATION_LIMIT, FARM, HOUSE, ObjectState, STATUS_LOST, typeOf, type Command, type Entity, type World } from '@aoe/sim';
import type { AssetProvider, ImageFrame } from '../assets';
import type { MapView } from '../map/map-view';
import { CommandPanel } from './command-panel';
import { constructionProgress, researchStatus, trainingStatus } from './commands';
import { applyCursors, clearCursors } from './cursors';
import { frameDataUrl, paintFrame } from './frame-image';
import { BOTTOM_HEIGHT, hudLayout, SLP, TOP_HEIGHT, type HudLayout, type Rect } from './layout';
import { Minimap, type MinimapUnits } from './minimap';
import { AchievementsScreen } from './achievements';
import { ChatEntry, STRING_CHAT } from './chat';
import { DiplomacyDialog, diplomacyNotices, SOUND_TRIBUTE, type DueBatch } from './diplomacy';
import { easyButton, FONT, GAME_DIALOG_INFO, lookOf } from './easy-panel';
import { HeldDisplay } from './relics';
import { ChatLines, formatName, GameOver, MESSAGE_NOT_RESPONDING, SOUND_CHAT, type GameOverSounds } from './game-over';
import { MenuDialog, okPopup } from './menu';
import { ScoreDisplay } from './score-display';
import { OptionsDialog, type OptionsSounds } from './options';
import { infoOf } from './records';
import { ResourceBar } from './resource-bar';
import { ageName, civilizationName, objectName, statRows, topButtonLabels } from './text';

/** `STRING_ID_SCORE_BUTTON_SHORTCUT`: the score button's text. */
const SCORE_BUTTON = 0x1023;
/** `STRING_ID_PLAYER_DROPPED_NOTICE`. */
const DROPPED_NOTICE = 0x25c9;

/** Frames in health.shp; the bar shows frame `count - count * hp / max`. */
const HEALTH_FRAMES = 26;
/** Egyptian: the game does not track a player's culture yet. */
const CULTURE = 0;
/** Building icons live in a different SLP and are chosen by `master_type` 80 and over (the sim's `UnitType.masterType`). */
const BUILDING = 80;
/** A part of the top strip without icons or buttons (1024 art; the others are narrower but share the texture there). */
const STRIP_TILE = { x: 300, w: 200 };
/** itemicon.shp frames of the object panel's rows (`TRIBE_Panel_Object::draw_item`). */
const ITEM_POPULATION = 4;
const ITEM_PROGRESS = 9;
/**
 * The itemicon frame of a held resource by `attribute_type_held` (tpnl_obj.cpp:365-388): food (0, 15-17) 2, wood (1) 0,
 * stone (2) 1, gold (3) 3, trade goods (9) 5.
 */
const ITEM_HELD: Record<number, number> = { 0: 2, 15: 2, 16: 2, 17: 2, 1: 0, 2: 1, 3: 3, 9: 5 };
/** `unit_level`s whose own units show what they carry (3 villager, 4 soldier, 6 priest-like), and resource objects (1). */
const CARRIER_LEVELS = new Set([3, 4, 6]);
const LEVEL_RESOURCE = 1;
/** `PLAYER_ATTRIBUTE_CURRENT_AGE`. */
const ATTR_CURRENT_AGE = 6;
/** The rows' itemicon at (54, 30 + 20 * row) and value at (88, 33 + 20 * row) (`TRIBE_Panel_Object::draw_item`). */
const ROW_HEIGHT = 20;

/** One row of the object panel: `kind` names its test ids (`object-<kind>`, `object-<kind>-icon`). */
interface PanelRow {
  kind: string;
  icon: number;
  text: string;
}

/** The player's selection as the HUD reads and changes it (the unit layer's). */
export interface HudSelection {
  /** Every selected object (`sel_list`). */
  readonly selected: ReadonlySet<number>;
  /** The object the panel shows (`selected_obj`: the last one selected), or null. */
  readonly primary: number | null;
  /** Is object `id` in a group (`selected_group` != 0)? */
  isGrouped(id: number): boolean;
  /** `group_objects(-1)`, `ungroup_objects`, `unselect_object`. */
  group(): void;
  ungroup(): void;
  unselect(): void;
  /** `get_selected_objects_to_command(minLevel)`: the selected own active objects of that select level or more. */
  commandObjects(minLevel: number): number[];
  /** `command_repair`: the next click on the map picks the building to repair. */
  armRepair(): void;
}

export interface GameHudOptions {
  /** The element the canvas sits in; the HUD covers it. */
  parent: HTMLElement;
  app: Application;
  world: World;
  provider: AssetProvider;
  /** Sim player number of this client. */
  player: number;
  /** The selection. */
  selection: HudSelection;
  /** Send a command through the lockstep. */
  issue: (command: Command) => void;
  /** Start and stop placing a building on the map. */
  startPlacement: (unit: number) => void;
  cancelPlacement: () => void;
  /** The map view and its units, for the minimap; without them the minimap's frame stays empty. */
  map?: { view: MapView; units: MinimapUnits };
  /** The buttons' click and the sound volume the Menu button's settings change; without it, no click and no settings. */
  sounds?: OptionsSounds & GameOverSounds;
  /** The multiplayer game around the screen: the menu's resign and quit, and the end of the game. */
  game: HudGame;
}

/** What the game screen asks of the multiplayer game. */
export interface HudGame {
  /** Player names by player number (0 Gaia). */
  names: readonly string[];
  /** Send the resign command (`command_resign`). */
  resign(): void;
  /** Quit Game confirmed (`do_game_over`'s `disconnect_multiplayer_game`): out of the room, the screen stays. */
  disconnect(): void;
  /** Leave the game screen for the lobby (`quit_game`). */
  leave(): void;
  /** Has the server dropped player `p`? */
  dropped(p: number): boolean;
  /** Entering the game over mode: cancel the order being given and unselect. */
  onGameOver(): void;
  /** The whole map, without fog. */
  reveal(): void;
  /** Send a chat message to players `to` (player numbers) through the relay, outside the turns (docs/spec/chat.md §3). */
  sendChat(text: string, to: number[]): void;
}

function box(parent: HTMLElement | null, className: string, testid?: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = className;
  if (testid) el.dataset.testid = testid;
  parent?.append(el);
  return el;
}

function place(el: HTMLElement, r: Rect): void {
  Object.assign(el.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
}

/**
 * The game screen's panels in the original's layout and art (TRIBE_Screen_Game): the top strip with the resource
 * counts, the age and the chat, diplomacy and menu buttons, and the bottom panel with the selected object's panel, the
 * command button grid and the minimap frame. Without a pack the same boxes show on plain backgrounds.
 */
export class GameHud {
  readonly root = box(null, 'hud', 'hud');
  private readonly top = box(this.root, 'hud-top', 'hud-top');
  private readonly topFrame = box(this.top, 'hud-frame');
  private readonly age = box(this.topFrame, 'hud-age', 'age');
  private readonly menus = ['chat', 'diplomacy', 'menu'].map((name) => box(this.topFrame, 'hud-menu', `menu-${name}`));
  private readonly bottom = box(this.root, 'hud-bottom', 'hud-bottom');
  private readonly object = box(this.bottom, 'hud-object', 'object-panel');
  private readonly objectCiv = box(this.object, 'hud-object-civ', 'object-civ');
  private readonly objectName = box(this.object, 'hud-object-name', 'object-name');
  private readonly objectIcon = box(this.object, 'hud-object-icon', 'object-icon');
  private readonly objectHealth = box(this.object, 'hud-object-health', 'object-health');
  private readonly objectHp = box(this.object, 'hud-object-hp', 'object-hp');
  private rowEls: { kind: string; icon: HTMLElement; text: HTMLElement }[] = [];
  private readonly slots = Array.from({ length: 12 }, () => box(this.bottom, 'hud-slot', 'command-slot'));
  private readonly minimap = box(this.bottom, 'hud-minimap', 'minimap');
  private readonly message = box(this.root, 'hud-message', 'hud-message');
  private readonly view = box(this.root, 'hud-view', 'hud-view');
  /** The command button grid. */
  readonly commands: CommandPanel;
  /** The minimap, when the HUD has a map view. */
  readonly minimapView: Minimap | null;
  /** The Menu button's settings (the sound volume), when the HUD has sounds. */
  readonly options: OptionsDialog | null;
  /** The Menu button's dialog. */
  readonly menu: MenuDialog;
  /** The chat lines: chat messages and system messages. */
  readonly chat: ChatLines;
  /** Enter's chat bar and the Chat button's Send Messages dialog. */
  readonly chatEntry: ChatEntry;
  /** The Diplomacy button's dialog. */
  readonly diplomacy: DiplomacyDialog;
  /**
   * The chat group (`TChat::chatGroupPlayers`): every player from the setup screen (src/scr_mps.cpp:53-55), this one
   * again at the start (src/tribegam.cpp:3488); the Send Messages dialog's check boxes change it.
   */
  readonly chatGroup = new Set<number>();
  /** F4's score display. */
  readonly scores: ScoreDisplay;
  /** The end of the game. */
  readonly gameOver: GameOver;
  /** All relics or all ruins held: the notifications and the countdown clocks. */
  readonly held: HeldDisplay;
  private readonly scoreButton: HTMLButtonElement;
  private achievements: AchievementsScreen | null = null;
  /** `player_quit`: the player resigned from the menu. */
  private quit = false;
  private readonly bar: ResourceBar;
  private readonly tick: (ticker: Ticker) => void;
  private readonly onResize = () => this.applyLayout();
  /** Enter opens the chat bar (`key_down_action`'s `VK_RETURN`, src/scr_game.cpp:1838; not with Ctrl or Alt). */
  private readonly onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' || e.ctrlKey || e.altKey || e.metaKey || e.repeat) return;
    e.preventDefault();
    this.commandChat(true);
  };
  private layout: HudLayout | undefined;
  private shown: string | null = null;

  constructor(private readonly o: GameHudOptions) {
    o.parent.append(this.root);
    this.bar = new ResourceBar(this.topFrame, o.app, o.world, o.player);
    this.message.hidden = true;
    this.commands = new CommandPanel({
      slots: this.slots,
      message: this.message,
      world: o.world,
      provider: o.provider,
      player: o.player,
      culture: CULTURE,
      issue: o.issue,
      startPlacement: o.startPlacement,
      cancelPlacement: o.cancelPlacement,
      unselect: () => o.selection.unselect(),
      group: () => o.selection.group(),
      ungroup: () => o.selection.ungroup(),
      onButton: () => o.sounds?.button(),
      commandObjects: (minLevel) => o.selection.commandObjects(minLevel),
      repair: () => o.selection.armRepair(),
    });
    const sounds = o.sounds;
    const click = () => sounds?.button();
    this.options = sounds ? new OptionsDialog(this.root, o.provider, sounds) : null;
    this.chat = new ChatLines(this.view);
    this.scores = new ScoreDisplay(this.view, o.world, o.game.names);
    this.gameOver = new GameOver({
      view: this.view,
      provider: o.provider,
      world: o.world,
      player: o.player,
      names: o.game.names,
      sounds: sounds ?? null,
      chat: this.chat,
      quit: () => this.quit,
      dropped: (p) => o.game.dropped(p),
      onGameOver: () => {
        o.cancelPlacement();
        o.game.onGameOver();
      },
      reveal: () => o.game.reveal(),
    });
    this.held = new HeldDisplay({
      view: this.view,
      provider: o.provider,
      world: o.world,
      player: o.player,
      names: o.game.names,
      sound: (index) => sounds?.message(index),
      message: (text) => this.chat.show(text),
    });
    for (let p = 1; p < o.world.players; p++) this.chatGroup.add(p);
    this.chatEntry = new ChatEntry({
      parent: this.root,
      provider: o.provider,
      group: this.chatGroup,
      players: () =>
        Array.from({ length: o.world.players - 1 }, (_, i) => {
          const p = i + 1;
          const gone = o.game.dropped(p);
          return { player: p, name: o.game.names[p] ?? '', civ: civilizationName(o.provider, o.world.civs[p]!), out: gone || o.world.playerStatus(p) === STATUS_LOST, checkable: p !== o.player && !gone };
        }),
      isAlly: (p) => o.world.isAlly(o.player, p),
      isEnemy: (p) => o.world.isEnemy(o.player, p),
      send: (text) => this.sendChat(text),
      click,
    });
    this.diplomacy = new DiplomacyDialog({
      parent: this.root,
      provider: o.provider,
      world: o.world,
      player: o.player,
      names: o.game.names,
      out: (p) => o.game.dropped(p) || o.world.playerStatus(p) === STATUS_LOST,
      gameOver: () => this.gameOver.over,
      civ: (p) => civilizationName(o.provider, o.world.civs[p]!),
      issue: o.issue,
      click,
    });
    window.addEventListener('keydown', this.onKey);
    this.menu = new MenuDialog(this.root, o.provider, {
      playing: () => o.world.playerStatus(o.player) === 0 && !this.quit,
      quit: () => {
        o.game.disconnect();
        this.showAchievements(true);
      },
      resign: () => {
        this.quit = true;
        o.game.resign();
      },
      achievements: () => this.showAchievements(false),
      settings: () => this.options?.show(),
      click,
    });
    // The top strip's buttons click like the grid's (`RGE_Panel_Tool_Box` gets `get_sound(1)`, src/scr_game.cpp:466);
    // Diplomacy opens the Diplomacy dialog (`command_diplomacy`, src/scr_game.cpp:3855; no hotkey), Menu the menu.
    this.menus.forEach((el, i) =>
      el.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        click();
        if (i === 0) this.commandChat(false);
        if (i === 1) this.diplomacy.show();
        if (i === 2) this.menu.show();
      }),
    );
    // `button_panel[16]`: the score button, a text button in the dialogs' bevel.
    this.scoreButton = easyButton(this.bottom, lookOf(o.provider, GAME_DIALOG_INFO), { x: 0, y: 0, w: 30, h: 30 }, o.provider.string(SCORE_BUTTON) ?? '', FONT.standard, () => this.scores.toggle(), click);
    this.scoreButton.classList.add('hud-score-button');
    this.scoreButton.dataset.testid = 'score-button';
    this.minimapView = o.map ? new Minimap({ parent: this.minimap, world: o.world, provider: o.provider, player: o.player, ...o.map }) : null;
    topButtonLabels(o.provider).forEach((label, i) => (this.menus[i]!.textContent = label));
    this.root.classList.toggle('art', o.provider.interfaceFrame(SLP.screen[1024], 0) !== null);
    this.applyLayout();
    window.addEventListener('resize', this.onResize);
    this.tick = () => this.update();
    o.app.ticker.add(this.tick);
    this.update();
    void applyCursors(o.parent, o.provider).catch(() => undefined);
  }

  destroy(): void {
    this.o.app.ticker.remove(this.tick);
    this.menu.close();
    this.chatEntry.close();
    this.diplomacy.close();
    window.removeEventListener('keydown', this.onKey);
    this.chat.destroy();
    this.scores.destroy();
    window.removeEventListener('resize', this.onResize);
    this.bar.destroy();
    this.commands.destroy();
    this.minimapView?.destroy();
    clearCursors(this.o.parent);
    this.root.remove();
  }

  /** Picks the art for the window size and puts every panel where the original has it. */
  private applyLayout(): void {
    const l = hudLayout(window.innerWidth, window.innerHeight);
    if (l === this.layout) return;
    this.layout = l;
    const { provider } = this.o;
    const screen = SLP.screen[l.width];
    const topArt = provider.interfaceFrame(screen, 0);
    const bottomArt = provider.interfaceFrame(screen, 1);

    this.top.style.height = `${TOP_HEIGHT}px`;
    this.topFrame.style.width = `${l.width}px`;
    paintFrame(this.topFrame, topArt);
    // In a window wider than the art the strip carries on sideways with a plain stretch of it (between the icons and the
    // buttons); a background cannot repeat a part of an atlas, so that part is cut out.
    this.top.style.backgroundImage = '';
    if (topArt) {
      const plain = { ...topArt, x: topArt.x + STRIP_TILE.x, w: STRIP_TILE.w };
      void frameDataUrl(plain).then((url) => this.layout === l && (this.top.style.backgroundImage = `url(${url})`));
    }
    this.bar.place(l.resourceX);
    place(this.age, l.age);
    l.topButtons.forEach((r, i) => {
      const el = this.menus[i]!;
      place(el, r);
      paintFrame(el, provider.interfaceFrame(i === 1 ? SLP.wideMenuButton : SLP.menuButton, 0));
    });

    this.bottom.style.width = `${l.width}px`;
    this.bottom.style.height = `${BOTTOM_HEIGHT}px`;
    paintFrame(this.bottom, bottomArt);
    place(this.object, l.object);
    l.buttons.forEach((r, i) => place(this.slots[i]!, r));
    place(this.minimap, l.minimap);
    place(this.scoreButton, l.scoreButton);
    this.shown = null;
    this.update();
  }

  /**
   * `command_quick_chat` (Enter) and `command_chat` (the Chat button; a multiplayer game opens the Send Messages
   * dialog): refused with "You cannot chat after you have resigned or been defeated." while this player is out of a
   * game still on (src/scr_game.cpp:3797-3820).
   */
  commandChat(quick: boolean): void {
    if (this.gameOver.over && !this.o.world.gameOver) {
      this.say(STRING_CHAT.afterDefeat);
      return;
    }
    if (quick) this.chatEntry.quick();
    else this.chatEntry.full();
  }

  /**
   * `SendGroupChatMsg` (src/com_hand.cpp:1905-1990): nothing in the game over mode; else to every other player in the
   * chat group still in the game, and on this screen too when this player is in it.
   */
  private sendChat(text: string): void {
    const { player, game } = this.o;
    if (this.gameOver.over) return;
    if (this.chatGroup.has(player)) this.receiveChat(player, text);
    const to = [...this.chatGroup].filter((p) => p !== player && !game.dropped(p));
    if (to.length > 0) game.sendChat(text, to);
  }

  /** A chat message from player `from` (this one's own included): "Name: text" on the chat lines with sound 2 (`AddChatMsg`, `handleChatReceived`). */
  receiveChat(from: number, text: string): void {
    this.o.sounds?.message(SOUND_CHAT);
    this.chat.show(`${this.o.game.names[from] ?? ''}: ${text}`);
  }

  /**
   * The commands about to run on a turn: another player's stance towards this one and its tribute to this one on the
   * chat lines (`display_system_message`), a tribute with tribute.wav (diplomacy.md §7).
   */
  commandsDue(batches: readonly DueBatch[]): void {
    const { world, player, provider, game } = this.o;
    for (const n of diplomacyNotices(world, player, batches, provider, game.names)) {
      if (n.tribute) this.o.sounds?.message(SOUND_TRIBUTE);
      this.chat.show(n.text);
    }
  }

  /** "Problem communicating with %s...": a turn is late (com_hand.cpp `COMM_PLAYER_NOT_RESPONDING`); names who is playing. */
  notResponding(): void {
    const { world, player, provider } = this.o;
    for (let p = 1; p < world.players; p++) {
      if (p === player || world.playerStatus(p) !== 0) continue;
      this.o.sounds?.message(SOUND_CHAT);
      this.chat.show(formatName(provider, MESSAGE_NOT_RESPONDING, this.o.game.names[p] ?? ''));
    }
  }

  /**
   * The relay found the two games' hashes different (`COMM_SYNC_ERROR`, tribegam.cpp `case 0x17b0`): sound 2 and the
   * system message, in the game screen. The turn loop has stopped, as the original's does; Menu still works.
   */
  outOfSync(): void {
    this.o.sounds?.message(SOUND_CHAT);
    this.chat.show('Out of sync detected by comm...');
  }

  /**
   * This player was dropped from the game (`STRING_ID_PLAYER_DROPPED_NOTICE`): the game is over for it, OK goes to the
   * end of the game's achievements.
   */
  droppedSelf(): void {
    if (this.quit) return;
    this.quit = true;
    this.menu.close();
    okPopup(this.root, this.o.provider, this.o.provider.string(DROPPED_NOTICE) ?? '', () => this.showAchievements(true), () => this.o.sounds?.button());
  }

  /** `TribeAchievementsScreen`: at the end of the game (`do_game_over`), Close leaves; else back to the game. */
  showAchievements(end: boolean): void {
    if (this.achievements) return;
    this.achievements = new AchievementsScreen({
      parent: this.root,
      provider: this.o.provider,
      world: this.o.world,
      player: this.o.player,
      names: this.o.game.names,
      end,
      click: () => this.o.sounds?.button(),
      onClose: () => {
        this.achievements = null;
        if (end) this.o.game.leave();
      },
    });
  }

  /** `show_message` of language string `id` on the message line (nothing when the pack has no such string). */
  say(id: number): void {
    const text = this.o.provider.string(id);
    if (text) this.commands.say(text);
  }

  /**
   * The rollover text of the object under the pointer (`get_mouse_pointer_action_vars`' `text_id` on the view's message
   * panel), or null to take it away. A button's message replaces it while the pointer is on the grid.
   */
  rollover(text: string | null): void {
    const m = this.message;
    if (m.dataset.hover) return;
    if (text) {
      m.textContent = text;
      m.hidden = false;
      m.dataset.rollover = 'true';
    } else if (m.dataset.rollover) {
      delete m.dataset.rollover;
      m.hidden = true;
    }
  }

  /**
   * Shows the player's `selected_obj` in the object panel, as `TRIBE_Panel_Object::draw` does (one object, however
   * many are selected: scr_game.cpp:1183), its commands and the selection's in the button grid, and the age.
   */
  private update(): void {
    const { world, selection, player } = this.o;
    this.gameOver.update();
    this.held.update();
    this.scores.update();
    this.minimapView?.update();
    this.age.textContent = ageName(this.o.provider, world.attributes[player]![ATTR_CURRENT_AGE]!);
    const primary = selection.primary;
    const entity = primary === null ? undefined : world.entities.get(primary);
    const selected = [...selection.selected].flatMap((id) => world.entities.get(id) ?? []);
    this.commands.update(entity, selected, entity ? selection.isGrouped(entity.id) : false);
    // The object's own master: its owner's copy, which ages and techs change (hit points, attack, name and icon).
    const type = entity && typeOf(world, entity);
    const rows = entity ? this.rows(entity) : [];
    const facet = type?.building?.facet ?? 0;
    const key = entity
      ? `${entity.id}:${entity.type}:${entity.owner}:${Math.floor(entity.hp)}:${type!.hitPoints}:${type!.name}:${facet}:${JSON.stringify(rows)}`
      : '';
    if (key === this.shown) return;
    this.shown = key;
    this.object.hidden = !entity;
    if (!entity || !type) return;
    const { provider } = this.o;
    // Gaia's objects have no owner line; a player's shows the civilization (the scenario's player name in a campaign).
    this.objectCiv.textContent = entity.owner !== 0 ? civilizationName(provider, world.civs[entity.owner]!) : '';
    this.objectName.textContent = objectName(provider, entity.type, type);
    const info = infoOf(provider, type);
    const building = type.masterType >= BUILDING;
    // A building's picture is its master's `button_pict + building_facet` (tpnl_obj.cpp:180-185): the age's.
    const icon: ImageFrame | null =
      info && info.icon >= 0
        ? provider.interfaceFrame(building ? SLP.buildingIcons + CULTURE : SLP.unitIcons, info.icon + (building ? facet : 0), entity.owner)
        : null;
    paintFrame(this.objectIcon, icon);
    const hp = Math.max(0, Math.floor(entity.hp));
    const showHp = entity.hp > 0 && type.hitPoints > 0;
    this.objectHp.textContent = showHp ? `${hp}/${type.hitPoints}` : '';
    const frame = Math.min(HEALTH_FRAMES - 1, Math.max(0, Math.trunc(HEALTH_FRAMES - (HEALTH_FRAMES * entity.hp) / type.hitPoints)));
    this.objectHealth.hidden = !showHp;
    paintFrame(this.objectHealth, showHp ? provider.interfaceFrame(SLP.health, frame) : null);
    // Rows of the same kind are updated in place, so a reader holding one never sees a detached element.
    for (const r of this.rowEls.splice(rows.length)) {
      r.icon.remove();
      r.text.remove();
    }
    rows.forEach((r, i) => {
      let el = this.rowEls[i];
      if (el && el.kind !== r.kind) {
        el.icon.remove();
        el.text.remove();
        el = undefined;
      }
      if (!el) {
        el = {
          kind: r.kind,
          icon: box(this.object, 'hud-object-row-icon', `object-${r.kind}-icon`),
          text: box(this.object, 'hud-object-row', `object-${r.kind}`),
        };
        this.rowEls[i] = el;
      }
      el.icon.style.top = `${30 + i * ROW_HEIGHT}px`;
      el.text.style.top = `${33 + i * ROW_HEIGHT}px`;
      paintFrame(el.icon, provider.interfaceFrame(SLP.itemIcons, r.icon));
      el.text.textContent = r.text;
    });
  }

  /**
   * The object panel's rows: the stats, then the own building's progress or population row as `item`, or what an own
   * unit carries, or what a resource object holds, as `held`.
   */
  private rows(e: Entity): PanelRow[] {
    const item = this.itemRow(e);
    const { world, player } = this.o;
    const busy = e.state === ObjectState.Unbuilt || (e.owner === player && (researchStatus(world, e) ?? trainingStatus(world, e)) !== null);
    const rows: PanelRow[] = statRows(this.o.provider, typeOf(world, e), busy);
    if (item) rows.push({ kind: 'item', ...item });
    const held = this.heldRow(e);
    if (held) rows.push({ kind: 'held', ...held });
    return rows;
  }

  /**
   * The held resource row (tpnl_obj.cpp:364-424): a resource object's (level 1) amount, whoever owns it; an own
   * villager's, soldier's or priest's load once it rounds to 1 or more. The value is `(int)(amount + 0.5)`.
   */
  private heldRow(e: Entity): { icon: number; text: string } | null {
    const level = this.o.provider.unitInfo(e.type)?.level;
    const icon = ITEM_HELD[e.heldType];
    if (level === undefined || icon === undefined) return null;
    const amount = Math.trunc(Math.fround(e.heldAmount + 0.5));
    if (level === LEVEL_RESOURCE) return { icon, text: String(amount) };
    if (!CARRIER_LEVELS.has(level) || e.owner !== this.o.player || amount < 1) return null;
    return { icon, text: String(amount) };
  }

  /**
   * The first row of the object panel for an own building (tpnl_obj.cpp:430-480): construction, research or training
   * progress in percent, for a House the population over the room the houses give (capped by the population limit), or
   * for a Farm the food it has left: its make action's timer plus what it holds, `(int)(timer + held + 0.5)`.
   */
  private itemRow(e: Entity): { icon: number; text: string } | null {
    const { world } = this.o;
    if (e.owner !== this.o.player || typeOf(world, e).masterType < BUILDING) return null;
    if (e.state === ObjectState.Unbuilt) return { icon: ITEM_PROGRESS, text: `${constructionProgress(world, e)}%` };
    // `work_status`: the building's action, a research or the unit in training, else the queue's first unit.
    const work = researchStatus(world, e) ?? trainingStatus(world, e);
    if (work) return { icon: ITEM_PROGRESS, text: `${work.progress}%` };
    if (e.type === FARM) {
      if (!e.make) return null;
      return { icon: ITEM_HELD[ATTR_FOOD]!, text: String(Math.trunc(Math.fround(Math.fround(e.make.timer + e.heldAmount) + 0.5))) };
    }
    if (e.type !== HOUSE) return null;
    const a = this.o.world.attributes[this.o.player]!;
    const population = Math.trunc(a[ATTR_POPULATION]!);
    const room = Math.min(Math.trunc(a[ATTR_HEADROOM]! + a[ATTR_POPULATION]!), Math.trunc(a[ATTR_POPULATION_LIMIT]!));
    return { icon: ITEM_POPULATION, text: `${population}/${room}` };
  }
}
