/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { AppAction, AppDriver, RuntimeApp } from './types.js';

export interface DockerPort {
  request<T>(method: 'GET' | 'POST', path: string, signal?: AbortSignal): Promise<T>;
}
interface Container {
  Id: string;
  Names?: string[];
  Image?: string;
  State?: string;
  Labels?: Record<string, string>;
}
const version = (value: string) => (/^1\.\d+$/.test(value) ? Number(value.slice(2)) : NaN);
/** The host supplies a trusted Docker transport; clients never receive its socket or credentials. */
export class DockerApps implements AppDriver {
  private api?: string;
  constructor(
    readonly id: string,
    private readonly port: DockerPort,
    private readonly options: { minimum?: number; maximum?: number } = {},
  ) {}
  private async prefix(signal?: AbortSignal) {
    if (this.api) return this.api;
    const server = await this.port.request<{ ApiVersion: string; MinAPIVersion?: string }>(
      'GET',
      '/version',
      signal,
    );
    const lower = Math.max(
        this.options.minimum ?? 41,
        server.MinAPIVersion ? version(server.MinAPIVersion) : 24,
      ),
      upper = Math.min(this.options.maximum ?? 56, version(server.ApiVersion));
    if (!Number.isInteger(lower) || !Number.isInteger(upper) || lower > upper)
      throw Error('unsupported_docker_api');
    return (this.api = `/v1.${upper}`);
  }
  async list(signal?: AbortSignal): Promise<readonly RuntimeApp[]> {
    const prefix = await this.prefix(signal);
    const rows = await this.port.request<Container[]>(
      'GET',
      `${prefix}/containers/json?all=1`,
      signal,
    );
    if (!Array.isArray(rows)) throw Error('invalid_app_inventory');
    return rows
      .slice(0, 2000)
      .filter((row) => /^[a-f0-9]{64}$/.test(row.Id))
      .map((row) => {
        const managed =
          typeof row.Labels?.['io.haus.app'] === 'string' && row.Labels['io.haus.app'].length > 0;
        return {
          externalId: row.Id,
          name: row.Names?.[0]?.replace(/^\//, '') || row.Id.slice(0, 12),
          image: row.Image,
          version: row.Labels?.['org.opencontainers.image.version'],
          managed,
          state:
            row.State === 'running'
              ? 'running'
              : row.State === 'restarting'
                ? 'starting'
                : ['exited', 'created', 'dead'].includes(row.State ?? '')
                  ? 'stopped'
                  : 'unknown',
          actions: managed ? ['start', 'stop', 'restart'] : [],
        };
      });
  }
  async execute(externalId: string, action: AppAction, signal?: AbortSignal) {
    if (!/^[a-f0-9]{64}$/.test(externalId) || !['start', 'stop', 'restart'].includes(action))
      throw Error('invalid_app_action');
    // Revalidate exact container ownership even when a caller bypasses Apps.
    const current = (await this.list(signal)).find((app) => app.externalId === externalId);
    if (!current?.managed) throw Error('unmanaged_app');
    await this.port.request(
      'POST',
      `${await this.prefix(signal)}/containers/${externalId}/${action}`,
      signal,
    );
  }
}
