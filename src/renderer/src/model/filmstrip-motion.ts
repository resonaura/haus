/** The media clock owns follow mode; native scrolling owns a gesture without easing. */
export class FilmstripMotion {
  left = 0;
  private initialized = false;
  private gestureUntil = 0;
  private pinned = false;
  private finalSeek = false;
  private seekAt = -Infinity;
  private seekLeft = NaN;
  private inputAt = -Infinity;
  private fastUntil = 0;
  gesture(now: number, left: number) {
    if (Math.abs(left - this.left) > 1.4 * Math.max(8, Math.min(80, now - this.inputAt)))
      this.fastUntil = now + 120;
    if (left !== this.left) this.inputAt = now;
    this.left = left;
    this.initialized = true;
    this.gestureUntil = now + 180;
    this.pinned = true;
    this.finalSeek = true;
  }
  follow() {
    this.pinned = false;
    this.finalSeek = false;
    this.gestureUntil = 0;
    this.fastUntil = 0;
  }
  interacting(now: number) {
    return now < this.gestureUntil;
  }
  shift(delta: number) {
    this.left += delta;
    this.seekLeft += delta;
  }
  step(input: {
    now: number;
    delta: number;
    target: number;
    nativeLeft: number;
    dragging: boolean;
    playing: boolean;
    reduced: boolean;
    live: boolean;
    width: number;
  }) {
    const manual = input.dragging || input.now < this.gestureUntil;
    let seek = false,
      settled = false;
    if (manual) {
      this.left = input.nativeLeft;
      if (
        input.now >= this.fastUntil &&
        input.now - this.seekAt >= 110 &&
        (!Number.isFinite(this.seekLeft) || Math.abs(this.left - this.seekLeft) >= 0.5)
      ) {
        seek = true;
        this.seekAt = input.now;
        this.seekLeft = this.left;
      }
    } else if (this.finalSeek) {
      this.left = input.nativeLeft;
      this.finalSeek = false;
      seek = settled = true;
    } else {
      if (input.playing) this.pinned = false;
      if (!this.pinned) {
        const distance = input.target - this.left;
        this.left =
          !this.initialized ||
          input.reduced ||
          input.live ||
          Math.abs(distance) < 0.01 ||
          Math.abs(distance) > input.width * 1.5
            ? input.target
            : this.left + distance * (1 - Math.exp(-input.delta / 40));
        if (Math.abs(input.target - this.left) < 0.01) this.left = input.target;
      }
    }
    this.initialized = true;
    return {
      left: this.left,
      manual: manual || this.pinned,
      seek,
      settled,
      animating: manual || (!this.pinned && Math.abs(input.target - this.left) >= 0.01),
    };
  }
}

/** Capture once before preview seeks pause the media element. */
export class FilmstripPlayback {
  private resume: boolean | undefined;
  begin(playing: boolean) {
    this.resume ??= playing;
  }
  finish() {
    const playing = this.resume ?? false;
    this.resume = undefined;
    return playing;
  }
}

/** Keep a buffered raster stationary while the compositor carries playback motion. */
export class FilmstripRaster {
  private previousPixel = Number.NaN;

  constructor(private buffer = 0) {}

  sample(left: number) {
    const pixel =
      this.buffer && Math.abs(left - this.previousPixel) < this.buffer
        ? this.previousPixel
        : Math.floor(left);
    const shouldPaint = pixel !== this.previousPixel;
    this.previousPixel = pixel;
    return { pixel, fraction: left - pixel, shouldPaint };
  }
}
