/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it } from 'vitest';
import { recordingPreparation } from './recording-preparation';

describe('recording preparation polling', () => {
  it('waits through pending replies before allowing a media source to be used', async () => {
    let calls = 0;
    const response = await recordingPreparation(
      async () => new Response('', { status: ++calls < 3 ? 202 : 200 }),
      new AbortController().signal,
      { pollMs: 1 },
    );
    expect(response.status).toBe(200);
    expect(calls).toBe(3);
  });
  it('preserves legacy success, missing-route and failure responses', async () => {
    for (const status of [200, 404, 503]) {
      let calls = 0;
      const response = await recordingPreparation(async () => {
        calls++;
        return new Response('', { status });
      }, new AbortController().signal);
      expect(response.status).toBe(status);
      expect(calls).toBe(1);
    }
  });
  it('cancels the pending delay immediately when the connected home changes', async () => {
    const controller = new AbortController();
    let calls = 0;
    const pending = recordingPreparation(async () => {
      calls++;
      queueMicrotask(() => controller.abort());
      return new Response('', { status: 202 });
    }, controller.signal);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toBe(1);
  });
  it('bounds a preparation that never becomes ready', async () => {
    await expect(
      recordingPreparation(
        async () => new Response('', { status: 202 }),
        new AbortController().signal,
        { timeoutMs: 0 },
      ),
    ).rejects.toThrow('taking longer');
  });
});
