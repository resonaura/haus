/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { HaIntegrationDomainMeta, HaUnifiedUpdatesResponse } from '@haus/ha/native/updates';

export type { HaIntegrationDomainMeta, HaUnifiedUpdatesResponse };

type HubApiFn = (path: string, init?: { method?: string; body?: unknown }) => Promise<unknown>;

/** Queries Hub `/api/updates` (optionally forcing a check) in a shape matching HA updates. */
export async function fetchHubUpdates(
  api: HubApiFn,
  refresh = false,
): Promise<HaUnifiedUpdatesResponse> {
  const res = (await api(
    refresh ? '/api/updates/check' : '/api/updates',
    refresh ? { method: 'POST', body: {} } : undefined,
  )) as HaUnifiedUpdatesResponse | null;
  if (!res || !Array.isArray(res.items)) {
    return { checkedAt: new Date().toISOString(), total: 0, availableCount: 0, items: [] };
  }
  return res;
}

/** Triggers a Hub update install by unified item id. */
export async function installHubUpdate(api: HubApiFn, id: string): Promise<unknown> {
  return api('/api/updates/install', { method: 'POST', body: { id } });
}

/** Queries unified integration domain metadata + persisted counts from the Hub. */
export async function fetchHubIntegrationMeta(
  api: HubApiFn,
): Promise<readonly HaIntegrationDomainMeta[]> {
  const res = (await api('/api/commissioning/integrations')) as {
    metadata?: readonly HaIntegrationDomainMeta[];
  } | null;
  return Array.isArray(res?.metadata) ? res.metadata : [];
}
