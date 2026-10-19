import { Button } from '@heroui/react';
import { ChevronDown, Trash2 } from 'lucide-react';
import { JsonField } from '../../components/forms/SchemaForm';
import type { HassEntity } from '../../model';
import { patchSceneTarget, targetConfig, type SceneTarget } from '../../model/scene-target';
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
  const modes: string[] = attrs.supported_color_modes ?? [];
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
          {domain === 'light' && modes.some((mode) => mode !== 'onoff') && (
            <label className="management-field">
              <span>
                Brightness <strong>{Math.round(Number(config.brightness ?? 255) / 2.55)}%</strong>
              </span>
              <input
                type="range"
                aria-label="Scene brightness"
                min={1}
                max={255}
                value={config.brightness ?? 255}
                onChange={(event) => patch('brightness', Number(event.target.value))}
              />
            </label>
          )}
          {domain === 'light' && modes.includes('color_temp') && (
            <label className="management-field">
              <span>
                White temperature{' '}
                <strong>
                  {config.color_temp_kelvin ?? Math.round(1e6 / Number(config.color_temp || 333))} K
                </strong>
              </span>
              <input
                type="range"
                aria-label="Scene white temperature"
                className="scene-white-temperature"
                min={attrs.min_color_temp_kelvin ?? 2000}
                max={attrs.max_color_temp_kelvin ?? 6500}
                step={25}
                value={
                  config.color_temp_kelvin ?? Math.round(1e6 / Number(config.color_temp || 333))
                }
                onChange={(event) => patch('color_temp_kelvin', Number(event.target.value))}
              />
              <small>
                Warm <span>Cool</span>
              </small>
            </label>
          )}
          {domain === 'light' &&
            modes.some((mode) => ['rgb', 'hs', 'xy', 'rgbw', 'rgbww'].includes(mode)) && (
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
                    value={
                      Array.isArray(config.rgb_color)
                        ? '#' +
                          config.rgb_color
                            .slice(0, 3)
                            .map((value: number) => Math.round(value).toString(16).padStart(2, '0'))
                            .join('')
                        : '#ffffff'
                    }
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
            <label className="management-field">
              <span>
                {domain === 'cover' ? 'Open position' : domain === 'fan' ? 'Speed' : 'Volume'}
              </span>
              <input
                type="range"
                min={0}
                max={100}
                value={
                  domain === 'cover'
                    ? (config.current_position ?? 100)
                    : domain === 'fan'
                      ? (config.percentage ?? 100)
                      : Math.round((config.volume_level ?? 0.3) * 100)
                }
                onChange={(event) => {
                  const n = Number(event.target.value);
                  patch(
                    domain === 'cover'
                      ? 'current_position'
                      : domain === 'fan'
                        ? 'percentage'
                        : 'volume_level',
                    domain === 'media_player' ? n / 100 : n,
                  );
                }}
              />
            </label>
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
