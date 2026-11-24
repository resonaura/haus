/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import { NativeClipboard } from './clipboard.js';

describe('NativeClipboard', () => {
  it('dispatches macOS pbcopy/pbpaste and validates input bounds', async () => {
    let stored = '';
    const clipboard = new NativeClipboard('darwin', {}, async (cmd, _args, stdin) => {
      if (cmd === 'pbcopy') {
        stored = stdin ?? '';
        return { code: 0, stdout: '', stderr: '' };
      }
      if (cmd === 'pbpaste') {
        return { code: 0, stdout: stored, stderr: '' };
      }
      return { code: 1, stdout: '', stderr: 'missing' };
    });

    await clipboard.writeText('haus://pair');
    await expect(clipboard.readText()).resolves.toBe('haus://pair');
    await expect(clipboard.writeText('bad\0value')).rejects.toThrow('valid string');
    await expect(clipboard.writeText('x'.repeat(1024 * 1024 + 1))).rejects.toThrow('1 MiB limit');
  });

  it('uses Wayland first when WAYLAND_DISPLAY is present and falls back to xclip on X11', async () => {
    const calls: string[] = [];
    const wayland = new NativeClipboard(
      'linux',
      { WAYLAND_DISPLAY: 'wayland-0' },
      async (cmd) => {
        calls.push(cmd);
        return { code: cmd === 'wl-copy' || cmd === 'wl-paste' ? 0 : 1, stdout: 'ok', stderr: '' };
      },
    );
    await wayland.writeText('token');
    await expect(wayland.readText()).resolves.toBe('ok');
    expect(calls).toEqual(['wl-copy', 'wl-paste']);

    const x11Calls: string[] = [];
    const x11 = new NativeClipboard('linux', {}, async (cmd) => {
      x11Calls.push(cmd);
      return { code: cmd === 'xsel' ? 0 : 1, stdout: 'x11', stderr: '' };
    });
    await expect(x11.readText()).resolves.toBe('x11');
    expect(x11Calls).toEqual(['xclip', 'xsel']);
  });

  it('uses Windows PowerShell clipboard via stdin without shell interpolation', async () => {
    let seenStdin = '';
    let seenCmd = '';
    const win = new NativeClipboard('win32', {}, async (cmd, args, stdin) => {
      seenCmd = cmd;
      if (args.at(-1)?.includes('Set-Clipboard')) {
        seenStdin = stdin ?? '';
        return { code: 0, stdout: '', stderr: '' };
      }
      return { code: 0, stdout: seenStdin, stderr: '' };
    });
    await win.writeText('$(whoami) & safe');
    await expect(win.readText()).resolves.toBe('$(whoami) & safe');
    expect(seenCmd).toBe('powershell.exe');
    expect(seenStdin).toBe('$(whoami) & safe');
  });
});
