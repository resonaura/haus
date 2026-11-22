/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import type { DockerPort } from './docker.js';

export interface AppObservation {
  readonly id: string;
  readonly name: string;
  readonly state: 'running' | 'stopped' | 'starting' | 'stopping' | 'unknown';
  readonly health: 'healthy' | 'unhealthy' | 'starting' | 'none';
  readonly exitCode?: number;
  readonly restartCount: number;
  readonly startedAt?: string;
  readonly image: string;
  readonly imageId?: string;
  readonly version?: string;
  readonly mounts?: readonly AppObservedMount[];
  readonly ports: readonly { containerPort: number; hostPort?: number; protocol: string }[];
}

export interface AppLifecycleOptions {
  readonly dataRoot: string;
  /** Path to the same data directory as seen by the Docker daemon host. */
  readonly hostDataRoot?: string;
  readonly apiVersion?: string;
}

export type AppInstallStage =
  | 'validating'
  | 'checking-local'
  | 'pulling'
  | 'building'
  | 'ready'
  | 'creating'
  | 'starting'
  | 'complete'
  | 'failed';

export interface AppInstallProgressUpdate {
  readonly stage: AppInstallStage;
  readonly current?: number;
  readonly total?: number;
}

export interface DockerContainerMountInfo {
  readonly Type?: string;
  readonly Source?: string;
  readonly Destination?: string;
  readonly RW?: boolean;
}

export interface AppObservedMount {
  readonly type?: string;
  readonly source: string;
  readonly destination: string;
  readonly rw?: boolean;
}

export interface ContainerInspectResponse {
  Id: string;
  Name?: string;
  Image?: string;
  Config?: {
    Image?: string;
    Labels?: Record<string, string>;
  };
  State?: {
    Status?: string;
    Running?: boolean;
    ExitCode?: number;
    Restarting?: boolean;
    StartedAt?: string;
    Health?: {
      Status?: string;
    };
  };
  Mounts?: readonly DockerContainerMountInfo[];
  RestartCount?: number;
  NetworkSettings?: {
    Ports?: Record<string, Array<{ HostPort?: string }>>;
  };
}

export interface DockerContainerListItem {
  readonly Id: string;
  readonly Image?: string;
  readonly Names?: readonly string[];
  readonly State?: string;
  readonly Labels?: Readonly<Record<string, string>>;
  readonly Mounts?: readonly DockerContainerMountInfo[];
}

export type AppContainerLookupResult =
  | {
      readonly state: 'running' | 'stopped';
      readonly containerId: string;
      readonly observation: AppObservation;
    }
  | {
      readonly state: 'missing';
      readonly containerId?: undefined;
      readonly observation?: undefined;
    }
  | {
      readonly state: 'ambiguous';
      readonly containerId?: undefined;
      readonly containerIds: readonly string[];
      readonly observation?: undefined;
    };

export type AppContainerSelection =
  | { readonly kind: 'missing' }
  | { readonly kind: 'ambiguous'; readonly containerIds: readonly string[] }
  | { readonly kind: 'match'; readonly containerId: string };

const FORBIDDEN_HOST_SOURCES = new Set([
  '/',
  '/etc',
  '/proc',
  '/sys',
  '/root',
  '/var/run',
  '/run',
  '/dev',
]);

/** Validates that a bind-mount host path does not expose sensitive host roots or Docker socket. */
export function isSafeBindMountSource(source: string): boolean {
  const trimmed = source.trim();
  if (!trimmed.startsWith('/') || trimmed.includes('docker.sock') || trimmed.includes('..')) {
    return false;
  }
  const normalized = trimmed.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
  return !FORBIDDEN_HOST_SOURCES.has(normalized);
}

/** Extracts the most specific container version label exposed by a Haus/OCI/HA add-on image. */
export function extractObservedVersion(
  labels?: Readonly<Record<string, string>>,
): string | undefined {
  if (!labels) return undefined;
  const hausVersion = labels['io.haus.version']?.trim();
  const ociVersion = labels['org.opencontainers.image.version']?.trim();
  const hassVersion = labels['io.hass.version']?.trim();

  if (hausVersion) {
    if (ociVersion && ociVersion.startsWith(`${hausVersion}+`)) return ociVersion;
    if (hassVersion && hassVersion.startsWith(`${hausVersion}+`)) return hassVersion;
    return hausVersion;
  }
  return ociVersion || hassVersion || undefined;
}

function imageRepo(imageRef: string | undefined): string | undefined {
  if (!imageRef) return undefined;
  const trimmed = imageRef.trim().toLowerCase();
  if (!trimmed || trimmed.startsWith('sha256:')) return undefined;
  const noDigest = trimmed.split('@')[0] ?? trimmed;
  const lastSlash = noDigest.lastIndexOf('/');
  const lastColon = noDigest.lastIndexOf(':');
  return lastColon > lastSlash ? noDigest.slice(0, lastColon) : noDigest;
}

/** Selects the canonical Docker container matching `io.haus.app=<appId>` without mutating state. */
export function selectAppContainer(
  list: readonly DockerContainerListItem[],
  appId: string,
  expectedImage?: string,
): AppContainerSelection {
  let matches = list.filter(
    (container) =>
      /^[a-f0-9]{64}$/.test(container.Id) && container.Labels?.['io.haus.app'] === appId,
  );
  if (matches.length === 0 && expectedImage) {
    const targetRef = expectedImage.trim().toLowerCase();
    const targetRepo = imageRepo(expectedImage);
    matches = list.filter((container) => {
      if (!/^[a-f0-9]{64}$/.test(container.Id)) return false;
      if (container.Labels?.['io.haus.app']) return false;
      const isHausManagedName = container.Names?.some((name) => name.startsWith('/haus-')) ?? false;
      if (!isHausManagedName && !container.Labels?.['io.haus.pi-migration']) return false;
      const candidateRef = container.Image?.trim().toLowerCase();
      if (!candidateRef) return false;
      return (
        candidateRef === targetRef ||
        (targetRepo !== undefined && imageRepo(candidateRef) === targetRepo)
      );
    });
  }
  if (matches.length === 0) return { kind: 'missing' };

  const running = matches.filter((container) => container.State === 'running');
  if (running.length > 1) {
    return { kind: 'ambiguous', containerIds: running.map((container) => container.Id) };
  }

  const canonicalName = `/haus-app-${appId}`;
  const match =
    running[0] ??
    matches.find((container) => container.Names?.includes(canonicalName)) ??
    matches[0];
  return match ? { kind: 'match', containerId: match.Id } : { kind: 'missing' };
}

function normalizePath(path: string): string {
  const normalized = path.trim().replace(/\/+/g, '/').replace(/\/$/, '');
  return normalized || '/';
}

function readLocalMountRoot(mountPoint: string): string | undefined {
  try {
    const content = readFileSync('/proc/self/mountinfo', 'utf8');
    const normalizedTarget = normalizePath(mountPoint);
    for (const line of content.split('\n')) {
      if (!line) continue;
      const fields = line.split(' ');
      if (fields.length < 5) continue;
      if (normalizePath(fields[4] ?? '') === normalizedTarget && fields[3]) {
        return normalizePath(fields[3]);
      }
    }
  } catch {
    // Non-Linux or unreadable procfs.
  }
  return undefined;
}

/**
 * Resolves the host-side bind-mount source path backing `containerDataDir` for the running hub
 * container when `HAUS_DATA_HOST_DIR` was not explicitly provided in environment variables.
 */
export async function detectHostMountSource(
  port: DockerPort,
  apiPrefix: string,
  containerDataDir: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const targetDest = normalizePath(containerDataDir);
  if (!targetDest || targetDest === '/') return undefined;

  const list = signal
    ? await port.request<DockerContainerListItem[]>(
        'GET',
        `${apiPrefix}/containers/json?all=1`,
        signal,
      )
    : await port.request<DockerContainerListItem[]>('GET', `${apiPrefix}/containers/json?all=1`);
  if (!Array.isArray(list)) return undefined;

  const candidates: Array<{ container: DockerContainerListItem; source: string }> = [];
  for (const container of list) {
    if (container.State !== 'running' || !Array.isArray(container.Mounts)) continue;
    const hasDockerSock = container.Mounts.some(
      (mount) =>
        (mount.Destination?.endsWith('/docker.sock') || mount.Source?.endsWith('/docker.sock')) ??
        false,
    );
    if (!hasDockerSock) continue;
    const dataMount = container.Mounts.find(
      (mount) =>
        mount.Type === 'bind' &&
        typeof mount.Destination === 'string' &&
        normalizePath(mount.Destination) === targetDest &&
        typeof mount.Source === 'string' &&
        isSafeBindMountSource(mount.Source),
    );
    if (dataMount?.Source) {
      candidates.push({ container, source: normalizePath(dataMount.Source) });
    }
  }

  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0]!.source;

  const currentHost = hostname().trim().toLowerCase();
  if (/^[a-f0-9]{12,64}$/.test(currentHost)) {
    const byId = candidates.filter((c) => c.container.Id.toLowerCase().startsWith(currentHost));
    if (byId.length === 1) return byId[0]!.source;
  }

  const mountRoot = readLocalMountRoot(targetDest);
  if (mountRoot && mountRoot !== '/') {
    const byRoot = candidates.filter((c) => c.source === mountRoot || c.source.endsWith(mountRoot));
    if (byRoot.length === 1) return byRoot[0]!.source;
  }

  const byName = candidates.filter((c) =>
    c.container.Names?.some((name) => name === '/haus-hub' || name === '/haus-worker'),
  );
  if (byName.length === 1) return byName[0]!.source;

  return undefined;
}

/** Normalizes a Docker `/containers/{id}/json` inspect payload into an `AppObservation`. */
export function parseContainerObservation(data: ContainerInspectResponse): AppObservation {
  const rawStatus = data.State?.Status ?? '';
  const state: AppObservation['state'] =
    rawStatus === 'running'
      ? 'running'
      : data.State?.Restarting
        ? 'starting'
        : ['exited', 'dead', 'created'].includes(rawStatus)
          ? 'stopped'
          : 'unknown';

  const rawHealth = data.State?.Health?.Status;
  const health: AppObservation['health'] =
    rawHealth === 'healthy'
      ? 'healthy'
      : rawHealth === 'unhealthy'
        ? 'unhealthy'
        : rawHealth === 'starting'
          ? 'starting'
          : 'none';

  const ports: Array<{ containerPort: number; hostPort?: number; protocol: string }> = [];
  if (data.NetworkSettings?.Ports) {
    for (const [key, bindings] of Object.entries(data.NetworkSettings.Ports)) {
      const [cPortStr, proto = 'tcp'] = key.split('/');
      const containerPort = Number(cPortStr);
      const hostPort = bindings?.[0]?.HostPort ? Number(bindings[0].HostPort) : undefined;
      if (!Number.isNaN(containerPort)) {
        ports.push({ containerPort, hostPort, protocol: proto });
      }
    }
  }

  const mounts: AppObservedMount[] = [];
  if (Array.isArray(data.Mounts)) {
    for (const m of data.Mounts) {
      if (typeof m.Source === 'string' && typeof m.Destination === 'string') {
        mounts.push({
          ...(m.Type ? { type: m.Type } : {}),
          source: m.Source,
          destination: m.Destination,
          ...(typeof m.RW === 'boolean' ? { rw: m.RW } : {}),
        });
      }
    }
  }

  const version = extractObservedVersion(data.Config?.Labels);
  return {
    id: data.Id,
    name: data.Name?.replace(/^\//, '') ?? data.Id.slice(0, 12),
    state,
    health,
    exitCode: data.State?.ExitCode,
    restartCount: data.RestartCount ?? 0,
    startedAt: data.State?.StartedAt,
    image: data.Config?.Image ?? '',
    ...(typeof data.Image === 'string' && data.Image ? { imageId: data.Image } : {}),
    ...(version ? { version } : {}),
    ...(mounts.length > 0 ? { mounts } : {}),
    ports,
  };
}

/**
 * Extracts verified host bind-mount overrides from a predecessor container when the hub's
 * host data root has not been mapped separately from its container data root.
 */
export function collectMountOverrides(
  previous: AppObservation,
): ReadonlyMap<string, string> | undefined {
  if (!previous.mounts?.length) return undefined;
  const overrides = new Map<string, string>();
  for (const mount of previous.mounts) {
    if (mount.type && mount.type !== 'bind') continue;
    if (isSafeBindMountSource(mount.source)) {
      overrides.set(mount.destination, normalizePath(mount.source));
    }
  }
  return overrides.size > 0 ? overrides : undefined;
}
