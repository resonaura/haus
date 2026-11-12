/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

type Api = (
  path: string,
  init?: { method?: 'GET' | 'POST' | 'DELETE'; body?: unknown },
) => Promise<unknown>;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Explicit Apple HomeKit publication operations over the authenticated Hub session,
 * enforcing strict path validation without creating a generic proxy.
 */
export class HubHomeKitPublishing {
  constructor(private readonly api: Api) {}

  async request(input: unknown): Promise<unknown> {
    if (
      !record(input) ||
      Object.keys(input).some((key) => !['method', 'path', 'data'].includes(key))
    ) {
      throw Error('Invalid HomeKit publication request.');
    }
    const { method, path, data } = input;
    if (typeof path !== 'string') throw Error('Invalid HomeKit publication request.');

    // 1. Bridge endpoints
    if (path === 'homekit/bridge' && method === 'GET' && data === undefined) {
      return this.api('/api/homekit/publication/bridge');
    }
    if (path === 'homekit/bridge/reset' && method === 'POST') {
      return this.api('/api/homekit/publication/bridge/reset', { method: 'POST', body: {} });
    }
    if (path === 'homekit/bridge/devices' && method === 'POST' && record(data)) {
      if (typeof data.deviceId !== 'string' || !data.deviceId) {
        throw Error('Missing deviceId for bridge addition.');
      }
      return this.api('/api/homekit/publication/bridge/devices', {
        method: 'POST',
        body: { deviceId: data.deviceId },
      });
    }
    const bridgeDeviceDeleteMatch = /^homekit\/bridge\/devices\/([a-zA-Z0-9_.:-]+)$/.exec(path);
    if (bridgeDeviceDeleteMatch && method === 'DELETE' && data === undefined) {
      return this.api(
        `/api/homekit/publication/bridge/devices/${encodeURIComponent(bridgeDeviceDeleteMatch[1]!)}`,
        {
          method: 'DELETE',
        },
      );
    }
    if (path === 'homekit/bridge/select' && method === 'POST' && record(data)) {
      if (!Array.isArray(data.deviceIds)) {
        throw Error('deviceIds must be an array.');
      }
      return this.api('/api/homekit/publication/bridge/select', {
        method: 'POST',
        body: { deviceIds: data.deviceIds },
      });
    }

    // 2. Accessories overview
    if (path === 'homekit/accessories' && method === 'GET' && data === undefined) {
      return this.api('/api/homekit/publication/accessories');
    }

    // 3. Mapping diagnostics
    const mappingMatch = /^homekit\/devices\/([a-zA-Z0-9_.:-]+)\/mapping$/.exec(path);
    if (mappingMatch && method === 'GET' && data === undefined) {
      return this.api(
        `/api/homekit/publication/devices/${encodeURIComponent(mappingMatch[1]!)}/mapping`,
      );
    }

    // 4. Standalone accessory endpoints
    const standalonePublishMatch = /^homekit\/standalone\/([a-zA-Z0-9_.:-]+)$/.exec(path);
    if (standalonePublishMatch && method === 'POST' && (data === undefined || record(data))) {
      return this.api(
        `/api/homekit/publication/standalone/${encodeURIComponent(standalonePublishMatch[1]!)}`,
        {
          method: 'POST',
          body: data ?? {},
        },
      );
    }
    if (standalonePublishMatch && method === 'DELETE' && data === undefined) {
      return this.api(
        `/api/homekit/publication/standalone/${encodeURIComponent(standalonePublishMatch[1]!)}`,
        {
          method: 'DELETE',
        },
      );
    }
    const standaloneResetMatch = /^homekit\/standalone\/([a-zA-Z0-9_.:-]+)\/reset$/.exec(path);
    if (standaloneResetMatch && method === 'POST') {
      return this.api(
        `/api/homekit/publication/standalone/${encodeURIComponent(standaloneResetMatch[1]!)}/reset`,
        {
          method: 'POST',
          body: {},
        },
      );
    }

    throw Error('Unsupported HomeKit publication operation.');
  }
}
