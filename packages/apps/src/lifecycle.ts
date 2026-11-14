/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { randomUUID } from 'node:crypto';
import type { DockerPort } from './docker.js';
import type { AppManifest } from './manifest.js';
import { validateAppManifest } from './manifest.js';
import type { AppPermissionType } from './policy.js';
import { assessAppPermissions } from './policy.js';
import { buildAppEnvironment } from './environment.js';
import type { AppImageAcquirer, ResolvedAppImage } from './image.js';

function errorCode(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : '';
  return /^[a-z][a-z0-9_]{0,79}$/.test(message) ? message : fallback;
}

export interface AppObservation {
  readonly id: string;
  readonly name: string;
  readonly state: 'running' | 'stopped' | 'starting' | 'stopping' | 'unknown';
  readonly health: 'healthy' | 'unhealthy' | 'starting' | 'none';
  readonly exitCode?: number;
  readonly restartCount: number;
  readonly startedAt?: string;
  readonly image: string;
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

export interface ContainerInspectResponse {
  Id: string;
  Name?: string;
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
  RestartCount?: number;
  NetworkSettings?: {
    Ports?: Record<string, Array<{ HostPort?: string }>>;
  };
}

/**
 * Manages regular-Docker container lifecycle for Haus Apps.
 * Enforces least-privilege policies, isolated data directories, rollback on update failure,
 * and crash recovery.
 */
export class DockerAppLifecycle {
  private apiPrefix: string;
  private dataRoot: string;
  private hostDataRoot: string;

  constructor(
    private readonly port: DockerPort,
    private readonly options: AppLifecycleOptions,
    private readonly imageAcquirer?: AppImageAcquirer,
  ) {
    this.apiPrefix = `/v1.${options.apiVersion ?? '45'}`;
    this.dataRoot = options.dataRoot;
    this.hostDataRoot = options.hostDataRoot ?? options.dataRoot;
  }

  setDataRoot(dataRoot: string, hostDataRoot = dataRoot): void {
    if (!dataRoot.trim()) throw Error('invalid_app_data_root');
    if (!hostDataRoot.trim()) throw Error('invalid_app_host_data_root');
    this.dataRoot = dataRoot.replace(/\/+$/, '');
    this.hostDataRoot = hostDataRoot.replace(/\/+$/, '');
  }

  private resolveHostMount(appId: string, target: string): string {
    const root = this.hostDataRoot;
    return `${root}/${appId}/${target}`;
  }

  async install(
    manifest: AppManifest,
    grantedPermissions: readonly AppPermissionType[] = [],
    runtimeEnvironment: Readonly<Record<string, string>> = {},
    onProgress?: (progress: AppInstallProgressUpdate) => void,
    signal?: AbortSignal,
  ): Promise<{ containerId: string; manifest: AppManifest; image?: ResolvedAppImage }> {
    return this.createContainer(
      manifest,
      grantedPermissions,
      runtimeEnvironment,
      `haus-app-${manifest.id}`,
      true,
      onProgress,
      signal,
    );
  }

  private async createContainer(
    manifest: AppManifest,
    grantedPermissions: readonly AppPermissionType[],
    runtimeEnvironment: Readonly<Record<string, string>>,
    containerName: string,
    checkExisting: boolean,
    onProgress?: (progress: AppInstallProgressUpdate) => void,
    signal?: AbortSignal,
  ): Promise<{ containerId: string; manifest: AppManifest; image?: ResolvedAppImage }> {
    const validation = validateAppManifest(manifest);
    if (!validation.valid || !validation.manifest) {
      throw new Error(`invalid_manifest: ${validation.errors.join('; ')}`);
    }

    const assessment = assessAppPermissions(manifest, grantedPermissions);
    if (!assessment.allowed) {
      const violations = assessment.violations
        .map((v) => v.message)
        .concat(assessment.missingPermissions.map((p) => `missing permission: ${p}`));
      throw new Error(`policy_violation: ${violations.join('; ')}`);
    }

    if (checkExisting) {
      const existingList = signal
        ? await this.port.request<Array<{ Id: string; Labels?: Record<string, string> }>>(
            'GET',
            `${this.apiPrefix}/containers/json?all=1`,
            signal,
          )
        : await this.port.request<Array<{ Id: string; Labels?: Record<string, string> }>>(
            'GET',
            `${this.apiPrefix}/containers/json?all=1`,
          );
      if (!Array.isArray(existingList)) throw Error('app_inventory_invalid');
      if (existingList.some((container) => container.Labels?.['io.haus.app'] === manifest.id)) {
        throw Error('app_already_installed');
      }
    }

    let image: ResolvedAppImage | undefined;
    if (this.imageAcquirer) {
      image = await this.imageAcquirer.acquire(
        manifest,
        (progress) => onProgress?.(progress),
        signal,
      );
    }

    const exposedPorts: Record<string, Record<string, never>> = {};
    const portBindings: Record<string, Array<{ HostPort: string }>> = {};

    if (manifest.ports) {
      for (const p of manifest.ports) {
        const proto = p.protocol ?? 'tcp';
        const key = `${p.containerPort}/${proto}`;
        exposedPorts[key] = {};
        if (p.hostPort !== undefined) {
          portBindings[key] = [{ HostPort: String(p.hostPort) }];
        }
      }
    }

    const binds: string[] = [];
    if (manifest.mounts) {
      for (const m of manifest.mounts) {
        const hostDir = this.resolveHostMount(manifest.id, m.target);
        const mode = m.readOnly ? 'ro' : 'rw';
        binds.push(`${hostDir}:${m.containerPath}:${mode}`);
      }
    }

    const envList = buildAppEnvironment(manifest, runtimeEnvironment);
    const needsHostGateway = Object.values(runtimeEnvironment).some((value) =>
      value.includes('host.docker.internal'),
    );

    const containerPayload = {
      Image: image?.reference ?? manifest.image,
      Cmd: manifest.cmd ? [...manifest.cmd] : undefined,
      Env: envList.length > 0 ? envList : undefined,
      Labels: {
        'io.haus.app': manifest.id,
        'io.haus.version': manifest.version,
        'io.haus.managed': 'true',
        'org.opencontainers.image.version': manifest.version,
        ...(manifest.ingress?.enabled ? { 'io.haus.ingress': String(manifest.ingress.port) } : {}),
      },
      ExposedPorts: exposedPorts,
      HostConfig: {
        PortBindings: portBindings,
        Binds: binds,
        NetworkMode: manifest.network?.mode ?? 'bridge',
        ...(needsHostGateway ? { ExtraHosts: ['host.docker.internal:host-gateway'] } : {}),
        RestartPolicy: {
          Name: manifest.lifecycle?.restartPolicy ?? 'unless-stopped',
        },
        Memory: manifest.resources?.memoryLimitMb
          ? manifest.resources.memoryLimitMb * 1024 * 1024
          : undefined,
        NanoCpus: manifest.resources?.cpuLimit
          ? Math.round(manifest.resources.cpuLimit * 1e9)
          : undefined,
      },
    };

    onProgress?.({ stage: 'creating' });
    let result: { Id: string };
    try {
      const path = `${this.apiPrefix}/containers/create?name=${encodeURIComponent(containerName)}`;
      result = signal
        ? await this.port.request<{ Id: string }>('POST', path, containerPayload, signal)
        : await this.port.request<{ Id: string }>('POST', path, containerPayload);
    } catch (error) {
      throw Error(errorCode(error, 'app_container_create_failed'));
    }

    if (!result?.Id || !/^[a-f0-9]{64}$/.test(result.Id)) {
      throw new Error('invalid_container_creation_response');
    }

    return { containerId: result.Id, manifest, image };
  }

  async start(containerId: string, signal?: AbortSignal): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(containerId)) throw new Error('invalid_container_id');
    await this.port.request(
      'POST',
      `${this.apiPrefix}/containers/${containerId}/start`,
      undefined,
      signal,
    );
  }

  async stop(containerId: string, signal?: AbortSignal): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(containerId)) throw new Error('invalid_container_id');
    await this.port.request(
      'POST',
      `${this.apiPrefix}/containers/${containerId}/stop`,
      undefined,
      signal,
    );
  }

  async remove(containerId: string, force = true, signal?: AbortSignal): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(containerId)) throw new Error('invalid_container_id');
    await this.port.request(
      'DELETE',
      `${this.apiPrefix}/containers/${containerId}?force=${force ? 1 : 0}`,
      undefined,
      signal,
    );
  }

  async observe(containerId: string, signal?: AbortSignal): Promise<AppObservation> {
    if (!/^[a-f0-9]{64}$/.test(containerId)) throw new Error('invalid_container_id');
    const data = await this.port.request<ContainerInspectResponse>(
      'GET',
      `${this.apiPrefix}/containers/${containerId}/json`,
      undefined,
      signal,
    );

    if (!data?.Id) throw new Error('container_not_found');

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

    return {
      id: data.Id,
      name: data.Name?.replace(/^\//, '') ?? data.Id.slice(0, 12),
      state,
      health,
      exitCode: data.State?.ExitCode,
      restartCount: data.RestartCount ?? 0,
      startedAt: data.State?.StartedAt,
      image: data.Config?.Image ?? '',
      ports,
    };
  }

  /**
   * Performs an update to a new manifest version with automated rollback on failure.
   * If the new container fails to start or reports unhealthy, the old container is restored.
   */
  async update(
    currentContainerId: string,
    targetManifest: AppManifest,
    grantedPermissions: readonly AppPermissionType[] = [],
    runtimeEnvironment: Readonly<Record<string, string>> = {},
    onProgress?: (progress: AppInstallProgressUpdate) => void,
    signal?: AbortSignal,
  ): Promise<{
    containerId: string;
    rolledBack: boolean;
    cleanupPending?: boolean;
    errorCode?: string;
    manifest: AppManifest;
    image?: ResolvedAppImage;
  }> {
    if (!/^[a-f0-9]{64}$/.test(currentContainerId)) throw new Error('invalid_container_id');
    let newContainerId: string | undefined;
    let previousState: AppObservation['state'] | undefined;
    let previousTouched = false;
    let candidateStartAttempted = false;

    try {
      const previous = await this.observe(currentContainerId, signal);
      if (previous.state !== 'running' && previous.state !== 'stopped') {
        throw Error('app_update_previous_state_unknown');
      }
      previousState = previous.state;

      const installResult = await this.createContainer(
        targetManifest,
        grantedPermissions,
        runtimeEnvironment,
        `haus-update-${randomUUID()}`,
        false,
        onProgress,
        signal,
      );
      newContainerId = installResult.containerId;

      if (previousState === 'running') {
        previousTouched = true;
        await this.stop(currentContainerId, signal);
        candidateStartAttempted = true;
        await this.start(newContainerId, signal);

        const observation = await this.observe(newContainerId, signal);
        if (observation.state !== 'running' || observation.health === 'unhealthy') {
          throw new Error('new_container_unhealthy');
        }
      }

      let cleanupPending = false;
      try {
        await this.remove(currentContainerId, true, signal);
      } catch {
        // The candidate is already active; retain it and report old-container cleanup separately.
        cleanupPending = true;
      }
      return {
        containerId: newContainerId,
        rolledBack: false,
        ...(cleanupPending ? { cleanupPending: true } : {}),
        manifest: targetManifest,
        image: installResult.image,
      };
    } catch (error) {
      let cleanupPending = false;
      let candidateSafe = true;
      if (newContainerId) {
        try {
          await this.remove(newContainerId, true);
        } catch {
          cleanupPending = true;
          try {
            let candidate = await this.observe(newContainerId);
            if (candidate.state === 'running') {
              await this.stop(newContainerId);
              candidate = await this.observe(newContainerId);
            }
            candidateSafe = candidate.state === 'stopped';
          } catch {
            candidateSafe = false;
          }
        }
      }

      if (!previousState) throw Error(errorCode(error, 'app_update_failed'));
      let restored = !previousTouched;
      if (previousTouched && previousState === 'running') {
        try {
          let previous = await this.observe(currentContainerId);
          if (previous.state === 'stopped') {
            if (!candidateStartAttempted || candidateSafe) {
              await this.start(currentContainerId);
              previous = await this.observe(currentContainerId);
            }
          }
          restored = previous.state === 'running' && (!candidateStartAttempted || candidateSafe);
        } catch {
          restored = false;
        }
      }

      if (!restored) throw Error('app_update_rollback_failed');
      return {
        containerId: currentContainerId,
        rolledBack: true,
        ...(cleanupPending ? { cleanupPending: true } : {}),
        errorCode: errorCode(error, 'app_update_failed'),
        manifest: targetManifest,
      };
    }
  }

  async recover(appId: string): Promise<{
    containerId?: string;
    containerIds?: readonly string[];
    state: 'running' | 'stopped' | 'missing' | 'ambiguous';
  }> {
    const list = await this.port.request<
      Array<{ Id: string; Names?: string[]; State?: string; Labels?: Record<string, string> }>
    >('GET', `${this.apiPrefix}/containers/json?all=1`);

    if (!Array.isArray(list)) return { state: 'missing' };

    const matches = list.filter(
      (container) =>
        /^[a-f0-9]{64}$/.test(container.Id) && container.Labels?.['io.haus.app'] === appId,
    );
    if (matches.length === 0) return { state: 'missing' };

    const running = matches.filter((container) => container.State === 'running');
    if (running.length > 1) {
      return { state: 'ambiguous', containerIds: running.map((container) => container.Id) };
    }
    const canonicalName = `/haus-app-${appId}`;
    const match =
      running[0] ??
      matches.find((container) => container.Names?.includes(canonicalName)) ??
      matches[0];
    if (!match) return { state: 'missing' };

    const observation = await this.observe(match.Id);
    if (observation.state !== 'running') {
      try {
        await this.start(match.Id);
        return { containerId: match.Id, state: 'running' };
      } catch {
        return { containerId: match.Id, state: 'stopped' };
      }
    }

    return { containerId: match.Id, state: 'running' };
  }
}
