/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { ReactNode } from 'react';
import type { Snapshot } from '../../model';
import type { FormField } from '../../ha/management';
import {
  FileUploadField,
  hexToRgbArray,
  rgbArrayToHex,
  SelectorFieldShell,
  type RichSelectorConfig,
} from './selector-shell';

export type { RichSelectorConfig } from './selector-shell';

const COMMON_MDI_ICONS = [
  'mdi:lightbulb',
  'mdi:thermometer',
  'mdi:toggle-switch',
  'mdi:lock',
  'mdi:motion-sensor',
  'mdi:video',
  'mdi:speaker',
  'mdi:fan',
  'mdi:power-plug',
  'mdi:door',
  'mdi:window-closed',
  'mdi:water',
  'mdi:weather-partly-cloudy',
  'mdi:bell',
  'mdi:home-automation',
];

/** Renders Home Assistant rich selectors (`file`, `location`, `duration`, `color_*`, `attribute`, `icon`, `datetime`, `multiline`, `custom_value` combobox). */
export function renderHaSelectorField(params: {
  fieldKey: string;
  type: string;
  field: FormField;
  config: RichSelectorConfig;
  value: unknown;
  values: Record<string, unknown>;
  caption: string;
  description?: string;
  error?: string;
  options: { value: string; label: string }[];
  snapshot: Snapshot;
  set: (next: unknown) => void;
}): ReactNode | undefined {
  const {
    fieldKey,
    type,
    field,
    config,
    value,
    values,
    caption,
    description,
    error,
    options,
    snapshot,
    set,
  } = params;

  if (type === 'file') {
    return (
      <FileUploadField
        key={fieldKey}
        caption={caption}
        field={field}
        config={config}
        value={value}
        description={description}
        error={error}
        onChange={set}
      />
    );
  }

  if (type === 'location') {
    const loc = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
    const updateLoc = (patch: Record<string, number | undefined>) => {
      const next: Record<string, number> = {};
      const lat = patch.latitude ?? (typeof loc.latitude === 'number' ? loc.latitude : undefined);
      const lon =
        patch.longitude ?? (typeof loc.longitude === 'number' ? loc.longitude : undefined);
      const rad = patch.radius ?? (typeof loc.radius === 'number' ? loc.radius : undefined);
      if (lat !== undefined && Number.isFinite(lat)) next.latitude = lat;
      if (lon !== undefined && Number.isFinite(lon)) next.longitude = lon;
      if (rad !== undefined && Number.isFinite(rad)) next.radius = rad;
      set(next);
    };
    return (
      <SelectorFieldShell
        key={fieldKey}
        asLabel={false}
        caption={caption}
        required={field.required}
        description={description}
        error={error}
      >
        <div className="management-field-grid">
          <input
            type="number"
            step="any"
            placeholder="Latitude"
            value={typeof loc.latitude === 'number' ? loc.latitude : ''}
            onChange={(e) =>
              updateLoc({ latitude: e.target.value === '' ? undefined : e.target.valueAsNumber })
            }
          />
          <input
            type="number"
            step="any"
            placeholder="Longitude"
            value={typeof loc.longitude === 'number' ? loc.longitude : ''}
            onChange={(e) =>
              updateLoc({ longitude: e.target.value === '' ? undefined : e.target.valueAsNumber })
            }
          />
          {config.radius && (
            <input
              type="number"
              min={0}
              step={1}
              placeholder="Radius (m)"
              value={typeof loc.radius === 'number' ? loc.radius : ''}
              onChange={(e) =>
                updateLoc({ radius: e.target.value === '' ? undefined : e.target.valueAsNumber })
              }
            />
          )}
        </div>
      </SelectorFieldShell>
    );
  }

  if (
    type === 'duration' &&
    (field.selector?.duration !== undefined || (value && typeof value === 'object'))
  ) {
    const dur = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
    const updateDur = (part: 'days' | 'hours' | 'minutes' | 'seconds', rawVal: string) => {
      const num = rawVal === '' ? Number.NaN : Number(rawVal);
      const next = { ...dur };
      if (Number.isFinite(num) && num >= 0) next[part] = Math.trunc(num);
      else delete next[part];
      set(next);
    };
    return (
      <SelectorFieldShell
        key={fieldKey}
        asLabel={false}
        caption={caption}
        required={field.required}
        description={description}
        error={error}
      >
        <div className="management-field-grid">
          {config.enable_day && (
            <input
              type="number"
              min={0}
              placeholder="Days"
              value={typeof dur.days === 'number' ? dur.days : ''}
              onChange={(e) => updateDur('days', e.target.value)}
            />
          )}
          <input
            type="number"
            min={0}
            placeholder="Hours"
            value={typeof dur.hours === 'number' ? dur.hours : ''}
            onChange={(e) => updateDur('hours', e.target.value)}
          />
          <input
            type="number"
            min={0}
            max={59}
            placeholder="Min"
            value={typeof dur.minutes === 'number' ? dur.minutes : ''}
            onChange={(e) => updateDur('minutes', e.target.value)}
          />
          <input
            type="number"
            min={0}
            max={59}
            placeholder="Sec"
            value={typeof dur.seconds === 'number' ? dur.seconds : ''}
            onChange={(e) => updateDur('seconds', e.target.value)}
          />
        </div>
      </SelectorFieldShell>
    );
  }

  if (type === 'color_rgb') {
    const hex = rgbArrayToHex(value);
    return (
      <SelectorFieldShell
        key={fieldKey}
        caption={caption}
        required={field.required}
        description={description}
        error={error}
      >
        <div className="management-color-row">
          <input type="color" value={hex} onChange={(e) => set(hexToRgbArray(e.target.value))} />
          <code>{hexToRgbArray(hex).join(', ')}</code>
        </div>
      </SelectorFieldShell>
    );
  }

  if (type === 'color_temp') {
    const min = config.min ?? config.min_mireds ?? (config.unit === 'kelvin' ? 2000 : 153);
    const max = config.max ?? config.max_mireds ?? (config.unit === 'kelvin' ? 6500 : 500);
    const unitLabel = config.unit === 'kelvin' ? 'K' : 'mireds';
    return (
      <SelectorFieldShell
        key={fieldKey}
        caption={`${caption} (${unitLabel})`}
        required={field.required}
        description={description}
        error={error}
      >
        <div className="management-color-row">
          <input
            type="number"
            min={min}
            max={max}
            step={config.step ?? 1}
            value={typeof value === 'number' ? value : ''}
            onChange={(e) => set(e.target.value === '' ? undefined : e.target.valueAsNumber)}
          />
          <small>
            {min}–{max}
          </small>
        </div>
      </SelectorFieldShell>
    );
  }

  if (type === 'attribute') {
    const targetEntityId =
      config.entity_id ?? (typeof values.entity_id === 'string' ? values.entity_id : undefined);
    const hidden = new Set(config.hide_attributes ?? []);
    const attrKeys = new Set<string>();
    for (const st of snapshot.states) {
      if (targetEntityId && st.entity_id !== targetEntityId) continue;
      for (const attr of Object.keys(st.attributes ?? {}))
        if (!hidden.has(attr)) attrKeys.add(attr);
    }
    const listId = `attr-list-${fieldKey}`;
    return (
      <SelectorFieldShell
        key={fieldKey}
        caption={caption}
        required={field.required}
        description={description}
        error={error}
      >
        <input
          type="text"
          list={listId}
          required={field.required}
          placeholder="Select or enter attribute"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => set(e.target.value)}
        />
        <datalist id={listId}>
          {Array.from(attrKeys)
            .sort()
            .map((attr) => (
              <option key={attr} value={attr} />
            ))}
        </datalist>
      </SelectorFieldShell>
    );
  }

  if (type === 'icon') {
    const listId = `mdi-list-${fieldKey}`;
    return (
      <SelectorFieldShell
        key={fieldKey}
        caption={caption}
        required={field.required}
        description={description}
        error={error}
      >
        <input
          type="text"
          list={listId}
          required={field.required}
          placeholder={config.placeholder ?? 'mdi:home'}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => set(e.target.value)}
        />
        <datalist id={listId}>
          {COMMON_MDI_ICONS.map((icon) => (
            <option key={icon} value={icon} />
          ))}
        </datalist>
      </SelectorFieldShell>
    );
  }

  if (type === 'datetime') {
    const formatted =
      typeof value === 'string' && value
        ? value.includes(' ') && !value.includes('T')
          ? value.replace(' ', 'T').slice(0, 16)
          : value.slice(0, 16)
        : '';
    return (
      <SelectorFieldShell
        key={fieldKey}
        caption={caption}
        required={field.required}
        description={description}
        error={error}
      >
        <input
          type="datetime-local"
          required={field.required}
          value={formatted}
          onChange={(e) => set(e.target.value ? e.target.value.replace('T', ' ') : '')}
        />
      </SelectorFieldShell>
    );
  }

  if (config.multiline) {
    return (
      <SelectorFieldShell
        key={fieldKey}
        caption={caption}
        required={field.required}
        description={description}
        error={error}
      >
        <textarea
          rows={3}
          required={field.required}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => set(e.target.value)}
        />
      </SelectorFieldShell>
    );
  }

  if (options.length > 0 && config.custom_value) {
    const listId = `select-custom-${fieldKey}`;
    return (
      <SelectorFieldShell
        key={fieldKey}
        caption={caption}
        required={field.required}
        description={description}
        error={error}
      >
        <input
          type="text"
          list={listId}
          required={field.required}
          value={typeof value === 'string' || typeof value === 'number' ? value : ''}
          onChange={(e) => set(e.target.value)}
        />
        <datalist id={listId}>
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </datalist>
      </SelectorFieldShell>
    );
  }

  return undefined;
}
