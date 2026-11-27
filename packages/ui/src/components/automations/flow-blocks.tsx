/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import {
  statePresetsForEntity,
  type AutomationTriggerBlock,
} from '@haus/core/transport';
import { colorToken, corners, insets, pct, px, rgba } from '../../ir/geometry.js';
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
import type { UiIconName } from '../icons.js';
import { automationPillStyle, getAutomationNeutralTokens } from './theme.js';
import {
  WhenBusEventControls,
  WhenButtonEventControls,
  type AutomationButtonControllerChoice,
} from './when-event-controls.js';
import { WhenSunControls, WhenTimeControls } from './when-schedule.js';

export interface AutomationEntityChoice {
  readonly value: string;
  readonly label: string;
  readonly deviceClass?: string;
}

export function AutomationFlowSpine({ label }: { readonly label?: string }) {
  return (
    <Row align="center" gapPx={10} style={{ layout: { padding: insets(0, 0, 0, 22) } }}>
      <Box
        ariaHidden
        style={{
          layout: { width: px(2), height: px(label ? 24 : 18) },
          material: new SolidMaterial(rgba(148, 163, 184, 0.28)),
          corners: corners(999),
        }}
      />
      {label && (
        <Text size={10} weight={700} tone="muted">
          {label}
        </Text>
      )}
    </Row>
  );
}

type EditableTriggerKind =
  | 'button_event'
  | 'bus_event'
  | 'time'
  | 'sun'
  | 'device'
  | 'threshold';

const TRIGGER_KIND_PILLS: readonly {
  readonly kind: EditableTriggerKind;
  readonly label: string;
  readonly icon: UiIconName;
}[] = [
  { kind: 'button_event', label: 'Switch / Button', icon: 'toggle-left' },
  { kind: 'bus_event', label: 'Event', icon: 'zap' },
  { kind: 'time', label: 'Time of Day', icon: 'clock-3' },
  { kind: 'sun', label: 'Sunrise / Sunset', icon: 'sunset' },
  { kind: 'device', label: 'Accessory / Sensor', icon: 'radar' },
  { kind: 'threshold', label: 'Value Threshold', icon: 'thermometer' },
];

const compactFieldStyle = {
  layout: { width: pct(100), minHeight: px(34), padding: insets(6, 10) },
  material: new SolidMaterial(colorToken('surface')),
  border: { width: 1, color: colorToken('border') },
  corners: corners(10),
  typography: { size: 12.5, color: colorToken('textPrimary') },
} as const;

export function AutomationWhenCard({
  trigger,
  index,
  canRemove,
  entityOptions,
  buttonControllers = [],
  targetPlatform = 'hub',
  onChange,
  onRemove,
}: {
  readonly trigger: AutomationTriggerBlock;
  readonly index: number;
  readonly canRemove: boolean;
  readonly entityOptions: readonly AutomationEntityChoice[];
  readonly buttonControllers?: readonly AutomationButtonControllerChoice[];
  readonly targetPlatform?: 'hub' | 'ha';
  readonly onChange: (next: AutomationTriggerBlock) => void;
  readonly onRemove: () => void;
}) {
  const { theme } = useHausUi();
  const neutral = getAutomationNeutralTokens(theme.mode);

  const switchKind = (kind: EditableTriggerKind) => {
    const nonEventOptions = entityOptions.filter((e) => !e.value.startsWith('event.'));
    const firstEntity = nonEventOptions[0]?.value ?? entityOptions[0]?.value ?? '';
    if (kind === 'button_event') {
      const firstCtrl = buttonControllers[0];
      const firstBtn = firstCtrl?.buttons[0];
      const defaultGesture = firstBtn?.eventTypes.includes('short_release')
        ? 'short_release'
        : (firstBtn?.eventTypes[0] ?? 'short_release');
      onChange({
        id: trigger.id,
        kind: 'button_event',
        entityId: firstBtn?.entityId ?? 'event.hue_switch_button_1',
        eventTypes: [defaultGesture],
        ...(targetPlatform === 'ha' && firstCtrl?.isHue && firstCtrl.deviceId
          ? {
              haDeviceTrigger: {
                domain: firstCtrl.domain ?? 'hue',
                deviceId: firstCtrl.deviceId,
                ...(firstBtn?.subtype ? { subtype: firstBtn.subtype } : {}),
              },
            }
          : {}),
      });
    } else if (kind === 'bus_event') {
      onChange({ id: trigger.id, kind: 'bus_event', eventType: 'hue_event', eventData: {} });
    } else if (kind === 'time') {
      onChange({ id: trigger.id, kind: 'time', at: '07:30', weekdays: [] });
    } else if (kind === 'sun') {
      onChange({ id: trigger.id, kind: 'sun', event: 'sunset', offsetMinutes: 0 });
    } else if (kind === 'threshold') {
      onChange({ id: trigger.id, kind: 'threshold', entityId: firstEntity, above: 24 });
    } else {
      onChange({ id: trigger.id, kind: 'device', entityId: firstEntity, toState: 'on' });
    }
  };

  const selectedEntityMeta =
    trigger.kind === 'device'
      ? entityOptions.find((opt) => opt.value === trigger.entityId)
      : undefined;
  const presets =
    trigger.kind === 'device'
      ? statePresetsForEntity(trigger.entityId, selectedEntityMeta?.deviceClass)
      : [];

  const headerIcon: UiIconName =
    trigger.kind === 'button_event'
      ? 'toggle-left'
      : trigger.kind === 'bus_event'
        ? 'zap'
        : trigger.kind === 'sun'
          ? trigger.event === 'sunrise'
            ? 'sunrise'
            : 'sunset'
          : trigger.kind === 'time'
            ? 'clock-3'
            : trigger.kind === 'threshold'
              ? 'thermometer'
              : 'radar';

  return (
    <Stack
      gapPx={12}
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
            <UiIcon name={headerIcon} size={14} color={neutral.iconCss} />
          </Box>
          <Text size={11} weight={700}>
            {index === 0 ? 'WHEN' : 'OR WHEN'}
          </Text>
        </Row>

        {canRemove && (
          <HausButton variant="ghost" size="sm" onPress={onRemove}>
            <UiIcon name="x" size={13} />
          </HausButton>
        )}
      </Row>

      <Row gapPx={6} wrap>
        {TRIGGER_KIND_PILLS.map((pill) => {
          const active = trigger.kind === pill.kind;
          return (
            <Pressable
              key={pill.kind}
              id={`when-kind-${pill.kind}-${index}`}
              ariaPressed={active}
              onActivate={() => switchKind(pill.kind)}
              style={{
                ...automationPillStyle({
                  active,
                  padding: insets(5, 10),
                  restToken: 'surface',
                }),
                layout: {
                  padding: insets(5, 10),
                  direction: 'row',
                  alignItems: 'center',
                  gap: px(5),
                },
              }}
            >
              <UiIcon name={pill.icon} size={12} />
              <Text size={11.5} weight={active ? 600 : 500}>
                {pill.label}
              </Text>
            </Pressable>
          );
        })}
      </Row>

      {trigger.kind === 'button_event' && (
        <WhenButtonEventControls
          trigger={trigger}
          buttonControllers={buttonControllers}
          targetPlatform={targetPlatform}
          onChange={onChange}
        />
      )}

      {trigger.kind === 'bus_event' && (
        <WhenBusEventControls trigger={trigger} onChange={onChange} />
      )}

      {trigger.kind === 'time' && <WhenTimeControls trigger={trigger} onChange={onChange} />}

      {trigger.kind === 'sun' && <WhenSunControls trigger={trigger} onChange={onChange} />}

      {trigger.kind === 'device' && (
        <Stack gapPx={10}>
          <HausSelect
            aria-label="Trigger accessory or sensor"
            value={trigger.entityId}
            options={entityOptions.filter((o) => !o.value.startsWith('event.'))}
            onChange={(entityId) => {
              const meta = entityOptions.find((o) => o.value === entityId);
              const nextDefault =
                statePresetsForEntity(entityId, meta?.deviceClass)[0]?.value ?? 'on';
              onChange({ ...trigger, entityId, toState: nextDefault });
            }}
          />
          <Row gapPx={6} wrap>
            {presets.map((preset) => {
              const active = trigger.toState === preset.value;
              return (
                <Pressable
                  key={preset.value}
                  ariaPressed={active}
                  onActivate={() => onChange({ ...trigger, toState: preset.value })}
                  style={{
                    layout: { padding: insets(6, 12) },
                    material: new SolidMaterial(
                      active ? colorToken('surfaceActive') : colorToken('surface'),
                    ),
                    border: {
                      width: 1,
                      color: active ? colorToken('accent') : colorToken('border'),
                    },
                    corners: corners(999, 'round'),
                  }}
                >
                  <Text size={12} weight={active ? 600 : 500}>
                    {preset.whenLabel}
                  </Text>
                </Pressable>
              );
            })}
          </Row>
        </Stack>
      )}

      {trigger.kind === 'threshold' && (
        <Stack gapPx={10}>
          <HausSelect
            aria-label="Sensor entity"
            value={trigger.entityId}
            options={entityOptions.filter((o) => !o.value.startsWith('event.'))}
            onChange={(entityId) => onChange({ ...trigger, entityId })}
          />
          <Row gapPx={10} wrap>
            <Stack gapPx={4} style={{ layout: { flexGrow: 1, minWidth: px(120) } }}>
              <Text size={11} tone="muted">
                Rises above
              </Text>
              <TextInput
                ariaLabel="Rises above"
                placeholder="e.g. 24"
                value={trigger.above !== undefined ? String(trigger.above) : ''}
                onChange={(val) =>
                  onChange({ ...trigger, above: val.trim() === '' ? undefined : Number(val) })
                }
                style={compactFieldStyle}
              />
            </Stack>
            <Stack gapPx={4} style={{ layout: { flexGrow: 1, minWidth: px(120) } }}>
              <Text size={11} tone="muted">
                Drops below
              </Text>
              <TextInput
                ariaLabel="Drops below"
                placeholder="e.g. 18"
                value={trigger.below !== undefined ? String(trigger.below) : ''}
                onChange={(val) =>
                  onChange({ ...trigger, below: val.trim() === '' ? undefined : Number(val) })
                }
                style={compactFieldStyle}
              />
            </Stack>
          </Row>
        </Stack>
      )}

      {trigger.kind === 'raw' && (
        <Text size={12} tone="muted">
          {`Preserved custom trigger: ${trigger.summary} (edit in JSON tab if needed).`}
        </Text>
      )}
      <GlassRim preset="card" variant="card" opacity={0.46} />
    </Stack>
  );
}
