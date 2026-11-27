/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import {
  AUTOMATION_WEEKDAYS,
  type AutomationTriggerBlock,
  type AutomationWeekday,
} from '@haus/core/transport';
import { colorToken, corners, insets, pct, px } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import { Box, Pressable, Row, Stack, Text, TextInput } from '../../primitives/index.js';
import { UiIcon } from '../icon.js';
import { automationPillStyle } from './theme.js';

const SUN_OFFSETS: readonly { readonly minutes: number; readonly label: string }[] = [
  { minutes: -30, label: '30m before' },
  { minutes: -15, label: '15m before' },
  { minutes: 0, label: 'At event' },
  { minutes: 15, label: '15m after' },
  { minutes: 30, label: '30m after' },
];

const QUICK_TIMES = ['07:00', '08:00', '18:00', '22:30'] as const;

export function WhenTimeControls({
  trigger,
  onChange,
}: {
  readonly trigger: Extract<AutomationTriggerBlock, { readonly kind: 'time' }>;
  readonly onChange: (next: AutomationTriggerBlock) => void;
}) {
  return (
    <Stack gapPx={10}>
      <Row align="center" gapPx={8} wrap>
        <Box style={{ layout: { width: px(120) } }}>
          <TextInput
            ariaLabel="Trigger time"
            placeholder="07:30"
            value={trigger.at}
            onChange={(at) => onChange({ ...trigger, at })}
            style={{
              layout: { width: pct(100), minHeight: px(36), padding: insets(6, 10) },
              material: new SolidMaterial(colorToken('surface')),
              border: { width: 1, color: colorToken('border') },
              corners: corners(10),
              typography: { size: 14, weight: 600, color: colorToken('textPrimary') },
            }}
          />
        </Box>
        {QUICK_TIMES.map((time) => (
          <Pressable
            key={time}
            ariaPressed={trigger.at === time}
            onActivate={() => onChange({ ...trigger, at: time })}
            style={automationPillStyle({
              active: trigger.at === time,
              padding: insets(5, 9),
              cornerSpec: corners(8),
            })}
          >
            <Text size={11.5}>{time}</Text>
          </Pressable>
        ))}
      </Row>

      <Row align="center" gapPx={6} wrap>
        {AUTOMATION_WEEKDAYS.map((day) => {
          const selected = trigger.weekdays.length === 0 || trigger.weekdays.includes(day.id);
          return (
            <Pressable
              key={day.id}
              ariaLabel={day.label}
              ariaPressed={selected}
              onActivate={() => {
                const current: AutomationWeekday[] =
                  trigger.weekdays.length === 0
                    ? AUTOMATION_WEEKDAYS.map((d) => d.id)
                    : [...trigger.weekdays];
                const next = current.includes(day.id)
                  ? current.filter((d) => d !== day.id)
                  : [...current, day.id];
                onChange({ ...trigger, weekdays: next.length === 7 ? [] : next });
              }}
              style={{
                layout: {
                  width: px(30),
                  height: px(30),
                  alignItems: 'center',
                  justifyContent: 'center',
                },
                material: new SolidMaterial(
                  selected ? colorToken('surfaceActive') : colorToken('surface'),
                ),
                border: {
                  width: 1,
                  color: selected ? colorToken('accent') : colorToken('border'),
                },
                corners: corners(999, 'round'),
              }}
            >
              <Text size={11} weight={700}>
                {day.short}
              </Text>
            </Pressable>
          );
        })}
        <Pressable
          onActivate={() =>
            onChange({ ...trigger, weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'] })
          }
          style={{
            layout: { padding: insets(5, 9) },
            material: new SolidMaterial(colorToken('surface')),
            border: { width: 1, color: colorToken('border') },
            corners: corners(8),
          }}
        >
          <Text size={11}>Weekdays</Text>
        </Pressable>
        <Pressable
          onActivate={() => onChange({ ...trigger, weekdays: [] })}
          style={{
            layout: { padding: insets(5, 9) },
            material: new SolidMaterial(colorToken('surface')),
            border: { width: 1, color: colorToken('border') },
            corners: corners(8),
          }}
        >
          <Text size={11}>Every day</Text>
        </Pressable>
      </Row>
    </Stack>
  );
}

export function WhenSunControls({
  trigger,
  onChange,
}: {
  readonly trigger: Extract<AutomationTriggerBlock, { readonly kind: 'sun' }>;
  readonly onChange: (next: AutomationTriggerBlock) => void;
}) {
  return (
    <Stack gapPx={10}>
      <Row gapPx={8}>
        {(
          [
            ['sunrise', 'Sunrise', 'sunrise'],
            ['sunset', 'Sunset', 'sunset'],
          ] as const
        ).map(([ev, label, icon]) => {
          const active = trigger.event === ev;
          return (
            <Pressable
              key={ev}
              ariaPressed={active}
              onActivate={() => onChange({ ...trigger, event: ev })}
              style={{
                layout: {
                  flexGrow: 1,
                  padding: insets(10, 12),
                  direction: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: px(8),
                },
                material: new SolidMaterial(
                  active ? colorToken('surfaceActive') : colorToken('surface'),
                ),
                border: {
                  width: 1,
                  color: active ? colorToken('accent') : colorToken('border'),
                },
                corners: corners(12),
              }}
            >
              <UiIcon name={icon} size={16} />
              <Text size={12.5} weight={600}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </Row>
      <Row gapPx={6} wrap>
        {SUN_OFFSETS.map((opt) => {
          const active = trigger.offsetMinutes === opt.minutes;
          return (
            <Pressable
              key={opt.minutes}
              ariaPressed={active}
              onActivate={() => onChange({ ...trigger, offsetMinutes: opt.minutes })}
              style={automationPillStyle({
                active,
                padding: insets(5, 10),
              })}
            >
              <Text size={11.5} weight={active ? 600 : 500}>
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </Row>
    </Stack>
  );
}
