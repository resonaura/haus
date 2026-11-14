/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { DiscoveryAdvertisementInput, DiscoveryMatcherRule } from './discovery-types.js';
import { globMatches, normalizeMac } from './discovery-deduplicator.js';
import { scoreBluetoothRule } from './bluetooth-matcher.js';

const GENERIC_ZEROCONF_TYPES = new Set(['_http._tcp', '_https._tcp', '_hap._tcp', '_hap._udp']);
const GENERIC_FALLBACK_DOMAINS = new Set([
  'generic',
  'homekit',
  'homekit_controller',
  'dlna_dmr',
  'dlna_dms',
  'upnp',
  'ipp',
]);
const GENERIC_SSDP_URN_RE = /:(MediaRenderer|MediaServer|InternetGatewayDevice):/i;

export function normalizeZeroconfServiceType(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\.local\.?$/, '')
    .replace(/\.$/, '');
}

function lookupInRecordCaseInsensitive(
  record: Readonly<Record<string, unknown>> | undefined,
  key: string,
): unknown {
  if (!record) return undefined;
  if (key in record && record[key] !== undefined) return record[key];
  const lower = key.toLowerCase();
  for (const [k, v] of Object.entries(record)) {
    if (k.toLowerCase() === lower && v !== undefined) return v;
  }
  return undefined;
}

function lookupDetailCaseInsensitive(
  details: Readonly<Record<string, unknown>> | undefined,
  key: string,
): unknown {
  if (!details) return undefined;
  const direct = lookupInRecordCaseInsensitive(details, key);
  if (direct !== undefined) return direct;
  for (const nestedKey of ['rawTxt', 'ssdpHeaders', 'headers'] as const) {
    const nested = details[nestedKey];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      const found = lookupInRecordCaseInsensitive(nested as Record<string, unknown>, key);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function isHapPaired(details: Readonly<Record<string, unknown>> | undefined): boolean {
  if (!details) return false;
  const sf = lookupDetailCaseInsensitive(details, 'sf');
  if (sf !== undefined && String(sf).trim() === '0') return true;
  if (details.paired === true || details.pairingAvailable === false) return true;
  return false;
}

function matchesZeroconfType(pattern: string, actual: string): boolean {
  if (!actual) return false;
  if (globMatches(pattern, actual)) return true;
  return globMatches(normalizeZeroconfServiceType(pattern), normalizeZeroconfServiceType(actual));
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

function matchesHomeKitModels(
  models: readonly string[] | undefined,
  details: Readonly<Record<string, unknown>> | undefined,
): boolean {
  if (!models || models.length === 0 || !details) return false;
  const rawModel =
    lookupDetailCaseInsensitive(details, 'model') ?? lookupDetailCaseInsensitive(details, 'md');
  if (typeof rawModel !== 'string' || !rawModel.trim()) return false;
  const trimmed = rawModel.trim();
  const candidates = new Set<string>([
    trimmed.toLowerCase(),
    trimmed.split(' ')[0]!.toLowerCase(),
    trimmed.split('-')[0]!.toLowerCase(),
  ]);
  return models.some((pattern) => {
    const clean = pattern.trim();
    if (!clean) return false;
    if (clean.includes('*')) return globMatches(clean, trimmed);
    return candidates.has(clean.toLowerCase());
  });
}

function scoreZeroconfRule(rule: DiscoveryMatcherRule, input: DiscoveryAdvertisementInput): number {
  if (!rule.zeroconf?.length) return 0;
  const serviceType =
    (typeof input.details?.serviceType === 'string' ? input.details.serviceType : undefined) ??
    (typeof input.details?.type === 'string' ? input.details.type : undefined) ??
    '';
  const normType = normalizeZeroconfServiceType(serviceType);
  const isGenericHap =
    (rule.domain === 'homekit' || rule.domain === 'homekit_controller') &&
    !rule.homekit?.models?.length;
  if (isGenericHap && normType.startsWith('_hap.') && isHapPaired(input.details)) {
    return 0;
  }

  let best = 0;
  for (const z of rule.zeroconf) {
    if (typeof z === 'string') {
      if (!matchesZeroconfType(z, serviceType)) continue;
      const base = GENERIC_ZEROCONF_TYPES.has(normalizeZeroconfServiceType(z)) ? 15 : 60;
      best = Math.max(best, base);
      continue;
    }

    if (!matchesZeroconfType(z.type, serviceType)) continue;
    if (z.name && !globMatches(z.name, input.name ?? '')) continue;
    if (z.properties) {
      if (!input.details) continue;
      const entries = Object.entries(z.properties);
      if (
        !entries.every(([propKey, propVal]) => {
          const actual = lookupDetailCaseInsensitive(input.details, propKey);
          return actual !== undefined && globMatches(propVal, String(actual));
        })
      ) {
        continue;
      }
      const base = GENERIC_ZEROCONF_TYPES.has(normalizeZeroconfServiceType(z.type)) ? 15 : 55;
      best = Math.max(best, base + (z.name ? 30 : 0) + entries.length * 35);
    } else {
      const base = GENERIC_ZEROCONF_TYPES.has(normalizeZeroconfServiceType(z.type)) ? 15 : 55;
      best = Math.max(best, base + (z.name ? 30 : 0));
    }
  }
  return best;
}

function scoreSsdpKey(key: string, pattern: string): number {
  const lower = key.toLowerCase();
  if (lower === 'manufacturer' || lower === 'modelname') return 35;
  if (lower === 'modeldescription' || lower === 'manufacturerurl') return 30;
  if (lower === 'devicetype' || lower === 'st' || lower === 'nt') {
    return GENERIC_SSDP_URN_RE.test(pattern) ? 10 : 25;
  }
  return 25;
}

function scoreSsdpRule(rule: DiscoveryMatcherRule, input: DiscoveryAdvertisementInput): number {
  if (!rule.ssdp?.length || !input.details) return 0;
  const details = input.details;
  let best = 0;
  for (const s of rule.ssdp) {
    const entries = Object.entries(s).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === 'string' && entry[1].trim().length > 0,
    );
    if (entries.length === 0) continue;

    let matched = true;
    let score = 0;
    for (const [key, pattern] of entries) {
      const actual = lookupDetailCaseInsensitive(details, key);
      if (actual === undefined || !globMatches(pattern, String(actual))) {
        matched = false;
        break;
      }
      score += scoreSsdpKey(key, pattern);
    }
    if (matched) {
      best = Math.max(best, score);
    }
  }
  return best;
}

function isIpLiteral(value: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value.trim()) || value.includes(':');
}

function scoreDhcpRule(rule: DiscoveryMatcherRule, input: DiscoveryAdvertisementInput): number {
  if (!rule.dhcp?.length) return 0;
  const mac = normalizeMac(
    input.mac ?? String(lookupDetailCaseInsensitive(input.details, 'macaddress') ?? ''),
  );
  const detailHost = lookupDetailCaseInsensitive(input.details, 'hostname');
  const host =
    (typeof detailHost === 'string' && detailHost.trim() ? detailHost.trim() : undefined) ??
    (input.host && !isIpLiteral(input.host) ? input.host : undefined) ??
    input.name;

  let best = 0;
  for (const d of rule.dhcp) {
    if (!d.macaddress && !d.hostname) continue;
    if (d.macaddress) {
      if (!mac) continue;
      const cleanPattern = d.macaddress.replace(/[^a-fA-F0-9*]/g, '').toLowerCase();
      if (!globMatches(cleanPattern, mac)) continue;
    }
    if (d.hostname) {
      if (!host || !globMatches(d.hostname, host)) continue;
    }
    best = Math.max(best, d.macaddress && d.hostname ? 50 : 22);
  }
  return best;
}

export function isGenericDiscoveryDomain(domain: string): boolean {
  return GENERIC_FALLBACK_DOMAINS.has(domain.toLowerCase());
}

/**
 * Computes a specificity score (> 0 when matched, 0 otherwise) for a discovery rule
 * so vendor-specific matchers always beat generic fallback handlers.
 */
export function scoreDiscoveryRuleMatch(
  rule: DiscoveryMatcherRule,
  input: DiscoveryAdvertisementInput,
): number {
  if (input.domain && input.domain.toLowerCase() === rule.domain.toLowerCase()) return 1000;

  const serviceType =
    (typeof input.details?.serviceType === 'string' ? input.details.serviceType : undefined) ??
    (typeof input.details?.type === 'string' ? input.details.type : undefined) ??
    '';
  const normType = normalizeZeroconfServiceType(serviceType);

  if (
    rule.homekit?.models?.length &&
    (input.protocol === 'homekit' ||
      (input.protocol === 'zeroconf' && normType.startsWith('_hap.')))
  ) {
    if (matchesHomeKitModels(rule.homekit.models, input.details)) {
      return 140;
    }
  }

  if (input.protocol === 'zeroconf') return scoreZeroconfRule(rule, input);
  if (input.protocol === 'homekit') {
    const hapServiceType =
      typeof input.details?.serviceType === 'string'
        ? input.details.serviceType
        : typeof input.details?.type === 'string'
          ? input.details.type
          : '_hap._tcp.local.';
    return scoreZeroconfRule(rule, {
      ...input,
      protocol: 'zeroconf',
      details: { ...input.details, serviceType: hapServiceType },
    });
  }
  if (input.protocol === 'ssdp') return scoreSsdpRule(rule, input);
  if (input.protocol === 'dhcp') return scoreDhcpRule(rule, input);
  if (input.protocol === 'bluetooth') return scoreBluetoothRule(rule, input);

  if (input.protocol === 'usb' && rule.usb && input.usb) {
    for (const u of rule.usb) {
      if (!u.vid && !u.pid && !u.description && !u.manufacturer) continue;
      if (u.vid && !globMatches(u.vid, input.usb.vid)) continue;
      if (u.pid && !globMatches(u.pid, input.usb.pid)) continue;
      if (u.description && !globMatches(u.description, input.usb.description ?? '')) continue;
      if (u.manufacturer && !globMatches(u.manufacturer, input.usb.manufacturer ?? '')) continue;
      return (
        60 +
        Number(Boolean(u.vid)) * 10 +
        Number(Boolean(u.pid)) * 10 +
        Number(Boolean(u.manufacturer)) * 10 +
        Number(Boolean(u.description)) * 5
      );
    }
  }

  if (input.protocol === 'mqtt' && rule.mqtt && input.mqttTopic) {
    for (const topicPattern of rule.mqtt) {
      if (mqttTopicMatches(topicPattern, input.mqttTopic)) {
        return (
          55 + topicPattern.split('/').filter((seg) => seg && seg !== '+' && seg !== '#').length * 5
        );
      }
    }
  }

  return 0;
}

export function matchesDiscoveryRule(
  rule: DiscoveryMatcherRule,
  input: DiscoveryAdvertisementInput,
): boolean {
  return scoreDiscoveryRuleMatch(rule, input) > 0;
}

export function matchAllDiscoveryRules(
  rules: readonly DiscoveryMatcherRule[],
  input: DiscoveryAdvertisementInput,
): readonly { readonly rule: DiscoveryMatcherRule; readonly score: number }[] {
  const matches: { readonly rule: DiscoveryMatcherRule; readonly score: number }[] = [];
  const serviceType =
    (typeof input.details?.serviceType === 'string' ? input.details.serviceType : undefined) ??
    (typeof input.details?.type === 'string' ? input.details.type : undefined) ??
    '';
  const isHap =
    input.protocol === 'homekit' ||
    (input.protocol === 'zeroconf' &&
      normalizeZeroconfServiceType(serviceType).startsWith('_hap.'));
  let suppressGenericHomeKit = false;

  for (const rule of rules) {
    const score = scoreDiscoveryRuleMatch(rule, input);
    if (score <= 0) continue;
    matches.push({ rule, score });
    if (
      isHap &&
      rule.homekit?.models?.length &&
      rule.homekit.alwaysDiscover === false &&
      !isHapPaired(input.details) &&
      matchesHomeKitModels(rule.homekit.models, input.details)
    ) {
      suppressGenericHomeKit = true;
    }
  }

  const filtered = suppressGenericHomeKit
    ? matches.filter(
        (m) =>
          (m.rule.domain !== 'homekit' && m.rule.domain !== 'homekit_controller') ||
          Boolean(input.domain && input.domain.toLowerCase() === m.rule.domain.toLowerCase()),
      )
    : matches;

  return filtered.sort((a, b) => b.score - a.score);
}

export function selectBestDiscoveryMatch(
  rules: readonly DiscoveryMatcherRule[],
  input: DiscoveryAdvertisementInput,
): { readonly rule: DiscoveryMatcherRule; readonly score: number } | undefined {
  return matchAllDiscoveryRules(rules, input)[0];
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
