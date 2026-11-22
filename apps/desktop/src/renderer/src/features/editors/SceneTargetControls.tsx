/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Button, parseColor } from '@heroui/react';
import { ChevronDown, Trash2 } from 'lucide-react';
import { JsonField } from '../../components/forms/SchemaForm';
import type { HassEntity } from '../../model';
import {
  patchSceneTarget,
  sceneTargetEntity,
  targetConfig,
  type SceneTarget,
} from '../../model/scene-target';
import { lightColor } from '../../model/light-color';
import { lightProfile, lightTemperature } from '../../model/light-profile';
import { ControlRange } from '../devices/controls/ControlRange';
import { SceneTargetReplace, type SceneReplacementCandidate } from './SceneTargetReplace';

const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

export function SceneTargetControls({
  id,
  entity,
  value,
  candidates = [],
  onChange,
  onReplace,
  onRemove,
}: {
  id: string;
  entity?: HassEntity;
  value: SceneTarget;
  candidates?: readonly SceneReplacementCandidate[];
  onChange: (value: SceneTarget) => void;
  onReplace?: (target: HassEntity) => void;
  onRemove: () => void;
}) {
  if (!entity && onReplace) {
    return (
      <SceneTargetReplace
        id={id}
        value={value}
        candidates={candidates}
        onReplace={onReplace}
        onChange={onChange}
        onRemove={onRemove}
      />
    );
  }
  const config = targetConfig(value);
  const domain = id.split('.')[0];
  const attrs = entity?.attributes ?? {};
  const patch = (key: string, nextValue: unknown) =>
    onChange(patchSceneTarget(config, key, nextValue));
  const preview = entity ? sceneTargetEntity(entity, config) : undefined;
  const profile = preview ? lightProfile(preview) : undefined;
  const temperature = (preview && lightTemperature(preview)) ?? 3000;
  const colour = parseColor((preview && lightColor(preview)) ?? '#ffffff').toString('hex');
  const hvacModes = Array.isArray(attrs.hvac_modes)
    ? attrs.hvac_modes.filter((mode): mode is string => typeof mode === 'string')
    : undefined;
  const states: string[] =
    domain === 'climate'
      ? hvacModes?.length
        ? hvacModes
        : ['off', 'heat', 'cool', 'auto']
      : domain === 'cover'
        ? ['open', 'closed']
        : domain === 'lock'
          ? ['locked', 'unlocked']
          : domain === 'media_player'
            ? ['off', 'on', 'playing', 'paused']
            : ['on', 'off'];
  const minKelvin =
    num(attrs.min_color_temp_kelvin) ??
    (num(attrs.max_mireds) ? 1e6 / Number(attrs.max_mireds) : 2000);
  const maxKelvin =
    num(attrs.max_color_temp_kelvin) ??
    (num(attrs.min_mireds) ? 1e6 / Number(attrs.min_mireds) : 6500);
  return (
    <div className="scene-target-adjustments">
      <div className="scene-state-choices" aria-label="Target state">
        {[...new Set([...states, String(config.state ?? '')])].filter(Boolean).map((state) => (
          <button
            type="button"
            key={state}
            aria-pressed={config.state === state}
            onClick={() => patch('state', state)}
          >
            {state.replaceAll('_', ' ')}
          </button>
        ))}
      </div>
      {config.state !== 'off' && (
        <>
          {domain === 'light' && profile?.brightness && (
            <ControlRange
              label="Brightness"
              min={1}
              value={Math.round(Number(preview?.attributes.brightness ?? 255) / 2.55)}
              disabled={false}
              onCommit={(next) => patch('brightness', Math.round(next * 2.55))}
            />
          )}
          {domain === 'light' && profile?.temperature && (
            <div className="scene-white-temperature">
              <ControlRange
                label="White temperature"
                min={minKelvin}
                max={maxKelvin}
                step={25}
                value={temperature}
                unit=" K"
                disabled={false}
                onCommit={(next) => patch('color_temp_kelvin', next)}
              />
              <small>
                Warm <span>Cool</span>
              </small>
            </div>
          )}
          {domain === 'light' && profile?.color && (
            <div className="scene-colour-choices">
              <span>Colour</span>
              {['#ffd4a0', '#ff8d50', '#f56f9b', '#ac80ff', '#609dff', '#73d4bc'].map((hex) => (
                <button
                  type="button"
                  key={hex}
                  style={{ background: hex }}
                  aria-label={`Set colour ${hex}`}
                  onClick={() =>
                    patch(
                      'rgb_color',
                      [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)),
                    )
                  }
                />
              ))}
              <label aria-label="Custom colour">
                <input
                  type="color"
                  aria-label="Custom scene colour"
                  value={colour}
                  onChange={(event) =>
                    patch(
                      'rgb_color',
                      [1, 3, 5].map((offset) =>
                        parseInt(event.target.value.slice(offset, offset + 2), 16),
                      ),
                    )
                  }
                />
              </label>
            </div>
          )}
          {domain === 'climate' && (
            <label className="management-field">
              <span>Temperature</span>
              <input
                type="number"
                min={num(attrs.min_temp) ?? 7}
                max={num(attrs.max_temp) ?? 35}
                step={num(attrs.target_temp_step) ?? 0.5}
                value={num(config.temperature) ?? num(attrs.temperature) ?? 21}
                onChange={(event) => patch('temperature', Number(event.target.value))}
              />
            </label>
          )}
          {['cover', 'fan', 'media_player'].includes(domain) && (
            <ControlRange
              label={domain === 'cover' ? 'Open position' : domain === 'fan' ? 'Speed' : 'Volume'}
              value={
                domain === 'cover'
                  ? (num(config.current_position) ?? (config.state === 'closed' ? 0 : 100))
                  : domain === 'fan'
                    ? (num(config.percentage) ?? num(attrs.percentage) ?? 100)
                    : Math.round((num(config.volume_level) ?? num(attrs.volume_level) ?? 0.3) * 100)
              }
              disabled={false}
              onCommit={(next) =>
                patch(
                  domain === 'cover'
                    ? 'current_position'
                    : domain === 'fan'
                      ? 'percentage'
                      : 'volume_level',
                  domain === 'media_player' ? next / 100 : next,
                )
              }
            />
          )}
        </>
      )}
      <details className="scene-advanced-target">
        <summary>
          <ChevronDown size={13} /> Advanced settings
        </summary>
        <JsonField
          label="Stored target"
          value={config}
          onChange={(next) => onChange(targetConfig(next))}
        />
      </details>
      <Button variant="ghost" onPress={onRemove}>
        <Trash2 size={14} /> Remove accessory
      </Button>
    </div>
  );
}
