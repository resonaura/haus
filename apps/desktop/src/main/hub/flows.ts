/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { DiscoveredCandidate } from '@haus/core';
import { handleAppFlowManagement, type AppFlowSession } from './app-flows.js';
import {
  ignoreDiscoveryCandidateFlow,
  mergeLiveAndDiscoveredProgress,
} from './management/discovery-progress.js';
import {
  fetchHubFlowHandlers,
  fetchHubManifests,
  fetchNativeFlowStep,
  handleExtendedFlowManagement,
  startNativeCommissioningFlow,
  submitNativeFlowStep,
  type ActiveFlowEntry,
  type NativeFlowDispatchContext,
} from './management/flow-dispatch.js';
import { submitLegacyHapFallbackStep } from './management/hap-fallback.js';
import { normalizeCoreStepToHaStep } from './management/normalize.js';
import {
  buildHubConfigEntries,
  buildHubManifests,
  configEntryIdForDevice,
  discoverLocalHomeKitAccessories,
  type CommissioningSnapshot,
  type DiscoveredHomeKitItem,
  type HubDiscoverySnapshot,
  type PersistedHomeKitPairingItem,
} from './flow-entries.js';

export {
  buildHubConfigEntries,
  buildHubManifests,
  configEntryIdForDevice,
  discoverLocalHomeKitAccessories,
};
export type {
  CommissioningSnapshot,
  DiscoveredHomeKitItem,
  HubDiscoverySnapshot,
  PersistedHomeKitPairingItem,
};

export class HubIntegrationFlowManager {
  private lastDiscovered = new Map<string, DiscoveredHomeKitItem>();
  private lastCommissioningDiscovered = new Map<string, DiscoveredCandidate>();
  private ignoredHomeKitIds = new Set<string>();
  private lastPairings: PersistedHomeKitPairingItem[] = [];
  private activeFlows = new Map<
    string,
    ActiveFlowEntry & {
      appSession?: AppFlowSession;
      appStep?: Record<string, unknown>;
    }
  >();

  constructor(
    private readonly api: (
      path: string,
      init?: { method?: string; body?: unknown },
    ) => Promise<unknown>,
    private readonly refreshDevices: () => Promise<void>,
    private readonly discoverLocal: (
      timeoutMs?: number,
    ) => Promise<DiscoveredHomeKitItem[]> = discoverLocalHomeKitAccessories,
    private readonly getEntries?: () => ReadonlyArray<{ entry_id?: unknown; domain?: unknown }>,
  ) {}

  private dispatchContext(): NativeFlowDispatchContext {
    return {
      api: (p, init) => this.api(p, init),
      activeFlows: this.activeFlows,
      fetchDiscovery: () => this.fetchDiscovery(),
      refreshDevices: () => this.refreshDevices(),
      getEntries: this.getEntries,
    };
  }

  async fetchDiscovery(): Promise<HubDiscoverySnapshot> {
    try {
      const [hubHkRes, hubCommRes, localDiscovered] = await Promise.all([
        this.api('/api/discovery/homekit?timeoutMs=1500').catch(() => undefined) as Promise<
          | { discovered?: DiscoveredHomeKitItem[]; pairings?: PersistedHomeKitPairingItem[] }
          | undefined
        >,
        this.api('/api/commissioning/discoveries').catch(() => undefined) as Promise<
          DiscoveredCandidate[] | undefined
        >,
        this.discoverLocal(1500),
      ]);

      const hubDiscovered = Array.isArray(hubHkRes?.discovered) ? hubHkRes.discovered : [];
      const pairings = Array.isArray(hubHkRes?.pairings) ? hubHkRes.pairings : this.lastPairings;
      for (const item of [...localDiscovered, ...hubDiscovered]) {
        this.lastDiscovered.set(item.id.toUpperCase(), item);
      }
      this.lastPairings = pairings;

      if (Array.isArray(hubCommRes)) {
        this.lastCommissioningDiscovered.clear();
        for (const candidate of hubCommRes) {
          if (
            (candidate.status === 'discovered' || candidate.status === 'in_progress') &&
            candidate.domain &&
            candidate.domain !== 'generic'
          ) {
            this.lastCommissioningDiscovered.set(candidate.id, candidate);
          }
        }
      }

      return {
        discovered: Array.from(this.lastDiscovered.values()),
        pairings,
      };
    } catch {
      return {
        discovered: Array.from(this.lastDiscovered.values()),
        pairings: this.lastPairings,
      };
    }
  }

  private async awaitCommissioning(id: string, timeoutMs = 60_000): Promise<CommissioningSnapshot> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const tx = (await this.api(
        `/api/commissioning/sessions/${encodeURIComponent(id)}`,
      )) as CommissioningSnapshot;
      if (['DONE', 'FAILED', 'OBTAIN_NETWORK_CREDENTIALS'].includes(tx.state)) {
        if (tx.state === 'FAILED') throw new Error(tx.error ?? 'Commissioning failed');
        return tx;
      }
      if (Date.now() > deadline) throw new Error('Commissioning timed out');
      await new Promise((r) => setTimeout(r, 750));
    }
  }

  getCachedPairings(): PersistedHomeKitPairingItem[] {
    return this.lastPairings;
  }

  async scanDiscovery(): Promise<HubDiscoverySnapshot> {
    await this.api('/api/commissioning/discoveries/scan', {
      method: 'POST',
      body: {},
    }).catch(() => undefined);
    return this.fetchDiscovery();
  }

  async ignoreFlow(flowId: string): Promise<Record<string, never>> {
    return ignoreDiscoveryCandidateFlow({
      flowId,
      api: (p, init) => this.api(p, init),
      activeFlows: this.activeFlows,
      lastCommissioningDiscovered: this.lastCommissioningDiscovered,
      lastDiscoveredHomeKit: this.lastDiscovered,
      ignoredHomeKitIds: this.ignoredHomeKitIds,
    });
  }

  async listFlowProgress(): Promise<Array<Record<string, unknown>>> {
    const [{ discovered, pairings }, progressRes] = await Promise.all([
      this.fetchDiscovery(),
      this.api('/api/commissioning/flows/progress').catch(() => null),
    ]);
    const rawLiveFlows =
      progressRes &&
      typeof progressRes === 'object' &&
      'flows' in progressRes &&
      Array.isArray((progressRes as { flows?: unknown }).flows)
        ? (progressRes as { flows: unknown[] }).flows
        : undefined;
    return mergeLiveAndDiscoveredProgress({
      rawLiveFlows,
      discoveredHomeKit: discovered,
      pairings,
      commissioningCandidates: this.lastCommissioningDiscovered.values(),
      activeFlows: this.activeFlows,
      ignoredHomeKitIds: this.ignoredHomeKitIds,
    });
  }

  getFlowHandlers(): Promise<string[]> {
    return fetchHubFlowHandlers((p, init) => this.api(p, init));
  }

  getManifests(): Promise<Array<Record<string, unknown>>> {
    return fetchHubManifests((p, init) => this.api(p, init));
  }

  async handleManagement(input: unknown): Promise<unknown> {
    if (!input || typeof input !== 'object') {
      throw new Error('Invalid management request.');
    }
    const req = input as {
      method?: string;
      path?: string;
      data?: Record<string, unknown>;
    };
    const method = (req.method ?? 'GET').toUpperCase();
    const path = (req.path ?? '').replace(/^\/+/, '');

    const appHandled = await handleAppFlowManagement(
      {
        api: (p, init) => this.api(p, init),
        refreshDevices: () => this.refreshDevices(),
        getAppFlow: (id) => this.activeFlows.get(id),
        setAppFlow: (id, session, step) => {
          this.activeFlows.set(id, { handler: session.appId, appSession: session, appStep: step });
        },
        deleteFlow: (id) => {
          this.activeFlows.delete(id);
        },
      },
      method,
      path,
      req.data ?? {},
    );
    if (appHandled) return appHandled.result;

    const extHandled = await handleExtendedFlowManagement(
      this.dispatchContext(),
      method,
      path,
      req.data ?? {},
    );
    if (extHandled) return extHandled.result;

    if (method === 'GET' && path === 'config/config_entries/flow_handlers') {
      return await this.getFlowHandlers();
    }

    if (method === 'GET' && path.startsWith('config/config_entries/flow/')) {
      const flowId = path.slice('config/config_entries/flow/'.length);
      const flow = this.activeFlows.get(flowId);
      if (flow?.nativeFlowId) {
        const res = await fetchNativeFlowStep(this.dispatchContext(), flowId, flow).catch(
          () => undefined,
        );
        if (res) {
          this.activeFlows.set(flowId, {
            ...flow,
            handler: String(res.handler ?? flow.handler),
            currentStepId: typeof res.step_id === 'string' ? res.step_id : flow.currentStepId,
          });
          return res;
        }
      }
      if (!flow) {
        const raw = await this.api(`/api/commissioning/flows/${encodeURIComponent(flowId)}`).catch(
          () => undefined,
        );
        if (
          raw &&
          typeof raw === 'object' &&
          ('type' in raw || 'flowId' in raw || 'flow_id' in raw)
        ) {
          const normalized = normalizeCoreStepToHaStep(raw, flowId);
          this.activeFlows.set(flowId, {
            handler: String(normalized.handler ?? 'unknown'),
            nativeFlowId: flowId,
            currentStepId: typeof normalized.step_id === 'string' ? normalized.step_id : undefined,
          });
          return normalized;
        }
        throw new Error('Setup flow expired. Please refresh and try again.');
      }
      if (flow.candidateId) {
        return startNativeCommissioningFlow(
          this.dispatchContext(),
          flow.handler,
          flowId,
          { candidateId: flow.candidateId, source: 'discovery', preserveFlowId: true },
          'discovery',
        );
      }
      return {
        type: 'form',
        flow_id: flowId,
        handler: flow.handler,
        step_id: 'pair',
        title: flow.name ? `Pair ${flow.name}` : 'Pair Device',
        last_step: true,
        dataSchema: [{ name: 'pairing_code', type: 'string', required: true }],
      };
    }

    if (method === 'POST' && path === 'config/config_entries/flow') {
      const handler = String(req.data?.handler ?? 'homekit_controller');
      const flowId = `flow_${Date.now()}`;
      return startNativeCommissioningFlow(this.dispatchContext(), handler, flowId, req.data ?? {});
    }

    if (method === 'POST' && path.startsWith('config/config_entries/flow/')) {
      const flowId = path.slice('config/config_entries/flow/'.length);
      const flow = this.activeFlows.get(flowId) ?? { handler: 'homekit_controller' };
      const data = req.data ?? {};

      if (flow.nativeFlowId) {
        const res = await submitNativeFlowStep(this.dispatchContext(), flowId, flow, data);
        if (res) return res;
      }

      return submitLegacyHapFallbackStep(
        {
          api: (p, init) => this.api(p, init),
          activeFlows: this.activeFlows,
          lastDiscovered: this.lastDiscovered,
          fetchDiscovery: () => this.fetchDiscovery(),
          refreshDevices: () => this.refreshDevices(),
          awaitCommissioning: (id) => this.awaitCommissioning(id),
        },
        flowId,
        flow,
        data,
      );
    }

    if (method === 'DELETE' && path.startsWith('config/config_entries/flow/')) {
      const flowId = path.slice('config/config_entries/flow/'.length);
      const flow = this.activeFlows.get(flowId);
      if (flow?.nativeFlowId) {
        await this.api(`/api/commissioning/flows/${encodeURIComponent(flow.nativeFlowId)}`, {
          method: 'DELETE',
        }).catch(() => {});
      }
      this.activeFlows.delete(flowId);
      return {};
    }

    if (method === 'DELETE' && path.startsWith('config/config_entries/entry/')) {
      const entryId = decodeURIComponent(path.slice('config/config_entries/entry/'.length));
      if (entryId.startsWith('matter_node_')) {
        const nodeId = entryId.slice('matter_node_'.length);
        await this.api(`/api/matter/nodes/${encodeURIComponent(nodeId)}`, { method: 'DELETE' });
        await this.refreshDevices();
        return { require_restart: false };
      }
      if (entryId.startsWith('homekit:')) {
        const slug = entryId.slice('homekit:'.length).toLowerCase();
        const pairing = this.lastPairings.find(
          (p) => p.accessoryId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() === slug,
        );
        const targetId = pairing?.accessoryId ?? slug;
        await this.api(`/api/discovery/homekit/${encodeURIComponent(targetId)}`, {
          method: 'DELETE',
        });
        await this.fetchDiscovery();
        await this.refreshDevices();
        return { require_restart: false };
      }
      await this.api(`/api/commissioning/entries/${encodeURIComponent(entryId)}`, {
        method: 'DELETE',
      }).catch(() => {});
      await this.refreshDevices();
      return { require_restart: false };
    }

    return {};
  }
}
