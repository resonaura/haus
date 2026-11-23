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
      if (path === 'apps/repositories') return this.api('/api/apps/repositories');
      if (path === 'apps/catalog' || path.startsWith('apps/catalog?')) {
        const rawQuery = path.startsWith('apps/catalog?') ? path.slice('apps/catalog?'.length) : '';
        const allowedKeys = new Set([
          'runtimeType',
          'category',
          'search',
          'refresh',
          'channel',
          'installed',
        ]);
        const incoming = new URLSearchParams(rawQuery);
        const sanitized = new URLSearchParams();
        for (const [key, value] of incoming.entries()) {
          if (!allowedKeys.has(key) || value.length > 120) {
            throw Error('Invalid App request.');
          }
          sanitized.set(key, value);
        }
        const qs = sanitized.toString();
        return this.api(qs ? `/api/apps/catalog?${qs}` : '/api/apps/catalog');
      }
      const catalogMatch = /^apps\/catalog\/([a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127})$/.exec(path);
      if (catalogMatch)
        return this.api(`/api/apps/catalog/${encodeURIComponent(catalogMatch[1]!)}`);
    }

    if (method === 'POST' && path === 'apps/repositories') {
      if (
        !record(data) ||
        Object.keys(data).some((key) => key !== 'url') ||
        typeof data.url !== 'string' ||
        data.url.trim().length === 0 ||
        data.url.length > 240
      )
        throw Error('Invalid App request.');
      return this.api('/api/apps/repositories', { method: 'POST', body: { url: data.url.trim() } });
    }

    if (method === 'POST' && path === 'apps/repositories/reload') {
      if (data !== undefined && (!record(data) || Object.keys(data).length > 0))
        throw Error('Invalid App request.');
      return this.api('/api/apps/repositories/reload', { method: 'POST', body: {} });
    }

    const repoMatch = /^apps\/repositories\/([a-f0-9]{8})\/(reload|remove)$/.exec(path);
    if (repoMatch && method === 'POST') {
      if (data !== undefined && (!record(data) || Object.keys(data).length > 0))
        throw Error('Invalid App request.');
      return this.api(`/api/apps/repositories/${repoMatch[1]}/${repoMatch[2]}`, {
        method: 'POST',
        body: {},
      });
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
    if (
      match[2] === 'operate' &&
      (data.operation === 'logs' || data.operation === 'info') &&
      Object.keys(data).every(
        (key) => key === 'operation' || (data.operation === 'logs' && key === 'options'),
      )
    ) {
      const opts =
        data.operation === 'logs' &&
        record(data.options) &&
        typeof data.options.tail === 'number' &&
        Number.isInteger(data.options.tail)
          ? { tail: data.options.tail }
          : undefined;
      return this.api(endpoint, {
        method: 'POST',
        body: { operation: data.operation, ...(opts ? { options: opts } : {}) },
      });
    }
    if (
      match[2] === 'configure' &&
      !Object.keys(data).some((key) => ['url', 'token'].includes(key))
    ) {
      const replace = data.replace === true;
      const options = record(data.options)
        ? data.options
        : record(data.config)
          ? data.config
          : data;
      return this.api(`/api/apps/${appId}/operate`, {
        method: 'POST',
        body: {
          operation: 'configure',
          options: replace ? { __hausReplace: true, values: options } : options,
        },
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
