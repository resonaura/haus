/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  parseHelperCapabilities,
  safeHelperDiagnostic,
  type HelperCapabilities,
  type HelperDiagnostic,
} from '@haus/core/helper-protocol';
import type { ServersStatus } from '@haus/core/servers';
import { validateHelperRequest, type HelperRequest } from './helper-request.js';

export type HaVideoNodeRole = 'storage' | 'stream';

export interface HelperPort {
  request<T>(request: HelperRequest): Promise<T>;
}

export interface HaVideoNodeDrainPlan {
  readonly nodeId: string;
  readonly canRemoveSafely?: boolean;
  readonly blockReason?: string;
  readonly blockingReasons?: readonly string[];
  readonly online: boolean;
  readonly soleCopyMediaCount: number;
  readonly soleCopyMediaBytes: number;
  readonly soleCopyBackupsCount: number;
  readonly requiresForceIfOffline?: boolean;
  readonly requiresForce?: boolean;
}

export interface RemoveHaVideoNodeOptions {
  readonly force?: boolean;
}

export interface HaVideoClusterNode {
  livePriority?: number;
  id: string;
  name: string;
  url: string;
  roles: HaVideoNodeRole[];
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

export interface HaVideoClusterStatus {
  optional: boolean;
  nodes: HaVideoClusterNode[];
  backups: {
    items: { digest: string; kind: 'haus' | 'ha'; createdAt: number; bytes: number }[];
    busy: boolean;
    error?: string;
  };
  sync: { enabled: boolean; authority: string };
  busy: boolean;
}

export interface AddHaVideoNodeInput {
  name: string;
  url: string;
  key?: string;
  token?: string;
  allowHttp?: boolean;
  roles: HaVideoNodeRole[];
  sshServerId?: string;
  nodeId?: string;
}

export type HaVideoNodePatch =
  | { livePriority: number }
  | { enabled: boolean }
  | { storageLimitBytes: number | null }
  | { sshServerId: string | null }
  | { enabled: boolean; storageLimitBytes: number | null };

/**
 * Home Assistant Helper client.
 * Supports full Home Assistant hub compatibility, optional NVR video-node clustering
 * (`storage` | `stream`), and `/api/ha-integration` for sharing cameras/entities into Home Assistant.
 */
export class HaHelperClient {
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

  /** Configures the Home Assistant integration so cameras (and optional native entities) are shared into Home Assistant. */
  setupHaIntegration(options?: { nativeEntities?: boolean }): Promise<Record<string, unknown>> {
    return this.request({
      method: 'POST',
      path: '/api/ha-integration',
      data: {
        action: 'setup',
        ...(options?.nativeEntities !== undefined
          ? { nativeEntities: options.nativeEntities }
          : {}),
      },
    });
  }

  /** Revokes a previously enrolled Home Assistant camera integration client. */
  revokeHaIntegration(clientId: string): Promise<Record<string, unknown>> {
    if (!/^[a-f0-9]{24}$/.test(clientId)) {
      throw new Error('Invalid Home Assistant camera integration request.');
    }
    return this.request({
      method: 'POST',
      path: '/api/ha-integration',
      data: { action: 'revoke', clientId },
    });
  }

  private assertVideoNodeId(id: string): void {
    if (!/^[a-f0-9-]{36}$/.test(id)) {
      throw new Error('invalid-server');
    }
  }

  cluster(): Promise<HaVideoClusterStatus> {
    return this.request({ method: 'GET', path: '/api/cluster' });
  }

  drainPlan(id: string): Promise<HaVideoNodeDrainPlan> {
    this.assertVideoNodeId(id);
    return this.request({ method: 'GET', path: `/api/cluster/nodes/${id}/drain-plan` });
  }

  drainNode(id: string): Promise<{
    drained: boolean;
    nodeId: string;
    evacuatedBlobs: number;
    remainingBlobs: number;
  }> {
    this.assertVideoNodeId(id);
    return this.request({
      method: 'POST',
      path: `/api/cluster/nodes/${id}/drain`,
      data: {},
    });
  }

  addNode(input: AddHaVideoNodeInput): Promise<HaVideoClusterStatus> {
    return this.request({ method: 'POST', path: '/api/cluster/nodes', data: { ...input } });
  }

  updateNode(id: string, patch: HaVideoNodePatch): Promise<HaVideoClusterStatus> {
    this.assertVideoNodeId(id);
    return this.request({ method: 'PATCH', path: `/api/cluster/nodes/${id}`, data: patch });
  }

  removeNode(id: string, options?: RemoveHaVideoNodeOptions): Promise<HaVideoClusterStatus> {
    this.assertVideoNodeId(id);
    return this.request({
      method: 'POST',
      path: `/api/cluster/nodes/${id}/remove`,
      data: options ? { ...options } : {},
    });
  }

  async setStorageLimit(serverId: string, bytes: number | null): Promise<ServersStatus> {
    if (serverId !== 'home-assistant') this.assertVideoNodeId(serverId);
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

  private diagnostic(input: HelperDiagnostic): void {
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

export { HaHelperClient as HausClient };

const VIDEO_NODE_PATH = /^\/api\/cluster\/nodes\/[a-f0-9-]{36}$/;
const VIDEO_REMOVE_PATH = /^\/api\/cluster\/nodes\/[a-f0-9-]{36}\/remove$/;

function helperDiagnosticOperation(request: HelperRequest): HelperDiagnostic['operation'] {
  if (request.method === 'GET' && request.path === '/api/status') return 'helper-status';
  if (request.method === 'GET' && request.path === '/api/servers') return 'list-servers';
  if (request.method === 'GET' && request.path === '/api/cluster') return 'list-cluster';
  if (
    request.method === 'PATCH' &&
    (request.path === '/api/servers/home-assistant' ||
      (VIDEO_NODE_PATH.test(request.path) &&
        Object.hasOwn(request.data ?? {}, 'storageLimitBytes')))
  )
    return 'update-storage-limit';
  if (request.method === 'POST' && request.path === '/api/cluster/nodes') return 'enroll-node';
  if (request.method === 'POST' && VIDEO_REMOVE_PATH.test(request.path)) return 'remove-node';
  if (request.method === 'PATCH' && VIDEO_NODE_PATH.test(request.path)) return 'update-node';
  return 'other-allowlisted';
}
