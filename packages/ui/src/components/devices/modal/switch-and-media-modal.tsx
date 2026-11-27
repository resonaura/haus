/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useEffect, useState } from 'react';
import { colorToken, corners, insets, pct, px } from '../../../ir/geometry.js';
import { SolidMaterial } from '../../../ir/materials.js';
import {
  Grid,
  HausButton,
  HausSlider,
  HausSwitch,
  Pressable,
  Row,
  Stack,
  Text,
} from '../../../primitives/index.js';
import { UiIcon } from '../../icon.js';
import type { UiIconName } from '../../icons.js';
import { MediaRemotePanel } from '../specialty-controls.js';
import {
  DeviceModalOrbStage,
  DeviceModalSurfaceCard,
  DevicePresetPills,
} from './surfaces.js';

export interface DeviceMetricPill {
  readonly label: string;
  readonly value: string;
}

export function SwitchActionModalPanel({
  idPrefix,
  kind,
  active,
  stateLabel,
  caption,
  iconName = 'power',
  metrics = [],
  disabled,
  onActivate,
}: {
  readonly idPrefix: string;
  readonly kind: 'toggle' | 'press' | 'run';
  readonly active: boolean;
  readonly stateLabel: string;
  readonly caption?: string;
  readonly iconName?: UiIconName;
  readonly metrics?: readonly DeviceMetricPill[];
  readonly disabled: boolean;
  readonly onActivate?: () => void;
}) {
  return (
    <Stack gapPx={12} style={{ layout: { width: pct(100) } }}>
      <DeviceModalOrbStage
        id={kind === 'toggle' ? `${idPrefix}-orb` : `${idPrefix}-press`}
        iconName={iconName}
        stateLabel={stateLabel}
        caption={
          caption ??
          (kind === 'toggle'
            ? 'Tap the power orb or switch below'
            : kind === 'run'
              ? 'Tap to trigger immediately'
              : 'Tap to send button press')
        }
        active={active}
        disabled={disabled || !onActivate}
        ariaLabel={stateLabel}
        onPress={onActivate}
        footer={
          onActivate ? (
            kind === 'toggle' ? (
              <Row
                justify="between"
                align="center"
                style={{
                  layout: { width: pct(100), padding: insets(10, 14) },
                  material: new SolidMaterial(colorToken('surface')),
                  border: { width: 1, color: colorToken('borderSubtle') },
                  corners: corners(14),
                }}
              >
                <Text size={13} weight={500}>
                  Power state
                </Text>
                <HausSwitch
                  id={`${idPrefix}-toggle`}
                  checked={active}
                  disabled={disabled}
                  onChange={() => onActivate()}
                />
              </Row>
            ) : (
              <HausButton
                id={`${idPrefix}-action`}
                size="md"
                variant="secondary"
                fullWidth
                disabled={disabled}
                onPress={onActivate}
              >
                {kind === 'run' ? 'Run now' : 'Press button'}
              </HausButton>
            )
          ) : undefined
        }
      />

      {metrics.length > 0 && (
        <Grid columns={2} gapPx={8}>
          {metrics.map((metric) => (
            <Stack
              key={metric.label}
              gapPx={2}
              style={{
                layout: { padding: insets(10, 12) },
                material: new SolidMaterial(colorToken('surfaceSecondary')),
                border: { width: 1, color: colorToken('borderSubtle') },
                corners: corners(14),
              }}
            >
              <Text size={10.5} tone="muted">
                {metric.label}
              </Text>
              <Text size={13.5} weight={600} mono>
                {metric.value}
              </Text>
            </Stack>
          ))}
        </Grid>
      )}
    </Stack>
  );
}

export function MediaModalPanel({
  idPrefix,
  title,
  subtitle,
  appName,
  playing,
  poweredOn,
  volumePct,
  canPrevious,
  canPlayPause,
  canNext,
  canPower,
  canVolume,
  canRemote,
  disabled,
  onPrevious,
  onPlayPause,
  onNext,
  onPower,
  onVolume,
  onRemoteCommand,
}: {
  readonly idPrefix: string;
  readonly title: string;
  readonly subtitle: string;
  readonly appName?: string;
  readonly playing: boolean;
  readonly poweredOn: boolean;
  readonly volumePct: number;
  readonly canPrevious: boolean;
  readonly canPlayPause: boolean;
  readonly canNext: boolean;
  readonly canPower: boolean;
  readonly canVolume: boolean;
  readonly canRemote: boolean;
  readonly disabled: boolean;
  readonly onPrevious?: () => void;
  readonly onPlayPause?: () => void;
  readonly onNext?: () => void;
  readonly onPower?: () => void;
  readonly onVolume?: (pctValue: number) => void;
  readonly onRemoteCommand?: (command: string) => void;
}) {
  const [draftVol, setDraftVol] = useState<number>();
  useEffect(() => {
    setDraftVol(undefined);
  }, [volumePct]);
  const shownVol = draftVol ?? volumePct;

  const circleBtnStyle = {
    layout: { width: px(40), height: px(40), alignItems: 'center' as const, justifyContent: 'center' as const },
    corners: corners(999, 'round'),
    material: new SolidMaterial(colorToken('controlFill')),
    border: { width: 1, color: colorToken('borderSubtle') },
    cursor: disabled ? ('not-allowed' as const) : ('pointer' as const),
    states: {
      hover: { material: new SolidMaterial(colorToken('controlFillHover')) },
      pressed: { transform: { scale: 0.94 } },
    },
  };

  return (
    <Stack gapPx={12} style={{ layout: { width: pct(100) } }}>
      <DeviceModalSurfaceCard
        title={appName || 'Now playing'}
        badge={!poweredOn ? 'Standby' : playing ? 'Playing' : 'Paused'}
      >
        <Stack gapPx={3} style={{ layout: { width: pct(100) } }}>
          <Text size={16} weight={600} style={{ typography: { maxLines: 1, truncate: true } }}>
            {title}
          </Text>
          <Text size={12.5} tone="muted" style={{ typography: { maxLines: 1, truncate: true } }}>
            {subtitle}
          </Text>
        </Stack>

        <Row
          justify="center"
          align="center"
          gapPx={12}
          style={{ layout: { width: pct(100), padding: insets(6, 0, 2, 0) } }}
        >
          {canPrevious && onPrevious && (
            <Pressable
              id={`${idPrefix}-previous`}
              ariaLabel="Previous track"
              disabled={disabled}
              onActivate={onPrevious}
              style={circleBtnStyle}
            >
              <UiIcon name="skip-back" size={17} />
            </Pressable>
          )}
          {canPlayPause && onPlayPause && (
            <Pressable
              id={`${idPrefix}-play-pause`}
              ariaLabel={playing ? 'Pause' : 'Play'}
              disabled={disabled}
              onActivate={onPlayPause}
              style={{
                layout: { width: px(52), height: px(52), alignItems: 'center', justifyContent: 'center' },
                corners: corners(999, 'round'),
                material: new SolidMaterial(colorToken('accent')),
                cursor: disabled ? 'not-allowed' : 'pointer',
                states: {
                  hover: { opacity: 0.92 },
                  pressed: { transform: { scale: 0.95 } },
                },
              }}
            >
              <Text style={{ typography: { color: colorToken('accentForeground') } }}>
                <UiIcon name={playing ? 'pause' : 'play'} size={20} />
              </Text>
            </Pressable>
          )}
          {canNext && onNext && (
            <Pressable
              id={`${idPrefix}-next`}
              ariaLabel="Next track"
              disabled={disabled}
              onActivate={onNext}
              style={circleBtnStyle}
            >
              <UiIcon name="skip-forward" size={17} />
            </Pressable>
          )}
          {canPower && onPower && (
            <Pressable
              id={`${idPrefix}-power`}
              ariaLabel={poweredOn ? 'Turn off' : 'Turn on'}
              disabled={disabled}
              onActivate={onPower}
              style={circleBtnStyle}
            >
              <UiIcon name="power" size={16} />
            </Pressable>
          )}
        </Row>
      </DeviceModalSurfaceCard>

      {canVolume && onVolume && (
        <DeviceModalSurfaceCard title="Audio">
          <HausSlider
            id={`${idPrefix}-volume`}
            label="Volume"
            valueLabel={`${shownVol}%`}
            value={shownVol}
            min={0}
            max={100}
            size="lg"
            disabled={disabled}
            onChange={setDraftVol}
            onChangeEnd={(next) => {
              setDraftVol(undefined);
              if (next !== volumePct) onVolume(next);
            }}
          />
          <DevicePresetPills
            idPrefix={`${idPrefix}-vol`}
            disabled={disabled}
            items={[
              { label: 'Mute', value: 0, active: shownVol === 0 },
              { label: '25%', value: 25, active: Math.abs(shownVol - 25) <= 4 },
              { label: '50%', value: 50, active: Math.abs(shownVol - 50) <= 4 },
              { label: '75%', value: 75, active: Math.abs(shownVol - 75) <= 4 },
            ]}
            onSelect={onVolume}
          />
        </DeviceModalSurfaceCard>
      )}

      {canRemote && onRemoteCommand && (
        <MediaRemotePanel disabled={disabled} onCommand={onRemoteCommand} />
      )}
    </Stack>
  );
}
