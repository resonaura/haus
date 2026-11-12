/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type {
  DiscoveredCandidate,
  DiscoveryAdvertisementInput,
  DiscoveryMatcherRule,
} from './discovery-types.js';
import type { ParsedSetupCode } from './types.js';
import { globMatches, normalizeMac } from './discovery-deduplicator.js';

export interface DnsSdDetails {
  readonly serviceType: string;
  readonly rawTxt: Readonly<Record<string, string>>;
  readonly pairingAvailable: boolean;
  readonly paired?: boolean;
  readonly accessoryId?: string;
  readonly model?: string;
  readonly stateNumber?: number;
  readonly configNumber?: number;
  readonly categoryId?: number;
  readonly setupHash?: string;
  readonly protocolVersion?: string;
  readonly discriminator?: number;
  readonly shortDiscriminator?: number;
  readonly commissioningMode?: number;
  readonly vendorId?: number;
  readonly productId?: number;
  readonly deviceName?: string;
  readonly deviceType?: number;
  readonly rotatingId?: string;
  readonly mac?: string;
  readonly version?: string;
  readonly platform?: string;
  readonly board?: string;
  readonly generation?: number;
}

export function parseDnsSdTxt(
  serviceType: string,
  rawTxt: Readonly<Record<string, string>> = {},
): DnsSdDetails {
  const normType = serviceType.replace(/\.local\.?$/, '');
  const txt: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawTxt)) {
    txt[k.trim()] = String(v).trim();
  }

  if (normType.startsWith('_hap._tcp')) {
    const sf = txt.sf ?? txt.SF;
    const pairingAvailable = sf === '1';
    const paired = sf === '0';
    const accessoryId = txt.id ?? txt.ID;
    const model = txt.md ?? txt.MD;
    const stateNumber = txt['s#'] ? parseInt(txt['s#'], 10) : undefined;
    const configNumber = txt['c#'] ? parseInt(txt['c#'], 10) : undefined;
    const categoryId = txt.ci ? parseInt(txt.ci, 10) : undefined;
    const setupHash = txt.sh ?? txt.SH;
    const protocolVersion = txt.pv ?? txt.PV;

    return {
      serviceType: normType,
      rawTxt,
      pairingAvailable,
      paired,
      accessoryId,
      model,
      stateNumber: Number.isNaN(stateNumber) ? undefined : stateNumber,
      configNumber: Number.isNaN(configNumber) ? undefined : configNumber,
      categoryId: Number.isNaN(categoryId) ? undefined : categoryId,
      setupHash,
      protocolVersion,
      mac: accessoryId,
    };
  }

  if (normType.startsWith('_matterc._udp')) {
    const cm = txt.CM ? parseInt(txt.CM, 10) : undefined;
    const pairingAvailable = cm === 1 || cm === 2;
    const paired = cm === 0;
    const disc = txt.D ? parseInt(txt.D, 10) : undefined;
    const shortDisc = disc !== undefined ? (disc >> 8) & 0x0f : undefined;
    let vendorId: number | undefined;
    let productId: number | undefined;
    if (txt.VP) {
      const parts = txt.VP.split('+');
      if (parts[0]) {
        const v = parseInt(parts[0], 10);
        if (!Number.isNaN(v)) vendorId = v;
      }
      if (parts[1]) {
        const p = parseInt(parts[1], 10);
        if (!Number.isNaN(p)) productId = p;
      }
    }
    const deviceType = txt.DT ? parseInt(txt.DT, 10) : undefined;

    return {
      serviceType: normType,
      rawTxt,
      pairingAvailable,
      paired,
      commissioningMode: Number.isNaN(cm) ? undefined : cm,
      discriminator: Number.isNaN(disc) ? undefined : disc,
      shortDiscriminator: shortDisc,
      vendorId,
      productId,
      deviceName: txt.DN,
      deviceType: Number.isNaN(deviceType) ? undefined : deviceType,
      rotatingId: txt.RI,
    };
  }

  if (normType.startsWith('_matter._tcp')) {
    return {
      serviceType: normType,
      rawTxt,
      pairingAvailable: false,
      paired: true,
    };
  }

  if (normType.startsWith('_esphomelib._tcp')) {
    return {
      serviceType: normType,
      rawTxt,
      pairingAvailable: true,
      paired: false,
      mac: txt.mac,
      version: txt.version,
      platform: txt.platform,
      board: txt.board,
    };
  }

  if (normType.startsWith('_shelly._tcp')) {
    const gen = txt.gen ? parseInt(txt.gen, 10) : undefined;
    return {
      serviceType: normType,
      rawTxt,
      pairingAvailable: true,
      paired: false,
      accessoryId: txt.id,
      mac: txt.mac ?? txt.id,
      model: txt.model,
      generation: Number.isNaN(gen) ? undefined : gen,
      version: txt.ver,
    };
  }

  if (normType.startsWith('_wled._tcp') || normType.startsWith('_tasmota._tcp')) {
    return {
      serviceType: normType,
      rawTxt,
      pairingAvailable: true,
      paired: false,
      mac: txt.mac,
    };
  }

  return {
    serviceType: normType,
    rawTxt,
    pairingAvailable: true,
    mac: txt.mac,
  };
}

export function isCandidatePairingAvailable(candidate: DiscoveredCandidate): boolean {
  if (typeof candidate.details.pairingAvailable === 'boolean') {
    return candidate.details.pairingAvailable;
  }
  if (candidate.details.sf !== undefined) {
    return String(candidate.details.sf) === '1';
  }
  if (candidate.details.CM !== undefined) {
    const cm = String(candidate.details.CM);
    return cm === '1' || cm === '2';
  }
  if (candidate.details.paired === true) {
    return false;
  }
  return true;
}

export interface CandidateMatchResult {
  readonly matched: boolean;
  readonly score: number;
  readonly reason?: string;
}

export interface MatchCandidateOptions {
  readonly computeSetupHash?: (setupId: string, accessoryId: string) => string;
}

export function matchCandidateToSetupCode(
  candidate: DiscoveredCandidate,
  parsed: ParsedSetupCode,
  options?: MatchCandidateOptions,
): CandidateMatchResult {
  if (parsed.protocol === 'homekit') {
    const isHap =
      candidate.protocol === 'homekit' ||
      candidate.domain === 'homekit' ||
      String(candidate.details.serviceType ?? '').startsWith('_hap._tcp');
    if (!isHap) return { matched: false, score: 0, reason: 'protocol_mismatch' };

    if (!isCandidatePairingAvailable(candidate)) {
      return { matched: false, score: 0, reason: 'accessory_already_paired' };
    }

    const wantSetupId = parsed.homekit?.setupId?.toUpperCase();
    const candidateHash =
      (typeof candidate.details.setupHash === 'string'
        ? candidate.details.setupHash
        : typeof candidate.details.sh === 'string'
          ? candidate.details.sh
          : undefined) ?? undefined;
    const accessoryId =
      (typeof candidate.details.accessoryId === 'string'
        ? candidate.details.accessoryId
        : typeof candidate.details.id === 'string'
          ? candidate.details.id
          : undefined) ?? undefined;

    if (wantSetupId) {
      if (candidateHash && accessoryId && options?.computeSetupHash) {
        const expectedHash = options.computeSetupHash(wantSetupId, accessoryId);
        if (expectedHash === candidateHash) {
          return { matched: true, score: 100 };
        }
        return { matched: false, score: 0, reason: 'setup_hash_mismatch' };
      }
      if (candidateHash) {
        return { matched: true, score: 50, reason: 'unverified_setup_hash' };
      }
    }

    return { matched: true, score: 30 };
  }

  if (parsed.protocol === 'matter') {
    const isMatter =
      candidate.protocol === 'matter' ||
      candidate.domain === 'matter' ||
      String(candidate.details.serviceType ?? '').startsWith('_matterc._udp');
    if (!isMatter) return { matched: false, score: 0, reason: 'protocol_mismatch' };

    if (!isCandidatePairingAvailable(candidate)) {
      return { matched: false, score: 0, reason: 'device_not_in_commissioning_mode' };
    }

    const codeDisc = parsed.matter?.discriminator;
    const candDisc =
      typeof candidate.details.discriminator === 'number'
        ? candidate.details.discriminator
        : typeof candidate.details.D === 'number'
          ? candidate.details.D
          : typeof candidate.details.D === 'string'
            ? parseInt(candidate.details.D, 10)
            : undefined;

    const candShortDisc =
      typeof candidate.details.shortDiscriminator === 'number'
        ? candidate.details.shortDiscriminator
        : candDisc !== undefined
          ? (candDisc >> 8) & 0x0f
          : undefined;

    if (codeDisc) {
      if (candDisc !== undefined) {
        if (codeDisc.type === 'long') {
          if (candDisc === codeDisc.value) return { matched: true, score: 100 };
          return { matched: false, score: 0, reason: 'discriminator_mismatch' };
        }
        const candidateShort = (candDisc >> 8) & 0x0f;
        if (candidateShort === codeDisc.value) return { matched: true, score: 80 };
        return { matched: false, score: 0, reason: 'short_discriminator_mismatch' };
      }

      if (candShortDisc !== undefined) {
        const codeShort = codeDisc.type === 'long' ? (codeDisc.value >> 8) & 0x0f : codeDisc.value;
        if (candShortDisc === codeShort) return { matched: true, score: 70 };
        return { matched: false, score: 0, reason: 'short_discriminator_mismatch' };
      }
    }

    if (parsed.matter?.vendorId !== undefined && candidate.details.vendorId !== undefined) {
      if (Number(candidate.details.vendorId) !== parsed.matter.vendorId) {
        return { matched: false, score: 0, reason: 'vendor_id_mismatch' };
      }
    }

    if (parsed.matter?.productId !== undefined && candidate.details.productId !== undefined) {
      if (Number(candidate.details.productId) !== parsed.matter.productId) {
        return { matched: false, score: 0, reason: 'product_id_mismatch' };
      }
    }

    return { matched: true, score: 40 };
  }

  if (parsed.protocol === 'improv') {
    const hint = parsed.improv?.deviceNameHint?.toLowerCase();
    if (hint && candidate.name.toLowerCase().includes(hint)) {
      return { matched: true, score: 90 };
    }
    if (
      candidate.protocol === 'bluetooth' ||
      candidate.domain === 'esphome' ||
      candidate.domain === 'improv'
    ) {
      return { matched: true, score: 50 };
    }
  }

  if (parsed.protocol === 'vendor') {
    const vendor = parsed.vendor?.vendor.toLowerCase();
    if (vendor && candidate.domain.toLowerCase() === vendor) {
      return { matched: true, score: 80 };
    }
    const ident = parsed.vendor?.identifier?.toLowerCase();
    if (
      ident &&
      (candidate.id.toLowerCase().includes(ident) || candidate.name.toLowerCase().includes(ident))
    ) {
      return { matched: true, score: 90 };
    }
  }

  return { matched: false, score: 0, reason: 'unmatched' };
}

export function matchesDiscoveryRule(
  rule: DiscoveryMatcherRule,
  input: DiscoveryAdvertisementInput,
): boolean {
  if (input.domain && input.domain.toLowerCase() === rule.domain.toLowerCase()) return true;

  if (input.protocol === 'zeroconf' && rule.zeroconf) {
    const serviceType =
      (typeof input.details?.serviceType === 'string' ? input.details.serviceType : undefined) ??
      (typeof input.details?.type === 'string' ? input.details.type : undefined) ??
      '';
    for (const z of rule.zeroconf) {
      if (typeof z === 'string') {
        if (globMatches(z, serviceType)) return true;
      } else {
        if (!globMatches(z.type, serviceType)) continue;
        if (z.name && !globMatches(z.name, input.name)) continue;
        if (z.properties && input.details) {
          let allPropsMatch = true;
          for (const [propKey, propVal] of Object.entries(z.properties)) {
            const actualVal = String(input.details[propKey] ?? '');
            if (!globMatches(propVal, actualVal)) {
              allPropsMatch = false;
              break;
            }
          }
          if (allPropsMatch) return true;
        } else if (!z.properties) {
          return true;
        }
      }
    }
  }

  if (input.protocol === 'ssdp' && rule.ssdp) {
    for (const s of rule.ssdp) {
      if (s.manufacturer && !globMatches(s.manufacturer, String(input.details?.manufacturer ?? '')))
        continue;
      if (s.modelName && !globMatches(s.modelName, String(input.details?.modelName ?? '')))
        continue;
      if (s.deviceType && !globMatches(s.deviceType, String(input.details?.deviceType ?? '')))
        continue;
      if (s.st && !globMatches(s.st, String(input.details?.st ?? ''))) continue;
      if (s.nt && !globMatches(s.nt, String(input.details?.nt ?? ''))) continue;
      return true;
    }
  }

  if (input.protocol === 'dhcp' && rule.dhcp) {
    const mac = normalizeMac(input.mac ?? String(input.details?.macaddress ?? ''));
    const host = input.host ?? String(input.details?.hostname ?? '');
    for (const d of rule.dhcp) {
      if (d.macaddress && mac) {
        const cleanPattern = d.macaddress.replace(/[^a-fA-F0-9*]/g, '').toLowerCase();
        if (globMatches(cleanPattern, mac)) return true;
      }
      if (d.hostname && host && globMatches(d.hostname, host)) return true;
    }
  }

  if (input.protocol === 'bluetooth' && rule.bluetooth) {
    const localName = input.name ?? String(input.details?.local_name ?? '');
    const mfgId = input.details?.manufacturer_id as number | undefined;
    const sUuid = String(input.details?.service_uuid ?? '').toLowerCase();
    const sDataUuid = String(input.details?.service_data_uuid ?? '').toLowerCase();
    for (const b of rule.bluetooth) {
      if (b.local_name && globMatches(b.local_name, localName)) return true;
      if (b.manufacturer_id !== undefined && mfgId === b.manufacturer_id) return true;
      if (
        b.service_uuid &&
        sUuid &&
        (b.service_uuid.toLowerCase() === sUuid || sUuid.includes(b.service_uuid.toLowerCase()))
      )
        return true;
      if (
        b.service_data_uuid &&
        sDataUuid &&
        (b.service_data_uuid.toLowerCase() === sDataUuid ||
          sDataUuid.includes(b.service_data_uuid.toLowerCase()))
      )
        return true;
    }
  }

  if (input.protocol === 'usb' && rule.usb && input.usb) {
    for (const u of rule.usb) {
      if (u.vid && !globMatches(u.vid, input.usb.vid)) continue;
      if (u.pid && !globMatches(u.pid, input.usb.pid)) continue;
      if (u.description && !globMatches(u.description, input.usb.description ?? '')) continue;
      return true;
    }
  }

  if (input.protocol === 'mqtt' && rule.mqtt && input.mqttTopic) {
    for (const topicPattern of rule.mqtt) {
      if (mqttTopicMatches(topicPattern, input.mqttTopic)) return true;
    }
  }

  return false;
}

function mqttTopicMatches(pattern: string, topic: string): boolean {
  if (pattern === topic || pattern === '#') return true;
  const pParts = pattern.split('/');
  const tParts = topic.split('/');
  for (let i = 0; i < pParts.length; i++) {
    const p = pParts[i];
    if (p === '#') return true;
    if (p !== '+' && p !== tParts[i]) return false;
  }
  return pParts.length === tParts.length;
}

export const BUILTIN_DNS_SD_RULES: readonly DiscoveryMatcherRule[] = [
  {
    domain: 'homekit',
    zeroconf: ['_hap._tcp', '_hap._tcp.local.'],
  },
  {
    domain: 'matter',
    zeroconf: ['_matterc._udp', '_matterc._udp.local.', '_matter._tcp', '_matter._tcp.local.'],
  },
  {
    domain: 'esphome',
    zeroconf: ['_esphomelib._tcp', '_esphomelib._tcp.local.'],
  },
  {
    domain: 'shelly',
    zeroconf: ['_shelly._tcp', '_shelly._tcp.local.'],
  },
  {
    domain: 'wled',
    zeroconf: ['_wled._tcp', '_wled._tcp.local.'],
  },
  {
    domain: 'tasmota',
    zeroconf: ['_tasmota._tcp', '_tasmota._tcp.local.'],
  },
];
