/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { validateHelperRequest, type HelperRequest } from './helper-request.js';
import {
  parseHelperCapabilities,
  safeHelperDiagnostic,
  type HelperDiagnostic,
  type HelperCapabilities,
} from '@haus/core/helper-protocol';
import type { ServersStatus } from './server-types.js';

export interface HelperPort {
  request<T>(request: HelperRequest): Promise<T>;
}
export interface ClusterStatus {
  optional: boolean;
  nodes: ClusterNode[];
  backups: {
    items: { digest: string; kind: 'haus' | 'ha'; createdAt: number; bytes: number }[];
    busy: boolean;
    error?: string;
  };
  sync: { enabled: boolean; authority: string };
  busy: boolean;
}
export interface ClusterNode {
  livePriority?: number;
  id: string;
  name: string;
  url: string;
  roles: ('storage' | 'stream')[];
  allowHttp: boolean;
  enabled: boolean;
  sshServerId?: string;
  instanceId?: string;
  online?: boolean;
  lastSeen?: number;
  remote?: Record<string, unknown>;
  error?: string;
  backupCopies: number;
}
export interface AddClusterNodeInput {
  name: string;
  url: string;
  key: string;
  allowHttp: boolean;
  roles: ('storage' | 'stream')[];
  sshServerId?: string;
}
export type ClusterNodePatch =
  | { livePriority: number }
  | { enabled: boolean }
  | { storageLimitBytes: number | null }
  | { sshServerId: string | null }
  | { enabled: boolean; storageLimitBytes: number | null };

/** Authenticated native/mobile port, with the same operation allowlist as Electron main. */
export class HausClient {
  private generation = 0;
  private disposed = false;
  constructor(
    private readonly port: HelperPort,
    private readonly report?: (diagnostic: HelperDiagnostic) => void,
  ) {}

  async request<T>(input: HelperRequest): Promise<T> {
    if (this.disposed) throw new Error('session-changed');
    const generation = this.generation;
    const request = validateHelperRequest(input);
    const startedAt = Date.now();
    const operation = helperDiagnosticOperation(request);
    try {
      const response = await this.port.request<T>(request);
      if (generation !== this.generation) throw new Error('session-changed');
      this.diagnostic({ operation, outcome: 'success', durationMs: Date.now() - startedAt });
      return response;
    } catch (error) {
      if (generation !== this.generation) throw new Error('session-changed');
      this.diagnostic({ operation, outcome: 'failure', durationMs: Date.now() - startedAt });
      throw error;
    }
  }

  async capabilities(): Promise<HelperCapabilities> {
    const status = await this.request<unknown>({ method: 'GET', path: '/api/status' });
    const capabilities = parseHelperCapabilities(status);
    if (!capabilities) throw new Error('helper-status-invalid');
    return capabilities;
  }

  servers(): Promise<ServersStatus> {
    return this.request({ method: 'GET', path: '/api/servers' });
  }
  cluster(): Promise<ClusterStatus> {
    return this.request({ method: 'GET', path: '/api/cluster' });
  }
  addNode(input: AddClusterNodeInput): Promise<ClusterStatus> {
    return this.request({ method: 'POST', path: '/api/cluster/nodes', data: { ...input } });
  }
  updateNode(id: string, patch: ClusterNodePatch): Promise<ClusterStatus> {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('invalid-server');
    return this.request({ method: 'PATCH', path: `/api/cluster/nodes/${id}`, data: patch });
  }
  removeNode(id: string): Promise<ClusterStatus> {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('invalid-server');
    return this.request({ method: 'POST', path: `/api/cluster/nodes/${id}/remove`, data: {} });
  }
  async setStorageLimit(serverId: string, bytes: number | null): Promise<ServersStatus> {
    if (serverId !== 'home-assistant' && !/^[a-f0-9-]{36}$/.test(serverId))
      throw new Error('invalid-server');
    const path =
      serverId === 'home-assistant'
        ? '/api/servers/home-assistant'
        : `/api/cluster/nodes/${serverId}`;
    await this.request({ method: 'PATCH', path, data: { storageLimitBytes: bytes } });
    const status = await this.servers();
    if (
      status.servers.find((server) => server.id === serverId)?.settings?.storageLimitBytes !== bytes
    )
      throw new Error('storage-limit-unconfirmed');
    return status;
  }
  dispose(): void {
    this.disposed = true;
    ++this.generation;
  }

  private diagnostic(input: HelperDiagnostic) {
    if (input.outcome !== 'failure') return;
    const safe = safeHelperDiagnostic(input);
    if (!safe || !this.report) return;
    try {
      this.report(safe);
    } catch {
      // Diagnostics must never change the result of a Helper operation.
    }
  }
}

function helperDiagnosticOperation(request: HelperRequest): HelperDiagnostic['operation'] {
  if (request.method === 'GET' && request.path === '/api/status') return 'helper-status';
  if (request.method === 'GET' && request.path === '/api/servers') return 'list-servers';
  if (request.method === 'GET' && request.path === '/api/cluster') return 'list-cluster';
  if (
    request.method === 'PATCH' &&
    (request.path === '/api/servers/home-assistant' ||
      (/^\/api\/cluster\/nodes\/[a-f0-9-]{36}$/.test(request.path) &&
        Object.hasOwn(request.data ?? {}, 'storageLimitBytes')))
  )
    return 'update-storage-limit';
  if (request.method === 'POST' && request.path === '/api/cluster/nodes') return 'enroll-node';
  if (
    request.method === 'POST' &&
    /^\/api\/cluster\/nodes\/[a-f0-9-]{36}\/remove$/.test(request.path)
  )
    return 'remove-node';
  if (request.method === 'PATCH' && /^\/api\/cluster\/nodes\/[a-f0-9-]{36}$/.test(request.path))
    return 'update-node';
  return 'other-allowlisted';
}
