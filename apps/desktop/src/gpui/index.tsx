/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useEffect, useState } from 'react';
import { render as gpuiRender, type KeyEvent } from '@gpuix/react';
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
import { probeInitialLinuxMaterial } from '../platform/materials.js';
import { buildGpuiWindowOptions } from '../platform/window-controls.js';
import { GpuiHomeRuntime } from './home/runtime.js';
import { LiveHome } from './home/view.js';
import { GpuiCameraStreams } from './camera/stream.js';
import { GpuiWindow } from './window.js';
import { requireGpuiBun } from './bun.js';

interface GpuiSession {
  runtime: GpuiHomeRuntime;
  streams: GpuiCameraStreams;
  store: GpuiCredentialStore;
}

declare global {
  var hausGpuiPlatform: Promise<GpuiPlatform> | undefined;
  var hausGpuiSession: Promise<GpuiSession> | undefined;
  var hausGpuiWindow: GpuiWindow | undefined;
}

const background = process.env.GPUIX_BACKGROUND === '1';
requireGpuiBun();
if (process.argv.includes('--check-native')) {
  const { __napiBindingTarget, GpuixRenderer } = await import('@gpuix/native');
  if (__napiBindingTarget !== 'native') throw new Error('Expected a native GPUIX addon.');
  new GpuixRenderer();
  console.log(`Haus GPUIX native ${process.platform}/${process.arch}`);
  process.exit(0);
}

const live = process.argv.includes('--live');
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

let initial: GpuiSession | undefined;
let initialError: string | undefined;
if (live || globalThis.hausGpuiSession) {
  try {
    initial = await openSession();
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'The Hub session store is unavailable.';
  }
}

const initialLinuxMaterial =
  process.platform === 'linux' ? await probeInitialLinuxMaterial() : undefined;

globalThis.hausGpuiWindow ??= new GpuiWindow({
  ...buildGpuiWindowOptions({
    title: live ? 'Haus' : 'Haus · GPUIX Preview',
    width: 1280,
    height: 900,
    minWidth: 620,
    minHeight: 410,
    focus: !background,
    linuxMaterial: initialLinuxMaterial,
  }),
  trafficLightX: 14,
  trafficLightY: 16,
});
const window = globalThis.hausGpuiWindow;
const subscribeKeyDown = (listener: (event: KeyEvent) => void) => window.onWindowKeyDown(listener);

function Desktop() {
  const [systemTheme, setSystemTheme] = useState(() => window.getSystemTheme());
  useEffect(() => {
    const timer = setInterval(() => setSystemTheme(window.getSystemTheme()), 1000);
    return () => clearInterval(timer);
  }, []);
  const [session, setSession] = useState(initial);
  const [showLive, setShowLive] = useState(Boolean(initial));
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
          setError(error instanceof Error ? error.message : 'The Hub session store is unavailable.');
        },
      )
      .finally(() => setOpening(false));
  };
  if (session && showLive) {
    return (
      <LiveHome
        runtime={session.runtime}
        platform={platform}
        streams={session.streams}
        sidebar={window.sidebar}
        systemTheme={systemTheme}
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
      platform={platform}
      sidebar={window.sidebar}
      subscribeKeyDown={subscribeKeyDown}
      onConnect={connect}
      systemTheme={systemTheme}
    />
  );
}

window.mount(
  <HausUiProvider contentHost={GPUIX_CONTENT_HOST} mode="dark">
    <Desktop />
  </HausUiProvider>,
  async () => {
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
