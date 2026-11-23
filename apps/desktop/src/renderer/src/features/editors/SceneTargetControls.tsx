/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  Box,
  HausButton as Button,
  HausDisclosure,
  parseHausColor,
  Pressable,
  Text,
  TextInput,
} from '@haus/ui';
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
  const colour = parseHausColor((preview && lightColor(preview)) ?? '#ffffff').toString('hex');
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
    <Box className="scene-target-adjustments">
      <Box className="scene-state-choices" ariaLabel="Target state">
        {[...new Set([...states, String(config.state ?? '')])].filter(Boolean).map((state) => (
          <Pressable
            type="button"
            key={state}
            ariaPressed={config.state === state}
            onPress={() => patch('state', state)}
          >
            {state.replaceAll('_', ' ')}
          </Pressable>
        ))}
      </Box>
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
            <Box className="scene-white-temperature">
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
              <Text semantic="small">
                Warm <Text>Cool</Text>
              </Text>
            </Box>
          )}
          {domain === 'light' && profile?.color && (
            <Box className="scene-colour-choices">
              <Text>Colour</Text>
              {['#ffd4a0', '#ff8d50', '#f56f9b', '#ac80ff', '#609dff', '#73d4bc'].map((hex) => (
                <Pressable
                  type="button"
                  key={hex}
                  surfaceTokens={{ background: hex }}
                  ariaLabel={`Set colour ${hex}`}
                  onPress={() =>
                    patch(
                      'rgb_color',
                      [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)),
                    )
                  }
                />
              ))}
              <Text semantic="label" ariaLabel="Custom colour">
                <TextInput
                  inputType="color"
                  ariaLabel="Custom scene colour"
                  value={colour}
                  onChange={(nextHex) =>
                    patch(
                      'rgb_color',
                      [1, 3, 5].map((offset) => parseInt(nextHex.slice(offset, offset + 2), 16)),
                    )
                  }
                />
              </Text>
            </Box>
          )}
          {domain === 'climate' && (
            <Text semantic="label" className="management-field">
              <Text>Temperature</Text>
              <TextInput
                inputType="number"
                min={num(attrs.min_temp) ?? 7}
                max={num(attrs.max_temp) ?? 35}
                step={num(attrs.target_temp_step) ?? 0.5}
                value={String(num(config.temperature) ?? num(attrs.temperature) ?? 21)}
                onChange={(nextValue) => patch('temperature', Number(nextValue))}
              />
            </Text>
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
      <HausDisclosure
        className="scene-advanced-target"
        summary={
          <>
            <ChevronDown size={13} /> Advanced settings
          </>
        }
      >
        <JsonField
          label="Stored target"
          value={config}
          onChange={(next) => onChange(targetConfig(next))}
        />
      </HausDisclosure>
      <Button variant="ghost" onPress={onRemove}>
        <Trash2 size={14} /> Remove accessory
      </Button>
    </Box>
  );
}
