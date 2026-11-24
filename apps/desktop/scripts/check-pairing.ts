/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import assert from 'node:assert/strict';
import { createElement } from 'react';
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing';
import { LiveHome } from '../src/gpui/home/view.js';
import { GpuiHomeRuntime } from '../src/gpui/home/runtime.js';

assert(hasNativeTestRenderer, 'GPUIX needs a native test renderer for this check');
const requests: string[] = [];
let confirmation: unknown;
const runtime = new GpuiHomeRuntime(
  {
    assertAvailable() {},
    async loadHubSession() {
      return null;
    },
    async saveHubSession() {
      throw new Error('The input fixture cannot save a session.');
    },
    async clearHubSession() {
      throw new Error('The input fixture has no session.');
    },
  },
  async (input, init) => {
    requests.push(String(input));
    switch (new URL(String(input)).pathname) {
      case '/api/auth/identity':
        return Response.json({ hub: { hubId: 'fixture-hub', homeId: 'fixture-home' } });
      case '/api/auth/challenge':
        return Response.json({ sessionId: 'fixture-pairing', firstOnboarding: false });
      case '/api/auth/confirm':
        confirmation = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
        return Response.json({ error: 'invalid_pairing_code' }, { status: 401 });
      default:
        return Response.json({}, { status: 404 });
    }
  },
);
const live = createTestRoot({ width: 720, height: 580 });
try {
  await runtime.start();
  live.render(createElement(LiveHome, { runtime, platform: {} }));
  live.renderer.flush();
  const address = live.renderer.findByTestId('hub-url');
  assert(address, 'Missing the GPUIX connection input');
  live.renderer.nativeSimulateKeystrokes(address.id, 'h');
  live.renderer.dispatchNativeEvents();
  live.renderer.nativeSimulateKeystrokes(address.id, 'enter');
  live.renderer.dispatchNativeEvents();
  await new Promise((resolve) => setTimeout(resolve, 0));
  live.renderer.flush();
  const code = live.renderer.findByTestId('hub-code');
  assert(code, 'Missing the GPUIX pairing code input');
  live.renderer.nativeSimulateKeystrokes(code.id, '1 2 3 4 enter');
  live.renderer.dispatchNativeEvents();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(requests, [
    'http://h/api/auth/identity',
    'http://h/api/auth/challenge',
    'http://h/api/auth/confirm',
  ]);
  assert(confirmation && typeof confirmation === 'object');
  assert.equal(Reflect.get(confirmation, 'challengeCode'), '1234');
  assert.equal(runtime.getSnapshot().error, 'That pairing code is not correct. Start again.');
  console.log('GPUIX submitted the shared address and code fields and surfaced pairing refusal.');
} finally {
  live.unmount();
  runtime.dispose();
}
