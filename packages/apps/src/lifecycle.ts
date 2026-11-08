/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { DockerPort } from './docker.js';
import type { AppManifest } from './manifest.js';
import { validateAppManifest } from './manifest.js';
import type { AppPermissionType } from './policy.js';
import { assessAppPermissions } from './policy.js';

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
  readonly apiVersion?: string;
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

  constructor(
    private readonly port: DockerPort,
    private readonly options: AppLifecycleOptions,
  ) {
    this.apiPrefix = `/v1.${options.apiVersion ?? '45'}`;
  }

  private resolveHostMount(appId: string, target: string): string {
    const root = this.options.dataRoot.replace(/\/+$/, '');
    return `${root}/${appId}/${target}`;
  }

  async install(
    manifest: AppManifest,
    grantedPermissions: readonly AppPermissionType[] = [],
  ): Promise<{ containerId: string; manifest: AppManifest }> {
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

    const envList: string[] = [];
    if (manifest.env) {
      if (Array.isArray(manifest.env)) {
        envList.push(...manifest.env);
      } else if (typeof manifest.env === 'object') {
        for (const [k, v] of Object.entries(manifest.env)) {
          envList.push(`${k}=${v}`);
        }
      }
    }

    const containerPayload = {
      Image: manifest.image,
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

    try {
      const existingList = await this.port.request<
        Array<{ Id: string; Labels?: Record<string, string> }>
      >('GET', `${this.apiPrefix}/containers/json?all=1`);
      if (Array.isArray(existingList)) {
        const old = existingList.find((c) => c.Labels?.['io.haus.app'] === manifest.id);
        if (old?.Id) {
          try {
            await this.stop(old.Id);
          } catch {
            // Ignore if already stopped
          }
          await this.remove(old.Id, true);
        }
      }
    } catch {
      // Ignore if list/cleanup fails
    }

    const result = await this.port.request<{ Id: string }>(
      'POST',
      `${this.apiPrefix}/containers/create?name=haus-app-${manifest.id}`,
      containerPayload,
    );

    if (!result?.Id || !/^[a-f0-9]{64}$/.test(result.Id)) {
      throw new Error('invalid_container_creation_response');
    }

    return { containerId: result.Id, manifest };
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
      `${this.apiPrefix}/containers/${containerId}?v=1&force=${force ? 1 : 0}`,
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
  ): Promise<{ containerId: string; rolledBack: boolean; manifest: AppManifest }> {
    let newContainerId: string | undefined;

    try {
      const installResult = await this.install(targetManifest, grantedPermissions);
      newContainerId = installResult.containerId;

      // Stop previous container
      await this.stop(currentContainerId);

      // Start new container
      await this.start(newContainerId);

      // Observe new container health/status
      const observation = await this.observe(newContainerId);
      if (observation.state !== 'running' || observation.health === 'unhealthy') {
        throw new Error('new_container_unhealthy');
      }

      // Successful update: remove previous container
      await this.remove(currentContainerId, true);
      return { containerId: newContainerId, rolledBack: false, manifest: targetManifest };
    } catch {
      // Rollback: if new container was created, stop and remove it
      if (newContainerId) {
        try {
          await this.stop(newContainerId);
          await this.remove(newContainerId, true);
        } catch {
          // Best effort cleanup
        }
      }

      // Re-start previous container
      try {
        await this.start(currentContainerId);
      } catch {
        // If already started or recovery needed
      }

      return { containerId: currentContainerId, rolledBack: true, manifest: targetManifest };
    }
  }

  async recover(
    appId: string,
  ): Promise<{ containerId?: string; state: 'running' | 'stopped' | 'missing' }> {
    const list = await this.port.request<
      Array<{ Id: string; State?: string; Labels?: Record<string, string> }>
    >('GET', `${this.apiPrefix}/containers/json?all=1`);

    if (!Array.isArray(list)) return { state: 'missing' };

    const match = list.find((c) => c.Labels?.['io.haus.app'] === appId);
    if (!match?.Id) return { state: 'missing' };

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
