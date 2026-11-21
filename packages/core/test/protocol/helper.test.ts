/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { expect, it } from 'vitest';
import {
  parseHelperCapabilities,
  parseHelperLiveMessage,
  safeHelperDiagnostic,
  supportsHelperFeature,
} from '../../src/helper-protocol.js';

const instance = '11111111-1111-4111-8111-111111111111';

it('negotiates only explicitly advertised Helper features and drops unknown fields', () => {
  const capabilities = parseHelperCapabilities({
    protocol: 1,
    name: 'Haus',
    version: '0.3.55',
    connected: false,
    features: { cluster: true, sharedPreferences: false, shell: true },
    ingressCookie: 'never-copy-this',
  });
  expect(capabilities).toEqual({
    protocol: 1,
    name: 'Haus',
    version: '0.3.55',
    connected: false,
    features: { cluster: true, sharedPreferences: false },
  });
  expect(supportsHelperFeature(capabilities!, 'cluster')).toBe(true);
  expect(supportsHelperFeature(capabilities!, 'previewPreheat')).toBe(false);
  expect(JSON.stringify(capabilities)).not.toContain('never-copy-this');
  expect(
    parseHelperCapabilities({ name: 'Haus', version: 'latest', connected: true, features: {} }),
  ).toBeUndefined();
});

it('accepts only versioned, fresh camera proofs and strips arbitrary live payload fields', () => {
  const now = 1_800_000_000_000;
  const message = parseHelperLiveMessage(
    {
      protocol: 1,
      instance,
      sequence: 5,
      topic: 'cameras',
      revision: '0',
      connected: false,
      sources: [{ id: 'camera.outdoor', available: true, expiresAt: now + 10000 }],
      authorization: 'private',
    },
    now,
  );
  expect(message).toEqual({
    protocol: 1,
    instance,
    sequence: 5,
    topic: 'cameras',
    revision: '0',
    connected: false,
    sources: [{ id: 'camera.outdoor', available: true, expiresAt: now + 10000 }],
  });
  expect(JSON.stringify(message)).not.toContain('private');
  expect(
    parseHelperLiveMessage(
      {
        protocol: 1,
        instance,
        sequence: 6,
        topic: 'cameras',
        revision: '0',
        connected: false,
        sources: [{ id: 'camera.outdoor', available: true, expiresAt: now + 120001 }],
      },
      now,
    )?.sources,
  ).toBeUndefined();
  expect(
    parseHelperLiveMessage({
      protocol: 2,
      instance,
      sequence: 1,
      topic: 'home',
      revision: '0',
      connected: true,
    }),
  ).toBeUndefined();
});

it('accepts only redacted diagnostic dimensions', () => {
  expect(
    safeHelperDiagnostic({
      operation: 'list-cluster',
      outcome: 'failure',
      durationMs: 12.7,
      url: 'https://private.example/?token=secret',
      error: 'secret',
    }),
  ).toEqual({ operation: 'list-cluster', outcome: 'failure', durationMs: 13 });
  expect(
    safeHelperDiagnostic({ operation: 'GET /api/servers/uuid', outcome: 'failure', durationMs: 1 }),
  ).toBeUndefined();
});

it('sanitizes live endpoint stateChanges and strips secret-like keys', () => {
  const message = parseHelperLiveMessage({
    protocol: 1,
    instance,
    sequence: 9,
    topic: 'devices',
    revision: '0',
    connected: true,
    registryChanged: false,
    stateChanges: {
      'light.narnia_rgb': {
        on_off: true,
        brightness: 72,
        rgb_color: [255, 180, 90],
        color_hsv: { h: 30, s: 65, v: 100 },
        access_token: 'never-leak',
        rtsp_url: 'rtsp://user:pass@192.168.1.5/live',
      },
    },
  });
  expect(message).toEqual({
    protocol: 1,
    instance,
    sequence: 9,
    topic: 'devices',
    revision: '0',
    connected: true,
    registryChanged: false,
    stateChanges: {
      'light.narnia_rgb': {
        on_off: true,
        brightness: 72,
        rgb_color: [255, 180, 90],
        color_hsv: { h: 30, s: 65, v: 100 },
      },
    },
  });
  expect(JSON.stringify(message)).not.toContain('never-leak');
  expect(JSON.stringify(message)).not.toContain('rtsp://');
});
