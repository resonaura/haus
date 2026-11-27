/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ServerKind, ServerSummaryRecord } from '@haus/core/transport';
import type { ServersStatus } from '@haus/core/servers';
import {
  HausTerminalClient,
  type HausTerminalEvent,
  type HausTerminalOpenRequest,
  type TerminalAccessCredentials,
  type TerminalKeyStorePort,
} from '@haus/ipc/client';
import type {
  AddClusterHubSubmitInput,
  AddClusterHubSubmitResult,
  ClusterMeshStatusView,
  DiscoveredClusterHubCandidate,
} from '@haus/ui/components';
import { discoverServers } from '../../main/discovery.js';
import type { HausHelper } from '../../main/helper.js';
import { gpuiStateDirectory } from '../../platform/credentials.js';
import type { GpuiRpcRequest } from './integrations.js';
import { normalizeHomeServer } from './servers/normalize.js';

export { normalizeHomeServer };

export interface GpuiServersPort {
  loadServers(): Promise<ServerSummaryRecord[]>;
  setServerEnabled(serverId: string, enabled: boolean): Promise<void>;
  setStorageLimit?(serverId: string, local: boolean, limitBytes: number | null): Promise<void>;
  removeServer?(serverId: string, kind: ServerKind): Promise<void>;
  loadCluster?(): Promise<ClusterMeshStatusView | undefined>;
  transferLeadership?(targetHubId: string): Promise<void>;
  rebalanceCluster?(): Promise<void>;
  reconcileCluster?(): Promise<void>;
  discoverCandidateHubs?(): Promise<DiscoveredClusterHubCandidate[]>;
  enrollHub?(input: AddClusterHubSubmitInput): Promise<AddClusterHubSubmitResult>;
}

export interface GpuiTerminalPort {
  open(request: HausTerminalOpenRequest): Promise<void>;
  write(sessionId: string, data: string): Promise<void>;
  resize(sessionId: string, cols: number, rows: number): void;
  close(sessionId: string): void;
  ack(sessionId: string, bytes: number): void;
  subscribe(listener: (event: HausTerminalEvent) => void): () => void;
  closeAll(): void;
}

export interface GpuiSystemPorts {
  readonly requestRpc: GpuiRpcRequest;
  readonly sessionKind: 'haus-hub' | 'home-assistant';
  readonly servers: GpuiServersPort;
  readonly terminal: GpuiTerminalPort;
}

const KEY_FILE = 'server-hub-keys.json';
const HEX_64 = /^[a-f0-9]{64}$/;

/** Persists pinned Ed25519 Hub identity fingerprints in user-only application state without Electron. */
export class GpuiTerminalKeyStore implements TerminalKeyStorePort {
  private pendingWrite: Promise<void> = Promise.resolve();

  constructor(private readonly directory: string) {}

  private keyFor(homeId: string, targetHubId: string): string {
    return `${homeId}\0${targetHubId}`;
  }

  private async loadAll(): Promise<Record<string, string>> {
    try {
      const raw = await readFile(join(this.directory, KEY_FILE), 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const clean: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string' && HEX_64.test(v)) clean[k] = v;
      }
      return clean;
    } catch {
      return {};
    }
  }

  async getPinned(homeId: string, targetHubId: string): Promise<string | undefined> {
    const all = await this.loadAll();
    return all[this.keyFor(homeId, targetHubId)];
  }

  async pin(homeId: string, targetHubId: string, fingerprintHex: string): Promise<void> {
    if (!HEX_64.test(fingerprintHex)) return;
    const entryKey = this.keyFor(homeId, targetHubId);
    const op = this.pendingWrite
      .catch(() => undefined)
      .then(async () => {
        const all = await this.loadAll();
        if (all[entryKey] === fingerprintHex) return;
        all[entryKey] = fingerprintHex;
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        const tmp = join(this.directory, `.server-hub-keys-${randomUUID()}.tmp`);
        try {
          await writeFile(tmp, JSON.stringify(all, null, 2), { flag: 'wx', mode: 0o600 });
          await rename(tmp, join(this.directory, KEY_FILE));
        } finally {
          await rm(tmp, { force: true });
        }
      });
    this.pendingWrite = op;
    await op;
  }
}

export function createGpuiTerminalPort(
  getHubAccess: () => TerminalAccessCredentials | null,
  stateDirectory: string = gpuiStateDirectory(),
): GpuiTerminalPort {
  const listeners = new Set<(event: HausTerminalEvent) => void>();
  const client = new HausTerminalClient(
    getHubAccess,
    new GpuiTerminalKeyStore(stateDirectory),
    (event) => {
      for (const listener of listeners) listener(event);
    },
  );
  return {
    open: (request) => client.open(request),
    write: (sessionId, data) => client.write(sessionId, data),
    resize: (sessionId, cols, rows) => client.resize(sessionId, cols, rows),
    close: (sessionId) => client.close(sessionId),
    ack: (sessionId, bytes) => client.ack(sessionId, bytes),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    closeAll: () => client.closeAll(),
  };
}

export function createGpuiServersPort(getHelper: () => HausHelper | null): GpuiServersPort {
  return {
    async loadServers(): Promise<ServerSummaryRecord[]> {
      const helper = getHelper();
      if (!helper) throw new Error('Connect to a Haus Hub to view servers.');
      const payload = (await helper.request({
        method: 'GET',
        path: '/api/servers',
      })) as ServersStatus;
      const now = Date.now();
      return Array.isArray(payload?.servers)
        ? payload.servers.map((s) => normalizeHomeServer(s, now))
        : [];
    },
    async setServerEnabled(serverId: string, enabled: boolean): Promise<void> {
      const helper = getHelper();
      if (!helper) throw new Error('Connect to a Haus Hub to manage servers.');
      await helper.request({
        method: 'PATCH',
        path: `/api/cluster/nodes/${encodeURIComponent(serverId)}`,
        data: { enabled },
      });
    },
    async setStorageLimit(
      serverId: string,
      local: boolean,
      storageLimitBytes: number | null,
    ): Promise<void> {
      const helper = getHelper();
      if (!helper) throw new Error('Connect to a Haus Hub to update storage limits.');
      await helper.request({
        method: 'PATCH',
        path: local
          ? '/api/servers/home-assistant'
          : `/api/cluster/nodes/${encodeURIComponent(serverId)}`,
        data: { storageLimitBytes },
      });
    },
    async removeServer(serverId: string): Promise<void> {
      const helper = getHelper();
      if (!helper) throw new Error('Connect to a Haus Hub to disconnect servers.');
      await helper.request({
        method: 'POST',
        path: `/api/cluster/nodes/${encodeURIComponent(serverId)}/remove`,
        data: {},
      });
    },
    async loadCluster(): Promise<ClusterMeshStatusView | undefined> {
      const helper = getHelper();
      if (!helper) return undefined;
      const raw = (await helper.request({ method: 'GET', path: '/api/cluster' })) as {
        id?: string;
        coordinatorId?: string;
        role?: string;
        epoch?: number;
        fenced?: boolean;
        members?: ClusterMeshStatusView['members'];
        nodes?: Array<{
          id: string;
          name: string;
          url?: string;
          enabled: boolean;
          online?: boolean;
        }>;
      };
      const coordinatorId = raw?.coordinatorId ?? raw?.id;
      if (!coordinatorId) return undefined;
      const members =
        Array.isArray(raw.members) && raw.members.length > 0
          ? raw.members
          : (raw.nodes ?? []).map((n) => ({
              id: n.id,
              name: n.name,
              url: n.url,
              role: n.id === coordinatorId ? 'coordinator' : 'node',
              online: n.online !== false,
              enabled: n.enabled !== false,
            }));
      return {
        coordinatorId,
        role: raw.role ?? 'coordinator',
        epoch: raw.epoch ?? 1,
        fenced: Boolean(raw.fenced),
        members,
      };
    },
    async transferLeadership(targetHubId: string): Promise<void> {
      const helper = getHelper();
      if (!helper) throw new Error('Connect to a Haus Hub to transfer leadership.');
      const init = (await helper.request({
        method: 'POST',
        path: '/api/cluster/transfer/initiate',
        data: { targetHubId, preservePairing: true },
      })) as { transferId: string };
      try {
        await helper.request({
          method: 'POST',
          path: `/api/cluster/transfer/${init.transferId}/prepare`,
          data: {},
        });
        await helper.request({
          method: 'POST',
          path: `/api/cluster/transfer/${init.transferId}/fence`,
          data: {},
        });
        await helper.request({
          method: 'POST',
          path: `/api/cluster/transfer/${init.transferId}/commit`,
          data: {},
        });
      } catch (err) {
        await helper
          .request({
            method: 'POST',
            path: `/api/cluster/transfer/${init.transferId}/rollback`,
            data: { reason: err instanceof Error ? err.message : 'gpui_transfer_aborted' },
          })
          .catch(() => undefined);
        throw err;
      }
    },
    async rebalanceCluster(): Promise<void> {
      const helper = getHelper();
      if (!helper) return;
      await helper.request({ method: 'POST', path: '/api/cluster/rebalance', data: {} });
    },
    async reconcileCluster(): Promise<void> {
      const helper = getHelper();
      if (!helper) return;
      await helper.request({ method: 'POST', path: '/api/cluster/reconcile', data: {} });
    },
    async discoverCandidateHubs(): Promise<DiscoveredClusterHubCandidate[]> {
      const found = await discoverServers({ rawHubsOnly: true });
      return found
        .filter((item) => item.kind !== 'home-assistant' && (item.hubCount ?? 1) <= 1)
        .map((item) => ({
          id: item.id,
          name: item.name,
          url: item.url,
          ...(item.hubId ? { hubId: item.hubId } : {}),
          ...(item.homeId ? { homeId: item.homeId } : {}),
          ...(item.onboarded !== undefined ? { onboarded: item.onboarded } : {}),
        }));
    },
    async enrollHub(input: AddClusterHubSubmitInput): Promise<AddClusterHubSubmitResult> {
      const helper = getHelper();
      if (!helper) throw new Error('Connect to a Haus Hub first.');
      const res = (await helper.request({
        method: 'POST',
        path: '/api/cluster/enroll-hub',
        data: {
          targetUrl: input.targetUrl,
          ...(input.name ? { name: input.name } : {}),
          roles: [...input.roles],
          ...(input.pairingCode ? { pairingCode: input.pairingCode } : {}),
          ...(input.challengeSessionId ? { challengeSessionId: input.challengeSessionId } : {}),
        },
      })) as {
        status?: string;
        challengeSessionId?: string;
        targetName?: string;
        node?: { name?: string };
      };
      if (res.status === 'pairing_code_required' && res.challengeSessionId) {
        return {
          status: 'pairing_code_required',
          challengeSessionId: res.challengeSessionId,
          targetName: res.targetName,
        };
      }
      return { status: 'joined', hubName: res.node?.name };
    },
  };
}

export function createGpuiRuntimeSystem(options: {
  readonly getHubAccess: () => TerminalAccessCredentials | null;
  readonly getHelper: () => HausHelper | null;
  readonly getRequestRpc: () => GpuiRpcRequest;
  readonly getSessionKind: () => 'haus-hub' | 'home-assistant';
}) {
  const terminal = createGpuiTerminalPort(options.getHubAccess);
  const hubServers = createGpuiServersPort(options.getHelper);
  const haVideoServers: GpuiServersPort = {
    loadServers: hubServers.loadServers,
    setServerEnabled: hubServers.setServerEnabled,
    setStorageLimit: hubServers.setStorageLimit,
    removeServer: hubServers.removeServer,
  };
  const ports: GpuiSystemPorts = {
    requestRpc: <T = unknown>(message: Record<string, unknown>) =>
      options.getRequestRpc()<T>(message),
    get sessionKind() {
      return options.getSessionKind();
    },
    get servers() {
      return options.getSessionKind() === 'home-assistant' ? haVideoServers : hubServers;
    },
    terminal,
  };
  return {
    terminal,
    snapshotPorts(): GpuiSystemPorts {
      return ports;
    },
  };
}
