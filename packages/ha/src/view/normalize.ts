/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  clockDeviceAliases,
  isServiceRoom,
  isVirtualDevice,
  isPhysicalHub,
  isButtonController,
} from './device-identity.js';
import { cameraRelationships, isPowerStrip } from './device-relationships.js';
import { cameraActivities, type CameraActivityBinding } from './camera-activity.js';
import { entityDomain, resolveCapabilities } from './capabilities.js';
import { earliestPending } from './pending-feedback.js';
import {
  deviceTelemetryRegistry,
  isSoftwareMediaEndpoint,
  preferredScaleEntity,
} from './device-telemetry.js';
import {
  controlDomains,
  specialDomains,
  securityClasses,
  isSecondary,
  friendlyName,
  displayNameForDevice,
  powerEntityMatchesDevice,
  isSegmentEntity,
  effectiveArea,
  entityCategory,
} from './matchers.js';
import { isStatefulScene } from './scene.js';
import { inferScenePlacements } from './placement.js';
import { collectAttention } from './attention.js';
import { associateBatteries } from './battery.js';
import type { HassEntity, HausAccessory, HausModel, Snapshot } from './types.js';

export { isSegmentEntity, effectiveArea, entityCategory } from './matchers.js';
export { isStatefulScene } from './scene.js';

export function normalizeHome(
  snapshot: Snapshot,
  cameraBindings: readonly CameraActivityBinding[] = [],
): HausModel {
  const generatedCameras = new Set(
    snapshot.entities.filter((entry) => entry.platform === 'haus').map((entry) => entry.entity_id),
  );
  snapshot = {
    ...snapshot,
    states: snapshot.states.filter(
      (entity) =>
        !(
          entity.entity_id.startsWith('camera.') &&
          (entity.attributes.haus_camera_proxy === 1 ||
            (generatedCameras.has(entity.entity_id) && entity.attributes.haus_native_camera !== 1))
        ),
    ),
  };
  const registry = deviceTelemetryRegistry(snapshot);
  const devices = new Map(snapshot.devices.map((device) => [device.id, device]));
  const relationships = cameraRelationships(snapshot);
  const cameraState = (state: HassEntity): HassEntity =>
    relationships.cameraSourceStates.has(state.entity_id)
      ? { ...state, state: relationships.cameraSourceStates.get(state.entity_id)! }
      : state;
  const clockAliases = clockDeviceAliases(snapshot.devices);
  const activity = cameraActivities(snapshot, cameraBindings);
  const deviceStates = new Map<string, HassEntity[]>();
  for (const original of snapshot.states) {
    if (activity.replaced.has(original.entity_id)) continue;
    const state = cameraState(original);
    const deviceId = registry.get(state.entity_id)?.device_id;
    const cameraId = relationships.entityOwners.get(state.entity_id);
    const key = cameraId
      ? `camera:${cameraId}`
      : deviceId
        ? `device:${clockAliases.get(deviceId) ?? deviceId}`
        : `entity:${state.entity_id}`;
    deviceStates.set(key, [...(deviceStates.get(key) ?? []), state]);
  }
  const visible = snapshot.states.filter((state) => !isSecondary(registry.get(state.entity_id)));
  const telemetryRank = (state: HassEntity) => {
    const deviceClass = state.attributes.device_class;
    return securityClasses.has(String(deviceClass))
      ? -1
      : deviceClass === 'temperature'
        ? 0
        : deviceClass === 'humidity'
          ? 1
          : /connectivity|battery/.test(String(deviceClass))
            ? 5
            : 2;
  };
  const groups = [...deviceStates.entries()];
  const primaryRank = (state: HassEntity) => {
    const domain = entityDomain(state);
    const rank: Record<string, number> = {
      camera: 0,
      printer: 1,
      light: 1,
      lock: 2,
      climate: 3,
      media_player: 4,
      cover: 5,
      fan: 6,
      valve: 7,
      humidifier: 8,
      water_heater: 9,
      alarm_control_panel: 10,
      siren: 11,
      vacuum: 12,
      switch: 13,
      input_boolean: 14,
      select: 20,
      number: 21,
      button: 22,
      input_select: 23,
      input_number: 24,
      input_button: 25,
    };
    return (rank[domain] ?? 100) + (isSegmentEntity(state) ? 50 : 0);
  };
  const isCandidate = (state: HassEntity) => {
    const domain = entityDomain(state);
    return (
      (controlDomains.has(domain) ||
        ['sensor', 'binary_sensor', 'device_tracker', 'event'].includes(domain)) &&
      (domain !== 'event' ||
        isButtonController(devices.get(registry.get(state.entity_id)?.device_id ?? ''))) &&
      !isSecondary(registry.get(state.entity_id)) &&
      !specialDomains.has(domain) &&
      !['battery', 'battery_charging'].includes(String(state.attributes.device_class))
    );
  };
  const accessories: HausAccessory[] = groups.flatMap(([groupKey, members]) => {
    let candidates = members.filter(isCandidate);
    // Infrastructure often exposes only diagnostics. Keep a read-only summary,
    // never promote a reboot button or a configuration switch to quick control.
    if (!candidates.length) {
      candidates = members.filter((state) => {
        const entry = registry.get(state.entity_id);
        return (
          entry?.device_id &&
          !entry.disabled_by &&
          !entry.hidden_by &&
          !['battery', 'battery_charging'].includes(String(state.attributes.device_class)) &&
          (['sensor', 'binary_sensor', 'device_tracker'].includes(entityDomain(state)) ||
            (isPhysicalHub(devices.get(entry.device_id)) && entityDomain(state) === 'button'))
        );
      });
    }
    if (!candidates.length) return [];
    const candidateEntry = registry.get(candidates[0].entity_id);
    const candidateDevice = candidateEntry?.device_id
      ? devices.get(candidateEntry.device_id)
      : undefined;
    const printerContext = [
      candidateDevice?.name,
      candidateDevice?.name_by_user,
      candidateDevice?.manufacturer,
      candidateDevice?.model,
      ...members.flatMap((state) => [state.entity_id, friendlyName(state)]),
    ]
      .filter(Boolean)
      .join(' ');
    const platforms = members.map((state) => registry.get(state.entity_id)?.platform);
    const isNetwork =
      platforms.some((platform) =>
        ['eero', 'unifi', 'asuswrt', 'upnp', 'fritz'].includes(platform ?? ''),
      ) || /\b(?:router|eero|ubiquiti|mikrotik|netgear)\b/i.test(printerContext);
    const isPrinter =
      platforms.includes('ipp') ||
      /\b(?:printer|printing|3d print|bambu|prusa|creality|octoprint|klipper|laserjet|officejet|deskjet|ecotank|workforce|imageclass|pixma|mfc[-\s])/i.test(
        printerContext,
      );
    const printerStatus = isPrinter
      ? candidates
          .filter((state) => {
            const domain = entityDomain(state);
            const label = `${state.entity_id} ${friendlyName(state)}`;
            return (
              domain === 'sensor' &&
              (/status|state|job|progress|connection/i.test(label) ||
                !/ink|toner|uptime|page|level/i.test(label))
            );
          })
          .sort((a, b) => a.entity_id.localeCompare(b.entity_id))
      : [];
    const infrastructure = isPhysicalHub(candidateDevice);
    const controller = isButtonController(candidateDevice);
    if (infrastructure) {
      const telemetry = members.filter(
        (state) =>
          !registry.get(state.entity_id)?.disabled_by &&
          !registry.get(state.entity_id)?.hidden_by &&
          ['sensor', 'binary_sensor'].includes(entityDomain(state)),
      );
      if (telemetry.length) candidates = telemetry;
    } else if (controller) {
      const buttons = candidates.filter((state) => entityDomain(state) === 'event');
      if (buttons.length) candidates = buttons;
    }
    const controls = candidates.filter((state) => controlDomains.has(entityDomain(state)));
    const networkStatus = isNetwork
      ? (candidates.find((state) => /(?:^|_)status$/.test(state.entity_id)) ??
        candidates.find((state) => state.entity_id.endsWith('_connected')))
      : undefined;
    const cameraPrimary = groupKey.startsWith('camera:')
      ? members.find((item) => item.entity_id === groupKey.slice(7))
      : undefined;
    const scalePrimary = preferredScaleEntity(candidates, candidateDevice);
    const hubStatus = infrastructure
      ? candidates.find((item) => /(?:connectivity|status|uptime)$/.test(item.entity_id))
      : undefined;
    const primary =
      cameraPrimary ??
      hubStatus ??
      networkStatus ??
      scalePrimary ??
      (printerStatus.length
        ? printerStatus[0]
        : controls.length
          ? [...controls].sort(
              (a, b) => primaryRank(a) - primaryRank(b) || a.entity_id.localeCompare(b.entity_id),
            )[0]
          : [...candidates].sort(
              (a, b) =>
                telemetryRank(a) - telemetryRank(b) || a.entity_id.localeCompare(b.entity_id),
            )[0]);
    const entry = registry.get(primary.entity_id);
    const deviceId = entry?.device_id ?? undefined;
    const device = cameraPrimary
      ? (members
          .map((item) => devices.get(registry.get(item.entity_id)?.device_id ?? ''))
          .find((item) => item?.model) ?? devices.get(deviceId ?? ''))
      : deviceId
        ? devices.get(deviceId)
        : undefined;
    const powerStrip = isPowerStrip(device, members);
    const buttonController = isButtonController(device);
    const clock = /clock|nixie/i.test(`${device?.model ?? ''} ${device?.name ?? ''}`);
    const separatedSwitches = members.filter((sibling) => {
      const domain = entityDomain(sibling);
      const primaryDomain = entityDomain(primary);
      if (
        cameraPrimary ||
        powerStrip ||
        isNetwork ||
        clock ||
        buttonController ||
        ['climate', 'water_heater'].includes(primaryDomain)
      )
        return false;
      if (
        sibling.entity_id === primary.entity_id ||
        !['switch', 'input_boolean'].includes(domain) ||
        !isCandidate(sibling) ||
        isStatefulScene(sibling, registry.get(sibling.entity_id), device)
      )
        return false;
      const label = `${sibling.entity_id} ${friendlyName(sibling)} ${registry.get(sibling.entity_id)?.name ?? ''}`;
      const primaryLabel = `${primary.entity_id} ${friendlyName(primary)} ${device?.name ?? ''}`;
      const isPowerEntity = powerEntityMatchesDevice(label, primaryLabel);
      const belongsToMainLight = entityDomain(primary) === 'light' && isPowerEntity;
      const isDevicePowerEntity =
        ['camera', 'media_player'].includes(entityDomain(primary)) && isPowerEntity;
      return !belongsToMainLight && !isDevicePowerEntity;
    });
    const separatedSwitchIds = new Set(separatedSwitches.map((item) => item.entity_id));
    const secondaryEntities = members.filter(
      (sibling) =>
        sibling.entity_id !== primary.entity_id && !separatedSwitchIds.has(sibling.entity_id),
    );
    const areaId =
      effectiveArea(entry, devices) ??
      secondaryEntities
        .map((sibling) => effectiveArea(registry.get(sibling.entity_id), devices))
        .find((area) => area !== undefined);
    const isService =
      isServiceRoom(snapshot.areas.find((area) => area.area_id === areaId)?.name ?? '') ||
      isStatefulScene(primary, entry, device) ||
      members.some((m) => isStatefulScene(m, registry.get(m.entity_id), device)) ||
      (platforms.includes('mobile_app') && !controls.length) ||
      isVirtualDevice(device) ||
      isSoftwareMediaEndpoint(primary, entry) ||
      (/(?:^|_)(?:scene_history|message|json)$/.test(primary.entity_id.split('.')[1] ?? '') &&
        !device);
    const accessory: HausAccessory = {
      id: primary.entity_id,
      deviceId,
      primaryEntityId: primary.entity_id,
      entityIds: [primary.entity_id, ...secondaryEntities.map((entity) => entity.entity_id)],
      areaId,
      manufacturer: device?.manufacturer,
      model: device?.model,
      category: isPrinter ? 'printers' : isNetwork ? 'network' : entityCategory(primary),
      buttonController: buttonController || undefined,
      physicalHub: isPhysicalHub(device) || undefined,
      name:
        scalePrimary && entry?.name
          ? entry.name
          : displayNameForDevice(
              primary,
              entry,
              device,
              isPrinter ||
                isNetwork ||
                powerStrip ||
                buttonController ||
                isPhysicalHub(device) ||
                Boolean(scalePrimary),
            ),
      powerStrip: powerStrip || undefined,
      visibilityEntityIds:
        cameraPrimary || powerStrip || clock || buttonController || isPhysicalHub(device)
          ? [primary.entity_id]
          : undefined,
      availability:
        primary.state !== 'unavailable' &&
        ((buttonController && primary.entity_id.startsWith('event.')) ||
          (isPhysicalHub(device) && primary.entity_id.startsWith('button.')))
          ? 'available'
          : primary.state === 'unavailable'
            ? 'unavailable'
            : primary.state === 'unknown'
              ? 'unknown'
              : 'available',
      capabilities: isPhysicalHub(device) ? [] : resolveCapabilities(primary, snapshot.services),
      state: primary,
      secondaryEntities,
      defaultHidden: isService ? true : undefined,
      isService: isService ? true : undefined,
      pending: members.some((member) => snapshot.pendingEntityIds?.includes(member.entity_id)),
      pendingSince: earliestPending(
        members.map((member) => snapshot.pendingSince?.[member.entity_id]),
      ),
    };
    const independentSwitches: HausAccessory[] = separatedSwitches.map((switchEntity) => {
      const switchEntry = registry.get(switchEntity.entity_id);
      return {
        id: switchEntity.entity_id,
        deviceId: switchEntry?.device_id ?? undefined,
        primaryEntityId: switchEntity.entity_id,
        entityIds: [switchEntity.entity_id],
        areaId: effectiveArea(switchEntry, devices) ?? areaId,
        manufacturer: device?.manufacturer,
        model: device?.model,
        category: entityCategory(switchEntity),
        name: displayNameForDevice(switchEntity, switchEntry, undefined, false),
        availability:
          switchEntity.state === 'unavailable'
            ? 'unavailable'
            : switchEntity.state === 'unknown'
              ? 'unknown'
              : 'available',
        capabilities: resolveCapabilities(switchEntity, snapshot.services),
        state: switchEntity,
        secondaryEntities: [],
        pending: snapshot.pendingEntityIds?.includes(switchEntity.entity_id),
        pendingSince: snapshot.pendingSince?.[switchEntity.entity_id],
      };
    });
    return [accessory, ...independentSwitches];
  });

  for (const [cameraId, sensor] of activity.sensors) {
    const camera = accessories.find((item) => item.primaryEntityId === cameraId);
    const external = accessories.find((item) => item.primaryEntityId === sensor.entity_id);
    if (camera) {
      camera.entityIds = [...new Set([...camera.entityIds, sensor.entity_id])];
      camera.secondaryEntities = [
        ...camera.secondaryEntities.filter((item) => item.entity_id !== sensor.entity_id),
        sensor,
      ];
      if (external) external.areaId ??= camera.areaId;
    }
  }

  associateBatteries(snapshot, accessories, registry, devices);

  const attention = collectAttention(snapshot, registry, devices, activity.replaced, accessories);
  const rooms = snapshot.areas
    .filter((area) => !isServiceRoom(area.name))
    .map((area) => ({
      id: area.area_id,
      name: area.name,
      accessories: accessories.filter((accessory) => accessory.areaId === area.area_id),
    }));
  const knownAreas = new Set(snapshot.areas.map((area) => area.area_id));
  const unassigned = accessories.filter(
    (accessory) => !accessory.areaId || !knownAreas.has(accessory.areaId),
  );
  if (unassigned.length)
    rooms.push({ id: 'unassigned', name: 'Unassigned', accessories: unassigned });
  const scenes = visible.filter((state) => entityDomain(state) === 'scene');
  const scenePlacements = inferScenePlacements(scenes, snapshot, registry, devices, knownAreas);

  return {
    accessories,
    rooms,
    scenes,
    scenePlacements,
    cameras: visible
      .filter(
        (state) =>
          entityDomain(state) === 'camera' && relationships.canonicalCameraIds.has(state.entity_id),
      )
      .map(cameraState),
    attention,
  };
}
