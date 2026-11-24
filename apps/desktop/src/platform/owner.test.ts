/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { acquireHubSessionOwner } from './owner.js';

it.skipIf(process.platform !== 'darwin' && process.platform !== 'linux')(
  'fences a second GPUIX session owner until the first descriptor is released',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'haus-gpuix-owner-'));
    try {
      const owner = await acquireHubSessionOwner(directory);
      try {
        await expect(acquireHubSessionOwner(directory)).rejects.toThrow('owns the Hub session');
      } finally {
        await owner.close();
      }
      const next = await acquireHubSessionOwner(directory);
      await next.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

it('enforces single-owner fencing and releases handles cleanly on Windows', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'haus-gpuix-win-owner-'));
  let locked = false;
  let closedFd: number | undefined;
  const lockFileDescriptor = (fd: number, platform: NodeJS.Platform) => {
    expect(platform).toBe('win32');
    if (locked) {
      closedFd = fd;
      return false;
    }
    locked = true;
    return true;
  };
  try {
    const owner = await acquireHubSessionOwner(directory, { platform: 'win32', lockFileDescriptor });
    await expect(
      acquireHubSessionOwner(directory, { platform: 'win32', lockFileDescriptor }),
    ).rejects.toThrow('Another Haus GPUIX process owns the Hub session.');
    expect(closedFd).toBeTypeOf('number');
    await owner.close();
    locked = false;
    const next = await acquireHubSessionOwner(directory, { platform: 'win32', lockFileDescriptor });
    await next.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('rejects unsupported operating systems cleanly', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'haus-gpuix-unsupported-owner-'));
  try {
    await expect(acquireHubSessionOwner(directory, { platform: 'freebsd' })).rejects.toThrow(
      'only supported on macOS, Windows, and Linux',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
