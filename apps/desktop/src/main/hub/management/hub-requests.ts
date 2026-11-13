/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { isAppConfigEntryId, operateInstalledAppEntry } from '../app-flows.js';
import { buildHubConfigEntries } from '../flow-entries.js';
import type { HubIntegrationFlowManager } from '../flows.js';
import type { HubDevice } from '../types.js';
import { hubFlowTranslations } from './normalize.js';
import { fetchHubIntegrationMeta, fetchHubUpdates, installHubUpdate } from './updates-ha.js';

export interface HubManagementRpcContext {
  api: (path: string, init?: { method?: string; body?: unknown }) => Promise<unknown>;
  devices: HubDevice[];
  flows: HubIntegrationFlowManager;
  refreshDevices: () => Promise<void>;
  setCachedEntries: (entries: ReadonlyArray<{ entry_id?: unknown; domain?: unknown }>) => void;
}

/** Handles integration entries, repairs, updates, and translations over Hub RPC. */
export async function handleHubIntegrationRpc(
  ctx: HubManagementRpcContext,
  message: Record<string, unknown>,
): Promise<{ handled: true; result: unknown } | { handled: false }> {
  switch (message.type) {
    case 'config_entries/get': {
      const [appsInventory, integrationsRes] = await Promise.all([
        ctx.api('/api/apps').catch(() => null),
        ctx.api('/api/commissioning/integrations').catch(() => null),
        ctx.flows.fetchDiscovery(),
      ]);
      const rawEntries =
        integrationsRes &&
        typeof integrationsRes === 'object' &&
        'entries' in integrationsRes &&
        Array.isArray((integrationsRes as { entries?: unknown }).entries)
          ? (integrationsRes as { entries: Array<{ entry_id?: unknown; domain?: unknown }> })
              .entries
          : [];
      if (rawEntries.length > 0) ctx.setCachedEntries(rawEntries);
      return {
        handled: true,
        result: buildHubConfigEntries(
          ctx.devices,
          ctx.flows.getCachedPairings(),
          appsInventory,
          integrationsRes,
        ),
      };
    }

    case 'config_entries/disable': {
      const entryId = typeof message.entry_id === 'string' ? message.entry_id : '';
      const disabled = message.disabled_by === 'user';
      if (
        entryId &&
        isAppConfigEntryId(entryId) &&
        (message.disabled_by === 'user' || message.disabled_by === null)
      ) {
        await operateInstalledAppEntry(ctx.api, entryId, disabled ? 'stop' : 'start');
        await ctx.refreshDevices().catch(() => {});
        return { handled: true, result: { require_restart: false } };
      }
      if (entryId && (message.disabled_by === 'user' || message.disabled_by === null)) {
        await ctx.api(`/api/commissioning/entries/${encodeURIComponent(entryId)}/disable`, {
          method: 'POST',
          body: { disabled },
        });
        await ctx.refreshDevices().catch(() => {});
        return { handled: true, result: { require_restart: false } };
      }
      throw new Error('Specify a valid config entry and disabled state.');
    }

    case 'repairs/list_issues': {
      const res = (await ctx.api('/api/repairs').catch(() => null)) as {
        issues?: unknown[];
      } | null;
      return { handled: true, result: { issues: Array.isArray(res?.issues) ? res.issues : [] } };
    }

    case 'repairs/ignore_issue': {
      const domain = String(message.domain ?? '');
      const issueId = String(message.issue_id ?? '');
      if (!domain || !issueId) throw new Error('Domain and issue_id are required.');
      const res = await ctx.api(
        `/api/repairs/${encodeURIComponent(domain)}/${encodeURIComponent(issueId)}/ignore`,
        { method: 'POST', body: { ignore: message.ignore !== false } },
      );
      return { handled: true, result: res };
    }

    case 'haus/updates/list':
      return { handled: true, result: await fetchHubUpdates(ctx.api, false) };

    case 'haus/updates/check':
      return { handled: true, result: await fetchHubUpdates(ctx.api, true) };

    case 'haus/updates/install': {
      const id = String(message.update_id ?? message.id ?? '');
      if (!id) throw new Error('Select an update item to install.');
      return { handled: true, result: await installHubUpdate(ctx.api, id) };
    }

    case 'haus/integration_meta':
      return { handled: true, result: await fetchHubIntegrationMeta(ctx.api) };

    case 'frontend/get_translations':
      return {
        handled: true,
        result: {
          resources: hubFlowTranslations(
            String(message.category ?? ''),
            typeof message.integration === 'string' ? message.integration : undefined,
          ),
        },
      };

    default:
      return { handled: false };
  }
}
