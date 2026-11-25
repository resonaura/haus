/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { SidebarMaterial } from '../shared/native.js';
import {
  applyNativeWindowsMaterial,
  createLinuxMaterialController,
  decodeNativeHwnd,
  type LinuxMaterialController,
  type NativeWindowsDwmCall,
} from './materials.js';
import type { SidebarBackdrop } from './sidebar.js';

const execFileAsync = promisify(execFile);

export interface ReducedTransparencyRuntime {
  readonly readMacReduceTransparency: () => Promise<string>;
  readonly readWindowsTransparency: () => Promise<string>;
  readonly readLinuxHighContrast: () => Promise<string>;
}

const defaultReducedTransparencyRuntime: ReducedTransparencyRuntime = {
  async readMacReduceTransparency() {
    const { stdout } = await execFileAsync(
      'defaults',
      ['read', 'com.apple.universalaccess', 'reduceTransparency'],
      { timeout: 1000, encoding: 'utf8' },
    );
    return stdout;
  },
  async readWindowsTransparency() {
    const { stdout } = await execFileAsync(
      'reg',
      [
        'query',
        'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize',
        '/v',
        'EnableTransparency',
      ],
      { timeout: 1000, encoding: 'utf8', windowsHide: true },
    );
    return stdout;
  },
  async readLinuxHighContrast() {
    const { stdout } = await execFileAsync(
      'gsettings',
      ['get', 'org.gnome.desktop.a11y.interface', 'high-contrast'],
      { timeout: 1000, encoding: 'utf8' },
    );
    return stdout;
  },
};

export async function probeSystemReducedTransparency(options?: {
  readonly platform?: NodeJS.Platform;
  readonly env?: NodeJS.ProcessEnv;
  readonly runtime?: Partial<ReducedTransparencyRuntime>;
}): Promise<boolean> {
  const env = options?.env ?? process.env;
  if (env.HAUS_REDUCE_TRANSPARENCY === '1') return true;
  if (env.HAUS_REDUCE_TRANSPARENCY === '0') return false;

  const platform = options?.platform ?? process.platform;
  const runtime: ReducedTransparencyRuntime = {
    ...defaultReducedTransparencyRuntime,
    ...options?.runtime,
  };
  try {
    if (platform === 'darwin') {
      return (await runtime.readMacReduceTransparency()).trim() === '1';
    }
    if (platform === 'win32') {
      return /EnableTransparency\s+REG_DWORD\s+0x0\b/i.test(
        await runtime.readWindowsTransparency(),
      );
    }
    if (platform === 'linux') {
      return (await runtime.readLinuxHighContrast()).trim() === 'true';
    }
  } catch {
    return false;
  }
  return false;
}

export class LinuxSidebarBackdrop implements SidebarBackdrop {
  private readonly listeners = new Set<() => void>();
  private readonly reduceTransparency: boolean;
  private readonly createController: typeof createLinuxMaterialController;
  private controller?: LinuxMaterialController;
  private material: SidebarMaterial;
  private width = 0;
  private started = false;
  private disposed = false;
  private closed = false;

  constructor(
    options: {
      readonly initialMaterial?: SidebarMaterial;
      readonly reduceTransparency?: boolean;
      readonly createController?: typeof createLinuxMaterialController;
    } = {},
  ) {
    this.material = options.initialMaterial ?? 'none';
    this.reduceTransparency = Boolean(options.reduceTransparency);
    this.createController = options.createController ?? createLinuxMaterialController;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): boolean =>
    !this.reduceTransparency &&
    !this.closed &&
    !this.disposed &&
    this.width > 0 &&
    this.material !== 'none';

  getMaterial(): SidebarMaterial {
    return this.getSnapshot() ? this.material : 'none';
  }

  update(width: number, _dark: boolean): void {
    const prev = this.getSnapshot();
    this.width = width;
    if (width <= 0 || this.closed) {
      this.emitIfChanged(prev);
      return;
    }
    this.disposed = false;
    if (!this.reduceTransparency && !this.started) {
      this.started = true;
      this.controller = this.createController((next) => {
        const before = this.getSnapshot();
        this.material = next;
        this.emitIfChanged(before);
      });
      void this.controller.start();
    }
    this.emitIfChanged(prev);
  }

  dispose(): void {
    const prev = this.getSnapshot();
    this.controller?.dispose();
    this.controller = undefined;
    this.started = false;
    this.disposed = true;
    this.emitIfChanged(prev);
  }

  close(): void {
    this.closed = true;
    this.dispose();
    this.listeners.clear();
  }

  private emitIfChanged(prev: boolean): void {
    if (prev !== this.getSnapshot()) {
      for (const listener of this.listeners) listener();
    }
  }
}

export interface WindowsDwmBridge {
  findWindowByTitle(title: string): Buffer | null;
  readonly applyMaterial: NativeWindowsDwmCall;
  clearMaterial(hwnd: Buffer): void;
}

export type WindowsDwmNativeArg = string | number | bigint | Buffer | object | null;

export type WindowsDwmNativeFn = (...args: WindowsDwmNativeArg[]) => bigint | number;

export interface WindowsDwmLibrary {
  func(definition: string): WindowsDwmNativeFn;
}

export interface WindowsDwmKoffi {
  load(path: string): WindowsDwmLibrary;
  struct(name: string, def: Record<string, string>): unknown;
  sizeof(type: string): number;
  as(value: Record<string, number>, type: string): object;
}

interface LoadedWindowsDwm {
  readonly findWindowFn: (className: null, title: string) => bigint | number;
  readonly dwmSetAttrFn: (hwnd: bigint, attribute: number, value: Buffer, bytes: number) => number;
  readonly setCompositionFn: (hwnd: bigint, data: object) => number;
  readonly accentSize: number;
}

const loadedDwmByKoffi = new WeakMap<WindowsDwmKoffi, LoadedWindowsDwm>();

function loadWindowsDwm(koffi: WindowsDwmKoffi): LoadedWindowsDwm {
  const cached = loadedDwmByKoffi.get(koffi);
  if (cached) return cached;

  const dwmapi = koffi.load('dwmapi.dll');
  const user32 = koffi.load('user32.dll');
  const dwmSetAttrFn = dwmapi.func(
    'long __stdcall DwmSetWindowAttribute(uintptr_t window, uint32_t attribute, const void *value, uint32_t bytes)',
  );
  const findWindowFn = user32.func(
    'uintptr_t __stdcall FindWindowW(const char16_t *className, const char16_t *windowName)',
  );
  koffi.struct('HausGpuiAccentPolicy', {
    accentState: 'int32_t',
    accentFlags: 'uint32_t',
    gradientColor: 'uint32_t',
    animationId: 'int32_t',
  });
  koffi.struct('HausGpuiWindowCompositionAttributeData', {
    attribute: 'int32_t',
    data: 'void *',
    size: 'size_t',
  });
  const setCompositionFn = user32.func(
    'int __stdcall SetWindowCompositionAttribute(uintptr_t window, HausGpuiWindowCompositionAttributeData *data)',
  );

  const loaded: LoadedWindowsDwm = {
    findWindowFn: (className, title) => findWindowFn(className, title),
    dwmSetAttrFn: (hwnd, attribute, value, bytes) =>
      Number(dwmSetAttrFn(hwnd, attribute, value, bytes)),
    setCompositionFn: (hwnd, data) => Number(setCompositionFn(hwnd, data)),
    accentSize: koffi.sizeof('HausGpuiAccentPolicy'),
  };
  loadedDwmByKoffi.set(koffi, loaded);
  return loaded;
}

export function createNativeWindowsDwmBridge(koffi: WindowsDwmKoffi): WindowsDwmBridge {
  return {
    findWindowByTitle(title: string): Buffer | null {
      try {
        const dwm = loadWindowsDwm(koffi);
        const raw = dwm.findWindowFn(null, title);
        if (!raw) return null;
        const buf = Buffer.alloc(8);
        buf.writeBigUInt64LE(BigInt(raw), 0);
        return buf;
      } catch {
        return null;
      }
    },
    applyMaterial(hwnd: Buffer, state: number, tint: number, dwmBackdrop = false): boolean {
      try {
        const dwm = loadWindowsDwm(koffi);
        const handle = decodeNativeHwnd(hwnd);
        if (dwmBackdrop) {
          const darkMode = Buffer.alloc(4);
          darkMode.writeInt32LE((tint & 0xff) < 0x80 ? 1 : 0);
          dwm.dwmSetAttrFn(handle, 20, darkMode, 4);
          const roundCorners = Buffer.alloc(4);
          roundCorners.writeInt32LE(2);
          dwm.dwmSetAttrFn(handle, 33, roundCorners, 4);
          const transientAcrylic = Buffer.alloc(4);
          transientAcrylic.writeInt32LE(3);
          return dwm.dwmSetAttrFn(handle, 38, transientAcrylic, 4) === 0;
        }
        const policy = {
          accentState: state,
          accentFlags: 2,
          gradientColor: tint,
          animationId: 0,
        };
        const data = {
          attribute: 19,
          data: koffi.as(policy, 'HausGpuiAccentPolicy *'),
          size: dwm.accentSize,
        };
        return dwm.setCompositionFn(handle, data) !== 0;
      } catch {
        return false;
      }
    },
    clearMaterial(hwnd: Buffer): void {
      try {
        const dwm = loadWindowsDwm(koffi);
        const handle = decodeNativeHwnd(hwnd);
        const none = Buffer.alloc(4);
        none.writeInt32LE(1);
        dwm.dwmSetAttrFn(handle, 38, none, 4);
        const policy = { accentState: 0, accentFlags: 0, gradientColor: 0, animationId: 0 };
        dwm.setCompositionFn(handle, {
          attribute: 19,
          data: koffi.as(policy, 'HausGpuiAccentPolicy *'),
          size: dwm.accentSize,
        });
      } catch {
        /* Safe opaque fallback on cleanup. */
      }
    },
  };
}

export class WindowsSidebarBackdrop implements SidebarBackdrop {
  private readonly listeners = new Set<() => void>();
  private readonly title: string;
  private readonly version: string;
  private readonly reduceTransparency: boolean;
  private readonly bridge: WindowsDwmBridge;
  private readonly retryIntervalMs: number;
  private readonly maxRetries: number;
  private hwnd: Buffer | null = null;
  private width = 0;
  private dark = true;
  private active = false;
  private closed = false;
  private retries = 0;
  private timer?: ReturnType<typeof setInterval>;

  constructor(options: {
    readonly title: string;
    readonly version: string;
    readonly reduceTransparency?: boolean;
    readonly bridge: WindowsDwmBridge;
    readonly retryIntervalMs?: number;
    readonly maxRetries?: number;
  }) {
    this.title = options.title;
    this.version = options.version;
    this.reduceTransparency = Boolean(options.reduceTransparency);
    this.bridge = options.bridge;
    this.retryIntervalMs = options.retryIntervalMs ?? 200;
    this.maxRetries = options.maxRetries ?? 20;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): boolean => this.active;

  update(width: number, dark: boolean): void {
    const themeChanged = this.dark !== dark;
    this.width = width;
    this.dark = dark;
    if (this.closed || this.reduceTransparency || width <= 0) {
      this.stopTimer();
      this.clearApplied();
      return;
    }
    if (this.active && !themeChanged) return;
    this.tryApply();
    if (!this.active && !this.hwnd && this.retries < this.maxRetries && !this.timer) {
      this.timer = setInterval(() => this.tryApply(), this.retryIntervalMs);
      this.timer.unref?.();
    }
  }

  dispose(): void {
    this.stopTimer();
    this.clearApplied();
  }

  close(): void {
    this.closed = true;
    this.dispose();
    this.listeners.clear();
  }

  private tryApply(): void {
    if (this.closed || this.reduceTransparency || this.width <= 0) {
      this.stopTimer();
      return;
    }
    if (!this.hwnd) {
      this.hwnd = this.bridge.findWindowByTitle(this.title);
      if (!this.hwnd) {
        this.retries += 1;
        if (this.retries >= this.maxRetries) this.stopTimer();
        return;
      }
    }
    this.stopTimer();
    const next = applyNativeWindowsMaterial(
      this.hwnd,
      { version: this.version, dark: this.dark },
      this.bridge.applyMaterial,
    );
    this.setActive(next);
  }

  private clearApplied(): void {
    if (this.active && this.hwnd) {
      this.bridge.clearMaterial(this.hwnd);
    }
    this.setActive(false);
  }

  private setActive(next: boolean): void {
    if (this.active === next) return;
    this.active = next;
    for (const listener of this.listeners) listener();
  }

  private stopTimer(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
