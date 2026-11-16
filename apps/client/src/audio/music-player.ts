// The music (`TMusic_System`, src/music.cpp; docs/spec/sounds.md §7) as the original plays it from MIDI files: a list of
// tracks `music<start>.mid` to `music<end>.mid` in order, or one named file, looped or not; the next track starts when
// one ends (`after_end_track`). The MIDI is synthesized with the pack's General MIDI sound bank in an AudioWorklet
// (spessasynth), through the sound player's context and the music volume's gain.
import processorUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url';
import type { Sequencer, WorkletSynthesizer } from 'spessasynth_lib';
import type { MusicTable } from '../assets';
import { Meter, VOLUME_STOPS, volumeGain, type SoundPlayer } from './sound-player';

const STORAGE_KEY = 'aoe1web.musicVolume';
/** `setup_music_system`'s volume without a saved one: -5000, the slider's middle (src/basegame.cpp:1780). */
const DEFAULT_POSITION = 50;

/** What is to play: `start_track`..`end_track`, or `file_name` (then the tracks are 0), and `loop`. */
interface Request {
  start: number;
  end: number;
  file: string | null;
  loop: boolean;
}

interface Engine {
  synth: WorkletSynthesizer;
  seq: Sequencer;
}

export class MusicPlayer {
  private table: MusicTable | null = null;
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private meter: Meter | null = null;
  private engine: Promise<Engine | null> | null = null;
  private request: Request | null = null;
  /** `current_track`. */
  private current = 0;
  /** Bumped by every play and stop, so a song still loading for an older one is dropped. */
  private generation = 0;
  private position: number;
  /** `prog_info->use_music`: off when the volume was saved at the bottom ("Off") stop. */
  private enabled: boolean;
  /** The file playing now (`music3.mid`, `won.mid`), for the test hook; null when stopped. */
  playing: string | null = null;

  constructor(audio: SoundPlayer) {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
    const position = Number(stored);
    this.position = stored !== null && Number.isInteger(position) && position >= 0 && position <= VOLUME_STOPS ? position : DEFAULT_POSITION;
    this.enabled = this.position < VOLUME_STOPS;
    audio.onStart((context) => {
      this.context = context;
      this.gain = context.createGain();
      this.gain.gain.value = volumeGain(this.position);
      this.gain.connect(context.destination);
      this.meter = new Meter(context, this.gain);
      if (this.request) this.play();
    });
  }

  /** The pack's music; null when it has none (nothing plays). */
  setTable(table: MusicTable | null): void {
    this.table = table;
    if (this.request) this.play();
  }

  /** How many `music<n>.mid` tracks the pack has (`track_count`). */
  get tracks(): number {
    return this.table?.tracks ?? 0;
  }

  /** Is the music on (`use_music`)? */
  get on(): boolean {
    return this.enabled;
  }

  /** The music volume slider's position: 0 "High" .. `VOLUME_STOPS` "Off"; it changes the volume at once. */
  get volume(): number {
    return this.position;
  }

  set volume(position: number) {
    this.position = Math.min(VOLUME_STOPS, Math.max(0, Math.round(position)));
    globalThis.localStorage?.setItem(STORAGE_KEY, String(this.position));
    if (this.gain && this.enabled) this.gain.gain.value = volumeGain(this.position);
  }

  /**
   * The dialog's OK with the volume moved (src/dlg_conf.cpp:477-496): at the bottom stop the music is shut down; from
   * off, it starts again with every track looped.
   */
  applyVolume(): void {
    if (this.position >= VOLUME_STOPS) {
      if (!this.enabled) return;
      this.stop();
      this.enabled = false;
    } else if (!this.enabled) {
      this.enabled = true;
      if (this.gain) this.gain.gain.value = volumeGain(this.position);
      this.playTracks(1, this.tracks, true);
    }
  }

  /** `play_tracks(start, end, loop)`: the tracks from `start` to `end` (clamped to the ones there are) in order. */
  playTracks(start: number, end: number, loop: boolean): void {
    const count = this.tracks;
    if (!this.enabled || count === 0) return;
    const first = Math.min(start, count);
    this.request = { start: first, end: Math.min(Math.max(end, first), count), file: null, loop };
    this.current = first;
    this.play();
  }

  /** `play_file(name, loop)`: one file of `sound/` (`won.mid`). */
  playFile(name: string, loop: boolean): void {
    if (!this.enabled || !this.table) return;
    this.request = { start: 0, end: 0, file: name, loop };
    this.play();
  }

  /** `stop_track`. */
  stop(): void {
    this.request = null;
    this.playing = null;
    this.generation++;
    void this.engine?.then((engine) => {
      engine?.seq.pause();
      engine?.synth.stopAll(true);
    });
  }

  /** Once a frame: samples the output for `level`. */
  sample(): void {
    this.meter?.sample();
  }

  /** The peak level of the music put out since the last call (0 silent, 1 full scale). */
  level(): number {
    return this.meter?.take() ?? 0;
  }

  /** `after_end_track` for MIDI: the next track of the list, else the list or the file again when looping. */
  private ended(): void {
    const r = this.request;
    if (!r) return;
    if (r.file === null && this.current < r.end) {
      this.current++;
      this.play();
    } else if (r.loop) {
      if (r.file === null) this.current = r.start;
      this.play();
    } else {
      this.request = null;
      this.playing = null;
    }
  }

  /** Starts the request's file or current track from its beginning, once the context and the synthesizer are up. */
  private play(): void {
    const r = this.request!;
    const name = r.file ?? `music${this.current}.mid`;
    this.playing = name;
    const generation = ++this.generation;
    const url = this.table?.url(name) ?? null;
    if (!url || !this.context) return;
    void this.ready().then(async (engine) => {
      if (!engine || generation !== this.generation) return;
      const binary = await fetch(url).then((res) => (res.ok ? res.arrayBuffer() : null));
      if (!binary || generation !== this.generation) return;
      engine.seq.loadNewSongList([{ binary, fileName: name }]);
      engine.seq.play();
    });
  }

  /** The synthesizer with the pack's sound bank and its sequencer, made once. */
  private ready(): Promise<Engine | null> {
    const context = this.context!;
    const bankUrl = this.table!.bankUrl;
    return (this.engine ??= (async () => {
      const { Sequencer, WorkletSynthesizer } = await import('spessasynth_lib');
      await context.audioWorklet.addModule(processorUrl);
      const synth = new WorkletSynthesizer(context);
      synth.connect(this.gain!);
      const bank = await fetch(bankUrl).then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(`${bankUrl}: ${res.status}`))));
      await synth.soundBankManager.addSoundBank(bank, 'gm');
      await synth.isReady;
      const seq = new Sequencer(synth);
      seq.loopCount = 0;
      seq.eventHandler.addEvent('songEnded', 'music', () => this.ended());
      return { synth, seq };
    })().catch((error: unknown) => {
      console.warn('music:', error);
      return null;
    }));
  }
}
