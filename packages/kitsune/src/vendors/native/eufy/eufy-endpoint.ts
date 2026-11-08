/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 only; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-only.
 */

import { isIP } from 'node:net';

export interface EufyEndpointConfig {
  readonly eufy_ws_url?: string;
  readonly standalone?: boolean;
  readonly token?: string;
}

/** Supervisor is the authority for the installed app's address; no credentials leave the helper. */
export function eufyEndpoint(
  config: EufyEndpointConfig,
  {
    fetchRequest = fetch,
    now = () => Date.now(),
  }: {
    fetchRequest?: typeof fetch;
    now?: () => number;
  } = {},
): () => Promise<string | undefined> {
  let cached: string | undefined;
  let until = 0;
  let pending: Promise<string | undefined> | undefined;
  return async () => {
    if (config.eufy_ws_url) return config.eufy_ws_url;
    if (config.standalone || !config.token) return undefined;
    if (until > now()) return cached;
    if (pending) return pending;
    pending = (async () => {
      const get = async (path: string): Promise<Record<string, unknown> | undefined> => {
        const response = await fetchRequest(`http://supervisor${path}`, {
          headers: { Authorization: `Bearer ${config.token}` },
          redirect: 'error',
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) throw new Error('eufy_discovery_unavailable');
        const payload = (await response.json()) as { data?: Record<string, unknown> };
        return payload.data;
      };
      cached = undefined;
      try {
        // The backup role permits */info but intentionally cannot enumerate /addons.
        const list = (await get('/supervisor/info')) as
          { addons?: Array<{ slug: string; state?: string }> } | undefined;
        const apps = (list?.addons ?? []).filter(
          (app) => /(?:^|_)eufy_security_ws$/.test(app.slug) && app.state === 'started',
        );
        if (apps.length !== 1 || !apps[0]) return undefined;
        const info = (await get(`/addons/${apps[0].slug}/info`)) as
          { ip_address?: string; options?: { port?: number | string } } | undefined;
        const host = info?.ip_address ?? '';
        const privateHost =
          isIP(host) === 4 && /^(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host);
        const port = Number(info?.options?.port ?? 3000);
        if (privateHost && Number.isInteger(port) && port > 0 && port <= 65535) {
          cached = `ws://${host}:${port}/`;
        }
      } catch {
        /* An explicit endpoint remains available for external installations. */
      } finally {
        until = now() + 60000;
      }
      return cached;
    })().finally(() => {
      pending = undefined;
    });
    return pending;
  };
}
