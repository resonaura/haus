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
export function SceneTargetControls({
  id,
  entity,
  value,
  onChange,
  onRemove,
}: {
  id: string;
  entity?: HassEntity;
  value: SceneTarget;
  onChange: (value: SceneTarget) => void;
  onRemove: () => void;
}) {
  const config = targetConfig(value),
    domain = id.split('.')[0],
    attrs = entity?.attributes ?? {};
  const patch = (key: string, value: unknown) => onChange(patchSceneTarget(config, key, value));
  const preview = entity ? sceneTargetEntity(entity, config) : undefined;
  const profile = preview ? lightProfile(preview) : undefined;
  const temperature = (preview && lightTemperature(preview)) ?? 3000;
  const colour = parseColor((preview && lightColor(preview)) ?? '#ffffff').toString('hex');
  const states: string[] =
    domain === 'climate'
      ? (attrs.hvac_modes ?? ['off', 'heat', 'cool', 'auto'])
      : domain === 'cover'
        ? ['open', 'closed']
        : domain === 'lock'
          ? ['locked', 'unlocked']
          : domain === 'media_player'
            ? ['off', 'on', 'playing', 'paused']
            : ['on', 'off'];
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
                min={
                  attrs.min_color_temp_kelvin ?? (attrs.max_mireds ? 1e6 / attrs.max_mireds : 2000)
                }
                max={
                  attrs.max_color_temp_kelvin ?? (attrs.min_mireds ? 1e6 / attrs.min_mireds : 6500)
                }
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
                min={attrs.min_temp ?? 7}
                max={attrs.max_temp ?? 35}
                step={attrs.target_temp_step ?? 0.5}
                value={config.temperature ?? attrs.temperature ?? 21}
                onChange={(event) => patch('temperature', Number(event.target.value))}
              />
            </label>
          )}
          {['cover', 'fan', 'media_player'].includes(domain) && (
            <ControlRange
              label={domain === 'cover' ? 'Open position' : domain === 'fan' ? 'Speed' : 'Volume'}
              value={
                domain === 'cover'
                  ? (config.current_position ?? (config.state === 'closed' ? 0 : 100))
                  : domain === 'fan'
                    ? (config.percentage ?? attrs.percentage ?? 100)
                    : Math.round((config.volume_level ?? attrs.volume_level ?? 0.3) * 100)
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
