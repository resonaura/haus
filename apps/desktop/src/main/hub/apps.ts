/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

type Api = (path: string, init?: { method?: 'GET' | 'POST'; body?: unknown }) => Promise<unknown>;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Explicit App operations over the authenticated Hub session, without a generic API proxy. */
export class HubApps {
  constructor(private readonly api: Api) {}

  async request(input: unknown): Promise<unknown> {
    if (
      !record(input) ||
      Object.keys(input).some((key) => !['method', 'path', 'data'].includes(key))
    )
      throw Error('Invalid App request.');
    const { method, path, data } = input;
    if (typeof path !== 'string') throw Error('Invalid App request.');

    if (method === 'GET' && data === undefined) {
      if (path === 'apps') return this.api('/api/apps');
      if (path === 'apps/catalog') return this.api('/api/apps/catalog');
      const catalogMatch = /^apps\/catalog\/([a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127})$/.exec(path);
      if (catalogMatch)
        return this.api(`/api/apps/catalog/${encodeURIComponent(catalogMatch[1]!)}`);
    }

    if (method === 'POST' && path === 'apps/install') {
      if (
        !record(data) ||
        Object.keys(data).some(
          (key) => !['manifest', 'grantedPermissions', 'config'].includes(key),
        ) ||
        !record(data.manifest) ||
        typeof data.manifest.id !== 'string' ||
        (data.grantedPermissions !== undefined && !Array.isArray(data.grantedPermissions)) ||
        (data.config !== undefined && !record(data.config))
      )
        throw Error('Invalid App request.');
      return this.api('/api/apps/install', { method: 'POST', body: data });
    }

    const match =
      /^apps\/([a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127})\/(inspect|execute|operate|configure|remove|accessories(?:\/sync)?|update|update-check|install-progress)$/.exec(
        path,
      );
    if (!match) throw Error('Unsupported App operation.');
    const appId = encodeURIComponent(match[1]!);
    const endpoint = `/api/apps/${appId}/${match[2]}`;
    if (
      method === 'GET' &&
      ['inspect', 'accessories', 'update-check', 'install-progress'].includes(match[2]!) &&
      data === undefined
    )
      return this.api(endpoint);
    if (method !== 'POST' || !record(data)) throw Error('Invalid App request.');
    if (
      match[2] === 'execute' &&
      Object.keys(data).length === 1 &&
      typeof data.action === 'string' &&
      ['start', 'stop', 'restart'].includes(data.action)
    )
      return this.api(endpoint, { method: 'POST', body: { action: data.action } });
    if (match[2] === 'operate' && Object.keys(data).length === 1 && data.operation === 'logs')
      return this.api(endpoint, { method: 'POST', body: { operation: 'logs' } });
    if (
      match[2] === 'configure' &&
      !Object.keys(data).some((key) => ['url', 'token'].includes(key))
    ) {
      const options = record(data.options)
        ? data.options
        : record(data.config)
          ? data.config
          : data;
      return this.api(`/api/apps/${appId}/operate`, {
        method: 'POST',
        body: { operation: 'configure', options },
      });
    }
    if (match[2] === 'remove' && Object.keys(data).length === 0)
      return this.api(`/api/apps/${appId}/operate`, {
        method: 'POST',
        body: { operation: 'remove' },
      });
    if (match[2] === 'accessories/sync' && Object.keys(data).length === 0)
      return this.api(endpoint, { method: 'POST', body: {} });
    if (match[2] === 'update') {
      return this.api(endpoint, { method: 'POST', body: data });
    }
    throw Error('Unsupported App operation.');
  }
}
