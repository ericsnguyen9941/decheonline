// Plays the pack's wavs through Web Audio as DirectSound played them for the original (docs/spec/sounds.md "Playback"):
// one buffer per wav, so playing a wav again restarts it; no panning or distance, every sound at full level under the
// player's sound volume. Browsers start audio only after a user gesture: the context is made on the first click or key.
// The music (`MusicPlayer`) plays through the same context.

/** The original's sound volume slider (`TRIBE_Dialog_Config`, src/dlg_conf.cpp:131): 0 at "High" (top), 99 at "Off". */
export const VOLUME_STOPS = 99;
const STORAGE_KEY = 'aoe1web.soundVolume';

/**
 * Gain of slider position `position`: the mixer gets `(volume + 10000) / 10000` of its range for `volume = -100 *
 * position` (`TSound_Driver::set_volume`, src/Sounddrv.cpp:170-186), so 1 - position / 100. The bottom stop, labelled
 * "Off", is silent here (the original's mixer kept 1%).
 */
export function volumeGain(position: number): number {
  return position >= VOLUME_STOPS ? 0 : 1 - position / 100;
}

/** The peak level a node puts out, sampled once a frame: what the test hook reads to tell that audio is heard. */
export class Meter {
  private readonly analyser: AnalyserNode;
  private readonly data: Float32Array<ArrayBuffer>;
  private peak = 0;

  constructor(context: AudioContext, source: AudioNode) {
    this.analyser = context.createAnalyser();
    this.analyser.fftSize = 2048;
    this.data = new Float32Array(this.analyser.fftSize);
    source.connect(this.analyser);
  }

  /** Reads the last `fftSize` samples (about 40 ms, more than a frame) into the peak. */
  sample(): void {
    this.analyser.getFloatTimeDomainData(this.data);
    for (const v of this.data) this.peak = Math.max(this.peak, Math.abs(v));
  }

  /** The peak since the last call. */
  take(): number {
    const peak = this.peak;
    this.peak = 0;
    return peak;
  }
}

export class SoundPlayer {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private meter: Meter | null = null;
  private readonly started: ((context: AudioContext) => void)[] = [];
  /** The one streamed sound (`TSound_Driver::stream_file`: the terrain sounds): its url and source. */
  private stream: { url: string; source: AudioBufferSourceNode | null } | null = null;
  private readonly buffers = new Map<string, Promise<AudioBuffer | null>>();
  /** What each wav is playing now: playing it again stops this first. */
  private readonly playing = new Map<string, AudioBufferSourceNode>();
  private readonly cleanup: (() => void)[] = [];
  private position: number;

  constructor() {
    const stored = Number(globalThis.localStorage?.getItem(STORAGE_KEY));
    this.position = Number.isInteger(stored) && stored >= 0 && stored <= VOLUME_STOPS ? stored : 0;
    this.create();
    const unlock = () => this.unlock();
    for (const type of ['pointerdown', 'keydown'] as const) {
      window.addEventListener(type, unlock, { capture: true });
      this.cleanup.push(() => window.removeEventListener(type, unlock, { capture: true }));
    }
  }

  /** Runs `fn` with the audio context once it exists (at once if it does). */
  onStart(fn: (context: AudioContext) => void): void {
    if (this.meter) fn(this.context!);
    else this.started.push(fn);
  }

  /** The sound volume slider's position: 0 loudest, `VOLUME_STOPS` off. */
  get volume(): number {
    return this.position;
  }

  set volume(position: number) {
    this.position = Math.min(VOLUME_STOPS, Math.max(0, Math.round(position)));
    globalThis.localStorage?.setItem(STORAGE_KEY, String(this.position));
    if (this.gain) this.gain.gain.value = volumeGain(this.position);
  }

  /** Is audio running (a gesture has started it)? */
  get running(): boolean {
    return this.context?.state === 'running';
  }

  /**
   * Plays the wav at `url` from its start. `restart` false leaves it alone while it still plays
   * (`RGE_Base_Game::play_sound`, src/basegame.cpp:3894); true stops and restarts it (`TDigital::play`).
   */
  play(url: string, restart = true): void {
    const context = this.context;
    if (!context || context.state !== 'running' || volumeGain(this.position) === 0) return;
    if (!restart && this.playing.has(url)) return;
    void this.buffer(url).then((buffer) => {
      if (!buffer || !this.gain) return;
      this.playing.get(url)?.stop();
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(this.gain);
      source.onended = () => this.playing.get(url) === source && this.playing.delete(url);
      this.playing.set(url, source);
      source.start();
    });
  }

  /**
   * Streams the wav at `url` from its start (`TSound_Driver::stream_file`), stopping the stream before it
   * (`stop_stream`). One stream plays at a time.
   */
  playStream(url: string): void {
    this.stopStream();
    const context = this.context;
    if (!context || context.state !== 'running' || volumeGain(this.position) === 0) return;
    const stream: { url: string; source: AudioBufferSourceNode | null } = { url, source: null };
    this.stream = stream;
    void this.buffer(url).then((buffer) => {
      if (!buffer || !this.gain || this.stream !== stream) return;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(this.gain);
      source.onended = () => this.stream === stream && (this.stream = null);
      stream.source = source;
      source.start();
    });
  }

  /** Is a stream playing (`_bPlaying`)? */
  get streaming(): boolean {
    return this.stream !== null;
  }

  stopStream(): void {
    this.stream?.source?.stop();
    this.stream = null;
  }

  /** Once a frame: samples the output for `level`. */
  sample(): void {
    this.meter?.sample();
  }

  /** The peak level of the sounds put out since the last call (0 silent, 1 full scale). */
  level(): number {
    return this.meter?.take() ?? 0;
  }

  destroy(): void {
    for (const fn of this.cleanup) fn();
    void this.context?.close().catch(() => undefined);
    this.context = null;
  }

  /** The context is made before any gesture (it stays suspended); the click task only resumes it, the rest follows it. */
  private create(): void {
    const Context = globalThis.AudioContext as typeof AudioContext | undefined;
    if (!Context) return;
    this.context = new Context();
  }

  private unlock(): void {
    const context = this.context;
    if (!context) return;
    if (context.state === 'suspended') void context.resume().catch(() => undefined);
    if (this.gain) return;
    this.gain = context.createGain();
    this.gain.gain.value = volumeGain(this.position);
    this.gain.connect(context.destination);
    setTimeout(() => {
      this.meter = new Meter(context, this.gain!);
      for (const fn of this.started.splice(0)) fn(context);
    });
  }

  /** The decoded wav, fetched once; null when it cannot be loaded or decoded. */
  private buffer(url: string): Promise<AudioBuffer | null> {
    let buffer = this.buffers.get(url);
    if (!buffer) {
      const context = this.context!;
      buffer = fetch(url)
        .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(String(res.status)))))
        .then((bytes) => context.decodeAudioData(bytes))
        .catch(() => null);
      this.buffers.set(url, buffer);
    }
    return buffer;
  }
}
