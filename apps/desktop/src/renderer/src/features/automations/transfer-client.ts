/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { nativeApi } from '../../ha/management';
import {
  record,
  type DeviceIdentity,
  type RuleKind,
  type TargetEntity,
  type TransferRule,
} from './transfer-types';

export async function readExisting(kind: RuleKind): Promise<Map<string, Record<string, unknown>>> {
  const response: unknown = await nativeApi().management({
    method: 'GET',
    path: `haus/rules/${kind === 'automation' ? 'automations' : 'scripts'}`,
  });
  const body = record(response);
  const list = body?.[kind === 'automation' ? 'automations' : 'scripts'];
  if (!Array.isArray(list))
    throw new Error('Haus could not verify its current rules before import.');
  return new Map(
    list.flatMap((value) => {
      const item = record(value);
      return typeof item?.id === 'string' ? [[item.id, item] as const] : [];
    }),
  );
}

export async function readTargetEntities(): Promise<TargetEntity[]> {
  const response: unknown = await nativeApi().management({
    method: 'GET',
    path: 'haus/rules/entities',
  });
  const body = record(response);
  if (!Array.isArray(body?.entities))
    throw new Error('Haus could not verify its current entities before import.');
  return body.entities.flatMap((value) => {
    const item = record(value);
    if (
      !item ||
      typeof item.entityId !== 'string' ||
      !/^[a-z_]+\.[a-z0-9_]+$/.test(item.entityId) ||
      typeof item.deviceId !== 'string' ||
      !item.deviceId ||
      typeof item.domain !== 'string' ||
      item.domain !== item.entityId.split('.', 1)[0] ||
      (item.platform !== undefined &&
        (typeof item.platform !== 'string' || !/^[a-z0-9_]{1,128}$/.test(item.platform))) ||
      (item.uniqueId !== undefined && typeof item.uniqueId !== 'string') ||
      (item.name !== undefined && typeof item.name !== 'string')
    ) {
      return [];
    }
    const rawIdentifiers = item.deviceIdentifiers;
    if (
      rawIdentifiers !== undefined &&
      (!Array.isArray(rawIdentifiers) ||
        rawIdentifiers.length > 64 ||
        rawIdentifiers.some(
          (pair) =>
            !Array.isArray(pair) ||
            pair.length !== 2 ||
            pair.some(
              (part) => typeof part !== 'string' || part.trim().length === 0 || part.length > 1024,
            ),
        ))
    ) {
      return [];
    }
    return [
      {
        entityId: item.entityId,
        deviceId: item.deviceId,
        domain: item.domain,
        ...(typeof item.platform === 'string' ? { platform: item.platform } : {}),
        ...(typeof item.uniqueId === 'string' ? { uniqueId: item.uniqueId } : {}),
        ...(Array.isArray(rawIdentifiers)
          ? { deviceIdentifiers: rawIdentifiers as DeviceIdentity[] }
          : {}),
        ...(typeof item.name === 'string' ? { name: item.name } : {}),
      },
    ];
  });
}

export function ruleStatusKey(kind: RuleKind, rule: TransferRule): string {
  return `${kind}:${rule.id}`;
}
