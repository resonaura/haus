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
} from '../helper-protocol.js';
import type { ServersStatus } from '../servers/types.js';
import { validateHubServiceRequest } from './request.js';
import type {
  AddClusterNodeInput,
  AttachClusterInput,
  ClusterNodeDrainPlan,
  ClusterNodePatch,
  ClusterStatus,
  ClusterTransferSummary,
  ClusterWorkloadSummary,
  EnrollClusterHubInput,
  HubServicePort,
  HubServiceRequest,
  RemoveClusterNodeOptions,
} from './types.js';

const CLUSTER_NODE_PATH = /^\/api\/cluster\/nodes\/(?:[a-f0-9-]{36}|hub-[a-zA-Z0-9_-]{1,64})$/;
const CLUSTER_REMOVE_PATH =
  /^\/api\/cluster\/nodes\/(?:[a-f0-9-]{36}|hub-[a-zA-Z0-9_-]{1,64})\/remove$/;

function hubDiagnosticOperation(request: HubServiceRequest): HelperDiagnostic['operation'] {
  if (request.method === 'GET' && request.path === '/api/status') return 'helper-status';
  if (request.method === 'GET' && request.path === '/api/servers') return 'list-servers';
  if (request.method === 'GET' && request.path === '/api/cluster') return 'list-cluster';
  if (
    request.method === 'PATCH' &&
    (request.path === '/api/servers/home-assistant' ||
      (CLUSTER_NODE_PATH.test(request.path) &&
        Object.hasOwn(request.data ?? {}, 'storageLimitBytes')))
  )
    return 'update-storage-limit';
  if (request.method === 'POST' && request.path === '/api/cluster/nodes') return 'enroll-node';
  if (request.method === 'POST' && CLUSTER_REMOVE_PATH.test(request.path)) return 'remove-node';
  if (request.method === 'PATCH' && CLUSTER_NODE_PATH.test(request.path)) return 'update-node';
  return 'other-allowlisted';
}

/** Authenticated Haus Hub service & mesh cluster client shared across desktop and mobile. */
export class HausHubClient {
  private generation = 0;
  private disposed = false;

  constructor(
    private readonly port: HubServicePort,
    private readonly report?: (diagnostic: HelperDiagnostic) => void,
    private readonly validate: (
      input: HubServiceRequest,
    ) => HubServiceRequest = validateHubServiceRequest,
  ) {}

  async request<T>(input: HubServiceRequest): Promise<T> {
    if (this.disposed) throw new Error('session-changed');
    const generation = this.generation;
    const request = this.validate(input);
    const startedAt = Date.now();
    const operation = hubDiagnosticOperation(request);
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

  private assertNodeId(id: string): void {
    if (!/^(?:[a-f0-9-]{36}|hub-[a-zA-Z0-9_-]{1,64})$/.test(id)) {
      throw new Error('invalid-server');
    }
  }

  cluster(): Promise<ClusterStatus> {
    return this.request({ method: 'GET', path: '/api/cluster' });
  }

  clusterWorkloads(): Promise<{
    workloads: ClusterWorkloadSummary[];
    epoch: number;
    coordinatorId: string;
    role: string;
  }> {
    return this.request({ method: 'GET', path: '/api/cluster/workloads' });
  }

  rebalanceCluster(): Promise<{
    rebalanced: boolean;
    movedCount: number;
    workloads: ClusterWorkloadSummary[];
  }> {
    return this.request({ method: 'POST', path: '/api/cluster/rebalance', data: {} });
  }

  reconcileCluster(): Promise<{
    reconciled: boolean;
    epoch: number;
    coordinatorId: string;
    role: string;
    stoppedWorkloads: number;
    conflictingCoordinators: string[];
  }> {
    return this.request({ method: 'POST', path: '/api/cluster/reconcile', data: {} });
  }

  drainPlan(id: string): Promise<ClusterNodeDrainPlan> {
    this.assertNodeId(id);
    return this.request({ method: 'GET', path: `/api/cluster/nodes/${id}/drain-plan` });
  }

  drainNode(
    id: string,
    targetHubId?: string,
  ): Promise<{
    drained: boolean;
    nodeId: string;
    migratedWorkloads: number;
    evacuatedBlobs: number;
    remainingBlobs: number;
  }> {
    this.assertNodeId(id);
    if (targetHubId !== undefined) this.assertNodeId(targetHubId);
    return this.request({
      method: 'POST',
      path: `/api/cluster/nodes/${id}/drain`,
      data: targetHubId ? { targetHubId } : {},
    });
  }

  addNode(input: AddClusterNodeInput): Promise<ClusterStatus> {
    return this.request({ method: 'POST', path: '/api/cluster/nodes', data: { ...input } });
  }

  enrollHub(input: EnrollClusterHubInput): Promise<{
    status?: string;
    challengeSessionId?: string;
    targetName?: string;
    node?: { id?: string; name?: string };
  }> {
    return this.request({ method: 'POST', path: '/api/cluster/enroll-hub', data: { ...input } });
  }

  attachToCoordinator(input: AttachClusterInput): Promise<{
    status: string;
    homeId: string;
    coordinatorHubId: string;
    coordinatorEpoch?: number;
  }> {
    return this.request({ method: 'POST', path: '/api/cluster/attach', data: { ...input } });
  }

  updateNode(id: string, patch: ClusterNodePatch): Promise<ClusterStatus> {
    this.assertNodeId(id);
    return this.request({ method: 'PATCH', path: `/api/cluster/nodes/${id}`, data: patch });
  }

  removeNode(id: string, options?: RemoveClusterNodeOptions): Promise<ClusterStatus> {
    this.assertNodeId(id);
    if (options?.targetHubId !== undefined) this.assertNodeId(options.targetHubId);
    return this.request({
      method: 'POST',
      path: `/api/cluster/nodes/${id}/remove`,
      data: options ? { ...options } : {},
    });
  }

  initiateTransfer(targetHubId: string, preservePairing = true): Promise<ClusterTransferSummary> {
    this.assertNodeId(targetHubId);
    return this.request({
      method: 'POST',
      path: '/api/cluster/transfer/initiate',
      data: { targetHubId, preservePairing },
    });
  }

  prepareTransfer(
    transferId: string,
  ): Promise<{ transferId: string; state: string; valid: boolean }> {
    return this.request({
      method: 'POST',
      path: `/api/cluster/transfer/${transferId}/prepare`,
      data: {},
    });
  }

  fenceTransfer(
    transferId: string,
  ): Promise<{ transferId: string; state: string; fenced: boolean }> {
    return this.request({
      method: 'POST',
      path: `/api/cluster/transfer/${transferId}/fence`,
      data: {},
    });
  }

  commitTransfer(
    transferId: string,
  ): Promise<{ transferId: string; state: string; newCoordinator: string }> {
    return this.request({
      method: 'POST',
      path: `/api/cluster/transfer/${transferId}/commit`,
      data: {},
    });
  }

  rollbackTransfer(
    transferId: string,
    reason?: string,
  ): Promise<{ transferId: string; state: string }> {
    return this.request({
      method: 'POST',
      path: `/api/cluster/transfer/${transferId}/rollback`,
      data: reason ? { reason } : {},
    });
  }

  async setStorageLimit(serverId: string, bytes: number | null): Promise<ServersStatus> {
    if (serverId !== 'home-assistant') this.assertNodeId(serverId);
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
      // Diagnostics must never change the result of a Hub operation.
    }
  }
}

export { HausHubClient as HausClient };
