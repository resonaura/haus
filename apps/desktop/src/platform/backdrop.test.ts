/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it, vi } from 'vitest';
import {
  LinuxSidebarBackdrop,
  WindowsSidebarBackdrop,
  createNativeWindowsDwmBridge,
  probeSystemReducedTransparency,
  type WindowsDwmBridge,
  type WindowsDwmKoffi,
  type WindowsDwmNativeArg,
} from './backdrop.js';
import type { SidebarMaterial } from '../shared/native.js';

describe('probeSystemReducedTransparency', () => {
  it('honors HAUS_REDUCE_TRANSPARENCY env override and probes OS preferences safely', async () => {
    await expect(
      probeSystemReducedTransparency({
        platform: 'darwin',
        env: { HAUS_REDUCE_TRANSPARENCY: '1' },
      }),
    ).resolves.toBe(true);
    await expect(
      probeSystemReducedTransparency({
        platform: 'darwin',
        env: { HAUS_REDUCE_TRANSPARENCY: '0' },
      }),
    ).resolves.toBe(false);

    await expect(
      probeSystemReducedTransparency({
        platform: 'darwin',
        env: {},
        runtime: { readMacReduceTransparency: async () => '1\n' },
      }),
    ).resolves.toBe(true);

    await expect(
      probeSystemReducedTransparency({
        platform: 'win32',
        env: {},
        runtime: {
          readWindowsTransparency: async () =>
            'HKEY_CURRENT_USER\\...\n    EnableTransparency    REG_DWORD    0x0\n',
        },
      }),
    ).resolves.toBe(true);
    await expect(
      probeSystemReducedTransparency({
        platform: 'win32',
        env: {},
        runtime: {
          readWindowsTransparency: async () => '    EnableTransparency    REG_DWORD    0x1\n',
        },
      }),
    ).resolves.toBe(false);

    await expect(
      probeSystemReducedTransparency({
        platform: 'linux',
        env: {},
        runtime: { readLinuxHighContrast: async () => 'true\n' },
      }),
    ).resolves.toBe(true);
    await expect(
      probeSystemReducedTransparency({
        platform: 'linux',
        env: {},
        runtime: {
          readLinuxHighContrast: async () => {
            throw new Error('no gsettings');
          },
        },
      }),
    ).resolves.toBe(false);
  });
});

describe('LinuxSidebarBackdrop', () => {
  it('updates material across Blur My Shell / KWin / Hyprland and enforces opaque reduced transparency', async () => {
    let listener: ((material: SidebarMaterial) => void) | undefined;
    const disposeSpy = vi.fn();
    const startSpy = vi.fn(async () => {
      await Promise.resolve();
      listener?.('kwin-blur');
    });

    const backdrop = new LinuxSidebarBackdrop({
      initialMaterial: 'blur-my-shell',
      createController: (onChange) => {
        listener = onChange;
        return { material: 'blur-my-shell', start: startSpy, dispose: disposeSpy };
      },
    });

    const updates: boolean[] = [];
    backdrop.subscribe(() => updates.push(backdrop.getSnapshot()));

    backdrop.update(240, true);
    expect(backdrop.getSnapshot()).toBe(true);
    expect(backdrop.getMaterial()).toBe('blur-my-shell');

    await Promise.resolve();
    expect(backdrop.getMaterial()).toBe('kwin-blur');

    listener?.('hyprland-blur');
    expect(backdrop.getMaterial()).toBe('hyprland-blur');

    listener?.('none');
    expect(backdrop.getSnapshot()).toBe(false);

    listener?.('blur-my-shell');
    backdrop.update(0, true);
    expect(backdrop.getSnapshot()).toBe(false);

    backdrop.update(240, true);
    expect(backdrop.getSnapshot()).toBe(true);

    backdrop.close();
    expect(backdrop.getSnapshot()).toBe(false);
    expect(disposeSpy).toHaveBeenCalled();

    const reduced = new LinuxSidebarBackdrop({
      initialMaterial: 'blur-my-shell',
      reduceTransparency: true,
      createController: () => ({ material: 'blur-my-shell', start: startSpy, dispose: disposeSpy }),
    });
    reduced.update(240, true);
    expect(reduced.getSnapshot()).toBe(false);
    expect(reduced.getMaterial()).toBe('none');
  });
});

describe('WindowsSidebarBackdrop', () => {
  it('applies DWM acrylic on Windows 11, re-applies on theme change, and cleans up on close', () => {
    const hwnd = Buffer.alloc(8);
    hwnd.writeBigUInt64LE(0x9876n, 0);
    const applyMaterial = vi.fn<WindowsDwmBridge['applyMaterial']>(() => true);
    const clearMaterial = vi.fn();
    const backdrop = new WindowsSidebarBackdrop({
      title: 'Haus',
      version: '10.0.22621',
      bridge: {
        findWindowByTitle: () => hwnd,
        applyMaterial,
        clearMaterial,
      },
    });

    const changes: boolean[] = [];
    backdrop.subscribe(() => changes.push(backdrop.getSnapshot()));
    backdrop.update(240, true);
    expect(backdrop.getSnapshot()).toBe(true);
    expect(applyMaterial).toHaveBeenCalledWith(hwnd, 3, 0xcc171717, true);

    backdrop.update(240, false);
    expect(applyMaterial).toHaveBeenCalledWith(hwnd, 3, 0xccf2f2f2, true);

    backdrop.close();
    expect(clearMaterial).toHaveBeenCalledWith(hwnd);
    expect(backdrop.getSnapshot()).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  it('retries deferred HWND discovery, keeps opaque fallback on failure, and honors reduceTransparency', async () => {
    const hwnd = Buffer.alloc(8);
    hwnd.writeBigUInt64LE(0x42n, 0);
    let calls = 0;
    const applyMaterial = vi.fn<WindowsDwmBridge['applyMaterial']>(() => false);
    const backdrop = new WindowsSidebarBackdrop({
      title: 'Haus',
      version: '10.0.15063',
      retryIntervalMs: 10,
      maxRetries: 3,
      bridge: {
        findWindowByTitle: () => (++calls >= 2 ? hwnd : null),
        applyMaterial,
        clearMaterial: vi.fn(),
      },
    });

    backdrop.update(220, true);
    expect(backdrop.getSnapshot()).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 35));
    expect(applyMaterial).toHaveBeenCalled();
    expect(backdrop.getSnapshot()).toBe(false);
    backdrop.close();

    const reduced = new WindowsSidebarBackdrop({
      title: 'Haus',
      version: '10.0.22621',
      reduceTransparency: true,
      bridge: {
        findWindowByTitle: () => hwnd,
        applyMaterial: vi.fn(() => true),
        clearMaterial: vi.fn(),
      },
    });
    reduced.update(240, true);
    expect(reduced.getSnapshot()).toBe(false);
  });
});

describe('createNativeWindowsDwmBridge', () => {
  it('caches loaded DWM bindings per koffi instance and applies/clears DWM and legacy attributes', () => {
    const structs = new Set<string>();
    const dwmCalls: Array<{ hwnd: bigint; attr: number; val: number; bytes: number }> = [];
    const compCalls: Array<{ hwnd: bigint; data: object }> = [];

    const mockKoffi: WindowsDwmKoffi = {
      load(dll) {
        return {
          func(def) {
            if (dll === 'user32.dll' && def.includes('FindWindowW')) {
              return (..._args: WindowsDwmNativeArg[]) => 0x123456n;
            }
            if (dll === 'dwmapi.dll' && def.includes('DwmSetWindowAttribute')) {
              return (hwnd, attr, value, bytes) => {
                if (
                  typeof hwnd === 'bigint' &&
                  typeof attr === 'number' &&
                  Buffer.isBuffer(value)
                ) {
                  dwmCalls.push({
                    hwnd,
                    attr,
                    val: value.readInt32LE(0),
                    bytes: Number(bytes),
                  });
                }
                return 0;
              };
            }
            if (dll === 'user32.dll' && def.includes('SetWindowCompositionAttribute')) {
              return (hwnd, data) => {
                if (typeof hwnd === 'bigint' && data && typeof data === 'object') {
                  compCalls.push({ hwnd, data });
                }
                return 1;
              };
            }
            throw new Error(`Unexpected func: ${dll} ${def}`);
          },
        };
      },
      struct(name) {
        if (structs.has(name)) {
          throw new Error(`Duplicate koffi struct registration: ${name}`);
        }
        structs.add(name);
        return { name };
      },
      sizeof(type) {
        return type === 'HausGpuiAccentPolicy' ? 16 : 0;
      },
      as(value, type) {
        return { value, type };
      },
    };

    const bridgeOne = createNativeWindowsDwmBridge(mockKoffi);
    const bridgeTwo = createNativeWindowsDwmBridge(mockKoffi);

    const hwndOne = bridgeOne.findWindowByTitle('Haus');
    const hwndTwo = bridgeTwo.findWindowByTitle('Haus Pairing');
    if (!hwndOne || !hwndTwo) throw new Error('Expected HWND buffer');
    expect(hwndOne.length).toBe(8);
    expect(hwndOne.readBigUInt64LE(0)).toBe(0x123456n);
    expect(hwndTwo.readBigUInt64LE(0)).toBe(0x123456n);
    expect([...structs]).toEqual([
      'HausGpuiAccentPolicy',
      'HausGpuiWindowCompositionAttributeData',
    ]);

    expect(bridgeOne.applyMaterial(hwndOne, 3, 0xcc171717, true)).toBe(true);
    expect(dwmCalls).toEqual([
      { hwnd: 0x123456n, attr: 20, val: 1, bytes: 4 },
      { hwnd: 0x123456n, attr: 33, val: 2, bytes: 4 },
      { hwnd: 0x123456n, attr: 38, val: 3, bytes: 4 },
    ]);

    expect(bridgeTwo.applyMaterial(hwndTwo, 4, 0xccf2f2f2, false)).toBe(true);
    expect(compCalls[0]).toEqual({
      hwnd: 0x123456n,
      data: {
        attribute: 19,
        data: {
          value: { accentState: 4, accentFlags: 2, gradientColor: 0xccf2f2f2, animationId: 0 },
          type: 'HausGpuiAccentPolicy *',
        },
        size: 16,
      },
    });

    dwmCalls.length = 0;
    compCalls.length = 0;
    bridgeOne.clearMaterial(hwndOne);
    expect(dwmCalls).toEqual([{ hwnd: 0x123456n, attr: 38, val: 1, bytes: 4 }]);
    expect(compCalls[0]).toEqual({
      hwnd: 0x123456n,
      data: {
        attribute: 19,
        data: {
          value: { accentState: 0, accentFlags: 0, gradientColor: 0, animationId: 0 },
          type: 'HausGpuiAccentPolicy *',
        },
        size: 16,
      },
    });
  });
});
