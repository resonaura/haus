/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { HomeKitClassificationInfo } from './types.js';

/** Canonical HAP Pairing Service UUID (0x0055 on Apple HomeKit base UUID). */
export const HAP_PAIRING_SERVICE_UUID = '00000055-0000-1000-8000-0026bb765291';
/** HAP Pair Setup Characteristic UUID (0x004C). */
export const HAP_PAIR_SETUP_CHAR_UUID = '0000004c-0000-1000-8000-0026bb765291';
/** HAP Pair Verify Characteristic UUID (0x004E). */
export const HAP_PAIR_VERIFY_CHAR_UUID = '0000004e-0000-1000-8000-0026bb765291';
/** HAP Pairing Features Characteristic UUID (0x004F). */
export const HAP_PAIRING_FEATURES_CHAR_UUID = '0000004f-0000-1000-8000-0026bb765291';
/** HAP Pairings Characteristic UUID (0x0050). */
export const HAP_PAIRINGS_CHAR_UUID = '00000050-0000-1000-8000-0026bb765291';
/** HAP Characteristic Instance ID (IID) Descriptor UUID. */
export const HAP_INSTANCE_ID_DESCRIPTOR_UUID = 'dc46f0fe-81d2-4616-b5d9-6abdd796939a';

/**
 * 0xFED3 is explicitly REJECTED as a HAP-BLE discovery criterion.
 * It is not Apple's HAP pairing service and must not be used for HAP candidate filtering.
 */
export const REJECTED_FED3_UUID = 'fed3';

/** Apple Manufacturer Company ID (0x004C). */
export const APPLE_COMPANY_ID = 0x004c;
/** Apple HomeKit advertisement subtype (0x06). */
export const HOMEKIT_BLE_ADV_SUBTYPE = 0x06;

/** HAP-BLE PDU Opcodes. */
export const HapBleOpcode = {
  CharacteristicSignatureRead: 0x01,
  CharacteristicWrite: 0x02,
  CharacteristicRead: 0x03,
  CharacteristicTimedWrite: 0x04,
  CharacteristicExecuteWrite: 0x05,
  ServiceSignatureRead: 0x06,
} as const;

export type HapBleOpcode = (typeof HapBleOpcode)[keyof typeof HapBleOpcode];

/** HAP-BLE Response Status Codes. */
export const HapBleStatus = {
  Success: 0x00,
  UnsupportedPdu: 0x01,
  MaxProceduresExceeded: 0x02,
  InsufficientAuthorization: 0x03,
  InvalidInstanceId: 0x04,
  InvalidRequest: 0x05,
  ResourceBusy: 0x06,
  UnsupportedCharacteristic: 0x07,
  SecurityError: 0x08,
} as const;

export type HapBleStatus = (typeof HapBleStatus)[keyof typeof HapBleStatus];

export function isRejectedFed3Uuid(uuid: string): boolean {
  const norm = uuid.toLowerCase().replace(/[^a-f0-9]/g, '');
  return norm.includes('fed3');
}

export interface HomeKitClassificationInput {
  readonly flags?: {
    readonly ip?: boolean;
    readonly ble?: boolean;
    readonly wac?: boolean;
  };
  readonly transport?: string;
  readonly serviceType?: string;
  readonly services?: readonly string[];
  readonly hasVendorWifiCharacteristic?: boolean;
}

/**
 * Classifies a HomeKit accessory into one of five distinct categories:
 * - `hap-ip`: online HAP-IP on local network
 * - `hap-ble`: true HAP-BLE operating permanently over BLE (honest: no Wi-Fi credentials required)
 * - `vendor-wifi-ble`: HAP-BLE with vendor-specific Wi-Fi configuration characteristic
 * - `wac-only`: Apple MFi Wireless Accessory Configuration (requires MFi entitlement)
 * - `vendor-softap`: vendor proprietary SoftAP Wi-Fi
 */
export function classifyHomeKitAccessory(
  input: HomeKitClassificationInput,
): HomeKitClassificationInfo {
  const flags = input.flags;
  const transport = input.transport?.toLowerCase();
  const serviceType = input.serviceType?.toLowerCase() ?? '';
  const isLan = transport === 'lan' || transport === 'ip' || serviceType.includes('_hap._tcp');
  const isBle = transport === 'ble' || transport === 'radio' || flags?.ble === true;

  // 1. WAC-only classification
  if (
    serviceType.includes('_wac._tcp') ||
    serviceType.includes('_apple-mob-dev') ||
    (flags?.wac === true && flags.ip === false && flags.ble === false)
  ) {
    return {
      classification: 'wac-only',
      description: 'Apple MFi Wireless Accessory Configuration',
      canDirectCommission: false,
      requiresWifiCredentials: false,
      guidance:
        'Accessory requires Apple Wireless Accessory Configuration (WAC), an MFi technology gated behind the com.apple.external-accessory.wireless-configuration entitlement. Use the vendor app or Apple Home on iOS to join it to your Wi-Fi network first.',
    };
  }

  // 2. Vendor SoftAP classification
  if (transport === 'softap' || serviceType.includes('softap')) {
    return {
      classification: 'vendor-softap',
      description: 'Vendor Proprietary SoftAP Wi-Fi',
      canDirectCommission: false,
      requiresWifiCredentials: true,
      guidance:
        'Accessory broadcasts a temporary Wi-Fi access point. Connect to its network or use the vendor app to configure infrastructure Wi-Fi.',
    };
  }

  // 3. Online HAP-IP classification
  if (isLan || (flags?.ip === true && flags.ble !== true)) {
    return {
      classification: 'hap-ip',
      description: 'Online HomeKit Accessory (HAP-IP)',
      canDirectCommission: true,
      requiresWifiCredentials: false,
      guidance:
        'Accessory is connected to the local IP network. Ready for direct Pair-Setup over HAP-IP.',
    };
  }

  // 4. HAP-BLE with vendor Wi-Fi characteristic
  if (isBle && input.hasVendorWifiCharacteristic) {
    return {
      classification: 'vendor-wifi-ble',
      description: 'HomeKit BLE with Vendor Wi-Fi Provisioning',
      canDirectCommission: true,
      requiresWifiCredentials: true,
      guidance:
        'Accessory supports vendor-specific Wi-Fi credential provisioning over Bluetooth LE.',
    };
  }

  // 5. True HAP-BLE classification (Honest invariant: communicates permanently over BLE)
  if (isBle) {
    return {
      classification: 'hap-ble',
      description: 'Native HomeKit Bluetooth LE Accessory',
      canDirectCommission: true,
      requiresWifiCredentials: false,
      guidance:
        'Accessory is a native Bluetooth LE HomeKit device (sensor/lock). It operates permanently over BLE and does not require Wi-Fi credentials.',
    };
  }

  // Default fallback if flags specify IP
  if (flags?.ip === true) {
    return {
      classification: 'hap-ip',
      description: 'Online HomeKit Accessory (HAP-IP)',
      canDirectCommission: true,
      requiresWifiCredentials: false,
      guidance:
        'Accessory is connected to the local IP network. Ready for direct Pair-Setup over HAP-IP.',
    };
  }

  return {
    classification: 'hap-ip',
    description: 'HomeKit Accessory',
    canDirectCommission: true,
    requiresWifiCredentials: false,
    guidance: 'HomeKit accessory reachable on local network.',
  };
}

export interface DiscoveredHomeKitBleAdvertisement {
  readonly paired: boolean;
  readonly deviceId: string;
  readonly categoryId: number;
  readonly globalStateNumber: number;
  readonly configNumber: number;
  readonly protocolVersion: number;
  readonly setupHash?: string;
}

/**
 * Parses an Apple HomeKit BLE manufacturer advertisement payload.
 * Expected structure:
 * Company ID: 0x4C 0x00 (2B LE)
 * Subtype: 0x06 (1B, HomeKit encrypted or clear advertisement)
 * Length: 1B
 * Status Flags: 1B (Bit 0: 0 = paired, 1 = unpaired / pair setup available)
 * Device ID: 6B (MAC address)
 * Category ID: 2B LE
 * Global State Number (s#): 2B LE
 * Config Number (c#): 1B
 * Protocol Version (pv): 1B
 * Setup Hash (sh): 4B (optional)
 */
export function parseHomeKitBleAdvertisement(
  data: Uint8Array,
): DiscoveredHomeKitBleAdvertisement | null {
  if (data.length < 15) return null;

  // Handle optional leading Company ID (0x004C)
  let offset = 0;
  if (data[0] === 0x4c && data[1] === 0x00) {
    offset = 2;
  }

  if (offset + 13 > data.length) return null;
  const subtype = data[offset];
  if (subtype !== HOMEKIT_BLE_ADV_SUBTYPE) return null;

  const length = data[offset + 1];
  if (offset + 2 + length > data.length && length > 0) return null;

  const sf = data[offset + 2];
  const paired = (sf & 0x01) === 0;

  const macBytes = data.slice(offset + 3, offset + 9);
  const deviceId = Array.from(macBytes)
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join(':');

  const categoryId = data[offset + 9] | (data[offset + 10] << 8);
  const globalStateNumber = data[offset + 11] | (data[offset + 12] << 8);
  const configNumber = data[offset + 13];
  const protocolVersion = offset + 14 < data.length ? data[offset + 14] : 1;

  let setupHash: string | undefined;
  if (offset + 19 <= data.length) {
    const hashBytes = data.slice(offset + 15, offset + 19);
    setupHash = Array.from(hashBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  return {
    paired,
    deviceId,
    categoryId,
    globalStateNumber,
    configNumber,
    protocolVersion,
    setupHash,
  };
}

export function encodeHapBleRequestPdu(options: {
  opcode: HapBleOpcode;
  tid: number;
  iid: number;
  body?: Uint8Array;
  control?: number;
}): Uint8Array {
  const body = options.body ?? new Uint8Array(0);
  const control = options.control ?? 0x00;
  const headerLen = 5 + (body.length > 0 ? 2 : 0);
  const pdu = new Uint8Array(headerLen + body.length);

  pdu[0] = control;
  pdu[1] = options.opcode;
  pdu[2] = options.tid & 0xff;
  pdu[3] = options.iid & 0xff;
  pdu[4] = (options.iid >> 8) & 0xff;

  if (body.length > 0) {
    pdu[5] = body.length & 0xff;
    pdu[6] = (body.length >> 8) & 0xff;
    pdu.set(body, 7);
  }

  return pdu;
}

export function decodeHapBleResponsePdu(data: Uint8Array): {
  control: number;
  tid: number;
  status: HapBleStatus;
  body: Uint8Array;
} {
  if (data.length < 3) {
    throw new Error(`HAP-BLE response PDU too short: ${data.length} bytes`);
  }
  const control = data[0];
  const tid = data[1];
  const status = data[2] as HapBleStatus;

  if (data.length <= 3) {
    return { control, tid, status, body: new Uint8Array(0) };
  }

  let bodyLength = data.length - 3;
  let bodyOffset = 3;

  if (data.length >= 5) {
    const explicitLen = data[3] | (data[4] << 8);
    if (explicitLen + 5 <= data.length) {
      bodyLength = explicitLen;
      bodyOffset = 5;
    }
  }

  const body = data.slice(bodyOffset, bodyOffset + bodyLength);
  return { control, tid, status, body };
}

export function hapBleStatusToString(status: HapBleStatus): string {
  switch (status) {
    case HapBleStatus.Success:
      return 'success';
    case HapBleStatus.UnsupportedPdu:
      return 'unsupported_pdu';
    case HapBleStatus.MaxProceduresExceeded:
      return 'max_procedures_exceeded';
    case HapBleStatus.InsufficientAuthorization:
      return 'insufficient_authorization';
    case HapBleStatus.InvalidInstanceId:
      return 'invalid_instance_id';
    case HapBleStatus.InvalidRequest:
      return 'invalid_request';
    case HapBleStatus.ResourceBusy:
      return 'resource_busy';
    case HapBleStatus.UnsupportedCharacteristic:
      return 'unsupported_characteristic';
    case HapBleStatus.SecurityError:
      return 'security_error';
    default:
      return `unknown_error_${status}`;
  }
}

export function chunkHapBlePdu(pdu: Uint8Array, maxChunkSize = 20): Uint8Array[] {
  if (pdu.length <= maxChunkSize) return [pdu];
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < pdu.length; offset += maxChunkSize) {
    chunks.push(pdu.slice(offset, offset + maxChunkSize));
  }
  return chunks;
}

export class HapBlePacketReassembler {
  private buffer = new Uint8Array(0);
  private expectedLength = 0;

  append(chunk: Uint8Array): Uint8Array | null {
    const next = new Uint8Array(this.buffer.length + chunk.length);
    next.set(this.buffer);
    next.set(chunk, this.buffer.length);
    this.buffer = next;

    if (this.expectedLength === 0 && this.buffer.length >= 5) {
      const explicitLen = this.buffer[3] | (this.buffer[4] << 8);
      this.expectedLength = 5 + explicitLen;
    }

    if (this.expectedLength > 0 && this.buffer.length >= this.expectedLength) {
      const complete = this.buffer.slice(0, this.expectedLength);
      this.buffer = this.buffer.slice(this.expectedLength);
      this.expectedLength = 0;
      return complete;
    }

    return null;
  }

  reset(): void {
    this.buffer = new Uint8Array(0);
    this.expectedLength = 0;
  }
}
