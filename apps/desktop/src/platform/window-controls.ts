/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { GpuixRenderer, WindowOptions } from '@gpuix/native';
import type { SidebarMaterial, WindowChrome } from '../shared/native.js';

export type WindowControlAction = 'close' | 'minimize' | 'maximize' | 'fullscreen' | 'activate';

export type WindowControlHost = Pick<
  GpuixRenderer,
  'minimizeWindow' | 'zoomWindow' | 'toggleFullscreen' | 'activateWindow' | 'setWindowTitle'
> & {
  closeWindow(): Promise<void> | void;
};

export interface GpuiWindowChromeOptions {
  readonly title?: string;
  readonly width?: number;
  readonly height?: number;
  readonly minWidth?: number;
  readonly minHeight?: number;
  readonly focus?: boolean;
  readonly show?: boolean;
  readonly dark?: boolean;
  readonly reduceTransparency?: boolean;
  readonly platform?: NodeJS.Platform;
  readonly linuxMaterial?: SidebarMaterial;
  readonly linuxTrafficLights?: boolean;
}

export function resolveGpuiWindowBackground(options: {
  readonly platform?: NodeJS.Platform;
  readonly reduceTransparency?: boolean;
  readonly linuxMaterial?: SidebarMaterial;
}): 'opaque' | 'transparent' | 'blurred' {
  if (options.reduceTransparency) return 'opaque';
  const platform = options.platform ?? process.platform;
  if (platform === 'darwin') return 'transparent';
  if (platform === 'win32') return 'blurred';
  if (
    platform === 'linux' &&
    options.linuxMaterial &&
    options.linuxMaterial !== 'none'
  ) {
    return 'transparent';
  }
  return 'opaque';
}

export function buildGpuiWindowOptions(options: GpuiWindowChromeOptions = {}): WindowOptions {
  const platform = options.platform ?? process.platform;
  const windowBackground = resolveGpuiWindowBackground(options);
  return {
    title: options.title ?? 'Haus',
    appName: 'Haus',
    appId: 'app.haus.desktop',
    width: options.width ?? 1280,
    height: options.height ?? 792,
    minWidth: options.minWidth ?? 900,
    minHeight: options.minHeight ?? 640,
    focus: options.focus ?? true,
    show: options.show ?? true,
    titlebarTransparent: platform === 'darwin',
    windowBackground,
    ...(platform === 'darwin' ? { trafficLightX: 16, trafficLightY: 18 } : {}),
  };
}

export function resolveDesktopWindowChrome(options: {
  readonly platform?: NodeJS.Platform;
  readonly maximized?: boolean;
  readonly fullscreen?: boolean;
  readonly focused?: boolean;
  readonly linuxTrafficLights?: boolean;
} = {}): WindowChrome {
  const raw = options.platform ?? process.platform;
  const platform: WindowChrome['platform'] =
    raw === 'darwin' || raw === 'win32' || raw === 'linux' ? raw : 'other';
  const controls: WindowChrome['controls'] =
    platform === 'darwin'
      ? 'native-left'
      : platform === 'win32'
        ? 'native-right'
        : options.linuxTrafficLights
          ? 'traffic-left'
          : 'custom-right';
  return {
    platform,
    controls,
    maximized: Boolean(options.maximized),
    fullscreen: Boolean(options.fullscreen),
    focused: options.focused ?? true,
  };
}

export class WindowControlsController {
  constructor(private readonly host: WindowControlHost) {}

  async perform(action: WindowControlAction): Promise<void> {
    switch (action) {
      case 'close':
        await this.host.closeWindow();
        return;
      case 'minimize':
        this.host.minimizeWindow();
        return;
      case 'maximize':
        this.host.zoomWindow();
        return;
      case 'fullscreen':
        this.host.toggleFullscreen();
        return;
      case 'activate':
        this.host.activateWindow();
        return;
    }
  }

  setTitle(title: string): void {
    const clean = title.trim().slice(0, 140) || 'Haus';
    this.host.setWindowTitle(clean);
  }
}
