/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { ReactNode } from 'react';
import { Box, HausCode, Text, TextArea, TextInput } from '@haus/ui';
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
        <Box className="management-field-grid">
          <TextInput
            inputType="number"
            step="any"
            placeholder="Latitude"
            value={typeof loc.latitude === 'number' ? String(loc.latitude) : ''}
            onChange={(nextVal) =>
              updateLoc({ latitude: nextVal === '' ? undefined : Number(nextVal) })
            }
          />
          <TextInput
            inputType="number"
            step="any"
            placeholder="Longitude"
            value={typeof loc.longitude === 'number' ? String(loc.longitude) : ''}
            onChange={(nextVal) =>
              updateLoc({ longitude: nextVal === '' ? undefined : Number(nextVal) })
            }
          />
          {config.radius && (
            <TextInput
              inputType="number"
              min={0}
              step={1}
              placeholder="Radius (m)"
              value={typeof loc.radius === 'number' ? String(loc.radius) : ''}
              onChange={(nextVal) =>
                updateLoc({ radius: nextVal === '' ? undefined : Number(nextVal) })
              }
            />
          )}
        </Box>
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
        <Box className="management-field-grid">
          {config.enable_day && (
            <TextInput
              inputType="number"
              min={0}
              placeholder="Days"
              value={typeof dur.days === 'number' ? String(dur.days) : ''}
              onChange={(nextVal) => updateDur('days', nextVal)}
            />
          )}
          <TextInput
            inputType="number"
            min={0}
            placeholder="Hours"
            value={typeof dur.hours === 'number' ? String(dur.hours) : ''}
            onChange={(nextVal) => updateDur('hours', nextVal)}
          />
          <TextInput
            inputType="number"
            min={0}
            max={59}
            placeholder="Min"
            value={typeof dur.minutes === 'number' ? String(dur.minutes) : ''}
            onChange={(nextVal) => updateDur('minutes', nextVal)}
          />
          <TextInput
            inputType="number"
            min={0}
            max={59}
            placeholder="Sec"
            value={typeof dur.seconds === 'number' ? String(dur.seconds) : ''}
            onChange={(nextVal) => updateDur('seconds', nextVal)}
          />
        </Box>
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
        <Box className="management-color-row">
          <TextInput
            inputType="color"
            value={hex}
            onChange={(nextHex) => set(hexToRgbArray(nextHex))}
          />
          <HausCode>{hexToRgbArray(hex).join(', ')}</HausCode>
        </Box>
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
        <Box className="management-color-row">
          <TextInput
            inputType="number"
            min={min}
            max={max}
            step={config.step ?? 1}
            value={typeof value === 'number' ? String(value) : ''}
            onChange={(nextVal) => set(nextVal === '' ? undefined : Number(nextVal))}
          />
          <Text semantic="small">
            {min}–{max}
          </Text>
        </Box>
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
    return (
      <SelectorFieldShell
        key={fieldKey}
        caption={caption}
        required={field.required}
        description={description}
        error={error}
      >
        <TextInput
          inputType="text"
          suggestions={Array.from(attrKeys).sort()}
          required={field.required}
          placeholder="Select or enter attribute"
          value={typeof value === 'string' ? value : ''}
          onChange={set}
        />
      </SelectorFieldShell>
    );
  }

  if (type === 'icon') {
    return (
      <SelectorFieldShell
        key={fieldKey}
        caption={caption}
        required={field.required}
        description={description}
        error={error}
      >
        <TextInput
          inputType="text"
          suggestions={COMMON_MDI_ICONS}
          required={field.required}
          placeholder={config.placeholder ?? 'mdi:home'}
          value={typeof value === 'string' ? value : ''}
          onChange={set}
        />
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
        <TextInput
          inputType="datetime-local"
          required={field.required}
          value={formatted}
          onChange={(nextVal) => set(nextVal ? nextVal.replace('T', ' ') : '')}
        />
      </SelectorFieldShell>
    );
  }

  if (config.multiline || type === 'template') {
    return (
      <SelectorFieldShell
        key={fieldKey}
        caption={caption}
        required={field.required}
        description={description}
        error={error}
      >
        <TextArea
          rows={type === 'template' ? 4 : 3}
          spellCheck={type === 'template' ? false : undefined}
          required={field.required}
          value={typeof value === 'string' ? value : ''}
          onChange={set}
        />
      </SelectorFieldShell>
    );
  }

  if (options.length > 0 && config.custom_value) {
    return (
      <SelectorFieldShell
        key={fieldKey}
        caption={caption}
        required={field.required}
        description={description}
        error={error}
      >
        <TextInput
          inputType="text"
          suggestions={options}
          required={field.required}
          value={typeof value === 'string' || typeof value === 'number' ? String(value) : ''}
          onChange={set}
        />
      </SelectorFieldShell>
    );
  }

  return undefined;
}
