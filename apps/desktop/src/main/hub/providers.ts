/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

type Api = (path: string, init?: { method?: 'GET' | 'POST'; body?: unknown }) => Promise<unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 128 && /^[\w.:-]+$/.test(value);

const TUYA_REGIONS = new Set(['eu', 'we', 'us', 'ue', 'cn', 'in']);
const isQrToken = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 512 && !/\s/.test(value);
const isRevision = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const isEntityId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 256 && !/\s/.test(value);

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
      case 'remove':
        this.only(input, ['operation', 'bridgeId']);
        return this.api(`/api/providers/${encodeURIComponent(this.id(input.bridgeId))}/remove`, {
          method: 'POST',
          body: {},
        });
      case 'handoverStatus': {
        this.only(input, ['operation']);
        const payload = await this.api('/api/providers/handover');
        return this.normalizeHandoverList(payload);
      }
      case 'handover':
        this.only(input, ['operation', 'bridgeId']);
        return this.api(`/api/providers/${encodeURIComponent(this.id(input.bridgeId))}/handover`, {
          method: 'POST',
          body: {},
        });
      case 'migrationStatus':
        this.only(input, ['operation', 'bridgeId']);
        return this.api(`/api/providers/${encodeURIComponent(this.id(input.bridgeId))}/migration`);
      case 'migrationReview':
        this.only(input, ['operation', 'bridgeId']);
        return this.api(
          `/api/providers/${encodeURIComponent(this.id(input.bridgeId))}/migration/review`,
          { method: 'POST', body: {} },
        );
      case 'migrationApply':
        this.only(input, ['operation', 'bridgeId', 'revision', 'retire']);
        if (
          !isRevision(input.revision) ||
          !Array.isArray(input.retire) ||
          input.retire.length > 512 ||
          !input.retire.every(isEntityId)
        )
          throw new Error('Invalid camera bridge migration.');
        return this.api(
          `/api/providers/${encodeURIComponent(this.id(input.bridgeId))}/migration/apply`,
          {
            method: 'POST',
            body: { revision: input.revision, retire: input.retire },
          },
        );
      case 'migrationUndo':
        this.only(input, ['operation', 'bridgeId', 'revision']);
        if (!isRevision(input.revision)) throw new Error('Invalid camera bridge migration.');
        return this.api(
          `/api/providers/${encodeURIComponent(this.id(input.bridgeId))}/migration/undo`,
          {
            method: 'POST',
            body: { revision: input.revision },
          },
        );
      case 'loginState':
        this.only(input, ['operation', 'bridgeId']);
        return this.api(
          `/api/providers/${encodeURIComponent(this.id(input.bridgeId))}/login-state`,
        );
      case 'loginQrStart': {
        this.only(
          input,
          input.region !== undefined
            ? ['operation', 'bridgeId', 'region']
            : ['operation', 'bridgeId'],
        );
        if (
          input.region !== undefined &&
          (typeof input.region !== 'string' || !TUYA_REGIONS.has(input.region))
        ) {
          throw new Error('Invalid Tuya region.');
        }
        return this.api(`/api/providers/${encodeURIComponent(this.id(input.bridgeId))}/login/qr`, {
          method: 'POST',
          body: input.region ? { region: input.region } : {},
        });
      }
      case 'loginQrPoll':
        this.only(input, ['operation', 'bridgeId', 'token']);
        if (!isQrToken(input.token)) throw new Error('Invalid Tuya QR token.');
        return this.api(
          `/api/providers/${encodeURIComponent(this.id(input.bridgeId))}/login/qr/poll?token=${encodeURIComponent(input.token)}`,
        );
      default:
        throw new Error('Unsupported camera bridge operation.');
    }
  }

  private normalizeHandoverList(payload: unknown): { bridges: unknown[] } {
    if (isRecord(payload) && Array.isArray(payload.bridges)) {
      return { bridges: payload.bridges };
    }
    if (isRecord(payload) && Array.isArray(payload.providers)) {
      const bridges = payload.providers.flatMap((provider) =>
        isRecord(provider) &&
        isRecord(provider.handover) &&
        typeof provider.handover.bridgeId === 'string'
          ? [provider.handover]
          : [],
      );
      return { bridges };
    }
    return { bridges: [] };
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
