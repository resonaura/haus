/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useEffect, useState } from 'react';
import { corners, insets, px, rgba } from '../../ir/geometry.js';
import { BackdropMaterial, SolidMaterial } from '../../ir/materials.js';
import { HausCalendar, HausPopover, Pressable, Row, Stack, Text } from '../../primitives/index.js';
import { UiIcon } from '../icon.js';
import { cameraGlass } from './surfaces.js';

export function CameraRecordingCalendar({
  day,
  today,
  markedDays,
  loadMonth,
  onChange,
}: {
  readonly day: string;
  readonly today: string;
  readonly markedDays: ReadonlySet<string>;
  readonly loadMonth?: (month: string) => Promise<readonly string[]>;
  readonly onChange: (day: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(day.slice(0, 7));
  const [recorded, setRecorded] = useState<readonly string[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('ready');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (open) setMonth(day.slice(0, 7));
  }, [open, day]);
  useEffect(() => {
    if (!open || !loadMonth) return;
    let active = true;
    setRecorded([]);
    setStatus('loading');
    void loadMonth(month)
      .then((dates) => {
        if (!active) return;
        setRecorded(dates);
        setStatus('ready');
      })
      .catch(() => {
        if (active) setStatus('failed');
      });
    return () => {
      active = false;
    };
  }, [open, month, loadMonth, retry]);
  const shiftDay = (offset: number) => {
    const date = new Date(`${day}T12:00:00`);
    date.setDate(date.getDate() + offset);
    onChange(
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
    );
  };
  const dayButton = (next: boolean) => (
    <Pressable
      id={next ? 'camera-day-next' : 'camera-day-prev'}
      ariaLabel={next ? 'Next day' : 'Previous day'}
      disabled={next && day >= today}
      onActivate={() => shiftDay(next ? 1 : -1)}
      style={{
        layout: {
          display: 'flex',
          width: px(28),
          height: px(28),
          alignItems: 'center',
          justifyContent: 'center',
        },
        corners: corners(10),
        opacity: next && day >= today ? 0.35 : 1,
        states: { hover: { material: new SolidMaterial(rgba(255, 255, 255, 0.12)) } },
      }}
    >
      <UiIcon name={next ? 'chevron-right' : 'chevron-left'} size={16} color="#ffffff" />
    </Pressable>
  );
  return (
    <Row
      gapPx={2}
      style={{
        layout: { padding: insets(3, 5) },
        material: cameraGlass(0.44),
        border: { width: 0.5, color: rgba(255, 255, 255, 0.05) },
        corners: corners(14),
        pointerEvents: 'auto',
      }}
    >
      {dayButton(false)}
      <HausPopover
        id="camera-calendar-popover"
        open={open}
        onOpenChange={setOpen}
        placement="bottom"
        style={{
          material: new BackdropMaterial(
            { blurRadius: 28, saturation: 1.15, tintColor: rgba(16, 16, 18, 0.58) },
            { fallbackColor: rgba(16, 16, 18, 0.96) },
          ),
        }}
        trigger={
          <Pressable
            id="camera-calendar-toggle"
            ariaLabel="Choose recording date"
            ariaExpanded={open}
            onActivate={() => setOpen((value) => !value)}
            style={{
              layout: {
                display: 'flex',
                direction: 'row',
                alignItems: 'center',
                height: px(28),
                gap: px(7),
                padding: insets(0, 8),
              },
              corners: corners(10),
              states: { hover: { material: new SolidMaterial(rgba(255, 255, 255, 0.12)) } },
            }}
          >
            <Text
              size={11.5}
              weight={500}
              style={{ pointerEvents: 'none', typography: { color: rgba(255, 255, 255, 0.94) } }}
            >
              {new Date(`${day}T12:00:00`).toLocaleDateString([], {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </Text>
            <UiIcon name="calendar" size={14} color="rgba(255, 255, 255, 0.78)" />
          </Pressable>
        }
      >
        <Stack gapPx={10} style={{ layout: { width: px(270) } }}>
          <HausCalendar
            ariaLabel="Recording date"
            value={day}
            maxDate={today}
            markedDates={new Set([...markedDays, ...recorded])}
            onMonthChange={setMonth}
            onChange={(date) => {
              onChange(date);
              setOpen(false);
            }}
          />
          <Text size={11} tone="muted" ariaLive="polite">
            {status === 'loading'
              ? 'Loading recording dates…'
              : status === 'failed'
                ? 'Some recording dates could not be loaded'
                : 'Days with recordings'}
          </Text>
          {status === 'failed' && (
            <Pressable
              ariaLabel="Retry recording dates"
              onActivate={() => setRetry((value) => value + 1)}
            >
              <Text size={12}>Try again</Text>
            </Pressable>
          )}
        </Stack>
      </HausPopover>
      {dayButton(true)}
    </Row>
  );
}
