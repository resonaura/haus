/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { isDeviceType, type DeviceType } from './category.js';
import type { HausService } from './graph.js';
import type { HausDevice } from './types.js';

export interface PowerStripPresentation {
  readonly outletEndpointIds: readonly string[];
  readonly masterEndpointId?: string;
}

export interface DevicePresentationMetadata {
  readonly deviceType?: DeviceType;
  readonly serviceDevice?: true;
  readonly managementUrl?: string;
  readonly powerStrip?: PowerStripPresentation;
  readonly independentLightEndpoints?: readonly string[];
  readonly segmentLightEndpoints?: readonly string[];
}

const VIRTUAL_MODEL_RE = /^(?:integration|home assistant app|homebridge|service|add-on|addon)$/i;
const VIRTUAL_BRIDGE_RE = /\b(?:2mqtt|to\s+mqtt|mqtt\s+bridge)\b/i;
const CLOCK_DEVICE_RE = /\b(?:clock|nixie)\b/i;
const LIGHT_STRIP_RE = /\b(?:lightstrip|light\s*strip|led\s*strip|gradient\s*strip)\b/i;
const OUTLET_HINT_RE = /\b(?:plug|outlet|socket|H508\d|H5001|H516[01])\b/i;
const BRIDGE_HINT_RE = /\b(?:hue\s*bridge|zigbee\s*coordinator|matter\s*bridge|gateway|bridge)\b/i;
const ROUTER_HINT_RE = /\b(?:router|eero|ubiquiti|unifi|mikrotik|mesh|access\s*point)\b/i;
const PRINTER_HINT_RE = /\b(?:printer|bambu|prusa|creality|octoprint|klipper|laserjet|ecotank)\b/i;
const SCALE_HINT_RE = /\b(?:scale|body\s*composition)\b/i;
const KETTLE_HINT_RE = /\b(?:kettle|boiler)\b/i;
const VACUUM_HINT_RE = /\b(?:vacuum|roborock|roomba|dreame)\b/i;
const DOORBELL_HINT_RE = /\b(?:doorbell|chime)\b/i;
const TV_HINT_RE = /\b(?:apple\s*tv|tvos|television|\btv\b)\b/i;
const SEGMENT_LIGHT_RE =
  /segment|pixel|(?:^|[_.\s-])zone(?:$|[_.\s-])|(?:^|[_.\s-])tube(?:\s*\d+)?(?:$|[_.\s-])/i;
const AUXILIARY_LIGHT_RE =
  /(?:^|[_.\s-])(?:power[_\s-]*switch|status[_\s-]*light|indicator|led[_\s-]*ring)(?:$|[_.\s-])/i;
const MASTER_OUTLET_ID_RE = /(?:^|[_.\s-])(?:power|all|master|main|switch_all)$/i;
const MASTER_OUTLET_NAME_RE =
  /^(?:power|all|all\s+outlets|all\s+sockets|master|main|switch\s+all)$/i;

function isSubzoneLight(
  device: Pick<HausDevice, 'name' | 'model'>,
  endpointId: string,
  label: string,
): boolean {
  if (CLOCK_DEVICE_RE.test(`${device.model ?? ''} ${device.name ?? ''}`)) return true;
  return SEGMENT_LIGHT_RE.test(`${endpointId} ${label}`);
}

function isTypedService(svc: HausService | undefined): svc is HausService {
  return Boolean(svc && typeof svc.type === 'string' && Array.isArray(svc.characteristics));
}

function serviceEndpointId(svc: HausService): string | undefined {
  const fromSubtype = typeof svc.subtype === 'string' && svc.subtype ? svc.subtype : undefined;
  const fromMeta = Array.isArray(svc.characteristics)
    ? svc.characteristics[0]?.metadata?.['endpointId']
    : undefined;
  return fromSubtype ?? (typeof fromMeta === 'string' && fromMeta ? fromMeta : undefined);
}

/** True when a switch/outlet endpoint represents a power strip's master all-outlets switch. */
export function isMasterPowerOutlet(endpointId: string, label?: string): boolean {
  if (label && MASTER_OUTLET_NAME_RE.test(label.trim())) return true;
  return MASTER_OUTLET_ID_RE.test(endpointId.trim());
}

/** Resolves canonical power-strip presentation from protocol-neutral services and device type. */
export function detectPowerStripPresentation(
  device: Pick<HausDevice, 'category' | 'deviceType'>,
  services: readonly HausService[],
): PowerStripPresentation | undefined {
  const switchServices = services.filter(
    (svc) =>
      isTypedService(svc) &&
      (svc.type === 'Outlet' || svc.type === 'Switch') &&
      svc.characteristics.some(
        (ch) => (ch.type === 'power' || ch.type === 'on_off') && ch.writable,
      ),
  );
  const outletServices = switchServices.filter((svc) => svc.type === 'Outlet');
  const isStrip =
    device.deviceType === 'power_strip' ||
    outletServices.length >= 2 ||
    (device.category === 'power' && switchServices.length >= 2);
  if (!isStrip || switchServices.length === 0) return undefined;

  const entries = switchServices
    .map((svc) => ({
      endpointId: serviceEndpointId(svc),
      name: svc.name ?? '',
      role: svc.opaqueMetadata?.['outletRole'],
    }))
    .filter((entry): entry is { endpointId: string; name: string; role: unknown } =>
      Boolean(entry.endpointId),
    );
  if (entries.length === 0) return undefined;

  const masterCandidates = entries.filter(
    (entry) => entry.role === 'master' || isMasterPowerOutlet(entry.endpointId, entry.name),
  );
  const nonMasters = entries.filter((entry) => !masterCandidates.includes(entry));
  if (masterCandidates.length === 1 && nonMasters.length >= 2) {
    return {
      masterEndpointId: masterCandidates[0]!.endpointId,
      outletEndpointIds: nonMasters.map((entry) => entry.endpointId),
    };
  }
  return {
    outletEndpointIds: entries.map((entry) => entry.endpointId),
  };
}

/** Resolves the canonical `DeviceType` for any `HausDevice` from services, category, and metadata. */
export function resolveDeviceType(
  device: Pick<HausDevice, 'name' | 'model' | 'category' | 'deviceType'>,
  services: readonly HausService[],
  hints: {
    readonly powerStrip?: PowerStripPresentation;
    readonly serviceDevice?: boolean;
  } = {},
): DeviceType {
  if (hints.serviceDevice) return 'service';
  if (hints.powerStrip) return 'power_strip';
  if (
    device.deviceType &&
    isDeviceType(device.deviceType) &&
    device.deviceType !== 'generic' &&
    device.deviceType !== 'outlet' &&
    device.deviceType !== 'switch'
  ) {
    return device.deviceType;
  }

  const typedServices = services.filter(isTypedService);
  const label = `${device.model ?? ''} ${device.name ?? ''}`;
  const types = new Set(typedServices.map((svc) => svc.type));

  if (types.has('CameraRTPStreamManagement') || device.category === 'cameras') {
    return types.has('Doorbell') || DOORBELL_HINT_RE.test(label) ? 'doorbell' : 'camera';
  }
  if (types.has('WaterHeater') || KETTLE_HINT_RE.test(label)) return 'kettle';
  if (types.has('Thermostat') || types.has('HeaterCooler')) return 'thermostat';
  if (types.has('AirPurifier')) return 'air_purifier';
  if (types.has('HumidifierDehumidifier')) return 'humidifier';
  if (types.has('Fan') || types.has('Fanv2')) return 'fan';
  if (types.has('LockMechanism')) return 'lock';
  if (types.has('SecuritySystem')) return 'security_system';
  if (
    types.has('WindowCovering') ||
    types.has('GarageDoorOpener') ||
    types.has('Door') ||
    types.has('Window') ||
    device.category === 'covers'
  ) {
    return 'cover';
  }
  if (types.has('Television')) return 'television';
  if (types.has('SmartSpeaker') || types.has('Speaker')) {
    return TV_HINT_RE.test(label) ? 'television' : 'speaker';
  }
  if (types.has('Remote')) return 'remote';
  if (CLOCK_DEVICE_RE.test(label)) return 'clock';
  if (SCALE_HINT_RE.test(label)) return 'scale';
  if (PRINTER_HINT_RE.test(label)) return 'printer';
  if (VACUUM_HINT_RE.test(label)) return 'vacuum';
  if (types.has('WiFiRouter') || types.has('WiFiSatellite')) return 'router';
  if (types.has('Lightbulb')) {
    return LIGHT_STRIP_RE.test(label) ? 'light_strip' : 'light';
  }
  if (types.has('Outlet')) return 'outlet';
  if (types.has('Switch')) return OUTLET_HINT_RE.test(label) ? 'outlet' : 'switch';
  if (types.has('StatelessProgrammableSwitch')) return 'button_controller';
  if (ROUTER_HINT_RE.test(label) || device.category === 'network') {
    return ROUTER_HINT_RE.test(label) ? 'router' : 'bridge';
  }
  if (BRIDGE_HINT_RE.test(label)) return 'bridge';

  switch (device.category) {
    case 'lighting':
      return LIGHT_STRIP_RE.test(label) ? 'light_strip' : 'light';
    case 'power':
      return OUTLET_HINT_RE.test(label) ? 'outlet' : 'switch';
    case 'climate':
      return 'thermostat';
    case 'media':
      return TV_HINT_RE.test(label) ? 'television' : 'speaker';
    case 'appliances':
      return 'appliance';
    case 'safety_sensors':
    case 'environmental_sensors':
    case 'occupancy_sensors':
    case 'energy':
      return 'sensor';
    case 'security':
      return typedServices.some((svc) => svc.type.endsWith('Sensor'))
        ? 'sensor'
        : 'security_system';
    default:
      return typedServices.some(
        (svc) => svc.type.endsWith('Sensor') || svc.type === 'PowerManagement',
      )
        ? 'sensor'
        : 'generic';
  }
}

function sanitizeManagementUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2048) return undefined;
  try {
    const parsed = new URL(trimmed);
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password
    ) {
      return undefined;
    }
    return parsed.href;
  } catch {
    return undefined;
  }
}

/** Computes Hub-authoritative presentation hints so clients render canonical lists without guessing. */
export function computeDevicePresentation(
  device: Pick<
    HausDevice,
    'id' | 'name' | 'model' | 'category' | 'deviceType' | 'endpoints' | 'opaqueMetadata'
  >,
  services: readonly HausService[],
): DevicePresentationMetadata {
  const serviceDevice =
    VIRTUAL_MODEL_RE.test(String(device.model ?? '').trim()) ||
    VIRTUAL_BRIDGE_RE.test(`${device.model ?? ''} ${device.name ?? ''}`);

  const typedServices = services.filter(isTypedService);
  const powerStrip = detectPowerStripPresentation(device, typedServices);
  const lightServices = typedServices.filter((svc) => svc.type === 'Lightbulb');
  const independentLightEndpoints: string[] = [];
  const segmentLightEndpoints: string[] = [];

  if (lightServices.length > 1) {
    for (const svc of lightServices) {
      const epId = serviceEndpointId(svc);
      if (!epId) continue;
      const label = svc.name ?? '';
      if (isSubzoneLight(device, epId, label)) {
        segmentLightEndpoints.push(epId);
      } else if (!AUXILIARY_LIGHT_RE.test(`${epId} ${label}`)) {
        independentLightEndpoints.push(epId);
      }
    }
  }

  const deviceType = resolveDeviceType(device, services, {
    powerStrip,
    serviceDevice,
  });
  const managementUrl = sanitizeManagementUrl(device.opaqueMetadata?.['managementUrl']);

  return {
    deviceType,
    ...(serviceDevice ? { serviceDevice: true as const } : {}),
    ...(managementUrl ? { managementUrl } : {}),
    ...(powerStrip ? { powerStrip } : {}),
    ...(independentLightEndpoints.length > 1 ? { independentLightEndpoints } : {}),
    ...(segmentLightEndpoints.length > 0 ? { segmentLightEndpoints } : {}),
  };
}
