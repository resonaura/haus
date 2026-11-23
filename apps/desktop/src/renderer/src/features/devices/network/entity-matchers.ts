/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { HassEntity, HausAccessory } from '../../../model';

/**
 * Returns the canonical Home Assistant entity ID (e.g. `image.system_crawford_qr_code`
 * or `update.narnia_eero_firmware`) even when Desktop's Hub bridge assigns a synthetic
 * compat entity ID (`sensor.ha_<entry>_<device>_<idx>`).
 */
export function canonicalHaEntityId(entity: HassEntity): string {
  const attrId = entity.attributes.haus_ha_entity_id;
  if (typeof attrId === 'string' && attrId.includes('.')) {
    return attrId.toLowerCase();
  }
  return entity.entity_id.toLowerCase();
}

export function canonicalDomain(entity: HassEntity): string {
  const canonical = canonicalHaEntityId(entity);
  return canonical.split('.')[0] || entity.entity_id.split('.')[0] || '';
}

export function canonicalObjectId(entity: HassEntity): string {
  const canonical = canonicalHaEntityId(entity);
  return canonical.split('.')[1] ?? canonical;
}

export function friendlyEntityLabel(entity: HassEntity, deviceName?: string): string {
  const raw =
    typeof entity.attributes.friendly_name === 'string' && entity.attributes.friendly_name.trim()
      ? entity.attributes.friendly_name.trim()
      : canonicalObjectId(entity).replace(/_/g, ' ');
  if (deviceName && raw.toLowerCase().startsWith(deviceName.toLowerCase())) {
    const stripped = raw
      .slice(deviceName.length)
      .replace(/^[\s\-_:]+/, '')
      .trim();
    if (stripped) return stripped;
  }
  return raw;
}

export interface ClassifiedNetworkEntities {
  readonly all: readonly HassEntity[];
  readonly statusEntity: HassEntity;
  readonly clientsEntity?: HassEntity;
  readonly guestClientsEntity?: HassEntity;
  readonly downloadSpeedEntity?: HassEntity;
  readonly uploadSpeedEntity?: HassEntity;
  readonly publicIpEntity?: HassEntity;
  readonly gatewayIpEntity?: HassEntity;
  readonly meshQualityEntity?: HassEntity;
  readonly statusLightEntity?: HassEntity;
  readonly switchEntities: readonly HassEntity[];
  readonly buttonEntities: readonly HassEntity[];
  readonly selectEntities: readonly HassEntity[];
  readonly updateEntities: readonly HassEntity[];
  readonly qrImageEntities: readonly HassEntity[];
}

export function findDeviceUpdateEntities(accessory: HausAccessory): readonly HassEntity[] {
  const all = [accessory.state, ...accessory.secondaryEntities];
  const seen = new Set<string>();
  return all.filter((entity) => {
    if (seen.has(entity.entity_id)) return false;
    seen.add(entity.entity_id);
    return canonicalDomain(entity) === 'update' || entity.entity_id.startsWith('update.');
  });
}

export function findDeviceQrImageEntities(accessory: HausAccessory): readonly HassEntity[] {
  const all = [accessory.state, ...accessory.secondaryEntities];
  const seen = new Set<string>();
  return all.filter((entity) => {
    if (seen.has(entity.entity_id)) return false;
    seen.add(entity.entity_id);
    const domain = canonicalDomain(entity);
    const objectId = canonicalObjectId(entity);
    const name = String(entity.attributes.friendly_name ?? '').toLowerCase();
    return (
      domain === 'image' ||
      entity.entity_id.startsWith('image.') ||
      objectId.includes('qr_code') ||
      name.includes('qr code')
    );
  });
}

export function classifyNetworkEntities(accessory: HausAccessory): ClassifiedNetworkEntities {
  const rawAll = [accessory.state, ...accessory.secondaryEntities];
  const seen = new Set<string>();
  const all = rawAll.filter((entity) => {
    if (seen.has(entity.entity_id)) return false;
    seen.add(entity.entity_id);
    return true;
  });

  const findBySuffix = (...patterns: readonly RegExp[]): HassEntity | undefined =>
    all.find((item) => {
      const obj = canonicalObjectId(item);
      const name = String(item.attributes.friendly_name ?? '').toLowerCase();
      return patterns.some((re) => re.test(obj) || re.test(name));
    });

  const statusEntity =
    findBySuffix(/(?:^|_)status$/, /connectivity/) ??
    all.find((item) => item.attributes.device_class === 'connectivity') ??
    accessory.state;

  const clientsEntity = findBySuffix(/(?:^|_)connected_clients$/, /^connected clients$/);
  const guestClientsEntity = findBySuffix(/(?:^|_)connected_guest_clients$/, /guest clients/);
  const downloadSpeedEntity = findBySuffix(/download_speed/, /download speed/);
  const uploadSpeedEntity = findBySuffix(/upload_speed/, /upload speed/);
  const publicIpEntity = findBySuffix(/public_ip/, /public ip/);
  const gatewayIpEntity = findBySuffix(/gateway_ip/, /gateway ip/);
  const meshQualityEntity = findBySuffix(/mesh_quality/, /mesh quality/);

  const statusLightEntity = all.find(
    (item) => canonicalDomain(item) === 'light' || item.entity_id.startsWith('light.'),
  );
  const switchEntities = all.filter(
    (item) => canonicalDomain(item) === 'switch' || item.entity_id.startsWith('switch.'),
  );
  const buttonEntities = all.filter(
    (item) => canonicalDomain(item) === 'button' || item.entity_id.startsWith('button.'),
  );
  const selectEntities = all.filter(
    (item) => canonicalDomain(item) === 'select' || item.entity_id.startsWith('select.'),
  );
  const updateEntities = findDeviceUpdateEntities(accessory);
  const qrImageEntities = findDeviceQrImageEntities(accessory);

  return {
    all,
    statusEntity,
    clientsEntity,
    guestClientsEntity,
    downloadSpeedEntity,
    uploadSpeedEntity,
    publicIpEntity,
    gatewayIpEntity,
    meshQualityEntity,
    statusLightEntity,
    switchEntities,
    buttonEntities,
    selectEntities,
    updateEntities,
    qrImageEntities,
  };
}
