import { useState } from 'react';
import type { Snapshot } from '../../model';
import { EntityPicker } from '../../components/forms/EntityPicker';
import { JsonField } from '../../components/forms/SchemaForm';
export function SceneTargets({
  entities,
  onChange,
  snapshot,
}: {
  entities: Record<string, any>;
  onChange: (entities: Record<string, any>) => void;
  snapshot: Snapshot;
}) {
  const [add, setAdd] = useState('');
  const patch = (id: string, key: string, value: unknown) => {
    const config = {
      ...(typeof entities[id] === 'object' ? entities[id] : { state: entities[id] }),
    };
    if (key === 'color_temp_kelvin')
      for (const field of [
        'color_temp',
        'rgb_color',
        'hs_color',
        'xy_color',
        'rgbw_color',
        'rgbww_color',
      ])
        delete config[field];
    onChange({ ...entities, [id]: { ...config, [key]: value } });
  };
  const available = snapshot.states.filter(
    (item) =>
      /^(light|switch|climate|cover|media_player|fan|lock|input_boolean)\./.test(item.entity_id) &&
      !entities[item.entity_id],
  );
  return (
    <section className="editor-blocks">
      <h3>Accessories in this scene</h3>
      {Object.entries(entities).map(([id, setting]) => {
        const state = snapshot.states.find((item) => item.entity_id === id);
        const config = typeof setting === 'object' ? setting : { state: setting };
        const domain = id.split('.')[0];
        return (
          <fieldset key={id}>
            <legend>{String(state?.attributes.friendly_name ?? id)}</legend>
            <button
              type="button"
              className="editor-remove"
              onClick={() =>
                onChange(Object.fromEntries(Object.entries(entities).filter(([key]) => key !== id)))
              }
            >
              Remove
            </button>
            <label className="management-field">
              <span>State</span>
              <input
                value={String(config.state ?? '')}
                onChange={(event) => patch(id, 'state', event.target.value)}
              />
            </label>
            {domain === 'light' && (
              <>
                {state?.attributes.supported_color_modes?.some(
                  (mode: string) => mode !== 'onoff',
                ) && (
                  <label className="management-field">
                    <span>Brightness · {Math.round(Number(config.brightness ?? 255) / 2.55)}%</span>
                    <input
                      type="range"
                      min={1}
                      max={255}
                      value={config.brightness ?? 255}
                      onChange={(event) => patch(id, 'brightness', Number(event.target.value))}
                    />
                  </label>
                )}
                {state?.attributes.supported_color_modes?.includes('color_temp') && (
                  <label className="management-field">
                    <span>Temperature · K</span>
                    <input
                      type="number"
                      min={state.attributes.min_color_temp_kelvin ?? 2000}
                      max={state.attributes.max_color_temp_kelvin ?? 6500}
                      value={config.color_temp_kelvin ?? ''}
                      onChange={(event) =>
                        patch(id, 'color_temp_kelvin', Number(event.target.value))
                      }
                    />
                  </label>
                )}
                {state?.attributes.supported_color_modes?.some((mode: string) =>
                  ['hs', 'xy', 'rgb', 'rgbw', 'rgbww'].includes(mode),
                ) && (
                  <label className="management-field">
                    <span>Light colour</span>
                    <input
                      type="color"
                      value={
                        Array.isArray(config.rgb_color)
                          ? '#' +
                            config.rgb_color
                              .slice(0, 3)
                              .map((c: number) => Math.round(c).toString(16).padStart(2, '0'))
                              .join('')
                          : '#ffffff'
                      }
                      onChange={(event) => {
                        const value = event.target.value;
                        const next = { ...config };
                        for (const key of [
                          'color_temp_kelvin',
                          'color_temp',
                          'hs_color',
                          'xy_color',
                        ])
                          delete next[key];
                        onChange({
                          ...entities,
                          [id]: {
                            ...next,
                            rgb_color: [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16)),
                          },
                        });
                      }}
                    />
                  </label>
                )}
              </>
            )}
            <details>
              <summary>Advanced settings</summary>
              <JsonField
                key={id}
                label="Target state"
                value={config}
                onChange={(value) => onChange({ ...entities, [id]: value })}
              />
            </details>
          </fieldset>
        );
      })}
      <EntityPicker label="New accessory" entities={available} value={add} onChange={setAdd} />
      <button
        type="button"
        disabled={!add}
        onClick={() => {
          const item = available.find((item) => item.entity_id === add);
          if (!item) return;
          const attrs = Object.fromEntries(
            Object.entries(item.attributes).filter(([key]) =>
              [
                'brightness',
                'rgb_color',
                'color_temp_kelvin',
                'current_position',
                'temperature',
                'hvac_mode',
                'percentage',
                'volume_level',
              ].includes(key),
            ),
          );
          if (item.attributes.color_mode === 'color_temp') delete attrs.rgb_color;
          else if (item.attributes.color_mode && item.attributes.color_mode !== 'unknown')
            delete attrs.color_temp_kelvin;
          onChange({
            ...entities,
            [add]: {
              state: ['unknown', 'unavailable'].includes(item.state) ? 'off' : item.state,
              ...attrs,
            },
          });
          setAdd('');
        }}
      >
        Add accessory
      </button>
    </section>
  );
}
