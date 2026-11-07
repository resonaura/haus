/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
export function rtp(payload: Buffer, sequence: number, timestamp: number, marker = true) {
  const packet = Buffer.alloc(12 + payload.length);
  packet[0] = 0x80;
  packet[1] = 96 | (marker ? 0x80 : 0);
  packet.writeUInt16BE(sequence & 0xffff, 2);
  packet.writeUInt32BE(timestamp >>> 0, 4);
  packet.writeUInt32BE(0x10203040, 8);
  payload.copy(packet, 12);
  return packet;
}

export function fragmentedFrame(
  nalType: number,
  count: number,
  sequence: number,
  timestamp: number,
) {
  return Array.from({ length: count }, (_, fragment) => {
    const payload = Buffer.alloc(1188);
    payload[0] = 0x7c; // H.264 FU-A, NRI=3.
    payload[1] = nalType | (fragment === 0 ? 0x80 : 0) | (fragment === count - 1 ? 0x40 : 0);
    payload.writeUInt32BE(sequence + fragment, 2);
    for (let offset = 6; offset < payload.length; offset++)
      payload[offset] = (sequence + fragment + offset) & 0xff;
    return rtp(payload, sequence + fragment, timestamp, fragment === count - 1);
  });
}
