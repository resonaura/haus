/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

type Api = (
  path: string,
  init?: { method?: 'GET' | 'POST' | 'DELETE'; body?: unknown },
) => Promise<unknown>;

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Validated client for Haus commissioning endpoints over the authenticated Hub session.
 * Enforces explicit operation boundaries, rejects path traversal, and safely marshals requests.
 */
export class HubCommissioningClient {
  constructor(private readonly api: Api) {}

  async request(input: unknown): Promise<unknown> {
    if (
      !record(input) ||
      Object.keys(input).some((key) => !['method', 'path', 'data'].includes(key))
    ) {
      throw new Error('Invalid commissioning request.');
    }
    const { method, path, data } = input;
    if (typeof path !== 'string') throw new Error('Invalid commissioning path.');

    // 1. Session creation
    if (path === 'commissioning/sessions' && method === 'POST' && record(data)) {
      if (typeof data.code !== 'string' || !data.code.trim()) {
        throw new Error('Setup code is required.');
      }
      return this.api('/api/commissioning/sessions', {
        method: 'POST',
        body: {
          code: data.code.trim(),
          ...(typeof data.deadlineMs === 'number' ? { deadlineMs: data.deadlineMs } : {}),
          ...(typeof data.contextProtocol === 'string'
            ? { contextProtocol: data.contextProtocol }
            : {}),
        },
      });
    }

    // 2. Session inspect (GET /api/commissioning/sessions/:id?sinceSeq=...)
    const sessionGetMatch = /^commissioning\/sessions\/([a-zA-Z0-9_-]+)$/.exec(path);
    if (sessionGetMatch && method === 'GET') {
      const sessionId = encodeURIComponent(sessionGetMatch[1]!);
      const since =
        record(data) && typeof data.sinceSeq === 'number' ? `?sinceSeq=${data.sinceSeq}` : '';
      return this.api(`/api/commissioning/sessions/${sessionId}${since}`);
    }

    // 3. Session resume (POST /api/commissioning/sessions/:id/resume)
    const sessionResumeMatch = /^commissioning\/sessions\/([a-zA-Z0-9_-]+)\/resume$/.exec(path);
    if (sessionResumeMatch && method === 'POST') {
      const sessionId = encodeURIComponent(sessionResumeMatch[1]!);
      return this.api(`/api/commissioning/sessions/${sessionId}/resume`, {
        method: 'POST',
        body: {},
      });
    }

    // 4. Session cancel (POST /api/commissioning/sessions/:id/cancel)
    const sessionCancelMatch = /^commissioning\/sessions\/([a-zA-Z0-9_-]+)\/cancel$/.exec(path);
    if (sessionCancelMatch && method === 'POST') {
      const sessionId = encodeURIComponent(sessionCancelMatch[1]!);
      return this.api(`/api/commissioning/sessions/${sessionId}/cancel`, {
        method: 'POST',
        body: {},
      });
    }

    // 5. Candidate selection (POST /api/commissioning/sessions/:id/select)
    const sessionSelectMatch = /^commissioning\/sessions\/([a-zA-Z0-9_-]+)\/select$/.exec(path);
    if (sessionSelectMatch && method === 'POST' && record(data)) {
      if (typeof data.candidateId !== 'string' || !data.candidateId) {
        throw new Error('candidateId is required.');
      }
      const sessionId = encodeURIComponent(sessionSelectMatch[1]!);
      return this.api(`/api/commissioning/sessions/${sessionId}/select`, {
        method: 'POST',
        body: { candidateId: data.candidateId },
      });
    }

    // 6. Network credentials (POST /api/commissioning/sessions/:id/credentials)
    const sessionCredentialsMatch =
      /^commissioning\/sessions\/([a-zA-Z0-9_-]+)\/credentials$/.exec(path);
    if (sessionCredentialsMatch && method === 'POST' && record(data)) {
      const sessionId = encodeURIComponent(sessionCredentialsMatch[1]!);
      return this.api(`/api/commissioning/sessions/${sessionId}/credentials`, {
        method: 'POST',
        body: {
          ...(typeof data.ssid === 'string' ? { ssid: data.ssid } : {}),
          ...(typeof data.password === 'string' ? { password: data.password } : {}),
          ...(typeof data.threadDataset === 'string' ? { threadDataset: data.threadDataset } : {}),
          ...(typeof data.saveForReuse === 'boolean' ? { saveForReuse: data.saveForReuse } : {}),
        },
      });
    }

    // 7. Manual IP fallback (POST /api/commissioning/sessions/:id/manual-address)
    const sessionManualMatch =
      /^commissioning\/sessions\/([a-zA-Z0-9_-]+)\/manual-address$/.exec(path);
    if (sessionManualMatch && method === 'POST' && record(data)) {
      if (typeof data.address !== 'string' || !data.address.trim()) {
        throw new Error('IP address is required.');
      }
      const sessionId = encodeURIComponent(sessionManualMatch[1]!);
      return this.api(`/api/commissioning/sessions/${sessionId}/manual-address`, {
        method: 'POST',
        body: {
          address: data.address.trim(),
          ...(typeof data.port === 'number' ? { port: data.port } : {}),
        },
      });
    }

    // 8. Vendor classification & provisioning
    if (path === 'commissioning/vendor/classify' && method === 'POST' && record(data)) {
      return this.api('/api/commissioning/vendor/classify', {
        method: 'POST',
        body: data,
      });
    }
    if (path === 'commissioning/vendor/provision' && method === 'POST' && record(data)) {
      return this.api('/api/commissioning/vendor/provision', {
        method: 'POST',
        body: data,
      });
    }

    // 9. Stored network credentials
    if (path === 'commissioning/credentials/wifi' && method === 'GET') {
      return this.api('/api/commissioning/credentials/wifi');
    }
    if (path === 'commissioning/credentials/thread' && method === 'GET') {
      return this.api('/api/commissioning/credentials/thread');
    }
    if (path === 'commissioning/credentials/wifi' && method === 'POST' && record(data)) {
      return this.api('/api/commissioning/credentials/wifi', {
        method: 'POST',
        body: data,
      });
    }
    if (path === 'commissioning/credentials/thread' && method === 'POST' && record(data)) {
      return this.api('/api/commissioning/credentials/thread', {
        method: 'POST',
        body: data,
      });
    }

    throw new Error('Unsupported commissioning operation.');
  }
}
