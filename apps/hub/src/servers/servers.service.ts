/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Inject, Injectable, Optional } from '@nestjs/common';
import { statfs } from 'node:fs/promises';
import {
  arch,
  cpus,
  freemem,
  hostname,
  loadavg,
  platform,
  release,
  totalmem,
  uptime,
} from 'node:os';
import { CLUSTER_SERVICE, type IClusterService } from '../cluster/cluster.controller.js';
import type { ClusterNodeRecordDto } from '../cluster/cluster.dto.js';
import type { Cluster } from '../cluster/cluster.js';
import { ClusterStateStore } from '../cluster/coordination/state.js';
import { HUB_DATA_DIRECTORY } from '../cluster/crypto/master-key.js';
import { normalizeClusterUrl } from '../cluster/nodes.js';
import { RECORDING_CLUSTER } from '../events/tokens.js';
import { NvrTransport } from '../nvr/transport/service.js';
import type { IServersService } from './servers.controller.js';
import type { ServersStatusResponseDto, ServerItemDto } from './servers.dto.js';

type RecordingNodeStatus = ReturnType<Cluster['status']>['nodes'][number];

const MIN_STORAGE_LIMIT_BYTES = 1024 ** 2;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNumberPair(value: unknown): { active: number; max: number } | undefined {
  if (!isRecord(value)) return undefined;
  const active = value.active;
  const max = value.max;
  if (typeof active !== 'number' || typeof max !== 'number') return undefined;
  return { active, max };
}

function buildFallbackHost(
  now: number,
  targetDir: string,
  disk: { totalBytes: number | null; usedBytes: number; freeBytes: number | null },
): Record<string, unknown> {
  const cpuList = cpus();
  const cpuCount = Math.max(1, cpuList.length);
  const loads = loadavg();
  const load1m = loads[0] ?? 0;
  const memTotal = totalmem();
  const memFree = freemem();
  const memUsed = Math.max(0, memTotal - memFree);
  const inContainer = process.env.HAUS_CONTAINER === '1';
  const scope = inContainer ? 'container' : 'host';
  return {
    sampledAt: new Date(now).toISOString(),
    scope,
    hostname: hostname(),
    platform: platform(),
    release: release(),
    arch: arch(),
    uptimeSeconds: uptime(),
    cpu: {
      model: cpuList[0]?.model || 'CPU',
      logicalCores: cpuCount,
      usage: Math.min(1, Math.max(0, load1m / cpuCount)),
      loadAverage: inContainer ? [] : loads,
    },
    memory: {
      totalBytes: memTotal,
      installedBytes: inContainer ? null : memTotal,
      availableBytes: memFree,
      usedBytes: memUsed,
    },
    swap: { supported: false, totalBytes: null, usedBytes: null },
    disks:
      disk.totalBytes !== null
        ? [
            {
              id: 'volume:data',
              name: 'Haus data',
              kind: 'volume',
              type: 'volume',
              physical: null,
              parentId: null,
              parentIds: [],
              mountpoint: targetDir,
              filesystem: null,
              totalBytes: disk.totalBytes,
              usedBytes: disk.usedBytes,
              availableBytes: disk.freeBytes,
              scope,
            },
          ]
        : [],
    docker: { available: false, source: 'unavailable', containers: [] },
    pm2: { available: false, source: 'unavailable', processes: [] },
    systemServices: { available: false, source: 'unavailable', services: [] },
  };
}

@Injectable()
export class DefaultServersService implements IServersService {
  private storageLimitBytes: number | null = null;

  constructor(
    @Optional() @Inject(CLUSTER_SERVICE) private readonly clusterService?: IClusterService,
    @Optional() @Inject(HUB_DATA_DIRECTORY) private readonly dataDir?: string,
    @Optional() @Inject(NvrTransport) private readonly nvrTransport?: NvrTransport,
    @Optional() @Inject(RECORDING_CLUSTER) private readonly recordingCluster?: Cluster,
    @Optional() @Inject(ClusterStateStore) private readonly stateStore?: ClusterStateStore,
  ) {}

  async status(): Promise<ServersStatusResponseDto> {
    const now = Date.now();
    await this.triggerPeerHealthRefresh();

    const cluster = this.clusterService?.status();
    const state = this.stateStore?.getStateSync();
    const localId = state?.hubId ?? cluster?.id ?? 'local-hub';
    const localRole = state?.role ?? cluster?.role ?? 'coordinator';
    const localNodeRecord = cluster?.nodes.find((node) => node.id === localId);
    const nvr = this.nvrTransport?.options;
    const localRoles = Array.from(
      new Set([localRole, ...(nvr?.roles ?? localNodeRecord?.roles ?? ['storage', 'stream'])]),
    );
    const localUrl =
      localNodeRecord?.url ||
      (state && state.coordinatorId === localId ? state.coordinatorUrl : undefined) ||
      process.env.HAUS_PUBLIC_URL?.trim() ||
      process.env.HAUS_HUB_URL?.trim() ||
      undefined;

    const localServer = await this.buildLocalServer({
      now,
      localId,
      localRoles,
      localUrl,
      localNodeRecord,
    });

    const peerServers = this.buildPeerServers({
      now,
      localId,
      localUrl,
      localInstanceId: nvr?.instanceId,
      clusterNodes: cluster?.nodes ?? [],
      recordingNodes: this.recordingCluster?.status().nodes ?? [],
    });

    return {
      features: { monitoringOnlyServers: true },
      servers: [localServer, ...peerServers],
      sampledAt: now,
    };
  }

  update(patch: { storageLimitBytes: number | null }): Promise<void> | void {
    const limit = patch.storageLimitBytes;
    if (
      limit !== null &&
      (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < MIN_STORAGE_LIMIT_BYTES)
    ) {
      throw new Error('invalid_storage_limit');
    }
    this.storageLimitBytes = limit;
    if (this.nvrTransport?.options.settings) {
      return this.nvrTransport.options.settings
        .update({ storageLimitBytes: limit })
        .then(() => undefined);
    }
  }

  private async triggerPeerHealthRefresh(): Promise<void> {
    const cluster = this.recordingCluster;
    if (!cluster?.refreshHealth) return;
    const refresh = cluster.refreshHealth().catch(() => {});
    const needsInitial =
      cluster.healthSampledAt === undefined && cluster.nodes().some((node) => node.enabled);
    if (!needsInitial) return;
    await Promise.race([
      refresh,
      new Promise<void>((resolve) => {
        setTimeout(resolve, 1500).unref();
      }),
    ]);
  }

  private async buildLocalServer(params: {
    readonly now: number;
    readonly localId: string;
    readonly localRoles: string[];
    readonly localUrl?: string;
    readonly localNodeRecord?: ClusterNodeRecordDto;
  }): Promise<ServerItemDto> {
    const { now, localId, localRoles, localUrl, localNodeRecord } = params;
    const nvr = this.nvrTransport?.options;
    const liveHost = nvr?.host?.status();
    const targetDir = this.dataDir?.trim() || process.env.HAUS_DATA?.trim() || process.cwd();

    let storage: Record<string, unknown>;
    let settings: { storageLimitBytes: number | null; source: string };
    let fallbackDisk = {
      totalBytes: null as number | null,
      usedBytes: 0,
      freeBytes: null as number | null,
    };

    if (nvr?.blobs) {
      const blobStatus = await nvr.blobs.status();
      const usage = nvr.storageUsage?.status();
      const nvrSettings = nvr.settings?.status();
      const limitBytes = nvrSettings?.storageLimitBytes ?? blobStatus.storageLimitBytes ?? null;
      const source = nvrSettings?.source ?? blobStatus.limitSource ?? 'default';
      storage = {
        ...blobStatus,
        limitBytes,
        storageLimitBytes: limitBytes,
        ...(usage ? { usage } : {}),
      };
      settings = { storageLimitBytes: limitBytes, source };
    } else {
      try {
        const fs = await statfs(targetDir);
        const totalBytes = Number(fs.blocks) * Number(fs.bsize);
        const freeBytes = Number(fs.bavail) * Number(fs.bsize);
        fallbackDisk = {
          totalBytes,
          freeBytes,
          usedBytes: Math.max(0, totalBytes - freeBytes),
        };
      } catch {
        // Fall back to null filesystem totals on unsupported platforms.
      }
      const availableBytes =
        this.storageLimitBytes === null
          ? fallbackDisk.freeBytes
          : Math.max(
              0,
              fallbackDisk.freeBytes === null
                ? this.storageLimitBytes - fallbackDisk.usedBytes
                : Math.min(fallbackDisk.freeBytes, this.storageLimitBytes - fallbackDisk.usedBytes),
            );
      storage = {
        usedBytes: fallbackDisk.usedBytes,
        totalBytes: fallbackDisk.totalBytes,
        freeBytes: fallbackDisk.freeBytes,
        availableBytes,
        limitBytes: this.storageLimitBytes,
        storageLimitBytes: this.storageLimitBytes,
      };
      settings = {
        storageLimitBytes: this.storageLimitBytes,
        source: this.storageLimitBytes === null ? 'default' : 'user',
      };
    }

    const host = isRecord(liveHost) ? liveHost : buildFallbackHost(now, targetDir, fallbackDisk);
    const hostLabel =
      typeof host.hostname === 'string' && host.hostname ? host.hostname : hostname();
    const maxStreams = nvr?.maxStreams ?? 4;
    const streams = nvr
      ? {
          active: nvr.streams?.size ?? 0,
          max: !localRoles.includes('stream') || nvr.capacity?.pressured ? 0 : maxStreams,
        }
      : undefined;
    const analysis = asNumberPair(nvr?.detectors?.status());
    const playback = asNumberPair(nvr?.playback?.status());

    return {
      id: localId,
      kind: 'hub',
      local: true,
      name: localNodeRecord?.name || process.env.HAUS_HUB_NAME?.trim() || `Haus Hub (${hostLabel})`,
      ...(localUrl ? { url: localUrl } : {}),
      enabled: localNodeRecord?.enabled ?? true,
      roles: localRoles,
      online: true,
      lastSeen: now,
      host,
      storage,
      settings,
      ...(streams ? { streams } : {}),
      ...(analysis ? { analysis } : {}),
      ...(playback ? { playback } : {}),
    };
  }

  private buildPeerServers(params: {
    readonly now: number;
    readonly localId: string;
    readonly localUrl?: string;
    readonly localInstanceId?: string;
    readonly clusterNodes: readonly ClusterNodeRecordDto[];
    readonly recordingNodes: readonly RecordingNodeStatus[];
  }): ServerItemDto[] {
    const { now, localId, localUrl, localInstanceId, clusterNodes, recordingNodes } = params;
    const localNormUrl = normalizeClusterUrl(localUrl);
    const recById = new Map<string, RecordingNodeStatus>();
    const recByUrl = new Map<string, RecordingNodeStatus>();
    for (const node of recordingNodes) {
      recById.set(node.id, node);
      const norm = normalizeClusterUrl(node.url);
      if (norm) recByUrl.set(norm, node);
    }

    const seenIds = new Set<string>([localId]);
    const seenUrls = new Set<string>(localNormUrl ? [localNormUrl] : []);
    const seenInstances = new Set<string>(localInstanceId ? [localInstanceId] : []);
    const peers: ServerItemDto[] = [];

    const appendPeer = (
      node: ClusterNodeRecordDto | undefined,
      rec: RecordingNodeStatus | undefined,
    ) => {
      const id = node?.id ?? rec?.id;
      if (!id || seenIds.has(id)) return;
      const url = node?.url ?? rec?.url;
      const normUrl = normalizeClusterUrl(url);
      const instanceId = rec?.remote?.instanceId ?? rec?.instanceId;
      if (normUrl && seenUrls.has(normUrl)) return;
      if (instanceId && seenInstances.has(instanceId)) return;

      seenIds.add(id);
      if (normUrl) seenUrls.add(normUrl);
      if (instanceId) seenInstances.add(instanceId);

      const remote = rec?.remote;
      const remoteHost = isRecord(remote?.host) ? remote.host : null;
      const remoteStorage = isRecord(remote?.storage) ? remote.storage : null;
      const storageLimitBytes =
        remote?.settings?.storageLimitBytes ??
        remote?.storage?.storageLimitBytes ??
        node?.storageLimitBytes ??
        null;
      const limitSource =
        remote?.settings?.source ??
        (typeof remoteStorage?.limitSource === 'string' ? remoteStorage.limitSource : 'default');
      const analysis = asNumberPair(remote?.analysis ?? remote?.detectors);
      const streams = asNumberPair(remote?.streams);
      const playback = asNumberPair(remote?.playback);
      const sshServerId = node?.sshServerId ?? rec?.sshServerId ?? undefined;
      const livePriority = node?.livePriority ?? rec?.livePriority;

      peers.push({
        id,
        kind: 'hub',
        local: false,
        name: node?.name ?? rec?.name ?? id,
        enabled: node?.enabled ?? rec?.enabled ?? true,
        roles: [...(node?.roles ?? rec?.roles ?? [])],
        online: typeof rec?.online === 'boolean' ? rec.online : Boolean(node?.online),
        lastSeen: rec?.lastSeen ?? node?.lastSeen ?? now,
        ...(url ? { url } : {}),
        ...(typeof livePriority === 'number' ? { livePriority } : {}),
        ...(sshServerId ? { sshServerId } : {}),
        host: remoteHost,
        storage: remoteStorage,
        settings: { storageLimitBytes, source: limitSource },
        ...(streams ? { streams } : {}),
        ...(analysis ? { analysis } : {}),
        ...(playback ? { playback } : {}),
        ...(typeof rec?.backupCopies === 'number' ? { backupCopies: rec.backupCopies } : {}),
        ...(rec?.error ? { error: rec.error } : {}),
      });
    };

    for (const node of clusterNodes) {
      const norm = normalizeClusterUrl(node.url);
      const rec = recById.get(node.id) ?? (norm ? recByUrl.get(norm) : undefined);
      appendPeer(node, rec);
    }
    for (const rec of recordingNodes) {
      appendPeer(undefined, rec);
    }
    return peers;
  }
}
