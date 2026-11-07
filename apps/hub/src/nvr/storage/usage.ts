/*
 * Haus — A thoughtful home for Haus Hub.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

export function nodeStorageCategory(path: string, roles: Map<string, string> = new Map()): string {
  if (/^blobs\/[a-f0-9]{64}$/.test(path)) return roles.get(path.slice(6)) ?? 'other-media';
  if (path.startsWith('blobs/.partial-')) return 'temporary';
  if (path.startsWith('camera-sessions/'))
    return /\/event-[^/]+\//.test(path) ? 'capture' : 'prebuffer';
  if (path.startsWith('camera-recordings/')) return 'capture';
  if (path.startsWith('playback/')) return 'preparation';
  if (path.startsWith('streams/')) return 'stream-cache';
  if (/\.(sqlite|db)(-(wal|shm))?$/.test(path)) return 'databases';
  if (/\.log(?:\.\d+)?$/.test(path)) return 'logs';
  if (['catalog.json', 'settings.json', 'instance-id'].includes(path)) return 'configuration';
  return 'other';
}

export function addStorageRole(
  roles: Map<string, string>,
  digest: string | undefined,
  role: string,
): void {
  if (digest === undefined || !/^[a-f0-9]{64}$/.test(digest)) return;
  const existing = roles.get(digest);
  roles.set(digest, existing && existing !== role ? 'shared' : role);
}
