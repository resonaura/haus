/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { WifiCredentials } from './types.js';

export type VendorProtocol =
  | 'shelly-rpc'
  | 'shelly-gen1'
  | 'esphome-web'
  | 'tasmota-web'
  | 'aqara-matter-referral'
  | 'aqara-proprietary';

export interface VendorCandidate {
  readonly vendor: 'shelly' | 'esphome' | 'tasmota' | 'aqara' | string;
  readonly protocol: VendorProtocol;
  readonly host: string;
  readonly port: number;
  readonly mac?: string;
  readonly model?: string;
  readonly generation?: number;
  readonly authRequired?: boolean;
  readonly matterDiscriminator?: number;
  readonly homekitSetupId?: string;
}

export interface VendorProvisioningOptions {
  readonly timeoutMs?: number;
  readonly fetchFn?: typeof fetch;
  readonly authUsername?: string;
  readonly authPassword?: string;
}

export interface VendorProvisioningResult {
  readonly status: 'provisioned' | 'rebooting' | 'failed' | 'referral_required' | 'unsupported_proprietary';
  readonly vendor: string;
  readonly protocol: VendorProtocol;
  readonly host: string;
  readonly mac?: string;
  readonly referralProtocol?: 'matter' | 'homekit';
  readonly error?: string;
  readonly guidance?: string;
}

export function classifyVendorDevice(info: {
  readonly host: string;
  readonly port?: number;
  readonly name?: string;
  readonly serviceType?: string;
  readonly txt?: Readonly<Record<string, string>>;
  readonly mac?: string;
  readonly model?: string;
}): VendorCandidate {
  const host = info.host;
  const name = (info.name ?? '').toLowerCase();
  const serviceType = (info.serviceType ?? '').toLowerCase();
  const txt = info.txt ?? {};
  const port = info.port ?? 80;
  const mac = info.mac ?? txt.mac;

  // 1. Shelly Detection (Gen 2/3/4 vs Gen 1)
  if (
    serviceType.includes('_shelly') ||
    name.includes('shelly') ||
    txt.gen !== undefined ||
    txt.app !== undefined
  ) {
    const gen = txt.gen ? parseInt(txt.gen, 10) : undefined;
    const isRpc =
      gen === 2 ||
      gen === 3 ||
      gen === 4 ||
      name.includes('plus') ||
      name.includes('pro') ||
      name.includes('gen3') ||
      name.includes('mini');

    return {
      vendor: 'shelly',
      protocol: isRpc ? 'shelly-rpc' : 'shelly-gen1',
      host,
      port,
      mac,
      model: txt.model ?? info.model ?? (isRpc ? 'Shelly Plus/Gen2+' : 'Shelly Gen1'),
      generation: gen ?? (isRpc ? 2 : 1),
      authRequired: txt.auth === 'true' || txt.auth === '1',
    };
  }

  // 2. ESPHome Detection
  if (serviceType.includes('esphomelib') || name.includes('esphome') || txt.esphome !== undefined) {
    return {
      vendor: 'esphome',
      protocol: 'esphome-web',
      host,
      port,
      mac,
      model: txt.project_name ?? 'ESPHome Device',
    };
  }

  // 3. Tasmota Detection
  if (serviceType.includes('tasmota') || name.includes('tasmota')) {
    return {
      vendor: 'tasmota',
      protocol: 'tasmota-web',
      host,
      port,
      mac,
      model: txt.friendly_name ?? 'Tasmota Device',
    };
  }

  // 4. Aqara Detection (Matter vs HomeKit vs Proprietary Cloud)
  if (name.includes('aqara') || serviceType.includes('aqara')) {
    const hasMatter = txt.md !== undefined || txt.matter !== undefined;
    const hasHomeKit = txt.sf !== undefined || txt.s_hash !== undefined;

    if (hasMatter) {
      const disc = txt.md ? parseInt(txt.md, 10) : undefined;
      return {
        vendor: 'aqara',
        protocol: 'aqara-matter-referral',
        host,
        port,
        mac,
        model: 'Aqara Matter Bridge / Accessory',
        matterDiscriminator: disc,
      };
    }

    if (hasHomeKit) {
      return {
        vendor: 'aqara',
        protocol: 'aqara-matter-referral',
        host,
        port,
        mac,
        model: 'Aqara HomeKit Accessory',
        homekitSetupId: txt.setup_id,
      };
    }

    return {
      vendor: 'aqara',
      protocol: 'aqara-proprietary',
      host,
      port,
      mac,
      model: 'Aqara Proprietary Accessory',
    };
  }

  // Default fallback for unknown vendor HTTP SoftAP
  return {
    vendor: 'unknown',
    protocol: 'shelly-rpc',
    host,
    port,
    mac,
  };
}

export async function provisionVendorDevice(
  candidate: VendorCandidate,
  credentials: WifiCredentials,
  options: VendorProvisioningOptions = {},
): Promise<VendorProvisioningResult> {
  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10000;
  const controller = new AbortController();
  const timeoutTimer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    switch (candidate.protocol) {
      case 'shelly-rpc':
        return await provisionShellyRpc(candidate, credentials, fetchFn, controller.signal);

      case 'shelly-gen1':
        return await provisionShellyGen1(candidate, credentials, fetchFn, controller.signal);

      case 'esphome-web':
        return await provisionEspHomeWeb(candidate, credentials, fetchFn, controller.signal);

      case 'tasmota-web':
        return await provisionTasmotaWeb(candidate, credentials, fetchFn, controller.signal);

      case 'aqara-matter-referral':
        return {
          status: 'referral_required',
          vendor: 'aqara',
          protocol: candidate.protocol,
          host: candidate.host,
          mac: candidate.mac,
          referralProtocol: candidate.matterDiscriminator ? 'matter' : 'homekit',
          guidance:
            'Device supports open Matter or HomeKit commissioning. Use Matter setup code or HomeKit PIN.',
        };

      case 'aqara-proprietary':
        return {
          status: 'unsupported_proprietary',
          vendor: 'aqara',
          protocol: candidate.protocol,
          host: candidate.host,
          mac: candidate.mac,
          error: 'Aqara proprietary provisioning requires vendor cloud app; open local SoftAP protocol unsupported',
          guidance:
            'Connect device via Aqara Home App to bind Matter/HomeKit bridge or use native Zigbee coordinator.',
        };

      default:
        return {
          status: 'failed',
          vendor: candidate.vendor,
          protocol: candidate.protocol,
          host: candidate.host,
          error: `Unsupported vendor protocol: ${String(candidate.protocol)}`,
        };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: 'failed',
      vendor: candidate.vendor,
      protocol: candidate.protocol,
      host: candidate.host,
      mac: candidate.mac,
      error: message.includes('abort') ? 'Vendor provisioning timed out' : message,
    };
  } finally {
    clearTimeout(timeoutTimer);
  }
}

async function provisionShellyRpc(
  candidate: VendorCandidate,
  credentials: WifiCredentials,
  fetchFn: typeof fetch,
  signal: AbortSignal,
): Promise<VendorProvisioningResult> {
  const baseUrl = `http://${candidate.host}:${candidate.port}`;

  const setConfigBody = JSON.stringify({
    id: 1,
    method: 'WiFi.SetConfig',
    params: {
      config: {
        sta: {
          ssid: credentials.ssid,
          pass: credentials.password,
          enable: true,
        },
      },
    },
  });

  const res = await fetchFn(`${baseUrl}/rpc/WiFi.SetConfig`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: setConfigBody,
    signal,
  });

  if (!res.ok) {
    if (res.status === 401) {
      return {
        status: 'failed',
        vendor: 'shelly',
        protocol: 'shelly-rpc',
        host: candidate.host,
        mac: candidate.mac,
        error: 'Authentication required by Shelly device (digest auth/password protected)',
      };
    }
    return {
      status: 'failed',
      vendor: 'shelly',
      protocol: 'shelly-rpc',
      host: candidate.host,
      mac: candidate.mac,
      error: `Shelly RPC returned HTTP status ${res.status}`,
    };
  }

  // Optional trigger reboot so device attaches to home Wi-Fi
  try {
    await fetchFn(`${baseUrl}/rpc/Shelly.Reboot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 2, method: 'Shelly.Reboot' }),
      signal,
    });
  } catch {
    // Device might disconnect immediately upon reboot command, which is normal
  }

  return {
    status: 'provisioned',
    vendor: 'shelly',
    protocol: 'shelly-rpc',
    host: candidate.host,
    mac: candidate.mac,
  };
}

async function provisionShellyGen1(
  candidate: VendorCandidate,
  credentials: WifiCredentials,
  fetchFn: typeof fetch,
  signal: AbortSignal,
): Promise<VendorProvisioningResult> {
  const baseUrl = `http://${candidate.host}:${candidate.port}`;
  const query = new URLSearchParams({
    enabled: '1',
    ssid: credentials.ssid,
    key: credentials.password,
  });

  const res = await fetchFn(`${baseUrl}/settings/sta?${query.toString()}`, {
    method: 'GET',
    signal,
  });

  if (!res.ok) {
    if (res.status === 401) {
      return {
        status: 'failed',
        vendor: 'shelly',
        protocol: 'shelly-gen1',
        host: candidate.host,
        mac: candidate.mac,
        error: 'Authentication required by Shelly Gen1 device',
      };
    }
    return {
      status: 'failed',
      vendor: 'shelly',
      protocol: 'shelly-gen1',
      host: candidate.host,
      mac: candidate.mac,
      error: `Shelly Gen1 returned HTTP status ${res.status}`,
    };
  }

  return {
    status: 'provisioned',
    vendor: 'shelly',
    protocol: 'shelly-gen1',
    host: candidate.host,
    mac: candidate.mac,
  };
}

async function provisionEspHomeWeb(
  candidate: VendorCandidate,
  credentials: WifiCredentials,
  fetchFn: typeof fetch,
  signal: AbortSignal,
): Promise<VendorProvisioningResult> {
  const baseUrl = `http://${candidate.host}:${candidate.port}`;
  const form = new URLSearchParams({
    ssid: credentials.ssid,
    psk: credentials.password,
  });

  const res = await fetchFn(`${baseUrl}/wifisave`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
    signal,
  });

  if (!res.ok) {
    return {
      status: 'failed',
      vendor: 'esphome',
      protocol: 'esphome-web',
      host: candidate.host,
      mac: candidate.mac,
      error: `ESPHome web provisioning returned HTTP status ${res.status}`,
    };
  }

  return {
    status: 'provisioned',
    vendor: 'esphome',
    protocol: 'esphome-web',
    host: candidate.host,
    mac: candidate.mac,
  };
}

async function provisionTasmotaWeb(
  candidate: VendorCandidate,
  credentials: WifiCredentials,
  fetchFn: typeof fetch,
  signal: AbortSignal,
): Promise<VendorProvisioningResult> {
  const baseUrl = `http://${candidate.host}:${candidate.port}`;
  const form = new URLSearchParams({
    s1: credentials.ssid,
    p1: credentials.password,
  });

  const res = await fetchFn(`${baseUrl}/wi`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
    signal,
  });

  if (!res.ok) {
    return {
      status: 'failed',
      vendor: 'tasmota',
      protocol: 'tasmota-web',
      host: candidate.host,
      mac: candidate.mac,
      error: `Tasmota web provisioning returned HTTP status ${res.status}`,
    };
  }

  return {
    status: 'provisioned',
    vendor: 'tasmota',
    protocol: 'tasmota-web',
    host: candidate.host,
    mac: candidate.mac,
  };
}
