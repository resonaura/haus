/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { HausDevice } from '@haus/core';

export type HomeKitPublicationRouteKind =
  | 'native_apple_home'
  | 'homekit_controller_import'
  | 'homebridge_virtualized'
  | 'haus_bridge'
  | 'haus_standalone'
  | 'excluded';

export interface PublicationRouteEvaluation {
  readonly route: HomeKitPublicationRouteKind;
  readonly eligibleForBridge: boolean;
  readonly eligibleForStandalone: boolean;
  readonly reason?: string;
}

export type PublicationGraphViolationType =
  | 'reimport_loop'
  | 'duplicate_route'
  | 'native_collision'
  | 'bridge_of_bridges'
  | 'bridge_capacity_exceeded';

export interface PublicationGraphViolation {
  readonly deviceId: string;
  readonly type: PublicationGraphViolationType;
  readonly message: string;
}

export interface PublicationGraphAuditReport {
  readonly totalDevices: number;
  readonly valid: boolean;
  readonly routes: ReadonlyMap<string, HomeKitPublicationRouteKind>;
  readonly violations: readonly PublicationGraphViolation[];
  readonly bridgeCount: number;
  readonly standaloneCount: number;
}

export interface EvaluateRouteOptions {
  readonly nativeAppleHomeIds?: ReadonlySet<string>;
  readonly standalonePreferred?: boolean;
}

export const MAX_HAP_BRIDGE_ACCESSORIES = 149;

/**
 * Classifies a HausDevice into its canonical Apple HomeKit publication route,
 * enforcing strict boundaries between imported accessories, Homebridge virtualization,
 * existing native Apple Home pairings, Haus multi-accessory bridges, and standalone accessories.
 */
export function evaluatePublicationRoute(
  device: HausDevice,
  options?: EvaluateRouteOptions,
): PublicationRouteEvaluation {
  // 1. Bridges cannot be bridged into another bridge
  if (
    device.relationships?.some((r) => r.type === 'bridge') ||
    (device.category === 'network' && device.name.toLowerCase().includes('bridge'))
  ) {
    return {
      route: 'excluded',
      eligibleForBridge: false,
      eligibleForStandalone: false,
      reason: 'cannot_bridge_existing_bridge',
    };
  }

  // 2. Prevent reimport loops: devices imported from an external HomeKit controller
  const protocol = device.connectivity?.protocol?.toLowerCase();
  const instanceId = device.source?.instanceId?.toLowerCase() ?? '';
  if (
    protocol === 'homekit' ||
    protocol === 'hap-ip' ||
    protocol === 'hap-ble' ||
    instanceId === 'homekit' ||
    instanceId.startsWith('homekit')
  ) {
    return {
      route: 'homekit_controller_import',
      eligibleForBridge: false,
      eligibleForStandalone: false,
      reason: 'imported_from_homekit_controller',
    };
  }

  // 3. Prevent duplicate publication: devices already paired directly to native Apple Home
  if (
    options?.nativeAppleHomeIds?.has(device.id) ||
    Boolean(device.metadata?.['native_apple_home']) ||
    Boolean(device.metadata?.['nativeAppleHome']) ||
    device.relationships?.some(
      (r) => r.targetDeviceId === 'apple-home' || r.metadata?.['platform'] === 'apple_home',
    )
  ) {
    return {
      route: 'native_apple_home',
      eligibleForBridge: false,
      eligibleForStandalone: false,
      reason: 'already_native_apple_home',
    };
  }

  // 4. Kitsune Homebridge plugin virtualization
  if (instanceId === 'kitsune:homebridge' || instanceId.includes('homebridge')) {
    return {
      route: 'homebridge_virtualized',
      eligibleForBridge: true,
      eligibleForStandalone: false,
      reason: 'homebridge_virtualized_accessory',
    };
  }

  // 5. Cameras and media streamers require dedicated RTP/SRTP standalone publication
  const hasCameraCapability = device.endpoints.some((ep) =>
    ep.capabilities.some(
      (c) => c.kind === 'camera' || c.kind === 'video' || c.id === 'camera' || c.id === 'video',
    ),
  );
  if (hasCameraCapability || (device.category === 'security' && options?.standalonePreferred)) {
    return {
      route: 'haus_standalone',
      eligibleForBridge: false,
      eligibleForStandalone: true,
      reason: 'high_capability_standalone_accessory',
    };
  }

  // 6. Standard Haus devices aggregated into the multi-accessory bridge
  return {
    route: 'haus_bridge',
    eligibleForBridge: true,
    eligibleForStandalone: Boolean(options?.standalonePreferred),
  };
}

/**
 * Audits an entire publication graph across all known Haus devices, active bridge members,
 * and standalone accessories, validating that zero loops, duplicate routes, or capacity violations exist.
 */
export function auditPublicationGraph(
  devices: readonly HausDevice[],
  published: {
    readonly bridgeDeviceIds: ReadonlySet<string>;
    readonly standaloneDeviceIds: ReadonlySet<string>;
  },
  options?: EvaluateRouteOptions,
): PublicationGraphAuditReport {
  const routes = new Map<string, HomeKitPublicationRouteKind>();
  const violations: PublicationGraphViolation[] = [];
  const deviceMap = new Map<string, HausDevice>();

  for (const device of devices) {
    deviceMap.set(device.id, device);
    const evaluation = evaluatePublicationRoute(device, options);
    routes.set(device.id, evaluation.route);
  }

  // Check bridge device list
  let bridgeCount = 0;
  for (const id of published.bridgeDeviceIds) {
    bridgeCount++;
    const device = deviceMap.get(id);
    if (!device) continue;

    const route = routes.get(id) ?? evaluatePublicationRoute(device, options).route;

    if (route === 'homekit_controller_import') {
      violations.push({
        deviceId: id,
        type: 'reimport_loop',
        message: `Device ${id} was imported from an external HomeKit controller and cannot be re-published via HAP bridge`,
      });
    }

    if (route === 'native_apple_home') {
      violations.push({
        deviceId: id,
        type: 'native_collision',
        message: `Device ${id} is already paired natively in Apple Home and cannot be bridged`,
      });
    }

    if (route === 'excluded') {
      violations.push({
        deviceId: id,
        type: 'bridge_of_bridges',
        message: `Device ${id} is a bridge and cannot be added as a bridged accessory`,
      });
    }

    // Check duplicate route (bridge + standalone simultaneously)
    if (published.standaloneDeviceIds.has(id)) {
      violations.push({
        deviceId: id,
        type: 'duplicate_route',
        message: `Device ${id} is published both as a bridged accessory and standalone accessory`,
      });
    }
  }

  // Check standalone device list
  let standaloneCount = 0;
  for (const id of published.standaloneDeviceIds) {
    standaloneCount++;
    const device = deviceMap.get(id);
    if (!device) continue;

    const route = routes.get(id) ?? evaluatePublicationRoute(device, options).route;

    if (route === 'homekit_controller_import') {
      violations.push({
        deviceId: id,
        type: 'reimport_loop',
        message: `Device ${id} was imported from HomeKit and cannot be re-published as a standalone accessory`,
      });
    }

    if (route === 'native_apple_home') {
      violations.push({
        deviceId: id,
        type: 'native_collision',
        message: `Device ${id} is already paired natively in Apple Home and cannot be re-published`,
      });
    }
  }

  // Check bridge capacity limit
  if (published.bridgeDeviceIds.size > MAX_HAP_BRIDGE_ACCESSORIES) {
    violations.push({
      deviceId: 'hap-bridge',
      type: 'bridge_capacity_exceeded',
      message: `HAP bridge contains ${published.bridgeDeviceIds.size} accessories, exceeding the Apple HomeKit limit of ${MAX_HAP_BRIDGE_ACCESSORIES}`,
    });
  }

  return {
    totalDevices: devices.length,
    valid: violations.length === 0,
    routes,
    violations,
    bridgeCount,
    standaloneCount,
  };
}
