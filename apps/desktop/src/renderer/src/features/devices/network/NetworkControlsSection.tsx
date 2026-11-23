/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  colorToken,
  corners,
  Grid,
  HausBadge,
  HausButton,
  HausCard,
  HausSelect,
  HausSlider,
  HausSplitPane,
  insets,
  Pressable,
  px,
  rgba,
  Row,
  SolidMaterial,
  Stack,
  Text,
} from '@haus/ui';
import { buildAction, type HassEntity, type HausAccessory } from '../../../model';
import { humanize } from '../controls/control-values';
import { friendlyEntityLabel } from './entity-matchers';

type Action = ReturnType<typeof buildAction>;

export interface NetworkControlsSectionProps {
  readonly accessory: HausAccessory;
  readonly statusLightEntity?: HassEntity;
  readonly switchEntities: readonly HassEntity[];
  readonly buttonEntities: readonly HassEntity[];
  readonly selectEntities: readonly HassEntity[];
  readonly pending?: boolean;
  readonly onAction?: (action: Action) => void;
}

export function NetworkControlsSection({
  accessory,
  statusLightEntity,
  switchEntities,
  buttonEntities,
  selectEntities,
  pending = false,
  onAction,
}: NetworkControlsSectionProps) {
  const hasAnyControls =
    Boolean(statusLightEntity) ||
    switchEntities.length > 0 ||
    buttonEntities.length > 0 ||
    selectEntities.length > 0;

  if (!hasAnyControls) return null;

  const lightOn = statusLightEntity?.state === 'on';
  const rawBrightness = statusLightEntity?.attributes.brightness;
  const brightnessPct =
    typeof rawBrightness === 'number' ? Math.round((rawBrightness / 255) * 100) : lightOn ? 100 : 0;

  return (
    <HausSplitPane columns="adaptive" minColumnWidthPx={310} gapPx={12}>
      {statusLightEntity && (
        <HausCard
          title="Status LED"
          subtitle={lightOn ? `Illuminated · ${brightnessPct}%` : 'LED indicator off'}
          badge={{
            label: lightOn ? 'On' : 'Off',
            tone: lightOn ? 'success' : 'default',
          }}
          headerRight={
            onAction ? (
              <HausButton
                variant={lightOn ? 'secondary' : 'primary'}
                size="sm"
                disabled={pending || statusLightEntity.state === 'unavailable'}
                label={lightOn ? 'Turn Off' : 'Turn On'}
                onPress={() => onAction(buildAction(statusLightEntity, 'toggle'))}
              />
            ) : undefined
          }
        >
          {onAction && (
            <HausSlider
              label="Brightness"
              value={brightnessPct}
              valueLabel={`${brightnessPct}%`}
              min={0}
              max={100}
              step={5}
              disabled={pending || statusLightEntity.state === 'unavailable'}
              onChange={(val) => onAction(buildAction(statusLightEntity, 'brightness', val))}
            />
          )}
        </HausCard>
      )}

      {switchEntities.length > 0 && (
        <HausCard
          title="Features & Access Control"
          subtitle={`${switchEntities.filter((s) => s.state === 'on').length} of ${switchEntities.length} active`}
        >
          <Grid columns={2} minColumnWidthPx={170} gapPx={8}>
            {switchEntities.map((sw) => {
              const isOn = sw.state === 'on';
              const unavailable = sw.state === 'unavailable' || sw.state === 'unknown';
              const label = humanize(friendlyEntityLabel(sw, accessory.name));
              const isPause = label.toLowerCase().includes('pause');
              const disabled = pending || unavailable || !onAction;
              return (
                <Pressable
                  key={sw.entity_id}
                  disabled={disabled}
                  onPress={() => onAction?.(buildAction(sw, 'toggle'))}
                  style={{
                    layout: {
                      display: 'flex',
                      direction: 'row',
                      alignItems: 'center',
                      justifyContent: 'between',
                      gap: px(8),
                      padding: insets(9, 11),
                    },
                    corners: corners(12, 'superellipse', 1.4),
                    border: { width: 1, style: 'solid', color: colorToken('border') },
                    material: new SolidMaterial(
                      isOn
                        ? isPause
                          ? rgba(245, 158, 11, 0.16)
                          : rgba(16, 185, 129, 0.15)
                        : rgba(128, 128, 128, 0.07),
                    ),
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    opacity: disabled ? 0.5 : 1,
                    transitionMs: 140,
                    states: {
                      hover: { opacity: 0.92 },
                      pressed: { transform: { scale: 0.98 } },
                    },
                  }}
                >
                  <Text size={12} weight={500} style={{ typography: { truncate: true } }}>
                    {label}
                  </Text>
                  <HausBadge
                    label={unavailable ? '—' : isOn ? 'On' : 'Off'}
                    tone={
                      unavailable ? 'default' : isOn ? (isPause ? 'warning' : 'success') : 'default'
                    }
                  />
                </Pressable>
              );
            })}
          </Grid>
        </HausCard>
      )}

      {(buttonEntities.length > 0 || selectEntities.length > 0) && (
        <HausCard
          title="Operations & Schedule"
          subtitle="Router diagnostics, reboot, and update window"
        >
          <Stack gapPx={10}>
            {buttonEntities.length > 0 && (
              <Row gapPx={8} wrap>
                {buttonEntities.map((btn) => {
                  const label = humanize(friendlyEntityLabel(btn, accessory.name));
                  const isReboot = label.toLowerCase().includes('reboot');
                  return (
                    <HausButton
                      key={btn.entity_id}
                      variant={isReboot ? 'danger' : 'secondary'}
                      size="sm"
                      disabled={pending || btn.state === 'unavailable' || !onAction}
                      label={label}
                      onPress={() => onAction?.(buildAction(btn, 'press'))}
                    />
                  );
                })}
              </Row>
            )}

            {selectEntities.map((sel) => {
              const rawOpts: unknown = sel.attributes.options;
              const options = Array.isArray(rawOpts)
                ? rawOpts.filter((o: unknown): o is string => typeof o === 'string')
                : [];
              if (options.length === 0) return null;
              const label = humanize(friendlyEntityLabel(sel, accessory.name));
              return (
                <Row key={sel.entity_id} justify="between" gapPx={10}>
                  <Text tone="secondary" size={12}>
                    {label}
                  </Text>
                  <HausSelect
                    aria-label={label}
                    value={sel.state}
                    options={options.map((opt) => ({ value: opt, label: opt }))}
                    disabled={pending || sel.state === 'unavailable' || !onAction}
                    onChange={(next) => onAction?.(buildAction(sel, 'select', next))}
                  />
                </Row>
              );
            })}
          </Stack>
        </HausCard>
      )}
    </HausSplitPane>
  );
}
