/** Samples kept: `FrameTSLC` is a 100-slot ring, `GetAvgFrameRate` averages the last 50 (docs/spec/turn-timing.md §3.2). */
const SAMPLES = 50;

/** Mean wall time per drawn frame over the last 50 frames, as the original reports it to the host. */
export class FrameClock {
  private readonly samples: number[] = [];
  /** Debug: when above 0, the mean reported instead of the measured one (fakes a slow machine). */
  forcedMs = 0;

  sample(ms: number): void {
    this.samples.push(ms);
    if (this.samples.length > SAMPLES) this.samples.shift();
  }

  /** Integer mean in ms; 0 before the first frame. */
  average(): number {
    if (this.forcedMs > 0) return this.forcedMs;
    if (this.samples.length === 0) return 0;
    return Math.trunc(this.samples.reduce((a, b) => a + b, 0) / this.samples.length);
  }
}
