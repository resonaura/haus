/** Decoded-frame progress, rather than readyState/playing, establishes live health. */
export class LiveProgress {
  private frameAt = 0;
  private observedTime = -1;
  private repaired = false;
  reset(now: number) {
    this.frameAt = now;
    this.observedTime = -1;
    this.repaired = false;
  }
  frame(mediaTime: number, now: number) {
    if (!Number.isFinite(mediaTime) || mediaTime === this.observedTime) return;
    this.observedTime = mediaTime;
    this.frameAt = now;
    this.repaired = false;
  }
  check(now: number, visible = true): 'wait' | 'repair' | 'restart' {
    if (!visible) {
      this.reset(now);
      return 'wait';
    }
    const age = now - this.frameAt;
    if (age >= 10000) {
      this.reset(now);
      return 'restart';
    }
    if (age >= 4000 && !this.repaired) {
      this.repaired = true;
      return 'repair';
    }
    return 'wait';
  }
}
