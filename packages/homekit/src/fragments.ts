/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

/** Parse complete ISO BMFF initialization/fragment units, never splitting an mdat. */
export class HomeKitFragments {
  onPacket: (data: Buffer, initialization: boolean) => void;
  limit: number;
  buffer: Buffer = Buffer.alloc(0);
  pending: Buffer[] = [];
  bytes = 0;
  initialized = false;
  constructor(onPacket: (data: Buffer, initialization: boolean) => void, limit = 8 * 1024 ** 2) {
    this.onPacket = onPacket;
    this.limit = limit;
    this.buffer = Buffer.alloc(0);
    this.pending = [];
    this.bytes = 0;
    this.initialized = false;
  }
  push(chunk: Buffer) {
    if (this.buffer.length + chunk.length + this.bytes > this.limit)
      throw Error('homekit_fragment_too_large');
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 8) {
      let size = this.buffer.readUInt32BE(0),
        header = 8;
      if (size === 1) {
        if (this.buffer.length < 16) return;
        const wide = this.buffer.readBigUInt64BE(8);
        if (wide > BigInt(this.limit)) throw Error('homekit_fragment_too_large');
        size = Number(wide);
        header = 16;
      }
      if (size < header || size > this.limit) throw Error('invalid_homekit_fragment');
      if (this.buffer.length < size) return;
      const atom = this.buffer.subarray(0, size);
      const type = atom.toString('ascii', 4, 8);
      this.buffer = this.buffer.subarray(size);
      // Do not retain subarrays into a growing stream allocation.
      this.pending.push(Buffer.from(atom));
      this.bytes += size;
      if ((!this.initialized && type === 'moov') || (this.initialized && type === 'mdat')) {
        const initialization = !this.initialized;
        if (!initialization && !this.pending.some((box) => box.toString('ascii', 4, 8) === 'moof'))
          throw Error('invalid_homekit_fragment');
        this.onPacket(Buffer.concat(this.pending), initialization);
        this.pending = [];
        this.bytes = 0;
        this.initialized = true;
      }
    }
  }
}
