import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Calendar, Popover } from '@heroui/react';
import { parseDate } from '@internationalized/date';
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
  const grid = useRef<HTMLTableElement>(null);
  const previousMonth = useRef(month);
  useEffect(() => {
    const previous = previousMonth.current;
    previousMonth.current = month;
    if (
      !open ||
      previous === month ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      return;
    const animation = grid.current?.animate(
      [
        { opacity: 0.45, translate: `${month > previous ? 7 : -7}px 0` },
        { opacity: 1, translate: '0 0' },
      ],
      { duration: 190, easing: 'cubic-bezier(.2,.75,.25,1)' },
    );
    return () => animation?.cancel();
  }, [month, open]);
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
  }, [open]);
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
    <div className="recording-day">
      <Button isIconOnly variant="ghost" aria-label="Previous day" onPress={() => shift(-1)}>
        <ChevronLeft size={16} />
      </Button>
      <Popover isOpen={open} onOpenChange={setOpen}>
        <Button
          variant="ghost"
          className="recording-date-trigger"
          aria-label="Choose recording date"
        >
          <span key={day} className="recording-selected-date">
            {new Date(`${day}T12:00:00`).toLocaleDateString([], {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </span>
          <CalendarDays size={15} />
        </Button>
        <Popover.Content className="recording-calendar-popover" placement="bottom" offset={10}>
          <Popover.Dialog aria-label="Recording calendar">
            <Calendar
              aria-label="Recording date"
              value={parseDate(day)}
              defaultFocusedValue={parseDate(day)}
              maxValue={parseDate(today)}
              onFocusChange={(date) => setMonth(date.toString().slice(0, 7))}
              onChange={(date) => {
                if (date) {
                  onChange(date.toString());
                  setOpen(false);
                }
              }}
            >
              <Calendar.Header>
                <Calendar.Heading />
                <Calendar.NavButton slot="previous" />
                <Calendar.NavButton slot="next" />
              </Calendar.Header>
              <Calendar.Grid ref={grid}>
                <Calendar.GridHeader>
                  {(label) => <Calendar.HeaderCell>{label}</Calendar.HeaderCell>}
                </Calendar.GridHeader>
                <Calendar.GridBody>
                  {(date) => (
                    <Calendar.Cell
                      date={date}
                      data-recorded={known.has(date.toString()) || undefined}
                      aria-label={`${date.toString()}${known.has(date.toString()) ? ', recordings available' : ''}`}
                    />
                  )}
                </Calendar.GridBody>
              </Calendar.Grid>
            </Calendar>
            <p className="recording-calendar-key">
              <span />
              {failed ? 'Some recording dates could not be loaded' : 'Days with recordings'}
            </p>
          </Popover.Dialog>
        </Popover.Content>
      </Popover>
      <Button
        isIconOnly
        variant="ghost"
        aria-label="Next day"
        isDisabled={day >= today}
        onPress={() => shift(1)}
      >
        <ChevronRight size={16} />
      </Button>
    </div>
  );
}
