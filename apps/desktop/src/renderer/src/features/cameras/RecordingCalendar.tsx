/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useMemo, useState } from 'react';
import { Box, HausButton as Button, HausCalendar, HausPopover, Text } from '@haus/ui';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  recordingDay,
  recordingDayRange,
  recordingMonthBoundaries,
} from '../../model/recording-calendar';
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
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(day.slice(0, 7));
  const [recorded, setRecorded] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);
  const today = recordingDay(Date.now());
  const known = useMemo(
    () =>
      new Set([
        ...recorded,
        ...events
          .filter((event) => event.status === 'ready')
          .map((event) => recordingDay(event.startAt)),
      ]),
    [recorded, events],
  );
  useEffect(() => {
    if (open) setMonth(day.slice(0, 7));
  }, [open, day]);
  useEffect(() => {
    if (!open || demo || !window.hausNative) return;
    let active = true;
    setRecorded([]);
    setFailed(false);
    const query = new URLSearchParams({
      camera_id: cameraId,
      boundaries: recordingMonthBoundaries(month).join(','),
    });
    void window.hausNative
      .helper<{ days: number[] }>({ method: 'GET', path: `/api/events/calendar?${query}` })
      .then((result) => {
        if (active) setRecorded(result.days.map(recordingDay));
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [cameraId, month, open, demo]);
  const shift = (offset: number) => {
    const date = new Date(recordingDayRange(day).from);
    date.setDate(date.getDate() + offset);
    onChange(recordingDay(date));
  };
  return (
    <Box className="recording-day">
      <Button isIconOnly variant="ghost" aria-label="Previous day" onPress={() => shift(-1)}>
        <ChevronLeft size={16} />
      </Button>
      <HausPopover
        open={open}
        onOpenChange={setOpen}
        placement="bottom"
        className="recording-calendar-popover"
        trigger={
          <Button
            variant="ghost"
            className="recording-date-trigger"
            aria-label="Choose recording date"
            aria-expanded={open}
            onPress={() => setOpen((value) => !value)}
          >
            <Text key={day} className="recording-selected-date">
              {new Date(`${day}T12:00:00`).toLocaleDateString([], {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </Text>
            <CalendarDays size={15} />
          </Button>
        }
      >
        <Box role="group" ariaLabel="Recording calendar">
          <HausCalendar
            ariaLabel="Recording date"
            value={day}
            maxDate={today}
            markedDates={known}
            onMonthChange={setMonth}
            onChange={(nextDay) => {
              onChange(nextDay);
              setOpen(false);
            }}
          />
          <Text semantic="p" className="recording-calendar-key">
            <Text />
            {failed ? 'Some recording dates could not be loaded' : 'Days with recordings'}
          </Text>
        </Box>
      </HausPopover>
      <Button
        isIconOnly
        variant="ghost"
        aria-label="Next day"
        isDisabled={day >= today}
        onPress={() => shift(1)}
      >
        <ChevronRight size={16} />
      </Button>
    </Box>
  );
}
