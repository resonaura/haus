/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useEffect, useState } from 'react';
import { colorToken, corners, insets, pct, px } from '../../../ir/geometry.js';
import { SolidMaterial } from '../../../ir/materials.js';
import {
  Box,
  Grid,
  HausSlider,
  Row,
  SelectInput,
  Stack,
  Text,
} from '../../../primitives/index.js';
import { UiIcon } from '../../icon.js';
import type { UiIconName } from '../../icons.js';
import { DeviceModalOrbStage, DeviceModalSurfaceCard } from './surfaces.js';
import type { DeviceMetricPill } from './switch-and-media-modal.js';

export interface PhysicalButtonChannelItem {
  readonly id: string;
  readonly label: string;
  readonly rotary?: boolean;
  readonly gestures?: readonly string[];
  readonly lastAction?: string;
  readonly linkedAutomations?: readonly string[];
}

export function ButtonRemoteModalPanel({
  buttons,
  linkedAutomations = [],
}: {
  readonly buttons: readonly PhysicalButtonChannelItem[];
  readonly linkedAutomations?: readonly string[];
}) {
  return (
    <Stack gapPx={12} style={{ layout: { width: pct(100) } }}>
      <DeviceModalSurfaceCard
        title="Physical buttons & events"
        badge={`${buttons.length} ${buttons.length === 1 ? 'control' : 'controls'}`}
      >
        <Text size={12} tone="muted">
          Press any physical button on the switch to trigger its assigned automations.
        </Text>
        <Grid columns={buttons.length === 1 ? 1 : 2} gapPx={10}>
          {buttons.map((btn) => (
            <Stack
              key={btn.id}
              gapPx={6}
              style={{
                layout: { padding: insets(12) },
                material: new SolidMaterial(colorToken('surface')),
                border: { width: 1, color: colorToken('borderSubtle') },
                corners: corners(14),
              }}
            >
              <Row align="center" gapPx={8}>
                <Box
                  style={{
                    layout: { width: px(30), height: px(30), alignItems: 'center', justifyContent: 'center' },
                    corners: corners(999, 'round'),
                    material: new SolidMaterial(colorToken('soft')),
                  }}
                >
                  <UiIcon name={btn.rotary ? 'rotate-cw' : 'radio'} size={15} />
                </Box>
                <Stack gapPx={1} style={{ layout: { minWidth: px(0), flexGrow: 1 } }}>
                  <Text size={12.5} weight={600} style={{ typography: { maxLines: 1, truncate: true } }}>
                    {btn.label}
                  </Text>
                  {btn.lastAction && (
                    <Text size={10.5} tone="muted" style={{ typography: { maxLines: 1, truncate: true } }}>
                      {btn.lastAction}
                    </Text>
                  )}
                </Stack>
              </Row>
              {btn.gestures && btn.gestures.length > 0 && (
                <Text size={10.5} tone="muted">
                  {btn.gestures.join(' · ')}
                </Text>
              )}
              {btn.linkedAutomations && btn.linkedAutomations.length > 0 && (
                <Stack gapPx={2}>
                  {btn.linkedAutomations.map((name) => (
                    <Row key={name} align="center" gapPx={5}>
                      <UiIcon name="sparkles" size={11} />
                      <Text size={11} weight={500} style={{ typography: { maxLines: 1, truncate: true } }}>
                        {name}
                      </Text>
                    </Row>
                  ))}
                </Stack>
              )}
            </Stack>
          ))}
        </Grid>
      </DeviceModalSurfaceCard>

      {linkedAutomations.length > 0 && (
        <DeviceModalSurfaceCard title="Assigned automations">
          <Stack gapPx={6}>
            {linkedAutomations.map((ruleName) => (
              <Row
                key={ruleName}
                align="center"
                gapPx={8}
                style={{
                  layout: { padding: insets(8, 10) },
                  material: new SolidMaterial(colorToken('surface')),
                  border: { width: 1, color: colorToken('borderSubtle') },
                  corners: corners(10),
                }}
              >
                <UiIcon name="sparkles" size={14} />
                <Text size={12.5} weight={500}>
                  {ruleName}
                </Text>
              </Row>
            ))}
          </Stack>
        </DeviceModalSurfaceCard>
      )}
    </Stack>
  );
}

export function SensorValueModalPanel({
  idPrefix,
  reading,
  subtitle,
  iconName = 'activity',
  metrics = [],
  slider,
  select,
  disabled = false,
}: {
  readonly idPrefix: string;
  readonly reading: string;
  readonly subtitle?: string;
  readonly iconName?: UiIconName;
  readonly metrics?: readonly DeviceMetricPill[];
  readonly slider?: {
    readonly label: string;
    readonly value: number;
    readonly min: number;
    readonly max: number;
    readonly step: number;
    readonly unit: string;
    readonly onCommit: (next: number) => void;
  };
  readonly select?: {
    readonly label: string;
    readonly value: string;
    readonly options: readonly string[];
    readonly onChange: (next: string) => void;
  };
  readonly disabled?: boolean;
}) {
  const [draft, setDraft] = useState<number>();
  useEffect(() => {
    setDraft(undefined);
  }, [slider?.value]);

  return (
    <Stack gapPx={12} style={{ layout: { width: pct(100) } }}>
      <DeviceModalOrbStage
        iconName={iconName}
        stateLabel={reading}
        caption={subtitle ?? 'Live telemetry reading'}
        active={false}
        ariaLabel={reading}
      />

      {slider && (
        <DeviceModalSurfaceCard title={slider.label}>
          <HausSlider
            id={`${idPrefix}-value`}
            label={slider.label}
            valueLabel={`${draft ?? slider.value}${slider.unit}`}
            value={draft ?? slider.value}
            min={slider.min}
            max={slider.max}
            step={slider.step}
            size="lg"
            disabled={disabled}
            onChange={setDraft}
            onChangeEnd={(next) => {
              setDraft(undefined);
              if (next !== slider.value) slider.onCommit(next);
            }}
          />
        </DeviceModalSurfaceCard>
      )}

      {select && select.options.length > 0 && (
        <DeviceModalSurfaceCard title={select.label}>
          <SelectInput
            id={`${idPrefix}-select`}
            ariaLabel={select.label}
            value={select.value}
            disabled={disabled}
            options={select.options.map((opt) => ({ value: opt, label: opt }))}
            onChange={select.onChange}
          />
        </DeviceModalSurfaceCard>
      )}

      {metrics.length > 0 && (
        <DeviceModalSurfaceCard title="Readings & attributes">
          <Grid columns={2} gapPx={8}>
            {metrics.map((m) => (
              <Stack
                key={m.label}
                gapPx={2}
                style={{
                  layout: { padding: insets(9, 11) },
                  material: new SolidMaterial(colorToken('surface')),
                  border: { width: 1, color: colorToken('borderSubtle') },
                  corners: corners(12),
                }}
              >
                <Text size={10.5} tone="muted">
                  {m.label}
                </Text>
                <Text size={12.5} weight={600} mono style={{ typography: { maxLines: 1, truncate: true } }}>
                  {m.value}
                </Text>
              </Stack>
            ))}
          </Grid>
        </DeviceModalSurfaceCard>
      )}
    </Stack>
  );
}
