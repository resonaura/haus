/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  detectLinuxDesktop,
  hasBlurMyShell,
  hasHyprlandBlur,
  hasKWinBlur,
  LinuxShellMaterial,
  type LinuxDesktop,
} from '../main/linux-shell-material.js';
import { windowsAcrylicMode } from '../main/windows-acrylic.js';
import type { SidebarMaterial } from '../shared/native.js';

const execFileAsync = promisify(execFile);

export type WindowsMaterialMode = 'dwm-acrylic' | 'legacy-acrylic' | 'legacy-blur';

export function resolveWindowsMaterialMode(version: string): WindowsMaterialMode {
  const mode = windowsAcrylicMode(version);
  return mode === 'electron' ? 'dwm-acrylic' : mode;
}

export interface LinuxMaterialProbeRuntime {
  readonly desktop: () => LinuxDesktop | null;
  readonly readEnabledExtensions: () => Promise<string>;
  readonly readKWinConfiguration: () => Promise<string>;
  readonly readHyprlandBlurOption: () => Promise<string>;
}

const defaultLinuxProbeRuntime: LinuxMaterialProbeRuntime = {
  desktop: () => detectLinuxDesktop(),
  async readEnabledExtensions() {
    const { stdout } = await execFileAsync(
      'gsettings',
      ['get', 'org.gnome.shell', 'enabled-extensions'],
      { timeout: 1000, encoding: 'utf8' },
    );
    return stdout;
  },
  readKWinConfiguration() {
    const configDir = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config');
    return readFile(join(configDir, 'kwinrc'), 'utf8');
  },
  async readHyprlandBlurOption() {
    const { stdout } = await execFileAsync(
      'hyprctl',
      ['getoption', 'decoration:blur:enabled', '-j'],
      { timeout: 1000, encoding: 'utf8' },
    );
    return stdout;
  },
};

export async function probeInitialLinuxMaterial(
  runtime: LinuxMaterialProbeRuntime = defaultLinuxProbeRuntime,
): Promise<SidebarMaterial> {
  const desktop = runtime.desktop();
  if (!desktop) return 'none';
  try {
    if (desktop === 'gnome') {
      return hasBlurMyShell(await runtime.readEnabledExtensions()) ? 'blur-my-shell' : 'none';
    }
    if (desktop === 'kde') {
      return hasKWinBlur(await runtime.readKWinConfiguration()) ? 'kwin-blur' : 'none';
    }
    if (desktop === 'hyprland') {
      return hasHyprlandBlur(await runtime.readHyprlandBlurOption()) ? 'hyprland-blur' : 'none';
    }
  } catch {
    return 'none';
  }
  return 'none';
}

export interface NativeWindowsDwmCall {
  (hwnd: Buffer, state: number, tint: number, dwmBackdrop?: boolean): boolean;
}

export function decodeNativeHwnd(handle: Buffer): bigint {
  if (handle.length >= 8) return handle.readBigUInt64LE(0);
  if (handle.length >= 4) return BigInt(handle.readUInt32LE(0));
  throw new Error('Native window handle buffer too short');
}

export function applyNativeWindowsMaterial(
  handle: Buffer,
  options: { readonly version: string; readonly dark?: boolean },
  call: NativeWindowsDwmCall,
): boolean {
  const mode = resolveWindowsMaterialMode(options.version);
  const dark = options.dark ?? true;
  const tint = dark ? 0xcc171717 : 0xccf2f2f2;
  if (mode === 'dwm-acrylic' && call(handle, 3, tint, true)) {
    return true;
  }
  const state = mode === 'legacy-blur' ? 3 : 4;
  if (call(handle, state, tint, false)) return true;
  return state === 4 && call(handle, 3, tint, false);
}

export interface LinuxMaterialController {
  readonly material: SidebarMaterial;
  start(): Promise<void>;
  dispose(): void;
}

export function createLinuxMaterialController(
  onChange: (material: SidebarMaterial) => void,
): LinuxMaterialController {
  const manager = new LinuxShellMaterial(onChange);
  return {
    get material() {
      return manager.material;
    },
    start: () => manager.start(),
    dispose: () => manager.dispose(),
  };
}
