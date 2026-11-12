/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

type Api = (path: string, init?: { method?: 'GET' | 'POST'; body?: unknown }) => Promise<unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 128 && /^[\w.:-]+$/.test(value);

/** Exposes only the Hub camera-provider workflows to the renderer; never a generic REST proxy. */
export class HubProviders {
  constructor(private readonly api: Api) {}

  async request(input: unknown): Promise<unknown> {
    if (!isRecord(input) || typeof input.operation !== 'string')
      throw new Error('Invalid camera bridge request.');
    switch (input.operation) {
      case 'list':
        this.only(input, ['operation']);
        return this.api('/api/providers');
      case 'discover':
        this.only(input, ['operation']);
        return this.api('/api/providers/discover', { method: 'POST', body: {} });
      case 'connect':
        this.only(input, ['operation', 'bridgeId']);
        return this.api('/api/providers/connect', {
          method: 'POST',
          body: { bridgeId: this.id(input.bridgeId) },
        });
      case 'preview':
        this.only(input, ['operation', 'bridgeId']);
        return this.api(`/api/providers/${encodeURIComponent(this.id(input.bridgeId))}`);
      case 'enroll':
        this.only(input, ['operation', 'url', 'code', 'allowHttp']);
        if (
          typeof input.url !== 'string' ||
          input.url.length > 2048 ||
          typeof input.code !== 'string' ||
          input.code.length < 4 ||
          input.code.length > 64 ||
          typeof input.allowHttp !== 'boolean'
        )
          throw new Error('Invalid camera bridge enrollment.');
        return this.api('/api/providers/enroll', {
          method: 'POST',
          body: {
            url: input.url,
            code: input.code,
            allowHttp: input.allowHttp,
          },
        });
      case 'import':
        this.only(input, ['operation', 'bridgeId', 'cameras']);
        if (
          !Array.isArray(input.cameras) ||
          input.cameras.length > 64 ||
          !input.cameras.every(isId)
        )
          throw new Error('Invalid camera selection.');
        return this.api(`/api/providers/${encodeURIComponent(this.id(input.bridgeId))}/import`, {
          method: 'POST',
          body: { cameras: input.cameras },
        });
      default:
        throw new Error('Unsupported camera bridge operation.');
    }
  }

  private id(value: unknown): string {
    if (!isId(value)) throw new Error('Invalid camera bridge identifier.');
    return value;
  }

  private only(input: Record<string, unknown>, allowed: string[]): void {
    if (Object.keys(input).some((key) => !allowed.includes(key)))
      throw new Error('Invalid camera bridge request.');
  }
}
