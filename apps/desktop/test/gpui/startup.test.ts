/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it, vi } from 'vitest';
import type { ClientSessionCredentials } from '@haus/core/auth';
import type { DeviceIntent } from '../../src/gpui/home/model.js';
import { shouldTriggerControlHaptic } from '../../src/gpui/home/model.js';
import { resolveGpuiStartupOptions, resolveInitialGpuiSession } from '../../src/gpui/startup.js';

function fakeSession(
  options: {
    hub?: ClientSessionCredentials | null | Error;
    ha?: Error | null | { url: string; name: string; clientId: string; refreshToken: string };
  } = {},
) {
  const dispose = vi.fn();
  const closeStreams = vi.fn(async () => undefined);
  const closeStore = vi.fn(async () => undefined);
  const loadHubSession = vi.fn(async () => {
    if (options.hub instanceof Error) throw options.hub;
    return options.hub ?? null;
  });
  const loadSession = vi.fn(async () => {
    if (options.ha instanceof Error) throw options.ha;
    return options.ha ?? null;
  });
  return {
    store: { loadHubSession, loadSession, close: closeStore },
    runtime: { dispose },
    streams: { close: closeStreams },
  };
}

describe('GPUI startup mode resolution', () => {
  it('detects --demo and HAUS_GPUI_DEMO=1 while letting --live take precedence', () => {
    expect(resolveGpuiStartupOptions(['bun', 'index.tsx'], {})).toEqual({
      demo: false,
      forceLive: false,
    });
    expect(resolveGpuiStartupOptions(['bun', 'index.tsx', '--demo'], {})).toEqual({
      demo: true,
      forceLive: false,
    });
    expect(resolveGpuiStartupOptions(['bun', 'index.tsx'], { HAUS_GPUI_DEMO: '1' })).toEqual({
      demo: true,
      forceLive: false,
    });
    expect(
      resolveGpuiStartupOptions(['bun', 'index.tsx', '--demo', '--live'], {
        HAUS_GPUI_DEMO: '1',
      }),
    ).toEqual({
      demo: false,
      forceLive: true,
    });
  });

  it('skips opening the session store when demo mode is explicitly requested', async () => {
    const openSession = vi.fn();
    const clearSessionCache = vi.fn();
    const res = await resolveInitialGpuiSession({
      demo: true,
      forceLive: false,
      hasExistingSession: false,
      openSession,
      clearSessionCache,
    });
    expect(res).toEqual({ showLive: false });
    expect(openSession).not.toHaveBeenCalled();
  });

  it('auto-opens paired Hub session by default without requiring --live', async () => {
    const session = fakeSession({
      hub: {
        hubId: 'hub-1',
        homeId: 'home-1',
        hubUrl: 'https://hub.local:8443',
        sessionId: 'sess-1',
        clientId: 'client-1',
        clientName: 'Mac',
        clientRole: 'admin',
        sessionToken: 'tok-1',
        refreshToken: 'ref-1',
        expiresAt: Date.now() + 3_600_000,
      },
    });
    const clearSessionCache = vi.fn();
    const res = await resolveInitialGpuiSession({
      demo: false,
      forceLive: false,
      hasExistingSession: false,
      openSession: async () => session,
      clearSessionCache,
    });
    expect(res.showLive).toBe(true);
    expect(res.initial).toBe(session);
    expect(session.store.close).not.toHaveBeenCalled();
    expect(clearSessionCache).not.toHaveBeenCalled();
  });

  it('auto-opens saved Home Assistant session by default', async () => {
    const session = fakeSession({
      hub: null,
      ha: {
        url: 'https://ha.local:8123',
        name: 'Home',
        clientId: 'https://haus',
        refreshToken: 'ha-ref',
      },
    });
    const res = await resolveInitialGpuiSession({
      demo: false,
      forceLive: false,
      hasExistingSession: false,
      openSession: async () => session,
      clearSessionCache: vi.fn(),
    });
    expect(res.showLive).toBe(true);
    expect(res.initial).toBe(session);
  });

  it('opens LiveHome when stored credentials exist but are unreadable so recovery is shown', async () => {
    const session = fakeSession({
      hub: new Error('The saved Hub session could not be read.'),
    });
    const res = await resolveInitialGpuiSession({
      demo: false,
      forceLive: false,
      hasExistingSession: false,
      openSession: async () => session,
      clearSessionCache: vi.fn(),
    });
    expect(res.showLive).toBe(true);
    expect(res.initial).toBe(session);
  });

  it('closes the temporary session and falls back to Demo Home when unpaired', async () => {
    const session = fakeSession({ hub: null, ha: null });
    const clearSessionCache = vi.fn();
    const res = await resolveInitialGpuiSession({
      demo: false,
      forceLive: false,
      hasExistingSession: false,
      openSession: async () => session,
      clearSessionCache,
    });
    expect(res).toEqual({ showLive: false });
    expect(session.streams.close).toHaveBeenCalledTimes(1);
    expect(session.runtime.dispose).toHaveBeenCalledTimes(1);
    expect(session.store.close).toHaveBeenCalledTimes(1);
    expect(clearSessionCache).toHaveBeenCalledTimes(1);
  });

  it('falls back cleanly to Demo Home without error screen if store is locked on default launch', async () => {
    const clearSessionCache = vi.fn();
    const res = await resolveInitialGpuiSession({
      demo: false,
      forceLive: false,
      hasExistingSession: false,
      openSession: async () => {
        throw new Error('Another Haus GPUIX process owns the Hub session.');
      },
      clearSessionCache,
    });
    expect(res).toEqual({ showLive: false });
    expect(clearSessionCache).toHaveBeenCalledTimes(1);
  });

  it('opens LiveHome even when unpaired if --live was explicitly passed and surfaces store errors', async () => {
    const unpaired = fakeSession({ hub: null, ha: null });
    const liveRes = await resolveInitialGpuiSession({
      demo: false,
      forceLive: true,
      hasExistingSession: false,
      openSession: async () => unpaired,
      clearSessionCache: vi.fn(),
    });
    expect(liveRes.showLive).toBe(true);
    expect(liveRes.initial).toBe(unpaired);

    const errRes = await resolveInitialGpuiSession({
      demo: false,
      forceLive: true,
      hasExistingSession: false,
      openSession: async () => {
        throw new Error('Credential store locked');
      },
      clearSessionCache: vi.fn(),
    });
    expect(errRes).toEqual({
      showLive: false,
      initialError: 'Credential store locked',
    });
  });
});

describe('GPUI haptic policy', () => {
  it('suppresses synthetic haptics for click actions and preserves them for sliders', () => {
    const clickIntents: DeviceIntent[] = [
      'toggle',
      'press',
      'run',
      'open',
      'close',
      'stop',
      'lock',
      'unlock',
      'play-pause',
      'media-next',
      'media-previous',
      'remote-command',
      'hvac-mode',
      'heater-mode',
      'select',
      'effect',
      'color',
      'update-install',
      'update-skip',
    ];
    for (const intent of clickIntents) {
      expect(shouldTriggerControlHaptic(intent)).toBe(false);
    }

    const sliderIntents: DeviceIntent[] = [
      'brightness',
      'temperature',
      'climate-temperature',
      'water-temperature',
      'volume',
      'percentage',
      'value',
      'position',
    ];
    for (const intent of sliderIntents) {
      expect(shouldTriggerControlHaptic(intent)).toBe(true);
    }
  });
});
