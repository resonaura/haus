/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import {
  statePresetsForEntity,
  type AutomationConditionBlock,
} from '@haus/core/transport';
import { colorToken, corners, insets, pct, px } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import {
  Box,
  HausButton,
  HausSelect,
  Pressable,
  Row,
  Stack,
  Text,
  TextInput,
  useHausUi,
} from '../../primitives/index.js';
import { GlassRim } from '../../primitives/glass-rim.js';
import { UiIcon } from '../icon.js';
import type { AutomationEntityChoice } from './flow-blocks.js';
import { automationPillStyle, getAutomationNeutralTokens } from './theme.js';

export function AutomationIfSection({
  conditions,
  logic,
  entityOptions,
  onLogicChange,
  onAddCondition,
  onUpdateCondition,
  onRemoveCondition,
}: {
  readonly conditions: readonly AutomationConditionBlock[];
  readonly logic: 'all' | 'any';
  readonly entityOptions: readonly AutomationEntityChoice[];
  readonly onLogicChange: (logic: 'all' | 'any') => void;
  readonly onAddCondition: () => void;
  readonly onUpdateCondition: (index: number, next: AutomationConditionBlock) => void;
  readonly onRemoveCondition: (index: number) => void;
}) {
  const { theme } = useHausUi();
  const neutral = getAutomationNeutralTokens(theme.mode);

  if (conditions.length === 0) {
    return (
      <Row align="center" gapPx={8} style={{ layout: { padding: insets(0, 0, 0, 8) } }}>
        <HausButton
          id="automation-add-conditions"
          variant="ghost"
          size="sm"
          onPress={onAddCondition}
        >
          <UiIcon name="plus" size={13} />
          <Text size={11.5} tone="muted">
            Add "If" condition (optional)
          </Text>
        </HausButton>
      </Row>
    );
  }

  return (
    <Stack
      gapPx={10}
      dataAttrs={{ 'data-haus-glass-rim': 'managed' }}
      style={{
        layout: { width: pct(100), padding: insets(14, 16), position: 'relative', overflow: 'hidden' },
        material: new SolidMaterial(colorToken('surfaceSecondary')),
        border: { width: 1, color: colorToken('border') },
        corners: corners(22, 'superellipse', 1.4),
      }}
    >
      <Row align="center" justify="between" gapPx={8} wrap>
        <Row align="center" gapPx={8}>
          <Box
            style={{
              layout: {
                width: px(28),
                height: px(28),
                alignItems: 'center',
                justifyContent: 'center',
              },
              material: neutral.badgeSurface,
              corners: corners(999, 'round'),
            }}
          >
            <UiIcon name="shield-check" size={14} color={neutral.iconCss} />
          </Box>
          <Text size={11} weight={700}>
            ONLY IF
          </Text>
          {conditions.length > 1 && (
            <Row gapPx={4}>
              {(['all', 'any'] as const).map((mode) => (
                <Pressable
                  key={mode}
                  ariaPressed={logic === mode}
                  onActivate={() => onLogicChange(mode)}
                  style={{
                    layout: { padding: insets(3, 8) },
                    material: new SolidMaterial(
                      logic === mode ? colorToken('surfaceActive') : colorToken('surface'),
                    ),
                    border: {
                      width: 1,
                      color: logic === mode ? colorToken('accent') : colorToken('border'),
                    },
                    corners: corners(999),
                  }}
                >
                  <Text size={10.5} weight={600}>
                    {mode === 'all' ? 'All match' : 'Any matches'}
                  </Text>
                </Pressable>
              ))}
            </Row>
          )}
        </Row>
        <HausButton
          id="automation-add-conditions"
          variant="ghost"
          size="sm"
          onPress={onAddCondition}
        >
          <UiIcon name="plus" size={13} />
          <Text size={11.5}>Add condition</Text>
        </HausButton>
      </Row>

      {conditions.map((cond, index) => (
        <Stack
          key={cond.id}
          gapPx={8}
          style={{
            layout: { width: pct(100), padding: insets(10, 12) },
            material: new SolidMaterial(colorToken('surface')),
            border: { width: 1, color: colorToken('border') },
            corners: corners(12),
          }}
        >
          <Row align="center" justify="between" gapPx={8} wrap>
            <Row gapPx={6} wrap>
              {(
                [
                  ['device', 'Accessory is…'],
                  ['sun', 'Daylight / Night'],
                  ['time_window', 'Between hours'],
                ] as const
              ).map(([kind, label]) => {
                const active = cond.kind === kind;
                return (
                  <Pressable
                    key={kind}
                    ariaPressed={active}
                    onActivate={() => {
                      if (kind === 'sun') {
                        onUpdateCondition(index, {
                          id: cond.id,
                          kind: 'sun',
                          after: 'sunset',
                          before: 'sunrise',
                        });
                      } else if (kind === 'time_window') {
                        onUpdateCondition(index, {
                          id: cond.id,
                          kind: 'time_window',
                          after: '22:00',
                          before: '06:30',
                        });
                      } else {
                        onUpdateCondition(index, {
                          id: cond.id,
                          kind: 'device',
                          entityId: entityOptions[0]?.value ?? '',
                          state: 'on',
                        });
                      }
                    }}
                    style={automationPillStyle({
                      active,
                      padding: insets(4, 9),
                      restToken: 'surfaceSecondary',
                    })}
                  >
                    <Text size={11} weight={active ? 600 : 500}>
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </Row>
            <HausButton variant="ghost" size="sm" onPress={() => onRemoveCondition(index)}>
              <UiIcon name="x" size={13} />
            </HausButton>
          </Row>

          {cond.kind === 'device' && (
            <Stack gapPx={8}>
              <HausSelect
                aria-label="Condition accessory"
                value={cond.entityId}
                options={entityOptions}
                onChange={(entityId) => onUpdateCondition(index, { ...cond, entityId })}
              />
              <Row gapPx={6} wrap>
                {statePresetsForEntity(
                  cond.entityId,
                  entityOptions.find((o) => o.value === cond.entityId)?.deviceClass,
                ).map((preset) => {
                  const active = cond.state === preset.value;
                  return (
                    <Pressable
                      key={preset.value}
                      ariaPressed={active}
                      onActivate={() =>
                        onUpdateCondition(index, { ...cond, state: preset.value })
                      }
                      style={automationPillStyle({
                        active,
                        padding: insets(5, 10),
                        restToken: 'surfaceSecondary',
                      })}
                    >
                      <Text size={11.5} weight={active ? 600 : 500}>
                        {preset.ifLabel}
                      </Text>
                    </Pressable>
                  );
                })}
              </Row>
            </Stack>
          )}

          {cond.kind === 'sun' && (
            <Row gapPx={8} wrap>
              {(
                [
                  ['night', 'At night (after Sunset)', 'sunset', 'sunrise'],
                  ['day', 'During daylight (after Sunrise)', 'sunrise', 'sunset'],
                ] as const
              ).map(([key, label, after, before]) => {
                const active = cond.after === after;
                return (
                  <Pressable
                    key={key}
                    ariaPressed={active}
                    onActivate={() =>
                      onUpdateCondition(index, { ...cond, after, before })
                    }
                    style={{
                      layout: { padding: insets(6, 12) },
                      material: new SolidMaterial(
                        active ? colorToken('surfaceActive') : colorToken('surfaceSecondary'),
                      ),
                      border: {
                        width: 1,
                        color: active ? colorToken('accent') : colorToken('border'),
                      },
                      corners: corners(999),
                    }}
                  >
                    <Text size={11.5} weight={active ? 600 : 500}>
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </Row>
          )}

          {cond.kind === 'time_window' && (
            <Row align="center" gapPx={8} wrap>
              <Text size={11.5} tone="muted">
                After
              </Text>
              <Box style={{ layout: { width: px(96) } }}>
                <TextInput
                  ariaLabel="After time"
                  placeholder="22:00"
                  value={cond.after ?? ''}
                  onChange={(after) => onUpdateCondition(index, { ...cond, after })}
                  style={{
                    layout: { width: pct(100), minHeight: px(32), padding: insets(4, 8) },
                    material: new SolidMaterial(colorToken('surfaceSecondary')),
                    border: { width: 1, color: colorToken('border') },
                    corners: corners(8),
                    typography: { size: 12.5, color: colorToken('textPrimary') },
                  }}
                />
              </Box>
              <Text size={11.5} tone="muted">
                until
              </Text>
              <Box style={{ layout: { width: px(96) } }}>
                <TextInput
                  ariaLabel="Before time"
                  placeholder="06:30"
                  value={cond.before ?? ''}
                  onChange={(before) => onUpdateCondition(index, { ...cond, before })}
                  style={{
                    layout: { width: pct(100), minHeight: px(32), padding: insets(4, 8) },
                    material: new SolidMaterial(colorToken('surfaceSecondary')),
                    border: { width: 1, color: colorToken('border') },
                    corners: corners(8),
                    typography: { size: 12.5, color: colorToken('textPrimary') },
                  }}
                />
              </Box>
            </Row>
          )}

          {(cond.kind === 'threshold' || cond.kind === 'raw') && (
            <Text size={11.5} tone="muted">
              {cond.kind === 'raw'
                ? `Custom condition (${cond.summary})`
                : `Sensor threshold (${cond.entityId})`}
            </Text>
          )}
        </Stack>
      ))}
      <GlassRim preset="card" variant="card" opacity={0.46} />
    </Stack>
  );
}
