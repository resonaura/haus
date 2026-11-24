/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import {
  buildGpuiWindowOptions,
  resolveDesktopWindowChrome,
  resolveGpuiWindowBackground,
  WindowControlsController,
} from './window-controls.js';

describe('GPUIX window controls & chrome options', () => {
  it('picks native material backgrounds per OS and honors reduced transparency', () => {
    expect(resolveGpuiWindowBackground({ platform: 'darwin' })).toBe('transparent');
    expect(resolveGpuiWindowBackground({ platform: 'win32' })).toBe('blurred');
    expect(resolveGpuiWindowBackground({ platform: 'linux', linuxMaterial: 'hyprland-blur' })).toBe(
      'transparent',
    );
    expect(resolveGpuiWindowBackground({ platform: 'linux', linuxMaterial: 'none' })).toBe('opaque');
    expect(
      resolveGpuiWindowBackground({ platform: 'darwin', reduceTransparency: true }),
    ).toBe('opaque');

    const macOpts = buildGpuiWindowOptions({ platform: 'darwin' });
    expect(macOpts.titlebarTransparent).toBe(true);
    expect(macOpts.trafficLightX).toBe(16);
    expect(macOpts.trafficLightY).toBe(18);
  });

  it('resolves cross-platform window control layouts and dispatches actions', async () => {
    expect(resolveDesktopWindowChrome({ platform: 'darwin' }).controls).toBe('native-left');
    expect(resolveDesktopWindowChrome({ platform: 'win32' }).controls).toBe('native-right');
    expect(
      resolveDesktopWindowChrome({ platform: 'linux', linuxTrafficLights: true }).controls,
    ).toBe('traffic-left');
    expect(
      resolveDesktopWindowChrome({ platform: 'linux', linuxTrafficLights: false }).controls,
    ).toBe('custom-right');

    const called: string[] = [];
    const controller = new WindowControlsController({
      minimizeWindow: () => {
        called.push('minimize');
      },
      zoomWindow: () => {
        called.push('maximize');
      },
      toggleFullscreen: () => {
        called.push('fullscreen');
      },
      activateWindow: () => {
        called.push('activate');
      },
      setWindowTitle: (title) => {
        called.push(`title:${title}`);
      },
      closeWindow: () => {
        called.push('close');
      },
    });
    await controller.perform('minimize');
    await controller.perform('maximize');
    await controller.perform('fullscreen');
    await controller.perform('activate');
    await controller.perform('close');
    controller.setTitle('  Living Room · Haus  ');
    expect(called).toEqual([
      'minimize',
      'maximize',
      'fullscreen',
      'activate',
      'close',
      'title:Living Room · Haus',
    ]);
  });
});
