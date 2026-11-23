/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  DemoHomeTransport,
  IpcBridgeTransport,
  SwitchableHomeTransport,
  WebStorageDemoModeStore,
} from '@haus/core/transport';
import { applyDemoAction, buildAction, createDemoSnapshot, type Snapshot } from '../model';

type DesktopAction = ReturnType<typeof buildAction>;

/**
 * Desktop composition root for the shared `@haus/core/transport` layer.
 * Routes every RPC (`get_states`, `call_service`, `haus/entity_image`,
 * `update/release_notes`, registry mutations, history) transparently through
 * either the live Electron IPC bridge or the local `DemoHomeTransport`.
 */
export function createDesktopHomeTransport(): SwitchableHomeTransport<Snapshot, DesktopAction> {
  const nativeBridge = typeof window !== 'undefined' ? window.hausNative : undefined;
  return new SwitchableHomeTransport<Snapshot, DesktopAction>({
    live: nativeBridge ? new IpcBridgeTransport(nativeBridge) : null,
    demo: new DemoHomeTransport<Snapshot, DesktopAction>({
      createSnapshot: createDemoSnapshot,
      applyAction: applyDemoAction,
    }),
    storage: new WebStorageDemoModeStore('haus.demoMode'),
  });
}

let sharedTransport: SwitchableHomeTransport<Snapshot, DesktopAction> | null = null;

export function getHomeTransport(): SwitchableHomeTransport<Snapshot, DesktopAction> {
  if (!sharedTransport) {
    sharedTransport = createDesktopHomeTransport();
  }
  return sharedTransport;
}
