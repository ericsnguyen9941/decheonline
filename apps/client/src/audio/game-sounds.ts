// The game's sounds (docs/spec/sounds.md): the player's clicks and orders call in here; what the sim does (objects
// made, finished, dying, research done, the under-attack alert) is read off the world's state each step, since the sim
// keeps no event list. Only what the player may know plays: own objects' sounds, and sprite sounds of what is drawn on
// screen outside the fog.
import { GAME_SOUND_IDS } from '@aoe/assets-import/manifest';
import { BUILDER, CANT_DO_NOTIFICATIONS, master, ObjectState, TECH_DONE, TECH_RESEARCHING, typeOf, workTaskType, type Command, type Entity, type World } from '@aoe/sim';
import type { SoundTable } from '../assets';
import { sourceId } from '../hud/records';
import type { SoundPlayer } from './sound-player';
import {
  ATTR_ATTACK_WARNING_SOUND,
  GameSound,
  hasSpriteSounds,
  pickItem,
  pickWav,
  researchSound,
  selectSound,
  spriteSounds,
  tauntNumber,
  TERRAIN_SOUND_CHECK,
  TERRAIN_SOUND_INTERVAL,
  TERRAIN_SOUND_LENGTH,
  terrainSound,
  unitSound,
  UnitSound,
} from './sound-rules';

/** What made a sound. */
export type SoundEvent =
  | 'select'
  | 'move'
  | 'command'
  | 'created'
  | 'built'
  | 'death'
  | 'research'
  | 'attacked'
  | 'farm-died'
  | 'converted'
  | 'button'
  | 'sprite'
  | 'message'
  | 'game-over'
  | 'cant-do'
  | 'taunt'
  | 'terrain';

/** One sound played (or that would have played before audio started), for tests (`window.__game.sounds()`). */
export interface SoundTrigger {
  event: SoundEvent;
  /** Dat sound id; -1 for one of the game's own sounds. */
  sound: number;
  /** `TRIBE_Game::sounds` index of a game sound; -1 for a dat sound. */
  game: number;
  /** The wav resource picked (a taunt's number); null when none was (no such wav in the pack, or the percents ran out). */
  wav: number | null;
  /** The master, graphic or tech it is for; -1 for none. */
  source: number;
  /** A loose `sound/` file played (a terrain sound), lower case. */
  file?: string;
}

/** `OBJECT_GROUP_ARTIFACT`: relics and ruins change hands without a conversion. */
const GROUP_ARTIFACT = 1;

/** Triggers kept for the test hook. */
const LOG_LIMIT = 2000;

export interface GameSoundsOptions {
  world: World;
  /** Sim player number of this client: the original's `curr_player`. */
  player: number;
  /** The pack's sounds; null without a pack (nothing plays). */
  table: SoundTable | null;
  audio: SoundPlayer;
}

export class GameSounds {
  /** Every trigger so far (up to `LOG_LIMIT`, oldest dropped). */
  readonly log: SoundTrigger[] = [];
  /** `object_state` of each object at the last step seen. */
  private readonly states = new Map<number, number>();
  /** Owner of each object at the last step seen. */
  private readonly owners = new Map<number, number>();
  private techs: number[];
  private alert: number;
  private depleted: number;
  private seenStep = -1;
  /** How many of the sim's notifications (`World.log`) were read. */
  private logRead: number;
  /** `TTaunt::Mute`: "!MUTE" typed here. */
  private tauntsMuted = false;
  /** `handle_terrain_sound`'s `last_terrain_sound_time` (null until the first frame), `terrain_playing`, `terrain_sound_start_time`. */
  private terrainCheck: number | null = null;
  private terrainPlaying = false;
  private terrainStart = 0;

  constructor(private readonly o: GameSoundsOptions) {
    const { world, player } = o;
    // What exists when the game starts was made without a sound.
    for (const e of world.entities.all()) {
      this.states.set(e.id, e.state);
      this.owners.set(e.id, e.owner);
    }
    this.techs = [...world.techs[player]!];
    this.alert = world.alertCooldown[player]!;
    this.depleted = world.depleted[player]!;
    this.logRead = world.log.notifications.length;
    this.seenStep = this.stepOf();
  }

  /** The sound volume slider's position (`SoundPlayer.volume`). */
  get volume(): number {
    return this.o.audio.volume;
  }

  set volume(position: number) {
    this.o.audio.volume = position;
  }

  /** Once a frame: after the sim ran a step, plays what changed for the player since the last one. */
  update(): void {
    const step = this.stepOf();
    if (step === this.seenStep) return;
    this.seenStep = step;
    const { world, player } = this.o;
    const alive = new Set<number>();
    for (const e of world.entities.all()) {
      alive.add(e.id);
      const before = this.states.get(e.id);
      this.states.set(e.id, e.state);
      // `GAME_NOTIFY_CONVERSION_SUCCEEDED` (the conversion's, src/tact_cnv.cpp:321, :380): the old owner hears convwarn.wav
      // when another player converted the object. An artifact changing hands is not a conversion.
      const owner = this.owners.get(e.id);
      this.owners.set(e.id, e.owner);
      if (owner === player && e.owner !== player && typeOf(world, e).group !== GROUP_ARTIFACT) this.game('converted', GameSound.Converted, e.id);
      if (e.owner !== player || !e.sprite) continue;
      if (before === undefined) this.unit('created', e, UnitSound.Created);
      else if (before === ObjectState.Unbuilt && e.state === ObjectState.Active) this.unit('built', e, UnitSound.Construction);
      else if (before <= ObjectState.Active && e.state >= ObjectState.Dying) this.unit('death', e, UnitSound.Death);
    }
    for (const id of this.states.keys()) {
      if (alive.has(id)) continue;
      this.states.delete(id);
      this.owners.delete(id);
    }
    const techs = world.techs[player]!;
    techs.forEach((state, tech) => {
      if (this.techs[tech] === TECH_RESEARCHING && state === TECH_DONE) this.game('research', researchSound(tech), tech);
    });
    this.techs = [...techs];
    // `TRIBE_Player::notify` starts the 20 s alert cooldown exactly when it plays the attack warning.
    const alert = world.alertCooldown[player]!;
    if (alert > this.alert) this.dat('attacked', Math.trunc(world.attributes[player]![ATTR_ATTACK_WARNING_SOUND]!), -1);
    this.alert = alert;
    // `GAME_NOTIFY_OBJECT_DEPLETED` for this player: a Farm used up.
    const depleted = world.depleted[player]!;
    if (depleted > this.depleted) this.game('farm-died', GameSound.FarmDied, -1);
    this.depleted = depleted;
    // A refusal the game tells this player of (no room for a unit, cannot repair, a conversion refused, ...): cantdo.wav.
    const notes = world.log.notifications;
    for (let i = this.logRead; i < notes.length; i++) {
      const n = notes[i]!;
      if (CANT_DO_NOTIFICATIONS.has(n.type) && n.args[0] === player) this.game('cant-do', GameSound.CantDo, n.type);
    }
    this.logRead = notes.length;
  }

  /**
   * Once a frame while the game is on (`TRIBE_Screen_Game::handle_terrain_sound`, src/scr_game.cpp:3571): every 20 s
   * the sound of the terrain `drawn` (explored tiles on screen by terrain) has most of streams for at most 6 s.
   * The clock starts at the first call, as the game screen is made.
   */
  terrain(now: number, drawn: () => ReadonlyMap<number, number>): void {
    const { audio, table } = this.o;
    if (this.terrainCheck === null) this.terrainCheck = now;
    if (this.terrainPlaying) {
      if (now - this.terrainCheck < TERRAIN_SOUND_CHECK) return;
      this.terrainCheck = now;
      if (audio.streaming) {
        if (now - this.terrainStart < TERRAIN_SOUND_LENGTH) return;
        audio.stopStream();
      }
      this.terrainPlaying = false;
      return;
    }
    if (now - this.terrainCheck < TERRAIN_SOUND_INTERVAL) return;
    this.terrainCheck = now;
    const sound = table ? terrainSound(table, drawn()) : -1;
    if (sound < 0) return;
    // `RGE_Sound::get_file_name`: one of its files, picked as a wav is.
    const items = table!.sound(sound) ?? [];
    const i = pickItem(items, Math.floor(Math.random() * 0x8000));
    const file = i === null ? undefined : table!.soundFiles(sound)?.[i];
    if (!file) return;
    const url = table!.fileUrl(file);
    this.record({ event: 'terrain', sound, game: -1, wav: url ? items[i!]![0] : null, source: -1, file });
    if (url) audio.playStream(url);
    this.terrainPlaying = true;
    this.terrainStart = now;
  }

  /** The player clicked `e` into the selection (`select_one_object` with play_sound). */
  selected(e: Entity): void {
    const t = this.o.table;
    if (!t) return;
    const unit = sourceId(typeOf(this.o.world, e));
    this.dat('select', selectSound(t, unit, e.owner, this.o.player), unit);
  }

  /**
   * The player gave `command` (`RGE_Player::command_make_*`, `TRIBE_Player::command_make_building`, `command_stop`):
   * the first unit's move sound for a move; for an order on an object the command sound of the master the unit would
   * become for it (`get_command_master`); the builder's command sound for a build; the first object's for a stop.
   */
  command(c: Command): void {
    const { world, player } = this.o;
    const first = (ids: readonly number[]) => (ids.length > 0 ? world.entities.get(ids[0]!) : undefined);
    switch (c.type) {
      case 'move': {
        const e = first(c.units);
        if (e) this.unit('move', e, UnitSound.Move);
        return;
      }
      case 'work':
      case 'attack':
      case 'repair': {
        // A repair plays its command master's sound (`get_command_master`, src/tplayer.cpp:1008): the Repair_Man's.
        const e = first(c.units);
        const target = world.entities.get(c.target);
        if (!e || !target) return;
        const id = workTaskType(world, e, target);
        const t = id === -1 ? typeOf(world, e) : master(world, player, id);
        this.slot('command', sourceId(t), UnitSound.Command);
        return;
      }
      case 'build':
        // `MASTER_OBJECT_BUILDER`'s command sound, whoever is selected (src/tplayer.cpp:874).
        this.slot('command', sourceId(master(world, player, BUILDER)), UnitSound.Command);
        return;
      case 'stop': {
        const e = first(c.objects);
        if (e) this.unit('command', e, UnitSound.Command);
        return;
      }
      case 'stand-ground':
      case 'attack-ground':
      case 'unload':
      case 'trade-attribute':
      case 'formation': {
        // `command_attack_ground`, `command_make_unload`, `command_trade_attribute` and `command_formation` play the first
        // unit's command sound (src/tplayer.cpp:968, :1023, :947; src/player.cpp:1873).
        const e = first(c.units);
        if (e) this.unit('command', e, UnitSound.Command);
        return;
      }
      default:
    }
  }

  /** A game screen button was pressed: button2.wav, from its start. */
  button(): void {
    this.game('button', GameSound.Button, -1, true);
  }

  /** An order mode's click found nothing to order: cantdo.wav. */
  cantDo(): void {
    this.game('cant-do', GameSound.CantDo, -1);
  }

  /** A notification's game sound (`TRIBE_Game::notification`'s `play_sound(index)`). */
  message(index: number): void {
    this.game('message', index, -1);
  }

  /**
   * A chat line shown (`TChat::AddChatMsg`'s `TTaunt::PlayTauntStr`, src/taunt.cpp): this player's own line (`local`)
   * starting "!MUTE" turns taunts off and "!NOMUTE" back on; unless they are off, a line that reads as a number plays
   * that taunt's wav, from its start.
   */
  chatLine(text: string, local: boolean): void {
    if (local && /^!MUTE/i.test(text)) this.tauntsMuted = true;
    if (local && /^!NOMUTE/i.test(text)) this.tauntsMuted = false;
    if (this.tauntsMuted) return;
    const n = tauntNumber(text);
    if (n === 0) return;
    const url = this.o.table?.tauntUrl(n) ?? null;
    this.record({ event: 'taunt', sound: -1, game: -1, wav: url ? n : null, source: n });
    if (url) this.o.audio.play(url);
  }

  /** The end of the game's won.wav or lost.wav (interface wav `id`), from its start. */
  gameOver(id: number): void {
    const url = this.o.table?.wavUrl(id) ?? null;
    this.record({ event: 'game-over', sound: -1, game: -1, wav: url ? id : null, source: -1 });
    if (url) this.o.audio.play(url);
  }

  /** Does graphic `graphic` play sounds as it animates? */
  spriteHasSounds(graphic: number): boolean {
    return this.o.table !== null && hasSpriteSounds(this.o.table, graphic);
  }

  /** A sprite drawn on screen, outside the fog, went from frame `from` to `to` at facet `facet`. */
  sprite(graphic: number, from: number, to: number, facet: number): void {
    if (!this.o.table) return;
    for (const sound of spriteSounds(this.o.table, graphic, from, to, facet)) this.dat('sprite', sound, graphic);
  }

  private stepOf(): number {
    return this.o.world.turn * 0x10000 + this.o.world.turnStep;
  }

  private unit(event: SoundEvent, e: Entity, slot: UnitSound): void {
    this.slot(event, sourceId(typeOf(this.o.world, e)), slot);
  }

  private slot(event: SoundEvent, unit: number, slot: UnitSound): void {
    if (this.o.table) this.dat(event, unitSound(this.o.table, unit, slot), unit);
  }

  /** `RGE_Sound::play`: one of dat sound `sound`'s wavs, from its start. */
  private dat(event: SoundEvent, sound: number, source: number): void {
    const items = sound >= 0 ? this.o.table?.sound(sound) : null;
    if (!items) return;
    const wav = pickWav(items, Math.floor(Math.random() * 0x8000));
    this.record({ event, sound, game: -1, wav, source });
    const url = wav === null ? null : this.o.table!.wavUrl(wav);
    if (url) this.o.audio.play(url);
  }

  /** `RGE_Base_Game::play_sound`: game sound `index`, unless it is still playing (a button restarts its sound). */
  private game(event: SoundEvent, index: number, source: number, restart = false): void {
    const wav = GAME_SOUND_IDS[index] ?? null;
    const url = wav === null ? null : (this.o.table?.wavUrl(wav) ?? null);
    this.record({ event, sound: -1, game: index, wav: url ? wav : null, source });
    if (url) this.o.audio.play(url, restart);
  }

  private record(trigger: SoundTrigger): void {
    this.log.push(trigger);
    if (this.log.length > LOG_LIMIT) this.log.splice(0, this.log.length - LOG_LIMIT);
  }
}
