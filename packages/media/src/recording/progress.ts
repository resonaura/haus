/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

const MAX_BUFFERED_CHARACTERS = 8192;
const SUSTAINED_FRAMES = 120;
const SUSTAINED_MICROSECONDS = 6_000_000;

/** Stream-copy releases may omit frames; advancing output timestamps still prove progress. */
export class RecordingProgress {
  #partial = '';
  #discarding = false;
  #frames = 0;
  #timeUs = 0;

  push(chunk: string | Buffer): boolean {
    const output = chunk.toString();
    let offset = 0;
    let advanced = false;
    while (offset < output.length) {
      const newline = output.indexOf('\n', offset);
      const end = newline === -1 ? output.length : newline;
      if (!this.#discarding) {
        if (this.#partial.length + end - offset > MAX_BUFFERED_CHARACTERS) {
          this.#partial = '';
          this.#discarding = true;
        } else {
          this.#partial += output.slice(offset, end);
        }
      }
      if (newline === -1) break;
      const line = this.#partial;
      const discarded = this.#discarding;
      this.#partial = '';
      this.#discarding = false;
      offset = end + 1;
      if (discarded) continue;
      const match = /^(frame|out_time_us)=\s*(\d+)\s*$/.exec(line);
      if (!match) continue;
      const value = Number(match[2]);
      if (!Number.isSafeInteger(value) || value <= 0) continue;
      if (match[1] === 'frame' && value > this.#frames) {
        this.#frames = value;
        advanced = true;
      } else if (match[1] === 'out_time_us' && value > this.#timeUs) {
        this.#timeUs = value;
        advanced = true;
      }
    }
    return advanced;
  }

  get frames(): number {
    return this.#frames;
  }
  get timeUs(): number {
    return this.#timeUs;
  }
  get bufferedCharacters(): number {
    return this.#partial.length;
  }
  get sustained(): boolean {
    return this.#frames >= SUSTAINED_FRAMES || this.#timeUs >= SUSTAINED_MICROSECONDS;
  }
}
