/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it, vi } from 'vitest';
import { AppCatalog } from '@haus/apps';
import { validateRequest } from '../../validation';
import { HubApps } from '../apps';
import { startAppConfigFlow } from '../app-flows';
import { HubAppLogStreamManager } from '../management/app-logs';
import type { NativeEvent } from '../../../shared/native';

describe('Desktop Hub App native config transport and real-time log stream', () => {
  it('routes info, logs with tail, and replace-mode configure through HubApps', async () => {
    const api = vi.fn(async () => ({ status: 'ok' }));
    const apps = new HubApps(api);

    await apps.request({
      method: 'POST',
      path: 'apps/aqara-g5pro/operate',
      data: { operation: 'info' },
    });
    await apps.request({
      method: 'POST',
      path: 'apps/aqara-g5pro/operate',
      data: { operation: 'logs', options: { tail: 150 } },
    });
    await apps.request({
      method: 'POST',
      path: 'apps/homebridge-govee/configure',
      data: { replace: true, options: { lanDisable: true, ignoreMatter: true } },
    });

    expect(api).toHaveBeenNthCalledWith(1, '/api/apps/aqara-g5pro/operate', {
      method: 'POST',
      body: { operation: 'info' },
    });
    expect(api).toHaveBeenNthCalledWith(2, '/api/apps/aqara-g5pro/operate', {
      method: 'POST',
      body: { operation: 'logs', options: { tail: 150 } },
    });
    expect(api).toHaveBeenNthCalledWith(3, '/api/apps/homebridge-govee/operate', {
      method: 'POST',
      body: {
        operation: 'configure',
        options: { __hausReplace: true, values: { lanDisable: true, ignoreMatter: true } },
      },
    });
  });

  it('validates apps/logs subscription requests and rejects invalid identifiers or tails', () => {
    expect(validateRequest({ type: 'apps/logs', appId: 'aqara-g5pro', tail: 200 })).toEqual({
      type: 'apps/logs',
      appId: 'aqara-g5pro',
      tail: 200,
    });
    expect(() => validateRequest({ type: 'apps/logs', appId: '../etc/passwd' })).toThrow();
    expect(() =>
      validateRequest({ type: 'apps/logs', appId: 'aqara-g5pro', tail: 5000 }),
    ).toThrow();
  });

  it('pre-populates Govee options flow defaults from live Hub config without overriding lanDisable', async () => {
    const catalog = AppCatalog.createDefaultCatalog();
    const api = vi.fn(async (path: string, init?: { method?: string; body?: unknown }) => {
      if (path === '/api/apps/catalog/homebridge-govee') {
        return { entry: catalog.get('homebridge-govee') };
      }
      if (
        path === '/api/apps/homebridge-govee/operate' &&
        (init?.body as { operation?: string })?.operation === 'info'
      ) {
        return {
          status: 'ok',
          data: {
            config: { username: 'user@example.com', lanDisable: true, bleDisable: false },
          },
        };
      }
      return { status: 'ok' };
    });

    const { step } = await startAppConfigFlow(api, 'app:homebridge-govee', 'flow-1', 'options');
    const schema = step.data_schema as Array<{ name: string; default?: unknown }>;
    expect(schema.find((f) => f.name === 'lanDisable')?.default).toBe(true);
    expect(schema.find((f) => f.name === 'username')?.default).toBe('user@example.com');
  });

  it('streams real-time SSE log events over haus_subscription and aborts on unsubscribe', async () => {
    let aborted = false;
    const encoder = new TextEncoder();
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      init?.signal?.addEventListener('abort', () => {
        aborted = true;
      });
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              'event: status\ndata: {"status":"connected"}\n\nevent: log\ndata: {"line":"MQTT connected"}\n\n',
            ),
          );
          init?.signal?.addEventListener('abort', () => {
            try {
              controller.close();
            } catch {
              // already closed
            }
          });
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    });

    const events: NativeEvent[] = [];
    const manager = new HubAppLogStreamManager(fetchMock);
    const subId = manager.subscribe(
      { type: 'apps/logs', appId: 'aqara-g5pro', tail: 100 },
      { url: 'http://192.168.4.44:8790', token: 'secret-token' },
      (e) => events.push(e),
    );

    await new Promise((resolve) => setTimeout(resolve, 30));
    manager.unsubscribe(subId);

    expect(aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://192.168.4.44:8790/api/apps/aqara-g5pro/logs/stream?tail=100',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer secret-token' }),
      }),
    );
    const payloads = events
      .filter((e): e is Extract<NativeEvent, { type: 'ha-event' }> => e.type === 'ha-event')
      .map((e) => e.event.data.payload);
    expect(payloads).toContainEqual({ kind: 'status', status: 'connected' });
    expect(payloads).toContainEqual({ kind: 'log', line: 'MQTT connected' });
  });
});
