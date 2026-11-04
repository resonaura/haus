/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { AppAction, AppDriver, RuntimeApp } from '@haus/apps';
export interface SupervisorPort {
  request<T>(method: 'GET' | 'POST', path: string, signal?: AbortSignal): Promise<T>;
}
/** App management is a separate runtime capability from the automation connection. */
export class SupervisorApps implements AppDriver {
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
}
