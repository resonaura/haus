/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

/** Stream-copy FFmpeg releases may omit frame=; output timestamps still advance. */
export class RecordingProgress {
  constructor() {
    this.partial = "";
    this.frames = 0;
    this.timeUs = 0;
  }
  push(chunk) {
    const lines = (this.partial + chunk.toString()).slice(-8192).split("\n");
    this.partial = lines.pop() ?? "";
    let advanced = false;
    for (const line of lines) {
      const match = /^(frame|out_time_us)=\s*(\d+)\s*$/.exec(line);
      if (!match) continue;
      const value = Number(match[2]);
      if (!Number.isSafeInteger(value) || value <= 0) continue;
      const field = match[1] === "frame" ? "frames" : "timeUs";
      if (value > this[field]) {
        this[field] = value;
        advanced = true;
      }
    }
    return advanced;
  }
  get sustained() {
    return this.frames >= 120 || this.timeUs >= 6000000;
  }
}
