/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { corners, insets, pct, px, rgba } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import {
  Box,
  HausButton,
  HausSwitch,
  Pressable,
  Row,
  SelectInput,
  Stack,
  Text,
} from '../../primitives/index.js';
import type { SecondaryEntityControlItem } from '../devices/device-details.js';
import { UiIcon } from '../icon.js';

const surfaceCardStyle = {
  layout: { padding: insets(14) },
  material: new SolidMaterial(rgba(255, 255, 255, 0.06)),
  border: { width: 1, color: rgba(255, 255, 255, 0.1) },
  corners: corners(16),
} as const;

const inkText = { typography: { color: rgba(255, 255, 255, 0.94) } } as const;
const mutedText = { typography: { color: rgba(255, 255, 255, 0.64) } } as const;

export function CameraSettingsPanel({
  settingsLoaded,
  recordingEnabled,
  activityAssistEnabled,
  activityAssistMode,
  activityAssistSupported,
  indicatorLight,
  nightVision,
  homekitEnabled,
  homekitStatusText,
  homekitPaired,
  pairingCode,
  pending,
  error,
  hiddenHome,
  hiddenApp,
  relatedControls,
  metadata,
  onSetRecordingEnabled,
  onSetActivityAssist,
  onToggleIndicator,
  onToggleNightVision,
  onToggleHomeKit,
  onPairHomeKit,
  onResetHomeKit,
  onToggleHomeVisibility,
  onToggleAppVisibility,
  onToggleRelated,
  onPressRelated,
  onSelectRelated,
}: {
  readonly settingsLoaded: boolean;
  readonly recordingEnabled: boolean;
  readonly activityAssistEnabled: boolean;
  readonly activityAssistMode: 'objects' | 'motion';
  readonly activityAssistSupported: boolean;
  readonly indicatorLight?: { readonly available: boolean; readonly value: boolean };
  readonly nightVision?: { readonly available: boolean; readonly value: boolean };
  readonly homekitEnabled: boolean;
  readonly homekitStatusText?: string;
  readonly homekitPaired?: boolean;
  readonly pairingCode?: string;
  readonly pending: boolean;
  readonly error?: string;
  readonly hiddenHome: boolean;
  readonly hiddenApp: boolean;
  readonly relatedControls: readonly SecondaryEntityControlItem[];
  readonly metadata: readonly { readonly label: string; readonly value: string; readonly mono?: boolean }[];
  readonly onSetRecordingEnabled: (enabled: boolean) => void;
  readonly onSetActivityAssist: (enabled: boolean, mode: 'objects' | 'motion') => void;
  readonly onToggleIndicator?: (value: boolean) => void;
  readonly onToggleNightVision?: (value: boolean) => void;
  readonly onToggleHomeKit?: (enabled: boolean) => void;
  readonly onPairHomeKit?: () => void;
  readonly onResetHomeKit?: () => void;
  readonly onToggleHomeVisibility: () => void;
  readonly onToggleAppVisibility: () => void;
  readonly onToggleRelated: (id: string) => void;
  readonly onPressRelated: (id: string) => void;
  readonly onSelectRelated: (id: string, option: string) => void;
}) {
  const pillChoice = (id: string, label: string, selected: boolean, onActivate: () => void) => (
    <Pressable
      key={id}
      id={id}
      disabled={pending || !settingsLoaded}
      ariaPressed={selected}
      onActivate={onActivate}
      style={{
        layout: { flexGrow: 1, padding: insets(8, 10), alignItems: 'center', justifyContent: 'center' },
        corners: corners(11),
        material: new SolidMaterial(
          selected ? rgba(255, 255, 255, 0.94) : rgba(255, 255, 255, 0.08),
        ),
        border: { width: 1, color: rgba(255, 255, 255, selected ? 0.94 : 0.12) },
        opacity: pending || !settingsLoaded ? 0.5 : 1,
      }}
    >
      <Text
        size={11.5}
        weight={600}
        style={{
          pointerEvents: 'none',
          typography: {
            size: 11.5,
            weight: 600,
            color: selected ? rgba(18, 18, 20, 1) : rgba(255, 255, 255, 0.92),
          },
        }}
      >
        {label}
      </Text>
    </Pressable>
  );

  const drawerButton = (id: string, label: string, icon: 'eye' | 'eye-off' | undefined, onActivate: () => void) => (
    <Pressable
      id={id}
      onActivate={onActivate}
      style={{
        layout: {
          display: 'flex',
          direction: 'row',
          alignItems: 'center',
          gap: px(8),
          width: pct(100),
          padding: insets(8, 12),
        },
        corners: corners(11),
        material: new SolidMaterial(rgba(255, 255, 255, 0.08)),
        border: { width: 1, color: rgba(255, 255, 255, 0.12) },
        states: { hover: { material: new SolidMaterial(rgba(255, 255, 255, 0.14)) } },
      }}
    >
      <Row align="center" gapPx={8} style={{ pointerEvents: 'none' }}>
        {icon && <UiIcon name={icon} size={14} color="rgba(255, 255, 255, 0.85)" />}
        <Text size={11.5} weight={500} style={inkText}>
          {label}
        </Text>
      </Row>
    </Pressable>
  );

  return (
    <Stack gapPx={14} style={{ layout: { width: pct(100) } }}>
      <Text size={16} weight={600} style={inkText}>
        Camera settings
      </Text>

      {error && (
        <Text tone="critical" size={12}>
          {error}
        </Text>
      )}

      <Stack gapPx={10} style={surfaceCardStyle}>
        <Text size={13} weight={600} style={inkText}>
          Viewing & recording
        </Text>
        <Row gapPx={8} style={{ layout: { width: pct(100) } }}>
          {pillChoice('camera-policy-stream', 'Stream only', !recordingEnabled, () =>
            onSetRecordingEnabled(false),
          )}
          {pillChoice('camera-policy-record', 'Stream & record', recordingEnabled, () =>
            onSetRecordingEnabled(true),
          )}
        </Row>
        <Text size={11} style={mutedText}>
          {!settingsLoaded
            ? 'Connect Haus Hub to configure camera recording settings.'
            : recordingEnabled
              ? 'Linked activity sensors save clips locally with pre-event footage.'
              : 'Watch live video without saving new clips. Existing recordings stay available.'}
        </Text>

        <Row justify="between" align="center" style={{ layout: { width: pct(100) } }}>
          <Text size={12.5} weight={500} style={inkText}>
            Activity assist
          </Text>
          <HausSwitch
            id="camera-activity-assist"
            aria-label="Activity assist"
            checked={activityAssistEnabled}
            disabled={pending || !settingsLoaded || !activityAssistSupported}
            onChange={(enabled) => onSetActivityAssist(enabled, activityAssistMode)}
          />
        </Row>
        {activityAssistEnabled && activityAssistSupported && (
          <Row gapPx={6} style={{ layout: { width: pct(100) } }}>
            {pillChoice('camera-activity-objects', 'Objects', activityAssistMode === 'objects', () =>
              onSetActivityAssist(true, 'objects'),
            )}
            {pillChoice('camera-activity-motion', 'Motion', activityAssistMode === 'motion', () =>
              onSetActivityAssist(true, 'motion'),
            )}
          </Row>
        )}
      </Stack>

      {(indicatorLight || nightVision) && (
        <Stack gapPx={10} style={surfaceCardStyle}>
          <Text size={13} weight={600} style={inkText}>
            Camera lights
          </Text>
          {indicatorLight && onToggleIndicator && (
            <Row justify="between" align="center" style={{ layout: { width: pct(100) } }}>
              <Text size={12.5} style={inkText}>
                Status light
              </Text>
              <HausSwitch
                id="camera-indicator-switch"
                aria-label="Status light"
                checked={indicatorLight.value}
                disabled={pending || !indicatorLight.available}
                onChange={onToggleIndicator}
              />
            </Row>
          )}
          {nightVision && onToggleNightVision && (
            <Row justify="between" align="center" style={{ layout: { width: pct(100) } }}>
              <Text size={12.5} style={inkText}>
                Automatic night vision
              </Text>
              <HausSwitch
                id="camera-night-vision-switch"
                aria-label="Automatic night vision"
                checked={nightVision.value}
                disabled={pending || !nightVision.available}
                onChange={onToggleNightVision}
              />
            </Row>
          )}
        </Stack>
      )}

      {onToggleHomeKit && (
        <Stack gapPx={10} style={surfaceCardStyle}>
          <Row justify="between" align="center" style={{ layout: { width: pct(100) } }}>
            <Text size={12.5} weight={600} style={inkText}>
              Apple Home
            </Text>
            <Row align="center" gapPx={8}>
              {homekitStatusText && (
                <Text size={11} style={mutedText}>
                  {homekitStatusText}
                </Text>
              )}
              <HausSwitch
                id="camera-homekit-toggle"
                aria-label="Apple Home"
                checked={homekitEnabled}
                disabled={pending || !settingsLoaded}
                onChange={onToggleHomeKit}
              />
            </Row>
          </Row>
          {homekitEnabled && !homekitPaired && onPairHomeKit && (
            drawerButton('camera-homekit-pair', 'Pair with Apple Home', undefined, onPairHomeKit)
          )}
          {homekitEnabled && homekitPaired && onResetHomeKit && (
            drawerButton('camera-homekit-reset', 'Reset pairing', undefined, onResetHomeKit)
          )}
          {pairingCode && (
            <Row gapPx={8} align="center">
              <Text size={11.5} style={mutedText}>
                Setup code:
              </Text>
              <Text size={13} weight={600} mono style={inkText}>
                {pairingCode}
              </Text>
            </Row>
          )}
        </Stack>
      )}

      {relatedControls.length > 0 && (
        <Stack gapPx={8} style={surfaceCardStyle}>
          <Text size={13} weight={600} style={inkText}>
            On this device
          </Text>
          {relatedControls.map((item) => (
            <Row
              key={item.id}
              justify="between"
              align="center"
              gapPx={10}
              style={{ layout: { width: pct(100), padding: insets(4, 0) } }}
            >
              <Text size={12} style={inkText}>
                {item.label}
              </Text>
              {item.kind === 'switch' ? (
                <HausSwitch
                  checked={Boolean(item.checked)}
                  disabled={pending}
                  onChange={() => onToggleRelated(item.id)}
                />
              ) : item.kind === 'button' ? (
                <HausButton
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  onPress={() => onPressRelated(item.id)}
                >
                  Run
                </HausButton>
              ) : item.kind === 'select' && item.options?.length ? (
                <Box style={{ layout: { minWidth: px(120) } }}>
                  <SelectInput
                    value={item.valueText}
                    disabled={pending}
                    options={item.options.map((opt) => ({ value: opt, label: opt }))}
                    onChange={(next) => onSelectRelated(item.id, next)}
                  />
                </Box>
              ) : (
                <Text size={12} style={mutedText}>
                  {item.valueText}
                </Text>
              )}
            </Row>
          ))}
        </Stack>
      )}

      <Stack gapPx={8} style={surfaceCardStyle}>
        <Text size={13} weight={600} style={inkText}>
          Visibility
        </Text>
        {drawerButton(
          'camera-toggle-home',
          hiddenHome ? 'Show on Home view' : 'Hide from Home view',
          hiddenHome ? 'eye' : 'eye-off',
          onToggleHomeVisibility,
        )}
        {drawerButton(
          'camera-toggle-app',
          hiddenApp ? 'Restore to Haus' : 'Hide from Haus',
          hiddenApp ? 'eye' : 'eye-off',
          onToggleAppVisibility,
        )}
      </Stack>

      <Stack gapPx={6} style={surfaceCardStyle}>
        <Text size={13} weight={600} style={inkText}>
          About this camera
        </Text>
        {metadata.map((row) => (
          <Row
            key={row.label}
            justify="between"
            align="center"
            gapPx={10}
            style={{ layout: { width: pct(100) } }}
          >
            <Text size={11.5} style={mutedText}>
              {row.label}
            </Text>
            <Text size={11.5} mono={row.mono} weight={500} style={inkText}>
              {row.value}
            </Text>
          </Row>
        ))}
      </Stack>
    </Stack>
  );
}
