/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

/** Improv Wi-Fi over BLE: transport-neutral packet codec. */
export const IMPROV_SERVICE_UUID = '00467768-6228-2272-4663-277478268000';
export const IMPROV_SERVICE_DATA_UUID = 0x4677;
export const IMPROV_CHARACTERISTICS = {
  currentState: '00467768-6228-2272-4663-277478268001',
  errorState: '00467768-6228-2272-4663-277478268002',
  rpcCommand: '00467768-6228-2272-4663-277478268003',
  rpcResult: '00467768-6228-2272-4663-277478268004',
  capabilities: '00467768-6228-2272-4663-277478268005',
} as const;

export const ImprovState = {
  authorizationRequired: 0x01,
  authorized: 0x02,
  provisioning: 0x03,
  provisioned: 0x04,
} as const;

export const IMPROV_CMD_WIFI_SETTINGS = 0x01;
export const IMPROV_BLE_CHUNK = 20;

function checksum(bytes: Uint8Array): number {
  let sum = 0;
  for (const b of bytes) sum = (sum + b) & 0xff;
  return sum;
}

export function encodeImprovWifiCommand(ssid: string, password: string): Uint8Array {
  const enc = new TextEncoder();
  const s = enc.encode(ssid);
  const p = enc.encode(password);
  const dataLen = 2 + s.length + p.length;
  if (s.length > 255 || p.length > 255 || dataLen > 255) {
    throw new Error('Improv Wi-Fi credentials too long');
  }
  const body = new Uint8Array(2 + dataLen);
  body[0] = IMPROV_CMD_WIFI_SETTINGS;
  body[1] = dataLen;
  body[2] = s.length;
  body.set(s, 3);
  body[3 + s.length] = p.length;
  body.set(p, 4 + s.length);
  const out = new Uint8Array(body.length + 1);
  out.set(body);
  out[body.length] = checksum(body);
  return out;
}

export function chunkImprovPacket(packet: Uint8Array, size = IMPROV_BLE_CHUNK): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < packet.length; i += size) chunks.push(packet.slice(i, i + size));
  return chunks;
}

/** Decodes an RPC result: command, strings. Returns undefined on bad checksum. */
export function decodeImprovRpcResult(
  packet: Uint8Array,
): { command: number; strings: string[] } | undefined {
  if (packet.length < 3) return undefined;
  const dataLen = packet[1] ?? 0;
  if (packet.length !== dataLen + 3) return undefined;
  if (checksum(packet.slice(0, packet.length - 1)) !== packet[packet.length - 1]) return undefined;
  const dec = new TextDecoder();
  const strings: string[] = [];
  let i = 2;
  while (i < packet.length - 1) {
    const len = packet[i] ?? 0;
    strings.push(dec.decode(packet.slice(i + 1, i + 1 + len)));
    i += 1 + len;
  }
  return { command: packet[0] ?? 0, strings };
}
