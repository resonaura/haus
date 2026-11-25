/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PathPromptOptions } from '@gpuix/react';
import { macPerformer, NativeHaptics } from '../platform/haptics.js';
import { NativeClipboard } from '../platform/clipboard.js';
import { NativeMenuService } from '../platform/menus.js';
import type { ContextMenuItem, HapticPattern } from '../shared/native.js';
import { validateExternalUrl } from '../main/validation.js';

export interface GpuiPlatform {
  readonly toggleFullscreen?: () => void;
  readonly hapticFeedback?: (pattern: HapticPattern) => boolean;
  readonly openExternal?: (url: string, hub: string) => Promise<void>;
  readonly openPaths?: (options?: PathPromptOptions) => Promise<readonly string[] | null>;
  readonly clipboard?: Pick<NativeClipboard, 'readText' | 'writeText'>;
  readonly showContextMenu?: (items: readonly ContextMenuItem[]) => Promise<string | null>;
}

function browserCommand(
  platform: NodeJS.Platform,
  allowedUrl: string,
): { readonly file: string; readonly args: readonly string[] } | undefined {
  if (platform === 'darwin') return { file: '/usr/bin/open', args: [allowedUrl] };
  if (platform === 'linux') return { file: 'xdg-open', args: [allowedUrl] };
  if (platform === 'win32') {
    return { file: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', allowedUrl] };
  }
  return undefined;
}

export async function createGpuiPlatform(background: boolean): Promise<GpuiPlatform> {
  const execFileAsync = promisify(execFile);
  const openExternal = async (url: string, hub: string) => {
    const allowed = validateExternalUrl(url, hub);
    const launch = browserCommand(process.platform, allowed);
    if (!launch) throw new Error('Opening browser links is unavailable on this operating system.');
    try {
      await execFileAsync(launch.file, [...launch.args], { timeout: 10_000, windowsHide: true });
    } catch {
      throw new Error('The system browser could not be opened.');
    }
  };
  const clipboard = new NativeClipboard();
  const menus = new NativeMenuService();
  const showContextMenu = (items: readonly ContextMenuItem[]) => menus.showContextMenu(items);

  if (process.platform !== 'darwin' || background) {
    return { openExternal, clipboard, showContextMenu };
  }
  try {
    const koffi = await import('koffi');
    const haptics = new NativeHaptics(process.platform, () => macPerformer(koffi));
    return {
      openExternal,
      clipboard,
      showContextMenu,
      hapticFeedback: (pattern) => haptics.perform(pattern),
    };
  } catch (error) {
    console.warn('AppKit haptic feedback could not be loaded.', error);
    return { openExternal, clipboard, showContextMenu };
  }
}
