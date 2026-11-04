/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { HelperPort } from './helper-client.js';
import { validateHelperRequest, type HelperRequest } from './helper-request.js';
import type { HaMessage } from './ha-client.js';

interface IngressDependencies {
  homeUrl: string;
  requestHa<T>(message: HaMessage): Promise<T>;
  fetch: typeof globalThis.fetch;
}
interface Surface {
  url: string;
  cookie: string;
  expiresAt: number;
}
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Session-scoped native access through authenticated HA ingress; never a public add-on port. */
export class HaIngressHelperPort implements HelperPort {
  private surface?: Surface;
  private opening?: Promise<Surface>;
  private active = true;
  private requests = new Set<AbortController>();

  constructor(private readonly dependencies: IngressDependencies) {
    const url = new URL(dependencies.homeUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      throw new Error('invalid-home-url');
  }

  async request<T>(input: HelperRequest): Promise<T> {
    const request = validateHelperRequest(input);
    if (!this.active) throw new Error('session-changed');
    const controller = new AbortController();
    this.requests.add(controller);
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      for (let attempt = 0; ; attempt++) {
        const surface = await this.waitForSurface(controller.signal);
        if (!this.active) throw new Error('session-changed');
        if (controller.signal.aborted) throw new Error('helper-timeout');
        const response = await this.dependencies.fetch(
          new URL(request.path.slice(1), surface.url),
          {
            method: request.method,
            headers: {
              'Content-Type': 'application/json',
              'X-Haus-Client': '1',
              Cookie: `ingress_session=${surface.cookie}`,
            },
            ...(request.data ? { body: JSON.stringify(request.data) } : {}),
            signal: controller.signal,
            redirect: 'error',
            credentials: 'omit',
          },
        );
        if (!this.active) throw new Error('session-changed');
        const denied = response.status === 401 || response.status === 403;
        const gateway =
          [502, 503, 504].includes(response.status) &&
          !/\bjson\b/i.test(response.headers.get('content-type') ?? '');
        if (denied || gateway) {
          if (this.surface === surface) this.surface = undefined;
          // Renew only safe reads. An ambiguous write may already have taken effect.
          if (request.method === 'GET' && attempt === 0) {
            await response.body?.cancel();
            continue;
          }
        }
        const body = await response.text();
        if (!this.active) throw new Error('session-changed');
        if (body.length > 4_000_000) throw new Error('helper-response-too-large');
        let value: unknown;
        try {
          value = JSON.parse(body);
        } catch {
          throw new Error('helper-response-invalid');
        }
        if (!response.ok && !(response.status === 409 && request.path === '/api/preferences'))
          throw new Error('helper-request-failed');
        return value as T;
      }
    } finally {
      clearTimeout(timer);
      this.requests.delete(controller);
    }
  }

  dispose() {
    this.active = false;
    this.surface = undefined;
    for (const controller of this.requests) controller.abort();
    this.requests.clear();
  }

  private getSurface(): Promise<Surface> {
    if (!this.active) return Promise.reject(new Error('session-changed'));
    if (this.surface && this.surface.expiresAt > Date.now()) return Promise.resolve(this.surface);
    if (this.opening) return this.opening;
    const flight = this.openSurface().finally(() => {
      if (this.opening === flight) this.opening = undefined;
    });
    this.opening = flight;
    return flight;
  }

  private waitForSurface(signal: AbortSignal): Promise<Surface> {
    return new Promise((resolve, reject) => {
      const aborted = () => reject(new Error('helper-timeout'));
      signal.addEventListener('abort', aborted, { once: true });
      if (signal.aborted) aborted();
      else
        void this.getSurface()
          .then(resolve, reject)
          .finally(() => {
            signal.removeEventListener('abort', aborted);
          });
    });
  }

  private async openSurface(): Promise<Surface> {
    const request = async <T>(message: HaMessage) => {
      if (!this.active) throw new Error('session-changed');
      const value = await this.dependencies.requestHa<T>(message);
      if (!this.active) throw new Error('session-changed');
      return value;
    };
    const inventory = await request<unknown>({
      type: 'supervisor/api',
      endpoint: '/addons',
      method: 'get',
    });
    if (!record(inventory) || !Array.isArray(inventory.addons))
      throw new Error('helper-unavailable');
    const addon = inventory.addons.find(
      (item: unknown) =>
        record(item) &&
        typeof item.slug === 'string' &&
        /^(?:[a-z0-9]+_)?haus-helper$/.test(item.slug) &&
        item.state === 'started',
    );
    if (!record(addon) || typeof addon.slug !== 'string') throw new Error('helper-unavailable');
    const info = await request<unknown>({
      type: 'supervisor/api',
      endpoint: `/addons/${addon.slug}/info`,
      method: 'get',
    });
    if (
      !record(info) ||
      info.state !== 'started' ||
      info.ingress !== true ||
      typeof info.ingress_url !== 'string' ||
      !/^\/api\/hassio_ingress\/[a-zA-Z0-9_-]+\/?$/.test(info.ingress_url)
    )
      throw new Error('helper-ingress-unavailable');
    const user = await request<unknown>({ type: 'auth/current_user' });
    if (!record(user) || typeof user.id !== 'string') throw new Error('auth-required');
    const session = await request<unknown>({
      type: 'supervisor/api',
      endpoint: '/ingress/session',
      method: 'post',
      data: { user_id: user.id },
    });
    if (
      !record(session) ||
      typeof session.session !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,2048}$/.test(session.session)
    )
      throw new Error('helper-session-invalid');
    if (!this.active) throw new Error('session-changed');
    this.surface = {
      url: new URL(info.ingress_url.replace(/\/?$/, '/'), this.dependencies.homeUrl).href,
      cookie: session.session,
      expiresAt: Date.now() + 180_000,
    };
    return this.surface;
  }
}
