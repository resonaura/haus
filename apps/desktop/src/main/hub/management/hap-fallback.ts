/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { CommissioningSnapshot, DiscoveredHomeKitItem } from '../flow-entries.js';
import type { ActiveFlowEntry } from './flow-dispatch.js';
import { normalizeCoreStepToHaStep } from './normalize.js';

export interface HapFallbackContext {
  api: (path: string, init?: { method?: string; body?: unknown }) => Promise<unknown>;
  activeFlows: Map<string, ActiveFlowEntry>;
  lastDiscovered: Map<string, DiscoveredHomeKitItem>;
  fetchDiscovery: () => Promise<unknown>;
  refreshDevices: () => Promise<void>;
  awaitCommissioning: (id: string) => Promise<CommissioningSnapshot>;
}

/** Handles legacy raw-HAP / commissioning-session step submission when no HA native flow exists. */
export async function submitLegacyHapFallbackStep(
  ctx: HapFallbackContext,
  flowId: string,
  flow: ActiveFlowEntry,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const accessoryId = String(flow.accessoryId ?? data.accessory_id ?? '')
    .trim()
    .toUpperCase();
  const disc = accessoryId ? ctx.lastDiscovered.get(accessoryId) : undefined;
  const address = String(flow.address ?? data.address ?? disc?.address ?? '').trim() || undefined;
  const portRaw = Number(flow.port ?? data.port ?? disc?.port ?? 0);
  const port = portRaw > 0 ? portRaw : undefined;
  const name = String(flow.name ?? disc?.name ?? accessoryId ?? '').trim() || undefined;
  const pin = String(data.pairing_code ?? data.pin ?? '').trim();

  try {
    const wifiSsid = String(data.ssid ?? '').trim();
    const sessionId = flow.commissioningId;
    if (accessoryId && !sessionId) {
      const pairRes = (await ctx.api('/api/discovery/homekit/pair', {
        method: 'POST',
        body: {
          accessoryId,
          pin,
          ...(address ? { address } : {}),
          ...(port ? { port } : {}),
          ...(name ? { name } : {}),
        },
      })) as { pairing?: { accessoryId?: string; name?: string } };
      const pairedId = pairRes?.pairing?.accessoryId ?? accessoryId;
      const title = pairRes?.pairing?.name ?? name ?? pairedId;
      ctx.activeFlows.delete(flowId);
      await ctx.fetchDiscovery();
      await ctx.refreshDevices();
      return {
        type: 'create_entry',
        flow_id: flowId,
        handler: 'homekit_controller',
        title,
        result: {
          entry_id: `homekit:${pairedId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()}`,
          title,
        },
      };
    }

    let tx =
      sessionId && wifiSsid
        ? ((await ctx.api(
            `/api/commissioning/sessions/${encodeURIComponent(sessionId)}/credentials`,
            {
              method: 'POST',
              body: { ssid: wifiSsid, password: String(data.password ?? '') },
            },
          )) as CommissioningSnapshot)
        : ((await ctx.api('/api/commissioning/sessions', {
            method: 'POST',
            body: { code: pin },
          })) as CommissioningSnapshot);

    tx = await ctx.awaitCommissioning(tx.commissioningId);
    ctx.activeFlows.set(flowId, { ...flow, commissioningId: tx.commissioningId });

    if (tx.state === 'OBTAIN_NETWORK_CREDENTIALS') {
      return normalizeCoreStepToHaStep(
        {
          type: 'form',
          flow_id: flowId,
          handler: 'homekit_controller',
          step_id: 'network',
          title: 'Connect device to Wi-Fi',
          description_placeholders: { reason: tx.requiresCredentials?.reason ?? '' },
          last_step: true,
          dataSchema: [
            {
              name: 'ssid',
              type: 'string',
              required: true,
              defaultValue: tx.requiresCredentials?.suggestedSsid ?? '',
            },
            { name: 'password', type: 'string', required: true },
          ],
        },
        flowId,
        'homekit_controller',
      );
    }
    if (tx.state !== 'DONE') {
      throw new Error(tx.error ?? 'Commissioning did not finish in time');
    }
    const firstDevice = tx.pairedDevices?.[0];
    const resolvedTitle = firstDevice?.name ?? name ?? 'Device';
    const resolvedId = tx.selectedCandidate?.identifier ?? tx.commissioningId;
    ctx.activeFlows.delete(flowId);
    await ctx.fetchDiscovery();
    await ctx.refreshDevices();
    return {
      type: 'create_entry',
      flow_id: flowId,
      handler: 'homekit_controller',
      title: resolvedTitle,
      result: {
        entry_id: `homekit:${resolvedId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()}`,
        title: resolvedTitle,
      },
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Pairing failed';
    return normalizeCoreStepToHaStep(
      {
        type: 'form',
        flow_id: flowId,
        handler: 'homekit_controller',
        step_id: 'pair',
        title: name ? `Pair ${name}` : 'Add device by code',
        last_step: true,
        errors: { base: msg },
        dataSchema: [{ name: 'pairing_code', type: 'string', required: true, defaultValue: pin }],
      },
      flowId,
      'homekit_controller',
    );
  }
}
