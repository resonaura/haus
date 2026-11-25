/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useMemo } from 'react';
import { CameraRecordingCalendar } from '@haus/ui/components';
import { Box } from '@haus/ui/primitives';
import { recordingDay, recordingMonthBoundaries } from '../../model/recording-calendar';
import type { CameraEvent } from '../../model/camera-history';

export function RecordingCalendar({
  cameraId,
  day,
  events,
  demo,
  onChange,
}: {
  cameraId: string;
  day: string;
  events: CameraEvent[];
  demo: boolean;
  onChange: (day: string) => void;
}) {
  const known = useMemo(
    () =>
      new Set(
        events
          .filter((event) => event.status === 'ready')
          .map((event) => recordingDay(event.startAt)),
      ),
    [events],
  );
  const loadMonth = useMemo(() => {
    if (demo || !window.hausNative) return undefined;
    const api = window.hausNative;
    return async (month: string) => {
      const query = new URLSearchParams({
        camera_id: cameraId,
        boundaries: recordingMonthBoundaries(month).join(','),
      });
      const result = await api.helper<{ days: number[] }>({
        method: 'GET',
        path: `/api/events/calendar?${query}`,
      });
      if (
        !Array.isArray(result.days) ||
        !result.days.every((day) => typeof day === 'number' && Number.isFinite(day))
      ) {
        throw new Error('The Hub returned invalid recording dates.');
      }
      return result.days.map(recordingDay);
    };
  }, [cameraId, demo]);
  return (
    <Box className="camera-recording-calendar">
      <CameraRecordingCalendar
        day={day}
        today={recordingDay(Date.now())}
        markedDays={known}
        loadMonth={loadMonth}
        onChange={onChange}
      />
    </Box>
  );
}
