/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { InstalledApp } from './api';
import type { CatalogAppSummary, CatalogStabilityTier } from './catalog-api';

export type StabilityTier = CatalogStabilityTier;

export interface StabilityMedalInfo {
  readonly tier: StabilityTier;
  readonly trustScore: number;
  readonly medal: string;
  readonly label: string;
  readonly shortLabel: string;
}

export interface BrandIdentity {
  readonly vendorId: string;
  readonly vendorTitle: string;
  readonly iconId: string;
  readonly isCombinedHausGovee: boolean;
}

export interface CatalogVendorGroup {
  readonly vendorId: string;
  readonly vendorTitle: string;
  readonly iconId: string;
  readonly isCombinedHausGovee: boolean;
  readonly topTrustScore: number;
  readonly topStabilityTier: StabilityTier;
  readonly items: readonly CatalogAppSummary[];
  readonly installedCount: number;
  readonly whyGrouped: string;
}

export interface InstalledVendorGroup {
  readonly vendorId: string;
  readonly vendorTitle: string;
  readonly iconId: string;
  readonly isCombinedHausGovee: boolean;
  readonly apps: readonly InstalledApp[];
  readonly whyGrouped: string;
}

export const HAUS_GOVEE_WHY_GROUPED =
  'Haus unifies Govee2MQTT (low-latency LAN, BLE & Matter lights/sensors) and Homebridge Govee (LAN/BLE smart outlets & AWS IoT cloud) into Haus Govee for one seamless setup flow — while still letting you configure each engine separately.';

export const VENDOR_GROUP_WHY_DEFAULT =
  'Grouped by brand and ranked by stability & community trust for a unified setup experience — open the group to use the top recommended driver or configure any integration individually.';

const BRAND_RULES: ReadonlyArray<readonly [RegExp, string, string, string]> = [
  [
    /(?:^|[-_:/\s])(govee|govee2mqtt|govee_ble|govee_light_local)(?:$|[-_:/\s])/i,
    'govee',
    'Haus Govee',
    'govee',
  ],
  [/(?:^|[-_:/\s])(hue|philips[-_]?hue|hue_ble)(?:$|[-_:/\s])/i, 'hue', 'Philips Hue', 'hue'],
  [
    /(?:^|[-_:/\s])(tuya|localtuya|tuya_local|smart_life|smartlife)(?:$|[-_:/\s])/i,
    'tuya',
    'Tuya',
    'tuya',
  ],
  [/(?:^|[-_:/\s])reolink(?:$|[-_:/\s])/i, 'reolink', 'Reolink', 'reolink'],
  [/(?:^|[-_:/\s])(unifiprotect|unifi|ubiquiti)(?:$|[-_:/\s])/i, 'unifi', 'UniFi', 'unifiprotect'],
  [/(?:^|[-_:/\s])ring(?:$|[-_:/\s])/i, 'ring', 'Ring', 'ring'],
  [/(?:^|[-_:/\s])(aqara|xiaomi_aqara|mi-aqara)(?:$|[-_:/\s])/i, 'aqara', 'Aqara', 'aqara'],
  [
    /(?:^|[-_:/\s])(xiaomi|xiaomi_miio|xiaomi_ble|xiaomi_miot)(?:$|[-_:/\s])/i,
    'xiaomi',
    'Xiaomi',
    'xiaomi_miio',
  ],
  [/(?:^|[-_:/\s])(tplink|tapo|kasa|tp-link)(?:$|[-_:/\s])/i, 'tplink', 'TP-Link / Tapo', 'tplink'],
  [/(?:^|[-_:/\s])shelly(?:$|[-_:/\s])/i, 'shelly', 'Shelly', 'shelly'],
  [
    /(?:^|[-_:/\s])(switchbot|switchbot_cloud)(?:$|[-_:/\s])/i,
    'switchbot',
    'SwitchBot',
    'switchbot',
  ],
  [/(?:^|[-_:/\s])(sonos|zp)(?:$|[-_:/\s])/i, 'sonos', 'Sonos', 'sonos'],
  [/(?:^|[-_:/\s])(hikvision|hikvisioncam)(?:$|[-_:/\s])/i, 'hikvision', 'Hikvision', 'hikvision'],
  [/(?:^|[-_:/\s])(amcrest|dahua)(?:$|[-_:/\s])/i, 'amcrest', 'Amcrest / Dahua', 'amcrest'],
  [/(?:^|[-_:/\s])(apple_tv|appletv)(?:$|[-_:/\s])/i, 'apple_tv', 'Apple TV', 'apple_tv'],
  [
    /(?:^|[-_:/\s])(homekit_controller|homekit)(?:$|[-_:/\s])/i,
    'homekit',
    'HomeKit',
    'homekit_controller',
  ],
  [/(?:^|[-_:/\s])(nest|google-device-access)(?:$|[-_:/\s])/i, 'nest', 'Google Nest', 'nest'],
  [/(?:^|[-_:/\s])(eufy|eufy_security|eufylife_ble)(?:$|[-_:/\s])/i, 'eufy', 'Eufy', 'eufy'],
  [/(?:^|[-_:/\s])arlo(?:$|[-_:/\s])/i, 'arlo', 'Arlo', 'arlo'],
  [/(?:^|[-_:/\s])wyze(?:$|[-_:/\s])/i, 'wyze', 'Wyze', 'wyze'],
  [/(?:^|[-_:/\s])(meross|meross_lan)(?:$|[-_:/\s])/i, 'meross', 'Meross', 'meross'],
  [/(?:^|[-_:/\s])broadlink(?:$|[-_:/\s])/i, 'broadlink', 'Broadlink', 'broadlink'],
  [/(?:^|[-_:/\s])dyson(?:$|[-_:/\s])/i, 'dyson', 'Dyson', 'dyson'],
  [/(?:^|[-_:/\s])(ecobee|ecobee3)(?:$|[-_:/\s])/i, 'ecobee', 'ecobee', 'ecobee'],
  [/(?:^|[-_:/\s])(lutron|lutron_caseta)(?:$|[-_:/\s])/i, 'lutron', 'Lutron', 'lutron'],
  [
    /(?:^|[-_:/\s])(samsungtv|samsung|smartthings)(?:$|[-_:/\s])/i,
    'samsung',
    'Samsung',
    'samsungtv',
  ],
  [/(?:^|[-_:/\s])(webostv|lg_thinq|lgwebos)(?:$|[-_:/\s])/i, 'lg', 'LG', 'webostv'],
  [/(?:^|[-_:/\s])(braviatv|bravia|sony)(?:$|[-_:/\s])/i, 'sony', 'Sony Bravia', 'braviatv'],
  [
    /(?:^|[-_:/\s])(panasonic_viera|panasonic)(?:$|[-_:/\s])/i,
    'panasonic',
    'Panasonic',
    'panasonic_viera',
  ],
  [/(?:^|[-_:/\s])roborock(?:$|[-_:/\s])/i, 'roborock', 'Roborock', 'roborock'],
  [/(?:^|[-_:/\s])(sonoff|ewelink)(?:$|[-_:/\s])/i, 'sonoff', 'Sonoff', 'sonoff'],
  [/(?:^|[-_:/\s])onvif(?:$|[-_:/\s])/i, 'onvif', 'ONVIF', 'onvif'],
  [/(?:^|[-_:/\s])(mqtt|mqttthing)(?:$|[-_:/\s])/i, 'mqtt', 'MQTT', 'mqtt'],
  [/(?:^|[-_:/\s])(matter|matter-server)(?:$|[-_:/\s])/i, 'matter', 'Matter', 'matter'],
  [/(?:^|[-_:/\s])(zigbee|zha|zigbee2mqtt|z2m)(?:$|[-_:/\s])/i, 'zigbee', 'Zigbee', 'zigbee'],
  [/(?:^|[-_:/\s])(zwave_js|zwave)(?:$|[-_:/\s])/i, 'zwave', 'Z-Wave', 'zwave_js'],
];

export function stabilityTierFromScore(trustScore: number): StabilityTier {
  if (trustScore >= 88) return 'gold';
  if (trustScore >= 74) return 'silver';
  if (trustScore >= 54) return 'bronze';
  return 'low';
}

export function stabilityTierRank(tier: StabilityTier): number {
  if (tier === 'gold') return 4;
  if (tier === 'silver') return 3;
  if (tier === 'bronze') return 2;
  return 1;
}

export function formatStabilityMedal(
  tier?: StabilityTier,
  rawTrustScore?: number,
  verified?: boolean,
): StabilityMedalInfo {
  const trustScore =
    typeof rawTrustScore === 'number' && Number.isFinite(rawTrustScore)
      ? Math.max(10, Math.min(100, Math.round(rawTrustScore)))
      : verified
        ? 92
        : tier === 'gold'
          ? 92
          : tier === 'silver'
            ? 80
            : tier === 'bronze'
              ? 64
              : 45;
  const resolvedTier = tier ?? stabilityTierFromScore(trustScore);
  if (resolvedTier === 'gold') {
    return {
      tier: 'gold',
      trustScore,
      medal: '🥇',
      label: `Gold Stability · ${trustScore}% Trust`,
      shortLabel: `🥇 ${trustScore}%`,
    };
  }
  if (resolvedTier === 'silver') {
    return {
      tier: 'silver',
      trustScore,
      medal: '🥈',
      label: `Silver Stability · ${trustScore}% Trust`,
      shortLabel: `🥈 ${trustScore}%`,
    };
  }
  if (resolvedTier === 'bronze') {
    return {
      tier: 'bronze',
      trustScore,
      medal: '🥉',
      label: `Community · ${trustScore}% Trust`,
      shortLabel: `🥉 ${trustScore}%`,
    };
  }
  return {
    tier: 'low',
    trustScore,
    medal: '•',
    label: `Low Trust · ${trustScore}%`,
    shortLabel: `${trustScore}% Trust`,
  };
}

const EXACT_HA_DOMAIN_VENDORS: Readonly<Record<string, readonly [string, string, string]>> = {
  govee: ['govee', 'Haus Govee', 'govee'],
  hue: ['hue', 'Philips Hue', 'hue'],
  tuya: ['tuya', 'Tuya', 'tuya'],
  reolink: ['reolink', 'Reolink', 'reolink'],
  unifiprotect: ['unifi', 'UniFi', 'unifiprotect'],
  unifi: ['unifi', 'UniFi', 'unifiprotect'],
  ring: ['ring', 'Ring', 'ring'],
  aqara: ['aqara', 'Aqara', 'aqara'],
  tplink: ['tplink', 'TP-Link / Tapo', 'tplink'],
  shelly: ['shelly', 'Shelly', 'shelly'],
  switchbot: ['switchbot', 'SwitchBot', 'switchbot'],
  sonos: ['sonos', 'Sonos', 'sonos'],
  hikvision: ['hikvision', 'Hikvision', 'hikvision'],
  amcrest: ['amcrest', 'Amcrest / Dahua', 'amcrest'],
  dahua: ['amcrest', 'Amcrest / Dahua', 'amcrest'],
  nest: ['nest', 'Google Nest', 'nest'],
  eufy: ['eufy', 'Eufy', 'eufy'],
  arlo: ['arlo', 'Arlo', 'arlo'],
  wyze: ['wyze', 'Wyze', 'wyze'],
  meross_lan: ['meross', 'Meross', 'meross'],
  broadlink: ['broadlink', 'Broadlink', 'broadlink'],
  dyson: ['dyson', 'Dyson', 'dyson'],
  ecobee: ['ecobee', 'ecobee', 'ecobee'],
  lutron: ['lutron', 'Lutron', 'lutron'],
  samsungtv: ['samsung', 'Samsung', 'samsungtv'],
  webostv: ['lg', 'LG', 'webostv'],
  braviatv: ['sony', 'Sony Bravia', 'braviatv'],
  panasonic_viera: ['panasonic', 'Panasonic', 'panasonic_viera'],
  roborock: ['roborock', 'Roborock', 'roborock'],
  sonoff: ['sonoff', 'Sonoff', 'sonoff'],
  onvif: ['onvif', 'ONVIF', 'onvif'],
  mqtt: ['mqtt', 'MQTT', 'mqtt'],
  matter: ['matter', 'Matter', 'matter'],
  zigbee: ['zigbee', 'Zigbee', 'zigbee'],
  zwave_js: ['zwave', 'Z-Wave', 'zwave_js'],
};

export function resolveBrandIdentity(
  idOrPackage: string,
  rawTitle: string,
  explicitVendorId?: string,
  explicitVendorName?: string,
): BrandIdentity {
  const lowerId = idOrPackage.trim().toLowerCase();
  const exactHa = EXACT_HA_DOMAIN_VENDORS[lowerId];
  if (exactHa) {
    return {
      vendorId: exactHa[0],
      vendorTitle: exactHa[1],
      iconId: exactHa[2],
      isCombinedHausGovee: exactHa[0] === 'govee',
    };
  }
  const isEcosystemPkg =
    lowerId.startsWith('homebridge-') ||
    lowerId.startsWith('scrypted-') ||
    lowerId.startsWith('@') ||
    lowerId.startsWith('hb-') ||
    lowerId === 'govee2mqtt' ||
    lowerId === 'tuya-rtsp-bridge' ||
    lowerId === 'aqara-cameras' ||
    lowerId === 'aqara-g5pro' ||
    lowerId === 'matter-server' ||
    Boolean(explicitVendorId);

  if (isEcosystemPkg) {
    const probe = `${idOrPackage} ${rawTitle} ${explicitVendorId ?? ''} ${explicitVendorName ?? ''}`;
    for (const [match, vendorId, vendorTitle, iconId] of BRAND_RULES) {
      if (match.test(probe)) {
        return {
          vendorId,
          vendorTitle,
          iconId,
          isCombinedHausGovee: vendorId === 'govee',
        };
      }
    }
    if (explicitVendorId && explicitVendorName) {
      const isGovee = explicitVendorId.toLowerCase() === 'govee';
      return {
        vendorId: explicitVendorId.toLowerCase(),
        vendorTitle: isGovee ? 'Haus Govee' : explicitVendorName,
        iconId: isGovee ? 'govee' : explicitVendorId.toLowerCase(),
        isCombinedHausGovee: isGovee,
      };
    }
  }
  const cleanTitle =
    rawTitle
      .replace(/^Homebridge\s+/i, '')
      .replace(/\s+\(Scrypted\)$/i, '')
      .trim() || rawTitle;
  const slug = lowerId
    .replace(/^@[a-z0-9._-]+\//, '')
    .replace(/^(?:homebridge|scrypted|hb-[a-z0-9_]+)-/, '');
  return {
    vendorId: slug || lowerId,
    vendorTitle: cleanTitle,
    iconId: slug || lowerId,
    isCombinedHausGovee: false,
  };
}

export function isGoveeAppId(id: string): boolean {
  const lower = id.trim().toLowerCase().replace(/^app:/, '');
  return lower === 'govee' || lower === 'homebridge-govee' || lower === 'govee2mqtt';
}

export const GOVEE_BUILTIN_DRIVERS: ReadonlyArray<{
  readonly appId: 'homebridge-govee' | 'govee2mqtt';
  readonly title: string;
  readonly runtime: 'homebridge' | 'docker';
  readonly trustScore: number;
  readonly description: string;
}> = [
  {
    appId: 'homebridge-govee',
    title: 'Homebridge Govee',
    runtime: 'homebridge',
    trustScore: 96,
    description: 'Homebridge Govee engine for smart outlets, LAN UDP, BLE, and AWS IoT.',
  },
  {
    appId: 'govee2mqtt',
    title: 'Govee to MQTT',
    runtime: 'docker',
    trustScore: 95,
    description: 'Govee2MQTT engine for RGBIC lights, environmental sensors, LAN, BLE & Matter.',
  },
];

export function groupCatalogAppsByVendor(
  entries: readonly CatalogAppSummary[],
): readonly CatalogVendorGroup[] {
  const groups = new Map<string, CatalogAppSummary[]>();
  const metaByVendor = new Map<string, BrandIdentity>();

  for (const entry of entries) {
    const identity = resolveBrandIdentity(
      entry.packageName ?? entry.id,
      entry.name,
      entry.vendorId,
      entry.vendorName,
    );
    metaByVendor.set(identity.vendorId, identity);
    const bucket = groups.get(identity.vendorId);
    if (bucket) {
      bucket.push(entry);
    } else {
      groups.set(identity.vendorId, [entry]);
    }
  }

  const out: CatalogVendorGroup[] = [];
  for (const [vendorId, items] of groups.entries()) {
    const identity = metaByVendor.get(vendorId)!;
    const sorted = [...items].sort((a, b) => {
      if (identity.isCombinedHausGovee) {
        const rank = (id: string) =>
          id === 'govee' ? 0 : id === 'homebridge-govee' ? 1 : id === 'govee2mqtt' ? 2 : 3;
        const rDiff = rank(a.id) - rank(b.id);
        if (rDiff !== 0) return rDiff;
      }
      const scoreA = formatStabilityMedal(a.stabilityTier, a.trustScore, a.verified).trustScore;
      const scoreB = formatStabilityMedal(b.stabilityTier, b.trustScore, b.verified).trustScore;
      if (scoreB !== scoreA) return scoreB - scoreA;
      return a.name.localeCompare(b.name);
    });
    const topMedal = formatStabilityMedal(
      sorted[0]?.stabilityTier,
      sorted[0]?.trustScore,
      sorted[0]?.verified,
    );
    const installedCount = sorted.filter((i) => i.installed).length;
    out.push({
      vendorId,
      vendorTitle: identity.isCombinedHausGovee
        ? 'Haus Govee'
        : sorted.length > 1
          ? identity.vendorTitle
          : (sorted[0]?.name ?? identity.vendorTitle),
      iconId: identity.iconId,
      isCombinedHausGovee: identity.isCombinedHausGovee,
      topTrustScore: identity.isCombinedHausGovee ? 99 : topMedal.trustScore,
      topStabilityTier: identity.isCombinedHausGovee ? 'gold' : topMedal.tier,
      items: sorted,
      installedCount,
      whyGrouped: identity.isCombinedHausGovee ? HAUS_GOVEE_WHY_GROUPED : VENDOR_GROUP_WHY_DEFAULT,
    });
  }

  out.sort((a, b) => {
    if (a.isCombinedHausGovee !== b.isCombinedHausGovee) return a.isCombinedHausGovee ? -1 : 1;
    if (b.topTrustScore !== a.topTrustScore) return b.topTrustScore - a.topTrustScore;
    return a.vendorTitle.localeCompare(b.vendorTitle);
  });

  return out;
}

export function groupInstalledAppsWithHausGovee(apps: readonly InstalledApp[]): {
  readonly goveeGroup: InstalledVendorGroup | null;
  readonly standaloneApps: readonly InstalledApp[];
} {
  const goveeApps: InstalledApp[] = [];
  const standaloneApps: InstalledApp[] = [];
  for (const app of apps) {
    const ext = app.externalId || app.id;
    if (isGoveeAppId(ext) || isGoveeAppId(app.id)) {
      goveeApps.push(app);
    } else {
      standaloneApps.push(app);
    }
  }
  if (goveeApps.length === 0) {
    return { goveeGroup: null, standaloneApps };
  }
  return {
    goveeGroup: {
      vendorId: 'govee',
      vendorTitle: 'Haus Govee',
      iconId: 'govee',
      isCombinedHausGovee: true,
      apps: goveeApps,
      whyGrouped: HAUS_GOVEE_WHY_GROUPED,
    },
    standaloneApps,
  };
}
