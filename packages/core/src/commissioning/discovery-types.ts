/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export type DiscoveryProtocol =
  'zeroconf' | 'ssdp' | 'dhcp' | 'bluetooth' | 'usb' | 'mqtt' | 'homekit' | 'matter';

export type DiscoveryStatus = 'discovered' | 'in_progress' | 'configured' | 'ignored';

export type DurableIdentityKind =
  'mac' | 'uuid' | 'usb' | 'net' | 'mqtt' | 'hap' | 'matter' | 'mdns';

export interface DurableIdentity {
  readonly kind: DurableIdentityKind;
  readonly value: string;
}

export interface DiscoveredCandidate {
  readonly id: string;
  readonly domain: string;
  readonly name: string;
  readonly protocol: DiscoveryProtocol;
  readonly secondaryProtocols: readonly DiscoveryProtocol[];
  readonly status: DiscoveryStatus;
  readonly authenticated: false;
  readonly addresses: readonly string[];
  readonly port?: number;
  readonly durableIdentities: readonly DurableIdentity[];
  readonly details: Readonly<Record<string, unknown>>;
  readonly discoveredAt: number;
  readonly updatedAt: number;
  readonly ttlMs?: number;
  readonly expiresAt?: number;
  readonly flowId?: string;
}

export interface DiscoveryAdvertisementInput {
  readonly protocol: DiscoveryProtocol;
  readonly domain?: string;
  readonly name?: string;
  readonly mac?: string;
  readonly uuid?: string;
  readonly host?: string;
  readonly port?: number;
  readonly addresses?: readonly string[];
  readonly ttlMs?: number;
  readonly usb?: {
    readonly vid: string;
    readonly pid: string;
    readonly serialNumber?: string;
    readonly description?: string;
    readonly manufacturer?: string;
  };
  readonly mqttTopic?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface ZeroconfMatcherRule {
  readonly type: string;
  readonly name?: string;
  readonly properties?: Readonly<Record<string, string>>;
}

export interface SsdpMatcherRule {
  readonly manufacturer?: string;
  readonly modelName?: string;
  readonly modelDescription?: string;
  readonly manufacturerURL?: string;
  readonly deviceType?: string;
  readonly st?: string;
  readonly nt?: string;
  readonly [key: string]: string | undefined;
}

export interface DhcpMatcherRule {
  readonly macaddress?: string;
  readonly hostname?: string;
}

export interface BluetoothMatcherRule {
  readonly local_name?: string;
  readonly manufacturer_id?: number;
  readonly service_uuid?: string;
  readonly service_data_uuid?: string;
  readonly manufacturer_data_start?: readonly number[];
  readonly connectable?: boolean;
}

export interface UsbMatcherRule {
  readonly vid?: string;
  readonly pid?: string;
  readonly description?: string;
  readonly manufacturer?: string;
}

export interface HomeKitMatcherRule {
  readonly models?: readonly string[];
  readonly alwaysDiscover?: boolean;
}

export interface DiscoveryMatcherRule {
  readonly domain: string;
  readonly zeroconf?: readonly (string | ZeroconfMatcherRule)[];
  readonly ssdp?: readonly SsdpMatcherRule[];
  readonly dhcp?: readonly DhcpMatcherRule[];
  readonly bluetooth?: readonly BluetoothMatcherRule[];
  readonly usb?: readonly UsbMatcherRule[];
  readonly mqtt?: readonly string[];
  readonly homekit?: HomeKitMatcherRule;
}

export interface DiscoveryFilter {
  readonly status?: DiscoveryStatus;
  readonly domain?: string;
  readonly protocol?: DiscoveryProtocol;
}
