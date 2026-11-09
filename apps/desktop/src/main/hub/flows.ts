/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { Bonjour, type Service } from 'bonjour-service';
import type { HubDevice } from './types';

function selectIPv4Address(service: Service): string | undefined {
  const addresses = service.addresses ?? [];
  return (
    addresses.find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a) && !a.startsWith('127.')) ??
    addresses[0] ??
    service.host
  );
}

function discoverLocalHomeKitAccessories(timeoutMs = 1500): Promise<DiscoveredHomeKitItem[]> {
  return new Promise((resolve) => {
    const found = new Map<string, DiscoveredHomeKitItem>();
    let bonjour: Bonjour | undefined;
    try {
      bonjour = new Bonjour();
      const browser = bonjour.find({ type: 'hap' }, (service: Service) => {
        const txt = (service.txt ?? {}) as Record<string, string | undefined>;
        const id = (txt.id ?? txt.ID ?? '').toUpperCase();
        const address = selectIPv4Address(service);
        if (!id || !address || !service.port) return;
        const sf = parseInt(txt.sf ?? '1', 10);
        const ci = parseInt(txt.ci ?? '1', 10);
        const cNum = parseInt(txt['c#'] ?? '1', 10);
        found.set(id, {
          id,
          name: service.name || txt.md || id,
          model: txt.md,
          address,
          port: service.port,
          category: Number.isFinite(ci) ? ci : 1,
          paired: sf === 0,
          configNumber: Number.isFinite(cNum) ? cNum : 1,
        });
      });
      browser.start();
      setTimeout(() => {
        try {
          browser.stop();
          bonjour?.destroy();
        } catch {
          // ignore
        }
        resolve(Array.from(found.values()));
      }, timeoutMs);
    } catch {
      try {
        bonjour?.destroy();
      } catch {
        // ignore
      }
      resolve([]);
    }
  });
}

interface CommissioningSnapshot {
  commissioningId: string;
  state: string;
  error?: string;
  requiresCredentials?: { reason?: string; suggestedSsid?: string };
  selectedCandidate?: { identifier: string };
  pairedDevices?: Array<{ name?: string }>;
}

export interface DiscoveredHomeKitItem {
  id: string;
  name: string;
  model?: string;
  address: string;
  port: number;
  category: number;
  paired: boolean;
  configNumber: number;
}

export interface PersistedHomeKitPairingItem {
  accessoryId: string;
  name: string;
  address: string;
  port: number;
}

export interface HubDiscoverySnapshot {
  discovered: DiscoveredHomeKitItem[];
  pairings: PersistedHomeKitPairingItem[];
}

export function configEntryIdForDevice(device: HubDevice): string | undefined {
  if (device.protocol === 'mqtt') return 'mqtt';
  const matterMatch = device.id.match(/^matter_node_(\d+)_/);
  if (matterMatch) return `matter_node_${matterMatch[1]}`;
  const hkMatch = device.id.match(/^hk_([a-f0-9]+)_aid_/i);
  if (hkMatch) return `homekit:${hkMatch[1].toLowerCase()}`;
  if (device.protocol === 'homekit' || device.protocol === 'hap-ip') return 'homekit_controller';
  return undefined;
}

export function buildHubManifests(): Array<{ domain: string; name: string }> {
  return [
    { domain: 'homekit_controller', name: 'HomeKit Device' },
    { domain: 'matter', name: 'Matter' },
    { domain: 'mqtt', name: 'MQTT' },
  ];
}

export function buildHubConfigEntries(
  devices: readonly HubDevice[],
  pairings: readonly PersistedHomeKitPairingItem[],
): Array<Record<string, unknown>> {
  const entries: Array<Record<string, unknown>> = [];

  if (devices.some((d) => d.protocol === 'mqtt')) {
    entries.push({
      entry_id: 'mqtt',
      domain: 'mqtt',
      title: 'MQTT Broker',
      state: 'loaded',
      disabled_by: null,
      supports_unload: false,
    });
  }

  const matterNodes = new Map<string, string>();
  for (const dev of devices) {
    const m = dev.id.match(/^matter_node_(\d+)_/);
    if (m) {
      const nodeId = m[1];
      if (!matterNodes.has(nodeId) || dev.id.endsWith('_bridge')) {
        matterNodes.set(nodeId, dev.name || `Matter Node ${nodeId}`);
      }
    }
  }
  for (const [nodeId, title] of matterNodes) {
    entries.push({
      entry_id: `matter_node_${nodeId}`,
      domain: 'matter',
      title,
      state: 'loaded',
      disabled_by: null,
      supports_unload: true,
    });
  }

  for (const p of pairings) {
    const slug = p.accessoryId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    entries.push({
      entry_id: `homekit:${slug}`,
      domain: 'homekit_controller',
      title: `${p.name} (${p.address})`,
      state: 'loaded',
      disabled_by: null,
      supports_unload: true,
    });
  }

  return entries;
}

export class HubIntegrationFlowManager {
  private lastDiscovered = new Map<string, DiscoveredHomeKitItem>();
  private lastPairings: PersistedHomeKitPairingItem[] = [];
  private activeFlows = new Map<
    string,
    {
      handler: string;
      commissioningId?: string;
      accessoryId?: string;
      address?: string;
      port?: number;
      name?: string;
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
      const [hubRes, localDiscovered] = await Promise.all([
        this.api('/api/discovery/homekit?timeoutMs=1500').catch(() => undefined) as Promise<
          | {
              discovered?: DiscoveredHomeKitItem[];
              pairings?: PersistedHomeKitPairingItem[];
            }
          | undefined
        >,
        discoverLocalHomeKitAccessories(1500),
      ]);
      const hubDiscovered = Array.isArray(hubRes?.discovered) ? hubRes.discovered : [];
      const pairings = Array.isArray(hubRes?.pairings) ? hubRes.pairings : this.lastPairings;
      for (const item of [...localDiscovered, ...hubDiscovered]) {
        this.lastDiscovered.set(item.id.toUpperCase(), item);
      }
      this.lastPairings = pairings;
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
    return discovered
      .filter((d) => !d.paired && !pairedIds.has(d.id.toUpperCase()))
      .map((d) => {
        const flowId = `hk_disc_${d.id.replace(/:/g, '')}`;
        this.activeFlows.set(flowId, {
          handler: 'homekit_controller',
          accessoryId: d.id,
          address: d.address,
          port: d.port,
          name: d.name,
        });
        return {
          flow_id: flowId,
          handler: 'homekit_controller',
          context: {
            source: 'zeroconf',
            title_placeholders: { name: `${d.name} (${d.address})` },
          },
        };
      });
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
      return ['homekit_controller', 'matter', 'mqtt'];
    }

    if (method === 'GET' && path.startsWith('config/config_entries/flow/')) {
      const flowId = path.slice('config/config_entries/flow/'.length);
      const flow = this.activeFlows.get(flowId);
      if (!flow) throw new Error('Setup flow expired. Please refresh and try again.');
      return {
        type: 'form',
        flow_id: flowId,
        handler: flow.handler,
        step_id: 'pair',
        title: flow.name ? `Pair ${flow.name}` : 'Pair HomeKit Device',
        last_step: true,
        data_schema: [{ name: 'pairing_code', type: 'string', required: true }],
      };
    }

    if (method === 'POST' && path === 'config/config_entries/flow') {
      const handler = String(req.data?.handler ?? 'homekit_controller');
      if (handler !== 'homekit_controller' && handler !== 'matter') {
        return {
          type: 'abort',
          flow_id: 'unsupported',
          handler,
          reason: 'already_configured',
        };
      }
      await this.fetchDiscovery();
      const unpaired = Array.from(this.lastDiscovered.values()).filter((d) => !d.paired);
      const flowId = `hk_manual_${Date.now()}`;
      this.activeFlows.set(flowId, { handler });

      return {
        type: 'form',
        flow_id: flowId,
        handler,
        step_id: 'pair',
        title: 'Add device by code',
        last_step: true,
        data_schema: [
          ...(unpaired.length > 0
            ? [
                {
                  name: 'accessory_id',
                  type: 'select',
                  required: false,
                  default: '',
                  options: [
                    ['', 'Auto-detect by Setup Code'],
                    ...unpaired.map((d) => [d.id, `${d.name} (${d.address}:${d.port})`]),
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
            data_schema: [
              {
                name: 'ssid',
                type: 'string',
                required: true,
                default: tx.requiresCredentials?.suggestedSsid ?? '',
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
          data_schema: [{ name: 'pairing_code', type: 'string', required: true, default: pin }],
        };
      }
    }

    if (method === 'DELETE' && path.startsWith('config/config_entries/flow/')) {
      const flowId = path.slice('config/config_entries/flow/'.length);
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
