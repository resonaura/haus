/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import { NativeMenuService, sanitizeContextMenuItems } from './menus.js';

describe('desktop context menus', () => {
  it('sanitizes menu separators, empty labels, and deep nesting', () => {
    const clean = sanitizeContextMenuItems([
      { id: 'sep-lead', label: '', type: 'separator' },
      { id: 'fav', label: '  Pin to Quick Controls  ', enabled: true },
      { id: 'sep-1', label: '', type: 'separator' },
      { id: 'sep-dup', label: '', type: 'separator' },
      { id: 'empty', label: '   ' },
      {
        id: 'room',
        label: 'Move to room',
        type: 'submenu',
        items: [{ id: 'room:kitchen', label: 'Kitchen' }],
      },
      { id: 'sep-tail', label: '', type: 'separator' },
    ]);

    expect(clean).toEqual([
      { id: 'fav', label: 'Pin to Quick Controls', type: 'normal', enabled: true },
      { id: 'sep-1', label: '', type: 'separator' },
      {
        id: 'room',
        label: 'Move to room',
        type: 'submenu',
        enabled: true,
        items: [{ id: 'room:kitchen', label: 'Kitchen', type: 'normal', enabled: true }],
      },
    ]);
  });

  it('routes macOS to the AppKit menu presenter and falls back safely on other OSes', async () => {
    const mac = new NativeMenuService(
      'darwin',
      async (items) => items[0]?.id ?? null,
      async () => 'fallback',
    );
    await expect(mac.showContextMenu([{ id: 'toggle', label: 'Toggle' }])).resolves.toBe('toggle');

    const fallbackLinux = new NativeMenuService(
      'linux',
      async () => 'mac',
      async (items) => items[0]?.id ?? null,
    );
    await expect(fallbackLinux.showContextMenu([{ id: 'hide', label: 'Hide' }])).resolves.toBe(
      'hide',
    );
  });
});
