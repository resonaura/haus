/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

export type RuleKind = 'automation' | 'script';
export type DeviceIdentity = readonly [protocol: string, externalId: string];
export type TransferRule = {
  id: string;
  name: string;
  sourceEntityId: string;
  sourceEnabled?: boolean;
  config: Record<string, unknown>;
};
export type DeviceEntity = {
  entityId: string;
  domain: string;
  platform?: string;
  uniqueId?: string;
  deviceIdentifiers?: DeviceIdentity[];
  configEntryId?: string;
  originalName?: string;
  friendlyName?: string;
};
export type TargetEntity = {
  entityId: string;
  deviceId: string;
  domain: string;
  platform?: string;
  uniqueId?: string;
  deviceIdentifiers?: DeviceIdentity[];
  name?: string;
};
export type TransferBundle = {
  automations: TransferRule[];
  scripts: TransferRule[];
  registryEntityIds: Record<string, string>;
  deviceEntities: Record<string, DeviceEntity[]>;
};
export function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
