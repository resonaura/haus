/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useEffect, useState } from 'react';
import { collectGarbageWhenIdle, render as gpuiRender, type KeyEvent } from '@gpuix/react';
import { MediaRuntime } from '@haus/media/pipeline';
import { CompactDashboard } from '@haus/ui/components';
import { GPUIX_CONTENT_HOST } from '@haus/ui/gpui';
import { HausButton, HausUiProvider, Text } from '@haus/ui/primitives';
import { createGpuiPlatform, type GpuiPlatform } from './platform.js';
import { Preview } from './preview.js';
import {
  gpuiStateDirectory,
  openGpuiCredentialStore,
  type GpuiCredentialStore,
} from '../platform/credentials.js';
import { openDesktopAppearance } from '../platform/appearance.js';
import { probeSystemReducedTransparency } from '../platform/backdrop.js';
import { probeInitialLinuxMaterial } from '../platform/materials.js';
import { buildGpuiWindowOptions } from '../platform/window-controls.js';
import { GpuiHomeRuntime } from './home/runtime.js';
import { LiveHome } from './home/view.js';
import { GpuiCameraStreams } from './camera/stream.js';
import { GpuiWindow } from './window.js';
import { requireGpuiBun } from './bun.js';
import { resolveGpuiStartupOptions, resolveInitialGpuiSession } from './startup.js';

interface GpuiSession {
  runtime: GpuiHomeRuntime;
  streams: GpuiCameraStreams;
  store: GpuiCredentialStore;
}

declare global {
  var hausGpuiPlatform: Promise<GpuiPlatform> | undefined;
  var hausGpuiSession: Promise<GpuiSession> | undefined;
  var hausGpuiWindow: GpuiWindow | undefined;
  var hausGpuiStopIdleGc: (() => void) | undefined;
}

const background = process.env.GPUIX_BACKGROUND === '1';
requireGpuiBun();
globalThis.hausGpuiStopIdleGc?.();
globalThis.hausGpuiStopIdleGc = collectGarbageWhenIdle();
if (process.argv.includes('--check-native')) {
  const { __napiBindingTarget, GpuixRenderer } = await import('@gpuix/native');
  if (__napiBindingTarget !== 'native') throw new Error('Expected a native GPUIX addon.');
  new GpuixRenderer();
  console.log(`Haus GPUIX native ${process.platform}/${process.arch}`);
  process.exit(0);
}

const startup = resolveGpuiStartupOptions(process.argv, process.env);
const platform = await (globalThis.hausGpuiPlatform ??= createGpuiPlatform(background));

function openSession() {
  // Keep session and playback ownership in one place across Bun hot remounts.
  globalThis.hausGpuiSession ??= Promise.all([
    openDesktopAppearance(gpuiStateDirectory()),
    openGpuiCredentialStore(),
  ])
    .then(([appearance, store]) => {
      const runtime = new GpuiHomeRuntime(store, undefined, undefined, appearance, {
        openBrowser: platform.openExternal,
      });
      return {
        runtime,
        streams: new GpuiCameraStreams(new MediaRuntime(), runtime.createCameraViewer),
        store,
      };
    })
    .catch((error: unknown) => {
      globalThis.hausGpuiSession = undefined;
      throw error;
    });
  return globalThis.hausGpuiSession;
}

const resolution = await resolveInitialGpuiSession({
  ...startup,
  hasExistingSession: Boolean(globalThis.hausGpuiSession),
  openSession,
  clearSessionCache: () => {
    globalThis.hausGpuiSession = undefined;
  },
});
const initial = resolution.initial;
const initialError = resolution.initialError;

const initialLinuxMaterial =
  process.platform === 'linux' ? await probeInitialLinuxMaterial() : undefined;
const reduceTransparency = await probeSystemReducedTransparency();

globalThis.hausGpuiWindow ??= new GpuiWindow(
  {
    ...buildGpuiWindowOptions({
      title: resolution.showLive || startup.forceLive ? 'Haus' : 'Haus · GPUIX Preview',
      width: 1280,
      height: 900,
      minWidth: 620,
      minHeight: 410,
      focus: !background,
      reduceTransparency,
      linuxMaterial: initialLinuxMaterial,
    }),
    trafficLightX: 14,
    trafficLightY: 16,
  },
  undefined,
  { initialLinuxMaterial, reduceTransparency },
);
const window = globalThis.hausGpuiWindow;
const subscribeKeyDown = (listener: (event: KeyEvent) => void) => window.onWindowKeyDown(listener);

const windowPlatform: GpuiPlatform = {
  ...platform,
  toggleFullscreen: () => void window.controls.perform('fullscreen'),
  openPaths: (options) => window.openPaths(options),
};

function Desktop() {
  const [systemTheme, setSystemTheme] = useState(() => window.getSystemTheme());
  useEffect(() => {
    const timer = setInterval(() => setSystemTheme(window.getSystemTheme()), 1000);
    return () => clearInterval(timer);
  }, []);
  const [session, setSession] = useState(initial);
  const [showLive, setShowLive] = useState(resolution.showLive);
  const [error, setError] = useState(initialError);
  const [opening, setOpening] = useState(false);
  const connect = () => {
    if (session) {
      setShowLive(true);
      return;
    }
    setOpening(true);
    void openSession()
      .then(
        (opened) => {
          setSession(opened);
          setShowLive(true);
        },
        (error: unknown) => {
          setError(
            error instanceof Error ? error.message : 'The Hub session store is unavailable.',
          );
        },
      )
      .finally(() => setOpening(false));
  };
  if (session && showLive) {
    return (
      <LiveHome
        runtime={session.runtime}
        platform={windowPlatform}
        streams={session.streams}
        sidebar={window.sidebar}
        systemTheme={systemTheme}
        reducedTransparency={reduceTransparency}
        subscribeKeyDown={subscribeKeyDown}
        onExploreDemo={() => setShowLive(false)}
      />
    );
  }
  if (opening)
    return (
      <CompactDashboard title="Connect to Haus Hub">
        <Text role="status">Opening the desktop session store…</Text>
      </CompactDashboard>
    );
  if (error)
    return (
      <CompactDashboard title="Haus">
        <Text tone="critical" role="alert">
          {error}
        </Text>
        <HausButton variant="secondary" onPress={() => setError(undefined)}>
          Back to demo home
        </HausButton>
      </CompactDashboard>
    );
  return (
    <Preview
      platform={windowPlatform}
      sidebar={window.sidebar}
      subscribeKeyDown={subscribeKeyDown}
      onConnect={connect}
      systemTheme={systemTheme}
      reducedTransparency={reduceTransparency}
    />
  );
}

window.mount(
  <HausUiProvider
    contentHost={GPUIX_CONTENT_HOST}
    mode="dark"
    reducedTransparency={reduceTransparency}
  >
    <Desktop />
  </HausUiProvider>,
  async () => {
    globalThis.hausGpuiStopIdleGc?.();
    globalThis.hausGpuiStopIdleGc = undefined;
    const session = await globalThis.hausGpuiSession?.catch(() => undefined);
    if (!session) return;
    try {
      await session.streams.close();
    } finally {
      session.runtime.dispose();
      await session.store.close().catch(() => undefined);
    }
  },
  gpuiRender,
);
