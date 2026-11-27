/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  computeServerDiskSpace,
  type ServerDiskSpace,
  type ServerDiskSpaceSegment,
} from '@haus/core/transport';
import type { ServerDisk } from './types';

export type DiskSpaceSegment = ServerDiskSpaceSegment;
export type DiskSpace = Omit<ServerDiskSpace, 'segments'> & {
  segments: DiskSpaceSegment[];
};

export function diskSpace(disk: ServerDisk, disks: ServerDisk[]): DiskSpace {
  const space = computeServerDiskSpace(disk, disks);
  return {
    ...space,
    segments: [...space.segments],
  };
}
