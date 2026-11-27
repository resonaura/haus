/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import {
  DEFAULT_HUE_BUTTON_EVENT_TYPES,
  gesturesForEventTypes,
  type AutomationTriggerBlock,
} from '@haus/core/transport';
import { colorToken, corners, insets, pct, px } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import {
  HausSelect,
  Pressable,
  Row,
  Stack,
  Text,
  TextInput,
} from '../../primitives/index.js';
import { UiIcon } from '../icon.js';
import { automationPillStyle } from './theme.js';

export { WhenBusEventControls } from './when-bus-event.js';

export interface AutomationButtonEndpointChoice {
  readonly entityId: string;
  readonly label: string;
  readonly shortLabel: string;
  readonly kind: 'button' | 'dial';
  readonly eventTypes: readonly string[];
  readonly subtype?: string;
}

export interface AutomationButtonControllerChoice {
  readonly controllerId: string;
  readonly deviceId?: string;
  readonly domain?: string;
  readonly name: string;
  readonly roomName: string;
  readonly model?: string;
  readonly isHue: boolean;
  readonly buttons: readonly AutomationButtonEndpointChoice[];
}

const HUE_MANUAL_BUTTON_PRESETS: readonly {
  readonly suffix: string;
  readonly label: string;
  readonly subtype: string;
  readonly dial?: boolean;
}[] = [
  { suffix: 'button_1', label: 'Button 1 · On', subtype: '1' },
  { suffix: 'button_2', label: 'Button 2 · Up', subtype: '2' },
  { suffix: 'button_3', label: 'Button 3 · Down', subtype: '3' },
  { suffix: 'button_4', label: 'Button 4 · Off', subtype: '4' },
  { suffix: 'rotary', label: 'Tap Dial · Rotate', subtype: 'clock_wise', dial: true },
];

const MANUAL_GESTURE_TYPES: readonly string[] = [
  ...DEFAULT_HUE_BUTTON_EVENT_TYPES,
  'double_short_release',
  'single_press',
  'rotate_right',
  'rotate_left',
];

const inputStyle = {
  layout: { width: pct(100), minHeight: px(34), padding: insets(6, 10) },
  material: new SolidMaterial(colorToken('surface')),
  border: { width: 1, color: colorToken('border') },
  corners: corners(10),
  typography: { size: 12.5, color: colorToken('textPrimary') },
} as const;

export function WhenButtonEventControls({
  trigger,
  buttonControllers,
  targetPlatform = 'hub',
  onChange,
}: {
  readonly trigger: Extract<AutomationTriggerBlock, { readonly kind: 'button_event' }>;
  readonly buttonControllers: readonly AutomationButtonControllerChoice[];
  readonly targetPlatform?: 'hub' | 'ha';
  readonly onChange: (next: AutomationTriggerBlock) => void;
}) {
  const activeController =
    buttonControllers.find((ctrl) =>
      ctrl.buttons.some((btn) => btn.entityId === trigger.entityId),
    ) ??
    buttonControllers.find(
      (ctrl) => trigger.haDeviceTrigger && ctrl.deviceId === trigger.haDeviceTrigger.deviceId,
    ) ??
    buttonControllers[0];

  const activeButton =
    activeController?.buttons.find((btn) => btn.entityId === trigger.entityId) ??
    activeController?.buttons.find(
      (btn) => trigger.haDeviceTrigger?.subtype && btn.subtype === trigger.haDeviceTrigger.subtype,
    ) ??
    activeController?.buttons[0];

  const supportedTypes = activeButton?.eventTypes.length
    ? activeButton.eventTypes
    : MANUAL_GESTURE_TYPES;
  const gestureOptions = gesturesForEventTypes(supportedTypes);

  const buildButtonTrigger = (
    ctrl: AutomationButtonControllerChoice | undefined,
    btn: AutomationButtonEndpointChoice,
    nextTypes: readonly string[],
  ): Extract<AutomationTriggerBlock, { readonly kind: 'button_event' }> => ({
    id: trigger.id,
    kind: 'button_event',
    entityId: btn.entityId,
    eventTypes: nextTypes.length > 0 ? nextTypes : [btn.eventTypes[0] ?? 'short_release'],
    ...(targetPlatform === 'ha' && ctrl?.isHue && ctrl.deviceId
      ? {
          haDeviceTrigger: {
            domain: ctrl.domain ?? 'hue',
            deviceId: ctrl.deviceId,
            ...(btn.subtype ? { subtype: btn.subtype } : {}),
          },
        }
      : {}),
  });

  const toggleGesture = (gestureValue: string) => {
    const exists = trigger.eventTypes.includes(gestureValue);
    const next = exists
      ? trigger.eventTypes.filter((t) => t !== gestureValue)
      : [...trigger.eventTypes, gestureValue];
    onChange({
      ...trigger,
      eventTypes: next.length > 0 ? next : [gestureValue],
    });
  };

  return (
    <Stack gapPx={10}>
      {buttonControllers.length > 0 && activeController ? (
        <>
          <HausSelect
            aria-label="Switch or button controller"
            value={activeController.controllerId}
            options={buttonControllers.map((ctrl) => ({
              value: ctrl.controllerId,
              label: `${ctrl.roomName} · ${ctrl.name}${ctrl.isHue ? ' (Hue)' : ''}`,
            }))}
            onChange={(controllerId) => {
              const nextCtrl = buttonControllers.find((c) => c.controllerId === controllerId);
              const firstBtn = nextCtrl?.buttons[0];
              if (nextCtrl && firstBtn) {
                const defaultGesture = firstBtn.eventTypes.includes('short_release')
                  ? 'short_release'
                  : (firstBtn.eventTypes[0] ?? 'initial_press');
                onChange(buildButtonTrigger(nextCtrl, firstBtn, [defaultGesture]));
              }
            }}
          />

          {activeController.buttons.length > 1 && (
            <Stack gapPx={5}>
              <Text size={11} tone="muted">
                Button or dial
              </Text>
              <Row gapPx={6} wrap>
                {activeController.buttons.map((btn) => {
                  const selected = activeButton?.entityId === btn.entityId;
                  return (
                    <Pressable
                      key={btn.entityId}
                      ariaPressed={selected}
                      onActivate={() => {
                        const preserved = trigger.eventTypes.filter((t) =>
                          btn.eventTypes.includes(t),
                        );
                        const fallback = btn.eventTypes.includes('short_release')
                          ? 'short_release'
                          : (btn.eventTypes[0] ?? 'initial_press');
                        onChange(
                          buildButtonTrigger(
                            activeController,
                            btn,
                            preserved.length > 0 ? preserved : [fallback],
                          ),
                        );
                      }}
                      style={{
                        ...automationPillStyle({
                          active: selected,
                          padding: insets(6, 11),
                          cornerSpec: corners(10),
                        }),
                        layout: {
                          padding: insets(6, 11),
                          direction: 'row',
                          alignItems: 'center',
                          gap: px(6),
                        },
                      }}
                    >
                      <UiIcon
                        name={btn.kind === 'dial' ? 'rotate-cw' : 'toggle-left'}
                        size={12.5}
                      />
                      <Text size={11.5} weight={selected ? 600 : 500}>
                        {btn.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </Row>
            </Stack>
          )}
        </>
      ) : (
        <Stack gapPx={8}>
          <Text size={11} tone="muted">
            Switch button entity (Hue Dimmer, Tap Dial, Wall Switch, Matter, or Zigbee button)
          </Text>
          <TextInput
            ariaLabel="Button event entity ID"
            placeholder="event.hue_dimmer_switch_button_1"
            value={trigger.entityId}
            onChange={(entityId) => onChange({ ...trigger, entityId })}
            style={inputStyle}
          />
          <Row gapPx={6} wrap>
            {HUE_MANUAL_BUTTON_PRESETS.map((preset) => {
              const active = trigger.entityId.endsWith(preset.suffix);
              return (
                <Pressable
                  key={preset.suffix}
                  ariaPressed={active}
                  onActivate={() => {
                    const basePrefix =
                      trigger.entityId.startsWith('event.') &&
                      trigger.entityId.includes('_button_')
                        ? trigger.entityId.replace(/_button_\d+$/, '')
                        : 'event.hue_switch';
                    onChange({
                      ...trigger,
                      entityId: `${basePrefix}_${preset.suffix}`,
                      eventTypes: preset.dial ? ['rotate_right'] : ['short_release'],
                    });
                  }}
                  style={automationPillStyle({
                    active,
                    padding: insets(4, 9),
                    cornerSpec: corners(8),
                  })}
                >
                  <Text size={11} weight={active ? 600 : 500}>
                    {preset.label}
                  </Text>
                </Pressable>
              );
            })}
          </Row>
        </Stack>
      )}

      <Stack gapPx={5}>
        <Text size={11} tone="muted">
          Press or dial gesture
        </Text>
        <Row gapPx={6} wrap>
          {gestureOptions.map((gesture) => {
            const active = trigger.eventTypes.includes(gesture.value);
            return (
              <Pressable
                key={gesture.value}
                ariaPressed={active}
                onActivate={() => toggleGesture(gesture.value)}
                style={automationPillStyle({
                  active,
                  padding: insets(6, 12),
                })}
              >
                <Text size={11.5} weight={active ? 600 : 500}>
                  {gesture.label}
                </Text>
              </Pressable>
            );
          })}
        </Row>
      </Stack>
    </Stack>
  );
}
