/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it, vi } from 'vitest';
import {
  applyNativeWindowsMaterial,
  decodeNativeHwnd,
  probeInitialLinuxMaterial,
  resolveWindowsMaterialMode,
} from './materials.js';

describe('platform shell materials', () => {
  it('resolves Windows 11 builds to dwm-acrylic and older builds cleanly', () => {
    expect(resolveWindowsMaterialMode('10.0.22621')).toBe('dwm-acrylic');
    expect(resolveWindowsMaterialMode('10.0.19045')).toBe('legacy-acrylic');
    expect(resolveWindowsMaterialMode('10.0.15063')).toBe('legacy-blur');
  });

  it('probes Linux compositor blur without Electron and falls back to none on errors', async () => {
    await expect(
      probeInitialLinuxMaterial({
        desktop: () => 'gnome',
        readEnabledExtensions: async () => "['blur-my-shell@aunetx']",
        readKWinConfiguration: async () => '',
        readHyprlandBlurOption: async () => '',
      }),
    ).resolves.toBe('blur-my-shell');

    await expect(
      probeInitialLinuxMaterial({
        desktop: () => 'kde',
        readEnabledExtensions: async () => '',
        readKWinConfiguration: async () => {
          throw new Error('missing kwinrc');
        },
        readHyprlandBlurOption: async () => '',
      }),
    ).resolves.toBe('none');
  });

  it('decodes native HWND and falls back from DWM backdrop to legacy blur', () => {
    const hwnd = Buffer.alloc(8);
    hwnd.writeBigUInt64LE(0x123456n, 0);
    expect(decodeNativeHwnd(hwnd)).toBe(0x123456n);

    const call = vi
      .fn<Parameters<typeof applyNativeWindowsMaterial>[2]>()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);

    const ok = applyNativeWindowsMaterial(hwnd, { version: '10.0.22621', dark: false }, call);
    expect(ok).toBe(true);
    expect(call).toHaveBeenCalledTimes(3);
  });
});
