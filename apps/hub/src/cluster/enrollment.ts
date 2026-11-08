/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { randomUUID } from 'node:crypto';
import { isRecord } from '@haus/core/record';
import { nodeAddress, nodeJson } from '@haus/servers';
import type { Cluster } from './cluster.js';
import type { ClusterNode } from './health.js';
import { validSshServerId } from './nodes.js';
import { enrollmentStatus } from './status.js';

type EnrollmentHost = Pick<
  Cluster,
  'catalog' | 'backups' | 'abort' | 'health' | 'nodes' | 'status' | 'invalidateHealth'
>;

function validRoles(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 2 &&
    value.every((role: unknown) => typeof role === 'string' && ['storage', 'stream'].includes(role))
  );
}

/** Enrollment checks remote capabilities before claiming persisted identities atomically. */
export class ClusterEnrollment {
  constructor(private readonly host: EnrollmentHost) {}

  async add(input: unknown) {
    this.host.abort.signal.throwIfAborted();
    if (!isRecord(input)) throw Error('invalid_node');
    if (
      typeof input.name !== 'string' ||
      !input.name.trim() ||
      input.name.length > 100 ||
      typeof input.key !== 'string' ||
      input.key.length < 32 ||
      input.key.length > 256 ||
      typeof input.allowHttp !== 'boolean' ||
      !validRoles(input.roles) ||
      (input.sshServerId !== undefined && !validSshServerId(input.sshServerId))
    )
      throw Error('invalid_node');
    const node: ClusterNode = {
      id: randomUUID(),
      name: input.name.trim(),
      url: nodeAddress(String(input.url ?? ''), input.allowHttp),
      key: input.key,
      roles: [...new Set(input.roles)],
      allowHttp: input.allowHttp,
      enabled: true,
      ...(input.sshServerId ? { sshServerId: input.sshServerId } : {}),
    };
    if (this.host.nodes().some((item) => item.url === node.url))
      throw Error('invalid_duplicate_node');
    if (node.sshServerId && this.host.nodes().some((item) => item.sshServerId === node.sshServerId))
      throw Error('invalid_duplicate_ssh_server');
    const status = enrollmentStatus(
      await nodeJson(node, '/v1/status', {
        signal: this.host.abort.signal,
        timeout: 10000,
      }),
    );
    if (status.roles && node.roles.some((role) => !status.roles?.includes(role)))
      throw Error('invalid_node_roles');
    this.host.abort.signal.throwIfAborted();
    node.instanceId = status.instanceId;
    await this.host.catalog.enrollNode(node);
    this.host.health.set(node.id, { online: true, lastSeen: Date.now(), remote: status });
    this.host.invalidateHealth();
    this.host.backups.markChanged();
    return { ...this.host.status(), pairedNodeId: node.id };
  }
}
