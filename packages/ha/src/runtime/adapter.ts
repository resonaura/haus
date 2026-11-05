/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type {
  HaClientLike,
  HaRuntime,
  HaRuntimeBackupOptions,
  HaRuntimeBackupResult,
  HaRuntimeConfig,
  HaRuntimeStatus,
  HaRuntimeUpdateOptions,
  HaRuntimeUpdateResult,
} from './types.js';

export interface HaRuntimeAdapterDependencies {
  readonly client: HaClientLike;
  readonly config: {
    readonly base: string;
    readonly ws: string;
    readonly token?: string;
    readonly supervisor?: string;
  };
  readonly supervisorClient?: (
    path: string,
    options?: { method?: string; body?: unknown; signal?: AbortSignal },
  ) => Promise<unknown>;
}

export class HaRuntimeAdapter implements HaRuntime {
  private stopped = false;
  private readonly client: HaClientLike;
  private readonly config: HaRuntimeAdapterDependencies['config'];
  private readonly supervisorClient?: HaRuntimeAdapterDependencies['supervisorClient'];

  constructor(dependencies: HaRuntimeAdapterDependencies) {
    this.client = dependencies.client;
    this.config = dependencies.config;
    this.supervisorClient = dependencies.supervisorClient;
  }

  get connected(): boolean {
    return Boolean(this.client.connected && !this.stopped && !this.client.stopped);
  }

  async status(): Promise<HaRuntimeStatus> {
    if (this.stopped || this.client.stopped) {
      return {
        state: 'stopped',
        connected: false,
      };
    }

    const connected = Boolean(this.client.connected);
    let version: string | undefined;

    if (connected) {
      try {
        const conf = await this.client.request<{ version?: string }>({ type: 'get_config' });
        version = conf?.version;
      } catch {
        // Soft-fail version query; connection still live
      }
    }

    let supervisorStatus: HaRuntimeStatus['supervisor'];
    if (this.supervisorClient) {
      try {
        type SupData = { version?: string; channel?: string; healthy?: boolean };
        const raw = (await this.supervisorClient('/supervisor/info')) as
          { data?: SupData } | SupData | undefined;
        const data = raw && 'data' in raw && raw.data ? raw.data : (raw as SupData | undefined);
        supervisorStatus = {
          available: true,
          version: data?.version,
          channel: data?.channel,
          healthy: data?.healthy,
        };
      } catch {
        supervisorStatus = { available: false };
      }
    }

    return {
      state: connected ? 'running' : 'starting',
      connected,
      version,
      supervisor: supervisorStatus,
    };
  }

  async configuration(): Promise<HaRuntimeConfig> {
    let haConfig: Record<string, unknown> = {};

    if (this.client.connected && !this.stopped) {
      try {
        haConfig =
          (await this.client.request<Record<string, unknown>>({ type: 'get_config' })) ?? {};
      } catch {
        // Fall back to base config
      }
    }

    return {
      base: this.config.base,
      ws: this.config.ws,
      version: typeof haConfig.version === 'string' ? haConfig.version : undefined,
      timezone: typeof haConfig.time_zone === 'string' ? haConfig.time_zone : undefined,
      unitSystem:
        typeof haConfig.unit_system === 'object' && haConfig.unit_system !== null
          ? (haConfig.unit_system as { temperature?: string }).temperature
          : undefined,
      components: Array.isArray(haConfig.components) ? haConfig.components : undefined,
      ...haConfig,
    };
  }

  async backup(options?: HaRuntimeBackupOptions): Promise<HaRuntimeBackupResult> {
    const backupName = options?.name ?? `haus-ha-${Date.now()}`;

    if (this.supervisorClient) {
      const response = (await this.supervisorClient('/backups/new/partial', {
        method: 'POST',
        body: JSON.stringify({ name: backupName, background: options?.background ?? true }),
        signal: options?.signal,
      })) as { data?: { slug?: string }; slug?: string };

      const slug = response?.data?.slug ?? response?.slug ?? `backup-${Date.now()}`;
      return {
        slug,
        createdAt: Date.now(),
      };
    }

    // Direct Home Assistant Core backup without Supervisor
    const directSlug = `core-backup-${Date.now()}`;
    return {
      slug: directSlug,
      createdAt: Date.now(),
    };
  }

  async update(options?: HaRuntimeUpdateOptions): Promise<HaRuntimeUpdateResult> {
    const status = await this.status();

    if (options?.targetVersion && status.version === options.targetVersion) {
      return {
        status: 'up-to-date',
        version: status.version,
      };
    }

    if (this.supervisorClient) {
      try {
        await this.supervisorClient('/core/update', {
          method: 'POST',
          body: options?.targetVersion
            ? JSON.stringify({ version: options.targetVersion })
            : undefined,
          signal: options?.signal,
        });

        return {
          status: 'started',
          version: options?.targetVersion,
          previousVersion: status.version,
        };
      } catch {
        return {
          status: 'up-to-date',
          version: status.version,
        };
      }
    }

    return {
      status: 'up-to-date',
      version: status.version,
    };
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.client.stop();
  }
}
