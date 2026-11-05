/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type {
  AppAction,
  AppDriver,
  AppDriverCapabilities,
  AppInfo,
  AppOperation,
  AppOperationResult,
  RuntimeApp,
} from '@haus/apps';

export interface SupervisorPort {
  request<T>(method: 'GET' | 'POST', path: string, signal?: AbortSignal): Promise<T>;
}

interface AddonRow {
  slug: string;
  name?: string;
  version?: string;
  state?: string;
  options?: Record<string, unknown>;
  description?: string;
  update_available?: boolean;
  version_latest?: string;
  url?: string;
}

const SUPERVISOR_CAPABILITIES: AppDriverCapabilities = {
  lifecycle: true,
  install: false,
  remove: false,
  update: false,
  configure: false,
  logs: false,
  info: true,
} as const;

/** App management is a separate runtime capability from the automation connection. */
export class SupervisorApps implements AppDriver {
  readonly capabilities = SUPERVISOR_CAPABILITIES;
  constructor(
    readonly id: string,
    private readonly port: SupervisorPort,
  ) {}
  async list(signal?: AbortSignal): Promise<readonly RuntimeApp[]> {
    const response = await this.port.request<{ data?: { addons?: unknown[] }; addons?: unknown[] }>(
      'GET',
      '/addons',
      signal,
    );
    const rows = response.data?.addons ?? response.addons;
    if (!Array.isArray(rows)) throw Error('invalid_app_inventory');
    return rows.slice(0, 2000).flatMap((value) => {
      if (!value || typeof value !== 'object') return [];
      const item = value as Record<string, unknown>;
      if (typeof item.slug !== 'string' || !/^[-a-zA-Z0-9_]{1,128}$/.test(item.slug)) return [];
      return [
        {
          externalId: item.slug,
          name: typeof item.name === 'string' ? item.name : item.slug,
          version: typeof item.version === 'string' ? item.version : undefined,
          state:
            item.state === 'started'
              ? ('running' as const)
              : item.state === 'stopped'
                ? ('stopped' as const)
                : ('unknown' as const),
          managed: true,
          actions: ['start', 'stop', 'restart'] as const,
        },
      ];
    });
  }
  async execute(externalId: string, action: AppAction, signal?: AbortSignal) {
    if (
      !/^[-a-zA-Z0-9_]{1,128}$/.test(externalId) ||
      !['start', 'stop', 'restart'].includes(action)
    )
      throw Error('invalid_app_action');
    const current = (await this.list(signal)).find((app) => app.externalId === externalId);
    if (!current) throw Error('unknown_app');
    await this.port.request('POST', `/addons/${externalId}/${action}`, signal);
  }
  async inspect(externalId: string, signal?: AbortSignal): Promise<AppOperationResult<AppInfo>> {
    if (!/^[-a-zA-Z0-9_]{1,128}$/.test(externalId))
      return { status: 'error', reason: 'invalid_app_id' };
    const response = await this.port.request<{ data?: { addons?: unknown[] }; addons?: unknown[] }>(
      'GET',
      '/addons',
      signal,
    );
    const rows = response.data?.addons ?? response.addons;
    if (!Array.isArray(rows)) return { status: 'error', reason: 'invalid_app_inventory' };
    const match = rows.find(
      (r) => r && typeof r === 'object' && (r as AddonRow).slug === externalId,
    ) as AddonRow | undefined;
    if (!match) return { status: 'error', reason: 'unknown_app' };
    return {
      status: 'ok',
      data: {
        externalId: match.slug,
        name: typeof match.name === 'string' ? match.name : match.slug,
        version: typeof match.version === 'string' ? match.version : undefined,
        state:
          match.state === 'started' ? 'running' : match.state === 'stopped' ? 'stopped' : 'unknown',
        managed: true,
        description: typeof match.description === 'string' ? match.description : undefined,
        updatable: match.update_available === true,
        updateVersion: typeof match.version_latest === 'string' ? match.version_latest : undefined,
      },
    };
  }
  async operate(
    operation: AppOperation,
    _externalId: string,
    _options?: Record<string, unknown>,
    _signal?: AbortSignal,
  ): Promise<AppOperationResult> {
    return { status: 'unsupported', reason: `supervisor_driver_does_not_support_${operation}` };
  }
}
