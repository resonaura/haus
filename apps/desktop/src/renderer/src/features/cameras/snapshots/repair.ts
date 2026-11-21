/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

/** Requests helper-side recording repair if supported before reloading playback. */
export async function requestRecordingRepair(recordingId: string): Promise<void> {
  const status = await window.hausNative?.helper<{ features?: { recordingRepair?: boolean } }>({
    method: 'GET',
    path: '/api/status',
  });
  if (status?.features?.recordingRepair) {
    await window.hausNative?.helper({
      method: 'POST',
      path: `/api/events/${recordingId}/repair`,
      data: {},
    });
  }
}
