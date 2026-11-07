/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { EntitySchema } from 'typeorm';

export interface ServicePolicyRow {
  id: string;
  value: string;
}

export interface KitsunePluginRow {
  vendor: string;
  version: string | null;
}

export const ServicePolicyEntity = new EntitySchema<ServicePolicyRow>({
  name: 'ServicePolicy',
  tableName: 'service_policy',
  columns: {
    id: { type: 'text', primary: true },
    value: { type: 'text' },
  },
});

export const KitsunePluginEntity = new EntitySchema<KitsunePluginRow>({
  name: 'KitsunePlugin',
  tableName: 'kitsune_plugins',
  columns: {
    vendor: { type: 'text', primary: true },
    version: { type: 'text', nullable: true },
  },
});
