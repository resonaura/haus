/** Interpolate media samples on rAF, without letting a stalled decoder run ahead. */
export class FilmstripClock {
  private id: string | undefined;
  private at = 0;
  private observedAt = 0;
  private observed = 0;
  private seconds = 0;
  private advancing = false;
  private rate = 1;

  sample(input: {
    id?: string;
    now: number;
    seconds: number;
    duration: number;
    advancing: boolean;
    seeking?: boolean;
    rate?: number;
  }) {
    const rate = Math.max(0, input.rate ?? 1);
    const observed = Number.isFinite(input.seconds) ? Math.max(0, input.seconds) : 0;
    const delta = Math.max(0, Math.min(64, input.now - this.at));
    const projected = this.seconds + (delta * rate) / 1000;
    if (
      input.id !== this.id ||
      !input.advancing ||
      !this.advancing ||
      input.seeking ||
      rate !== this.rate ||
      Math.abs(observed - projected) > Math.max(0.35, rate * 0.3)
    ) {
      this.seconds = observed;
      this.observedAt = input.now;
    } else {
      if (observed !== this.observed) this.observedAt = input.now;
      // currentTime can be delivered at video-frame cadence. Predict between
      // those samples and correct phase gradually, rather than easing each tick.
      // Waiting/seeking/paused media never enters this path. A missing waiting
      // event still cannot advance the strip more than 200ms beyond the decoder.
      const ceiling = observed + rate * 0.2;
      const target = observed + (Math.min(200, input.now - this.observedAt) * rate) / 1000;
      this.seconds = Math.max(
        this.seconds,
        Math.min(ceiling, projected + (target - projected) * (1 - Math.exp(-delta / 140))),
      );
    }
    this.id = input.id;
    this.at = input.now;
    this.observed = observed;
    this.advancing = input.advancing;
    this.rate = rate;
    if (Number.isFinite(input.duration) && input.duration > 0)
      this.seconds = Math.min(this.seconds, input.duration);
    return this.seconds;
  }
}
