/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export interface NetworkInterfaceCandidate {
  readonly name: string;
  readonly internal: boolean;
  readonly address: string;
  readonly family: 'IPv4' | 'IPv6' | string;
}

export const HAUS_BLE_SERVICE_UUID = '0000fa11-0000-1000-8000-00805f9b34fb';
export const HAUS_BLE_CHAR_AUTH_UUID = '0000fa12-0000-1000-8000-00805f9b34fb';
export const HAUS_BLE_CHAR_STATUS_UUID = '0000fa13-0000-1000-8000-00805f9b34fb';

const VIRTUAL_INTERFACE_REGEX =
  /^(docker\d*|br-[a-f0-9]+|veth[a-f0-9]+|tailscale\d*|wg\d*|tun\d*|tap\d*|dummy\d*|virbr\d*)$/i;

export function isPrimaryPhysicalInterface(iface: NetworkInterfaceCandidate): boolean {
  if (iface.internal) return false;
  if (iface.family !== 'IPv4') return false;

  const name = iface.name.toLowerCase();
  if (VIRTUAL_INTERFACE_REGEX.test(name)) return false;

  const addr = iface.address;
  // Exclude Docker default bridge subnet (172.17.0.0/16 - 172.31.0.0/16) if interface looks virtual
  if (
    /^172\.(1[7-9]|2[0-9]|3[0-1])\./.test(addr) &&
    (name.startsWith('br-') || name.startsWith('docker'))
  ) {
    return false;
  }

  // Physical Ethernet and Wi-Fi interfaces
  if (/^(eth\d*|en\d*|wlan\d*|wl\d*|lan\d*)/.test(name)) {
    return true;
  }

  // Fallback: private LAN address on non-virtual interface
  return /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(addr);
}

export function encodeBleAdvertisementPayload(
  hubId: string,
  homeId: string,
  port: number,
): Uint8Array {
  const json = JSON.stringify({ h: hubId, hm: homeId, p: port });
  return new TextEncoder().encode(json);
}

export function decodeBleAdvertisementPayload(
  data: Uint8Array,
): { hubId: string; homeId: string; port: number } | null {
  try {
    const text = new TextDecoder().decode(data);
    const parsed = JSON.parse(text) as { h?: unknown; hm?: unknown; p?: unknown };
    if (
      typeof parsed.h === 'string' &&
      typeof parsed.hm === 'string' &&
      typeof parsed.p === 'number'
    ) {
      return {
        hubId: parsed.h,
        homeId: parsed.hm,
        port: parsed.p,
      };
    }
    return null;
  } catch {
    return null;
  }
}
