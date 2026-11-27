/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useState } from 'react';
import {
  BUS_EVENT_PRESETS,
  DEFAULT_HUE_BUTTON_EVENT_TYPES,
  type AutomationTriggerBlock,
} from '@haus/core/transport';
import { colorToken, corners, insets, pct, px } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import {
  Box,
  HausButton,
  Pressable,
  Row,
  Stack,
  Text,
  TextInput,
} from '../../primitives/index.js';
import { UiIcon } from '../icon.js';
import { automationPillStyle } from './theme.js';

const inputStyle = {
  layout: { width: pct(100), minHeight: px(34), padding: insets(6, 10) },
  material: new SolidMaterial(colorToken('surface')),
  border: { width: 1, color: colorToken('border') },
  corners: corners(10),
  typography: { size: 12.5, color: colorToken('textPrimary') },
} as const;

function coerceScalarValue(raw: string): string | number | boolean {
  const trimmed = raw.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return raw;
}

export function WhenBusEventControls({
  trigger,
  onChange,
}: {
  readonly trigger: Extract<AutomationTriggerBlock, { readonly kind: 'bus_event' }>;
  readonly onChange: (next: AutomationTriggerBlock) => void;
}) {
  const [newKey, setNewKey] = useState('');
  const [newVal, setNewVal] = useState('');
  const entries = Object.entries(trigger.eventData);

  const patchData = (key: string, value: string | number | boolean | undefined) => {
    const next = { ...trigger.eventData };
    if (value === undefined) delete next[key];
    else next[key] = value;
    onChange({ ...trigger, eventData: next });
  };

  return (
    <Stack gapPx={10}>
      <Row gapPx={6} wrap>
        {BUS_EVENT_PRESETS.map((preset) => {
          const active = trigger.eventType === preset.eventType;
          return (
            <Pressable
              key={preset.eventType}
              ariaPressed={active}
              onActivate={() => onChange({ ...trigger, eventType: preset.eventType })}
              style={automationPillStyle({
                active,
                padding: insets(5, 10),
              })}
            >
              <Text size={11} weight={active ? 600 : 500}>
                {preset.label}
              </Text>
            </Pressable>
          );
        })}
      </Row>

      <Stack gapPx={4}>
        <Text size={11} tone="muted">
          Event type
        </Text>
        <TextInput
          ariaLabel="Event type"
          placeholder="hue_event, zha_event, custom_event…"
          value={trigger.eventType}
          onChange={(eventType) => onChange({ ...trigger, eventType })}
          style={inputStyle}
        />
      </Stack>

      {trigger.eventType === 'hue_event' && (
        <Stack gapPx={6}>
          <Text size={11} tone="muted">
            Hue button & gesture quick filter
          </Text>
          <Row gapPx={6} wrap>
            {([1, 2, 3, 4] as const).map((btnNum) => {
              const active = Number(trigger.eventData.subtype) === btnNum;
              return (
                <Pressable
                  key={btnNum}
                  ariaPressed={active}
                  onActivate={() => patchData('subtype', btnNum)}
                  style={{
                    layout: { padding: insets(4, 9) },
                    material: new SolidMaterial(
                      active ? colorToken('surfaceActive') : colorToken('surface'),
                    ),
                    border: {
                      width: 1,
                      color: active ? colorToken('accent') : colorToken('border'),
                    },
                    corners: corners(8),
                  }}
                >
                  <Text size={11} weight={active ? 600 : 500}>
                    {`Button ${btnNum}`}
                  </Text>
                </Pressable>
              );
            })}
            {DEFAULT_HUE_BUTTON_EVENT_TYPES.map((gesture) => {
              const active = trigger.eventData.type === gesture;
              return (
                <Pressable
                  key={gesture}
                  ariaPressed={active}
                  onActivate={() => patchData('type', gesture)}
                  style={{
                    layout: { padding: insets(4, 9) },
                    material: new SolidMaterial(
                      active ? colorToken('surfaceActive') : colorToken('surface'),
                    ),
                    border: {
                      width: 1,
                      color: active ? colorToken('accent') : colorToken('border'),
                    },
                    corners: corners(8),
                  }}
                >
                  <Text size={11} weight={active ? 600 : 500}>
                    {gesture.replaceAll('_', ' ')}
                  </Text>
                </Pressable>
              );
            })}
          </Row>
        </Stack>
      )}

      <Stack gapPx={6}>
        <Text size={11} tone="muted">
          Event payload filters (optional — e.g. id, device_id, subtype, type, command)
        </Text>
        {entries.map(([key, val]) => (
          <Row key={key} align="center" gapPx={6}>
            <Box
              style={{
                layout: { minWidth: px(110), padding: insets(6, 10) },
                material: new SolidMaterial(colorToken('surface')),
                border: { width: 1, color: colorToken('border') },
                corners: corners(8),
              }}
            >
              <Text size={12} mono>
                {key}
              </Text>
            </Box>
            <Box style={{ layout: { flexGrow: 1, minWidth: px(120) } }}>
              <TextInput
                ariaLabel={`Filter value for ${key}`}
                value={String(val)}
                onChange={(nextRaw) => patchData(key, coerceScalarValue(nextRaw))}
                style={inputStyle}
              />
            </Box>
            <HausButton variant="ghost" size="sm" onPress={() => patchData(key, undefined)}>
              <UiIcon name="x" size={13} />
            </HausButton>
          </Row>
        ))}

        <Row align="center" gapPx={6} wrap>
          <Box style={{ layout: { width: px(130) } }}>
            <TextInput
              ariaLabel="New event filter field"
              placeholder="Field (e.g. id)"
              value={newKey}
              onChange={setNewKey}
              style={inputStyle}
            />
          </Box>
          <Box style={{ layout: { flexGrow: 1, minWidth: px(130) } }}>
            <TextInput
              ariaLabel="New event filter value"
              placeholder="Value"
              value={newVal}
              onChange={setNewVal}
              style={inputStyle}
            />
          </Box>
          <HausButton
            variant="secondary"
            size="sm"
            disabled={!newKey.trim()}
            onPress={() => {
              const cleanKey = newKey.trim();
              if (!cleanKey) return;
              patchData(cleanKey, coerceScalarValue(newVal));
              setNewKey('');
              setNewVal('');
            }}
          >
            <UiIcon name="plus" size={13} />
            <Text size={11.5}>Add filter</Text>
          </HausButton>
        </Row>
      </Stack>
    </Stack>
  );
}
