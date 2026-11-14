/**
 * The Visual C++ runtime `rand()`/`srand()` that every simulation draw goes through
 * (docs/spec/core.md §4.1): one 32-bit state word, LCG 214013 / 2531011, 15-bit output.
 */
export class CrtRand {
  private state = 1;

  srand(seed: number): void {
    this.state = seed >>> 0;
  }

  /** 0..32767 */
  rand(): number {
    this.state = (Math.imul(this.state, 214013) + 2531011) >>> 0;
    return (this.state >>> 16) & 0x7fff;
  }
}
