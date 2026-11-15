// Plays the pack's wavs through Web Audio as DirectSound played them for the original (docs/spec/sounds.md "Playback"):
// one buffer per wav, so playing a wav again restarts it; no panning or distance, every sound at full level under the
// player's sound volume. Browsers start audio only after a user gesture: the context is made on the first click or key.

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

export class SoundPlayer {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private readonly buffers = new Map<string, Promise<AudioBuffer | null>>();
  /** What each wav is playing now: playing it again stops this first. */
  private readonly playing = new Map<string, AudioBufferSourceNode>();
  private readonly cleanup: (() => void)[] = [];
  private position: number;

  constructor() {
    const stored = Number(globalThis.localStorage?.getItem(STORAGE_KEY));
    this.position = Number.isInteger(stored) && stored >= 0 && stored <= VOLUME_STOPS ? stored : 0;
    const unlock = () => this.unlock();
    for (const type of ['pointerdown', 'keydown'] as const) {
      window.addEventListener(type, unlock, { capture: true });
      this.cleanup.push(() => window.removeEventListener(type, unlock, { capture: true }));
    }
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

  destroy(): void {
    for (const fn of this.cleanup) fn();
    void this.context?.close().catch(() => undefined);
    this.context = null;
  }

  private unlock(): void {
    if (!this.context) {
      const Context = globalThis.AudioContext as typeof AudioContext | undefined;
      if (!Context) return;
      this.context = new Context();
      this.gain = this.context.createGain();
      this.gain.gain.value = volumeGain(this.position);
      this.gain.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') void this.context.resume().catch(() => undefined);
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
