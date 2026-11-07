/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { cameraSource } from '../../src/camera/source.js';

test('RTSP source validation pins private DNS and rejects media-engine directives/public rebinding', async () => {
  const result = await cameraSource(
    { kind: 'p2p-restream', url: 'rtsp://user:pass@camera.home:8555/live' },
    async () => [{ address: '192.168.1.9' }],
  );
  assert.equal(result.url, 'rtsp://user:pass@192.168.1.9:8555/live');
  for (const url of [
    'http://192.168.1.1/live',
    'rtsp://8.8.8.8/live',
    'rtsp://192.168.1.1/live#transport=exec:bad',
    'ffmpeg:rtsp://192.168.1.1/live',
  ])
    await assert.rejects(cameraSource({ kind: 'rtsp', url }), /invalid_camera_source/);
  await assert.rejects(
    cameraSource({ kind: 'rtsp', url: 'rtsp://camera.home/live' }, async () => [
      { address: '192.168.1.9' },
      { address: '8.8.8.8' },
    ]),
    /invalid_camera_source/,
  );
});
