/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { HausBadge, HausButton, HausCard, HausSplitPane } from '@haus/ui';
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
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                fontSize: '12px',
              }}
            >
              <span style={{ opacity: 0.75, minWidth: '68px' }}>Brightness</span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={brightnessPct}
                disabled={pending || statusLightEntity.state === 'unavailable'}
                onChange={(e) =>
                  onAction(buildAction(statusLightEntity, 'brightness', Number(e.target.value)))
                }
                style={{ flex: 1 }}
              />
              <span
                style={{
                  fontVariantNumeric: 'tabular-nums',
                  minWidth: '38px',
                  textAlign: 'right',
                }}
              >
                {brightnessPct}%
              </span>
            </label>
          )}
        </HausCard>
      )}

      {switchEntities.length > 0 && (
        <HausCard
          title="Features & Access Control"
          subtitle={`${switchEntities.filter((s) => s.state === 'on').length} of ${switchEntities.length} active`}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(175px, 1fr))',
              gap: '8px',
            }}
          >
            {switchEntities.map((sw) => {
              const isOn = sw.state === 'on';
              const unavailable = sw.state === 'unavailable' || sw.state === 'unknown';
              const label = humanize(friendlyEntityLabel(sw, accessory.name));
              const isPause = label.toLowerCase().includes('pause');
              return (
                <button
                  key={sw.entity_id}
                  type="button"
                  disabled={pending || unavailable || !onAction}
                  onClick={() => onAction?.(buildAction(sw, 'toggle'))}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px',
                    padding: '9px 11px',
                    borderRadius: '12px',
                    border: '1px solid rgba(128, 128, 128, 0.18)',
                    background: isOn
                      ? isPause
                        ? 'rgba(245, 158, 11, 0.16)'
                        : 'rgba(16, 185, 129, 0.15)'
                      : 'rgba(128, 128, 128, 0.07)',
                    color: 'inherit',
                    cursor: pending || unavailable || !onAction ? 'not-allowed' : 'pointer',
                    textAlign: 'left',
                    fontSize: '12px',
                    fontWeight: 500,
                  }}
                >
                  <span
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {label}
                  </span>
                  <HausBadge
                    label={unavailable ? '—' : isOn ? 'On' : 'Off'}
                    tone={
                      unavailable ? 'default' : isOn ? (isPause ? 'warning' : 'success') : 'default'
                    }
                  />
                </button>
              );
            })}
          </div>
        </HausCard>
      )}

      {(buttonEntities.length > 0 || selectEntities.length > 0) && (
        <HausCard
          title="Operations & Schedule"
          subtitle="Router diagnostics, reboot, and update window"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {buttonEntities.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
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
              </div>
            )}

            {selectEntities.map((sel) => {
              const rawOpts: unknown = sel.attributes.options;
              const options = Array.isArray(rawOpts)
                ? rawOpts.filter((o: unknown): o is string => typeof o === 'string')
                : [];
              if (options.length === 0) return null;
              const label = humanize(friendlyEntityLabel(sel, accessory.name));
              return (
                <label
                  key={sel.entity_id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '10px',
                    fontSize: '12px',
                  }}
                >
                  <span style={{ opacity: 0.78 }}>{label}</span>
                  <select
                    value={sel.state}
                    disabled={pending || sel.state === 'unavailable' || !onAction}
                    onChange={(e) => onAction?.(buildAction(sel, 'select', e.target.value))}
                    style={{
                      padding: '5px 10px',
                      borderRadius: '10px',
                      border: '1px solid rgba(128, 128, 128, 0.25)',
                      background: 'rgba(128, 128, 128, 0.1)',
                      color: 'inherit',
                      fontSize: '12px',
                    }}
                  >
                    {options.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}
          </div>
        </HausCard>
      )}
    </HausSplitPane>
  );
}
