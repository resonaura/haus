/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDesktopHomeTransport } from '../app/transport';
import { applyDemoAction, createDemoSnapshot } from '../model';
import {
  readLocalDemoMode,
  registerDemoModeSetter,
  triggerDemoMode,
  writeLocalDemoMode,
} from './demo-override';

describe('Local Demo Mode override & demo network fixtures', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('persists local demo mode toggle without modifying hub preferences and notifies setter', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    });

    expect(readLocalDemoMode()).toBe(false);

    const calls: boolean[] = [];
    const unregister = registerDemoModeSetter((enabled) => calls.push(enabled));

    triggerDemoMode(true);
    expect(readLocalDemoMode()).toBe(true);
    expect(calls).toEqual([true]);

    triggerDemoMode(false);
    expect(readLocalDemoMode()).toBe(false);
    expect(calls).toEqual([true, false]);

    writeLocalDemoMode(true);
    expect(readLocalDemoMode()).toBe(true);
    unregister();
  });

  it('includes a demo Eero mesh router with QR codes and interactive firmware updates', () => {
    const snap = createDemoSnapshot();
    const qrPrimary = snap.states.find((s) => s.entity_id === 'image.willow_mesh_qr_code');
    const qrGuest = snap.states.find(
      (s) => s.entity_id === 'image.willow_mesh_guest_network_qr_code',
    );
    const fw = snap.states.find((s) => s.entity_id === 'update.willow_mesh_eero_firmware');

    expect(String(qrPrimary?.attributes.entity_picture)).toContain('data:image/svg+xml;utf8,');
    expect(String(qrGuest?.attributes.entity_picture)).toContain('data:image/svg+xml;utf8,');
    expect(fw?.state).toBe('on');
    expect(fw?.attributes.installed_version).toBe('v7.17.4');
    expect(fw?.attributes.latest_version).toBe('v7.18.0');

    const installed = applyDemoAction(snap, {
      domain: 'update',
      service: 'install',
      target: { entity_id: 'update.willow_mesh_eero_firmware' },
    });
    const fwAfter = installed.states.find(
      (s) => s.entity_id === 'update.willow_mesh_eero_firmware',
    );
    expect(fwAfter?.state).toBe('off');
    expect(fwAfter?.attributes.installed_version).toBe('v7.18.0');
  });

  it('serves demo Eero QR codes, release notes, and firmware installs transparently via @haus/core/transport', async () => {
    const transport = createDesktopHomeTransport();
    expect(transport.mode).toBe('demo');

    const primaryQr = await transport.request<{ dataUrl: string | null }>({
      type: 'haus/entity_image',
      entity_id: 'image.willow_mesh_qr_code',
    });
    const guestQr = await transport.request<{ dataUrl: string | null }>({
      type: 'haus/entity_image',
      entity_id: 'image.willow_mesh_guest_network_qr_code',
    });
    const releaseNotes = await transport.request<string | null>({
      type: 'update/release_notes',
      entity_id: 'update.willow_mesh_eero_firmware',
    });

    expect(primaryQr.dataUrl).toContain('data:image/svg+xml;utf8,');
    expect(guestQr.dataUrl).toContain('data:image/svg+xml;utf8,');
    expect(releaseNotes).toContain('Improved mesh roaming stability');

    await transport.request({
      type: 'call_service',
      domain: 'update',
      service: 'install',
      target: { entity_id: 'update.willow_mesh_eero_firmware' },
    });
    const updatedFw = transport.demo
      .getSnapshot()
      .states.find((s) => s.entity_id === 'update.willow_mesh_eero_firmware');
    expect(updatedFw?.state).toBe('off');
    expect(updatedFw?.attributes.installed_version).toBe('v7.18.0');
  });
});
