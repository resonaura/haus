/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { DiscoveredCandidate, IntegrationFlowStep } from '@haus/core';
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
  private lastPairings: PersistedHomeKitPairingItem[] = [];
  private activeFlows = new Map<
    string,
    {
      handler: string;
      commissioningId?: string;
      candidateId?: string;
      accessoryId?: string;
      address?: string;
      port?: number;
      name?: string;
      nativeFlowId?: string;
    }
  >();

  constructor(
    private readonly api: (
      path: string,
      init?: { method?: string; body?: unknown },
    ) => Promise<unknown>,
    private readonly refreshDevices: () => Promise<void>,
  ) {}

  async fetchDiscovery(): Promise<HubDiscoverySnapshot> {
    try {
      const [hubHkRes, hubCommRes, localDiscovered] = await Promise.all([
        this.api('/api/discovery/homekit?timeoutMs=1500').catch(() => undefined) as Promise<
          | { discovered?: DiscoveredHomeKitItem[]; pairings?: PersistedHomeKitPairingItem[] }
          | undefined
        >,
        this.api('/api/commissioning/discoveries?status=discovered').catch(
          () => undefined,
        ) as Promise<DiscoveredCandidate[] | undefined>,
        discoverLocalHomeKitAccessories(1500),
      ]);

      const hubDiscovered = Array.isArray(hubHkRes?.discovered) ? hubHkRes.discovered : [];
      const pairings = Array.isArray(hubHkRes?.pairings) ? hubHkRes.pairings : this.lastPairings;
      for (const item of [...localDiscovered, ...hubDiscovered]) {
        this.lastDiscovered.set(item.id.toUpperCase(), item);
      }
      this.lastPairings = pairings;

      if (Array.isArray(hubCommRes)) {
        for (const candidate of hubCommRes) {
          this.lastCommissioningDiscovered.set(candidate.id, candidate);
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

  async listFlowProgress(): Promise<Array<Record<string, unknown>>> {
    const { discovered, pairings } = await this.fetchDiscovery();
    const pairedIds = new Set(pairings.map((p) => p.accessoryId.toUpperCase()));
    const items: Array<Record<string, unknown>> = [];

    // HomeKit unconfigured items
    for (const d of discovered) {
      if (d.paired || pairedIds.has(d.id.toUpperCase())) continue;
      const flowId = `hk_disc_${d.id.replace(/:/g, '')}`;
      this.activeFlows.set(flowId, {
        handler: 'homekit_controller',
        accessoryId: d.id,
        address: d.address,
        port: d.port,
        name: d.name,
      });
      items.push({
        flow_id: flowId,
        handler: 'homekit_controller',
        context: {
          source: 'zeroconf',
          title_placeholders: { name: `${d.name} (${d.address})` },
        },
      });
    }

    // Commissioning discovered items
    for (const c of this.lastCommissioningDiscovered.values()) {
      if (c.status !== 'discovered') continue;
      const flowId = `comm_disc_${c.id.replace(/[^a-zA-Z0-9]/g, '_')}`;
      this.activeFlows.set(flowId, {
        handler: c.domain,
        candidateId: c.id,
        address: c.addresses[0],
        port: c.port,
        name: c.name,
      });
      items.push({
        flow_id: flowId,
        handler: c.domain,
        context: {
          source: c.protocol,
          title_placeholders: { name: `${c.name} (${c.addresses[0] ?? c.protocol})` },
        },
      });
    }

    return items;
  }

  async getFlowHandlers(): Promise<string[]> {
    try {
      const res = (await this.api('/api/catalog/integrations')) as
        { domains?: string[] } | undefined;
      if (Array.isArray(res?.domains) && res.domains.length > 0) {
        return res.domains;
      }
    } catch {
      // fallback to built-in list
    }
    return buildHubManifests().map((m) => m.domain);
  }

  async getManifests(): Promise<Array<{ domain: string; name: string }>> {
    try {
      const res = (await this.api('/api/catalog/integrations')) as
        { integrations?: Array<{ domain: string; name: string }> } | undefined;
      if (Array.isArray(res?.integrations) && res.integrations.length > 0) {
        return res.integrations.map((m) => ({ domain: m.domain, name: m.name || m.domain }));
      }
    } catch {
      // fallback
    }
    return buildHubManifests();
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

    if (method === 'GET' && path === 'config/config_entries/flow_handlers') {
      return await this.getFlowHandlers();
    }

    if (method === 'GET' && path.startsWith('config/config_entries/flow/')) {
      const flowId = path.slice('config/config_entries/flow/'.length);
      const flow = this.activeFlows.get(flowId);
      if (flow?.nativeFlowId) {
        return this.api(`/api/commissioning/flows/${encodeURIComponent(flow.nativeFlowId)}`);
      }
      if (!flow) throw new Error('Setup flow expired. Please refresh and try again.');
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

      if (handler !== 'homekit_controller' && handler !== 'matter') {
        try {
          const res = (await this.api('/api/commissioning/flows', {
            method: 'POST',
            body: { domain: handler, source: 'user' },
          })) as IntegrationFlowStep;
          this.activeFlows.set(flowId, { handler, nativeFlowId: res.flowId });
          return res;
        } catch {
          return {
            type: 'abort',
            flow_id: flowId,
            handler,
            reason: 'unsupported_flow',
          };
        }
      }

      await this.fetchDiscovery();
      const unpaired = Array.from(this.lastDiscovered.values()).filter((d) => !d.paired);
      this.activeFlows.set(flowId, { handler });

      return {
        type: 'form',
        flow_id: flowId,
        handler,
        step_id: 'pair',
        title: 'Add device by code',
        last_step: true,
        dataSchema: [
          ...(unpaired.length > 0
            ? [
                {
                  name: 'accessory_id',
                  type: 'select',
                  required: false,
                  defaultValue: '',
                  choices: [
                    '',
                    ...unpaired.map((d) => `${d.id} (${d.name} ${d.address}:${d.port})`),
                  ],
                },
              ]
            : []),
          { name: 'pairing_code', type: 'string', required: true },
        ],
      };
    }

    if (method === 'POST' && path.startsWith('config/config_entries/flow/')) {
      const flowId = path.slice('config/config_entries/flow/'.length);
      const flow = this.activeFlows.get(flowId) ?? { handler: 'homekit_controller' };
      const data = req.data ?? {};

      if (flow.nativeFlowId) {
        const stepRes = (await this.api(
          `/api/commissioning/flows/${encodeURIComponent(flow.nativeFlowId)}/step`,
          {
            method: 'POST',
            body: { values: data },
          },
        )) as IntegrationFlowStep;
        if (stepRes.type === 'create_entry') {
          this.activeFlows.delete(flowId);
          await this.fetchDiscovery();
          await this.refreshDevices();
        }
        return stepRes;
      }

      const accessoryId = String(flow.accessoryId ?? data.accessory_id ?? '')
        .trim()
        .toUpperCase();
      const disc = accessoryId ? this.lastDiscovered.get(accessoryId) : undefined;
      const address =
        String(flow.address ?? data.address ?? disc?.address ?? '').trim() || undefined;
      const portRaw = Number(flow.port ?? data.port ?? disc?.port ?? 0);
      const port = portRaw > 0 ? portRaw : undefined;
      const name = String(flow.name ?? disc?.name ?? accessoryId ?? '').trim() || undefined;
      const pin = String(data.pairing_code ?? data.pin ?? '').trim();

      try {
        const wifiSsid = String(data.ssid ?? '').trim();
        const sessionId = flow.commissioningId;
        let tx: CommissioningSnapshot;
        if (accessoryId && !sessionId) {
          const pairRes = (await this.api('/api/discovery/homekit/pair', {
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
          this.activeFlows.delete(flowId);
          await this.fetchDiscovery();
          await this.refreshDevices();
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
        if (sessionId && wifiSsid) {
          tx = (await this.api(
            `/api/commissioning/sessions/${encodeURIComponent(sessionId)}/credentials`,
            {
              method: 'POST',
              body: { ssid: wifiSsid, password: String(data.password ?? '') },
            },
          )) as CommissioningSnapshot;
        } else {
          tx = (await this.api('/api/commissioning/sessions', {
            method: 'POST',
            body: { code: pin },
          })) as CommissioningSnapshot;
        }
        tx = await this.awaitCommissioning(tx.commissioningId);
        this.activeFlows.set(flowId, { ...flow, commissioningId: tx.commissioningId });

        if (tx.state === 'OBTAIN_NETWORK_CREDENTIALS') {
          return {
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
          };
        }
        if (tx.state !== 'DONE') {
          throw new Error(tx.error ?? 'Commissioning did not finish in time');
        }
        const firstDevice = tx.pairedDevices?.[0];
        const resolvedTitle = firstDevice?.name ?? name ?? 'Device';
        const resolvedId = tx.selectedCandidate?.identifier ?? tx.commissioningId;
        this.activeFlows.delete(flowId);
        await this.fetchDiscovery();
        await this.refreshDevices();
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
        return {
          type: 'form',
          flow_id: flowId,
          handler: 'homekit_controller',
          step_id: 'pair',
          title: name ? `Pair ${name}` : 'Add device by code',
          last_step: true,
          errors: { base: msg },
          dataSchema: [{ name: 'pairing_code', type: 'string', required: true, defaultValue: pin }],
        };
      }
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
      return { require_restart: false };
    }

    return {};
  }
}
