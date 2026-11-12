/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

/** Improv Wi-Fi over BLE and Serial protocol codec and framing. */
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
  stopped: 0x00,
  authorizationRequired: 0x01,
  authorized: 0x02,
  provisioning: 0x03,
  provisioned: 0x04,
} as const;
export type ImprovStateType = (typeof ImprovState)[keyof typeof ImprovState];

export const ImprovError = {
  noError: 0x00,
  invalidRpc: 0x01,
  unknownCommand: 0x02,
  unableToConnect: 0x03,
  notAuthorized: 0x04,
  badHostname: 0x05,
  unknownError: 0xff,
} as const;
export type ImprovErrorType = (typeof ImprovError)[keyof typeof ImprovError];

export const ImprovCapability = {
  identify: 0x01,
  deviceInfo: 0x02,
  wifiScan: 0x04,
  hostname: 0x08,
} as const;

export const ImprovCommand = {
  wifiSettings: 0x01,
  identify: 0x02,
  deviceInfo: 0x03,
  wifiScan: 0x04,
  getSetHostname: 0x05,
} as const;
export type ImprovCommandType = (typeof ImprovCommand)[keyof typeof ImprovCommand];

export const IMPROV_CMD_WIFI_SETTINGS = ImprovCommand.wifiSettings;
export const IMPROV_BLE_CHUNK = 20;

export const IMPROV_SERIAL_HEADER = new Uint8Array([0x49, 0x4d, 0x50, 0x52, 0x4f, 0x56]); // "IMPROV"
export const IMPROV_SERIAL_VERSION = 0x01;

export const ImprovSerialType = {
  currentState: 0x01,
  errorState: 0x02,
  rpcCommand: 0x03,
  rpcResult: 0x04,
} as const;
export type ImprovSerialTypeValue = (typeof ImprovSerialType)[keyof typeof ImprovSerialType];

export interface ImprovCapabilities {
  readonly identify: boolean;
  readonly deviceInfo: boolean;
  readonly wifiScan: boolean;
  readonly hostname: boolean;
}

export interface ImprovServiceData {
  readonly state: ImprovStateType;
  readonly capabilities: ImprovCapabilities;
  readonly rawCapabilities: number;
}

export interface ImprovRpcResult {
  readonly command: number;
  readonly strings: readonly string[];
}

export interface ImprovDeviceInfo {
  readonly firmwareName: string;
  readonly firmwareVersion: string;
  readonly hardwareVariant: string;
  readonly deviceName: string;
}

export interface ImprovWifiScanEntry {
  readonly ssid: string;
  readonly rssi: number;
  readonly authRequired: boolean;
}

export interface ImprovSerialPacket {
  readonly type: ImprovSerialTypeValue;
  readonly data: Uint8Array;
}

export function improvChecksum(bytes: Uint8Array): number {
  let sum = 0;
  for (const b of bytes) sum = (sum + b) & 0xff;
  return sum;
}

export function parseImprovCapabilities(raw: number): ImprovCapabilities {
  return {
    identify: (raw & ImprovCapability.identify) !== 0,
    deviceInfo: (raw & ImprovCapability.deviceInfo) !== 0,
    wifiScan: (raw & ImprovCapability.wifiScan) !== 0,
    hostname: (raw & ImprovCapability.hostname) !== 0,
  };
}

export function parseImprovServiceData(data: Uint8Array): ImprovServiceData | undefined {
  if (data.length < 2) return undefined;
  const state = (data[0] ?? 0) as ImprovStateType;
  const rawCapabilities = data[1] ?? 0;
  return {
    state,
    capabilities: parseImprovCapabilities(rawCapabilities),
    rawCapabilities,
  };
}

export function encodeImprovRpcCommand(
  command: number,
  payload: Uint8Array = new Uint8Array(0),
): Uint8Array {
  if (payload.length > 255) {
    throw new Error(`Improv RPC payload exceeds 255 bytes (got ${payload.length})`);
  }
  const body = new Uint8Array(2 + payload.length);
  body[0] = command;
  body[1] = payload.length;
  body.set(payload, 2);
  const out = new Uint8Array(body.length + 1);
  out.set(body);
  out[body.length] = improvChecksum(body);
  return out;
}

export function encodeImprovWifiCommand(ssid: string, password = ''): Uint8Array {
  const enc = new TextEncoder();
  const s = enc.encode(ssid);
  const p = enc.encode(password);
  const dataLen = 2 + s.length + p.length;
  if (s.length > 255 || p.length > 255 || dataLen > 255) {
    throw new Error('Improv Wi-Fi credentials exceed 255 bytes');
  }
  const payload = new Uint8Array(2 + s.length + p.length);
  payload[0] = s.length;
  payload.set(s, 1);
  payload[1 + s.length] = p.length;
  payload.set(p, 2 + s.length);
  return encodeImprovRpcCommand(ImprovCommand.wifiSettings, payload);
}

export function encodeImprovIdentifyCommand(): Uint8Array {
  return encodeImprovRpcCommand(ImprovCommand.identify);
}

export function encodeImprovDeviceInfoCommand(): Uint8Array {
  return encodeImprovRpcCommand(ImprovCommand.deviceInfo);
}

export function encodeImprovWifiScanCommand(): Uint8Array {
  return encodeImprovRpcCommand(ImprovCommand.wifiScan);
}

export function decodeImprovRpcResult(packet: Uint8Array): ImprovRpcResult | undefined {
  if (packet.length < 3) return undefined;
  const command = packet[0] ?? 0;
  const dataLen = packet[1] ?? 0;
  if (packet.length !== dataLen + 3) return undefined;
  const expectedChecksum = packet[packet.length - 1];
  if (improvChecksum(packet.slice(0, packet.length - 1)) !== expectedChecksum) return undefined;

  const dec = new TextDecoder();
  const strings: string[] = [];
  let i = 2;
  while (i < packet.length - 1) {
    const len = packet[i] ?? 0;
    if (i + 1 + len > packet.length - 1) return undefined;
    strings.push(dec.decode(packet.slice(i + 1, i + 1 + len)));
    i += 1 + len;
  }
  return { command, strings };
}

export function parseImprovDeviceInfo(strings: readonly string[]): ImprovDeviceInfo | undefined {
  if (strings.length < 4) return undefined;
  return {
    firmwareName: strings[0] ?? '',
    firmwareVersion: strings[1] ?? '',
    hardwareVariant: strings[2] ?? '',
    deviceName: strings[3] ?? '',
  };
}

export function parseImprovWifiScan(strings: readonly string[]): ImprovWifiScanEntry[] {
  const entries: ImprovWifiScanEntry[] = [];
  for (let i = 0; i + 2 < strings.length; i += 3) {
    const ssid = strings[i] ?? '';
    const rssiStr = strings[i + 1] ?? '0';
    const authStr = (strings[i + 2] ?? '').toUpperCase();
    const rssi = parseInt(rssiStr, 10);
    const authRequired = authStr === 'YES' || authStr === 'TRUE' || authStr === '1';
    entries.push({
      ssid,
      rssi: Number.isNaN(rssi) ? 0 : rssi,
      authRequired,
    });
  }
  return entries;
}

export function chunkImprovPacket(packet: Uint8Array, size = IMPROV_BLE_CHUNK): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < packet.length; i += size) {
    chunks.push(packet.slice(i, i + size));
  }
  return chunks;
}

export class ImprovBlePacketReassembler {
  private buffer = new Uint8Array(0);

  public append(chunk: Uint8Array): ImprovRpcResult | undefined {
    const next = new Uint8Array(this.buffer.length + chunk.length);
    next.set(this.buffer);
    next.set(chunk, this.buffer.length);
    this.buffer = next;

    if (this.buffer.length < 3) return undefined;
    const dataLen = this.buffer[1] ?? 0;
    const totalExpected = dataLen + 3;
    if (this.buffer.length >= totalExpected) {
      const fullPacket = this.buffer.slice(0, totalExpected);
      this.buffer = this.buffer.slice(totalExpected);
      return decodeImprovRpcResult(fullPacket);
    }
    return undefined;
  }

  public reset(): void {
    this.buffer = new Uint8Array(0);
  }

  public get bufferedBytes(): number {
    return this.buffer.length;
  }
}

export function encodeImprovSerialPacket(
  type: number,
  data: Uint8Array = new Uint8Array(0),
): Uint8Array {
  if (data.length > 255) {
    throw new Error(`Improv serial payload exceeds 255 bytes (got ${data.length})`);
  }
  const total = 9 + data.length + 1;
  const frame = new Uint8Array(total);
  frame.set(IMPROV_SERIAL_HEADER, 0);
  frame[6] = IMPROV_SERIAL_VERSION;
  frame[7] = type;
  frame[8] = data.length;
  frame.set(data, 9);
  frame[frame.length - 1] = improvChecksum(frame.slice(0, frame.length - 1));
  return frame;
}

export function decodeImprovSerialPacket(packet: Uint8Array): ImprovSerialPacket | undefined {
  if (packet.length < 10) return undefined;
  for (let i = 0; i < 6; i++) {
    if (packet[i] !== IMPROV_SERIAL_HEADER[i]) return undefined;
  }
  if (packet[6] !== IMPROV_SERIAL_VERSION) return undefined;
  const type = packet[7] as ImprovSerialTypeValue;
  const dataLen = packet[8] ?? 0;
  if (packet.length !== 9 + dataLen + 1) return undefined;
  const expectedChecksum = packet[packet.length - 1];
  if (improvChecksum(packet.slice(0, packet.length - 1)) !== expectedChecksum) return undefined;
  return {
    type,
    data: packet.slice(9, 9 + dataLen),
  };
}

export class ImprovSerialFrameParser {
  private buffer = new Uint8Array(0);

  public append(chunk: Uint8Array): ImprovSerialPacket[] {
    const next = new Uint8Array(this.buffer.length + chunk.length);
    next.set(this.buffer);
    next.set(chunk, this.buffer.length);
    this.buffer = next;

    const packets: ImprovSerialPacket[] = [];
    while (this.buffer.length >= 10) {
      let headerIdx = -1;
      for (let i = 0; i <= this.buffer.length - 6; i++) {
        let match = true;
        for (let j = 0; j < 6; j++) {
          if (this.buffer[i + j] !== IMPROV_SERIAL_HEADER[j]) {
            match = false;
            break;
          }
        }
        if (match) {
          headerIdx = i;
          break;
        }
      }

      if (headerIdx === -1) {
        this.buffer = this.buffer.slice(Math.max(0, this.buffer.length - 5));
        break;
      }

      if (headerIdx > 0) {
        this.buffer = this.buffer.slice(headerIdx);
      }

      if (this.buffer.length < 10) break;
      const dataLen = this.buffer[8] ?? 0;
      const totalLen = 9 + dataLen + 1;
      if (this.buffer.length < totalLen) break;

      const candidate = this.buffer.slice(0, totalLen);
      const parsed = decodeImprovSerialPacket(candidate);
      if (parsed) {
        packets.push(parsed);
        this.buffer = this.buffer.slice(totalLen);
      } else {
        this.buffer = this.buffer.slice(1);
      }
    }
    return packets;
  }

  public reset(): void {
    this.buffer = new Uint8Array(0);
  }

  public get bufferedBytes(): number {
    return this.buffer.length;
  }
}
