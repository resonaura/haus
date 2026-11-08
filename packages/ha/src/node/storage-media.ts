/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

const transports = new Set([
  'ata',
  'sata',
  'sas',
  'scsi',
  'usb',
  'nvme',
  'mmc',
  'sdio',
  'sd',
  'ieee1394',
  'fc',
  'fcoe',
  'thunderbolt',
  'apple-fabric',
]);
const kinds = new Set(['hdd', 'ssd', 'solid-state', 'flash', 'sd', 'mmc', 'optical']);

export interface StorageMediaMetadata {
  transport?: string;
  mediaKind?: string;
  removable?: boolean;
  hotplug?: boolean;
}

export function sanitizeStorageMedia(
  value?: {
    transport?: unknown;
    mediaKind?: unknown;
    removable?: unknown;
    hotplug?: unknown;
  } | null,
): StorageMediaMetadata {
  return {
    ...(typeof value?.transport === 'string' && transports.has(value.transport)
      ? { transport: value.transport }
      : {}),
    ...(typeof value?.mediaKind === 'string' && kinds.has(value.mediaKind)
      ? { mediaKind: value.mediaKind }
      : {}),
    ...(typeof value?.removable === 'boolean' ? { removable: value.removable } : {}),
    ...(typeof value?.hotplug === 'boolean' ? { hotplug: value.hotplug } : {}),
  };
}

/** Only typed hardware evidence; labels/models never identify media types. */
export function storageMedia({
  transport,
  rotational,
  removable,
  hotplug,
  attributes = {},
  nativeMedia,
}: {
  transport?: unknown;
  rotational?: boolean;
  removable?: boolean;
  hotplug?: boolean;
  attributes?: Record<string, string | undefined>;
  nativeMedia?: string;
} = {}): StorageMediaMetadata {
  const bus = String(transport ?? '').toLowerCase();
  const flag = (key: string) => attributes[key] === '1';
  const sd =
    flag('ID_DRIVE_FLASH_SD') ||
    flag('ID_DRIVE_MEDIA_FLASH_SD') ||
    ['SD', 'SDcombo'].includes(attributes.MMC_TYPE ?? '') ||
    bus === 'sd';
  const mmc =
    attributes.MMC_TYPE === 'MMC' || flag('ID_DRIVE_FLASH_MMC') || flag('ID_DRIVE_MEDIA_FLASH_MMC');
  const flash = flag('ID_DRIVE_THUMB') || flag('ID_DRIVE_FLASH') || flag('ID_DRIVE_MEDIA_FLASH');
  const mediaKind = sd
    ? 'sd'
    : mmc
      ? 'mmc'
      : flash
        ? 'flash'
        : flag('ID_CDROM')
          ? 'optical'
          : nativeMedia === 'SSD'
            ? 'ssd'
            : nativeMedia === 'HDD'
              ? 'hdd'
              : rotational === true
                ? 'hdd'
                : rotational === false
                  ? ['ata', 'sata', 'nvme', 'sas'].includes(bus)
                    ? 'ssd'
                    : 'solid-state'
                  : undefined;
  return sanitizeStorageMedia({
    transport: bus,
    mediaKind,
    removable,
    hotplug,
  });
}

export function udevMediaAttributes(value: unknown): Record<string, string> {
  const allowed = new Set([
    'MMC_TYPE',
    'ID_DRIVE_THUMB',
    'ID_DRIVE_FLASH',
    'ID_DRIVE_MEDIA_FLASH',
    'ID_DRIVE_FLASH_SD',
    'ID_DRIVE_MEDIA_FLASH_SD',
    'ID_DRIVE_FLASH_MMC',
    'ID_DRIVE_MEDIA_FLASH_MMC',
    'ID_CDROM',
  ]);
  return Object.fromEntries(
    String(value)
      .split('\n')
      .flatMap((line) => {
        const match = /^E:([A-Z_]+)=([^\r\n]*)$/.exec(line);
        return match && allowed.has(match[1]!) ? [[match[1]!, match[2]!]] : [];
      }),
  );
}
