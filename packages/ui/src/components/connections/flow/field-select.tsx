/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { FlowFormFieldRecord } from '@haus/core/transport';
import { colorToken, corners, insets, mixColor, pct, px } from '../../../ir/geometry.js';
import { SolidMaterial } from '../../../ir/materials.js';
import {
  Box,
  HausSelect,
  Pressable,
  Row,
  Stack,
  Text,
  useHausUi,
} from '../../../primitives/index.js';
import { UiIcon } from '../../icon.js';

export interface FlowFieldSnapshotContext {
  readonly states: readonly {
    readonly entity_id: string;
    readonly attributes?: Readonly<Record<string, unknown>>;
  }[];
  readonly devices: readonly {
    readonly id: string;
    readonly name?: string | null;
    readonly name_by_user?: string | null;
    readonly manufacturer?: string | null;
    readonly model?: string | null;
  }[];
  readonly entities?: readonly {
    readonly entity_id: string;
    readonly device_id?: string | null;
    readonly platform?: string | null;
  }[];
  readonly areas: readonly { readonly area_id: string; readonly name: string }[];
}

export function asFieldRec(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

export function extractFlowSelectOptions(
  field: FlowFormFieldRecord,
  selectorType: string,
  config: Readonly<Record<string, unknown>>,
  snapshot?: FlowFieldSnapshotContext,
  translatedLabels?: Readonly<Record<string, string>>,
): readonly { readonly value: string; readonly label: string }[] {
  let options: { value: string; label: string }[] = [];
  const raw = field.options ?? (config.options as FlowFormFieldRecord['options']);
  if (raw) {
    if (Array.isArray(raw)) {
      options = raw.flatMap((entry) => {
        if (typeof entry === 'string' || typeof entry === 'number') {
          const val = String(entry);
          return [{ value: val, label: val }];
        }
        if (Array.isArray(entry) && entry.length >= 2) {
          return [{ value: String(entry[0]), label: String(entry[1]) }];
        }
        const rec = asFieldRec(entry);
        if (rec && 'value' in rec) {
          const val = String(rec.value);
          return [{ value: val, label: typeof rec.label === 'string' ? rec.label : val }];
        }
        return [];
      });
    } else {
      options = Object.entries(raw).map(([value, label]) => ({ value, label: String(label) }));
    }
  } else if (selectorType === 'entity' && snapshot) {
    const filter = asFieldRec(config.filter) ?? config;
    const rawDomains = filter.domain;
    const allowed = Array.isArray(rawDomains)
      ? rawDomains.map(String)
      : typeof rawDomains === 'string'
        ? [rawDomains]
        : [];
    options = snapshot.states
      .filter((s) => !allowed.length || allowed.includes(s.entity_id.split('.')[0] ?? ''))
      .map((s) => ({
        value: s.entity_id,
        label: `${String(s.attributes?.friendly_name ?? s.entity_id)} · ${s.entity_id}`,
      }));
  } else if (selectorType === 'device' && snapshot) {
    const filter = asFieldRec(config.filter) ?? config;
    const integration = typeof filter.integration === 'string' ? filter.integration : undefined;
    const manufacturer = typeof filter.manufacturer === 'string' ? filter.manufacturer : undefined;
    const model = typeof filter.model === 'string' ? filter.model : undefined;
    options = snapshot.devices
      .filter(
        (dev) =>
          (!integration ||
            snapshot.entities?.some((e) => e.device_id === dev.id && e.platform === integration)) &&
          (!manufacturer || dev.manufacturer === manufacturer) &&
          (!model || dev.model === model),
      )
      .map((dev) => ({ value: dev.id, label: dev.name_by_user || dev.name || dev.id }));
  } else if (selectorType === 'area' && snapshot) {
    options = snapshot.areas.map((area) => ({ value: area.area_id, label: area.name }));
  }

  if (translatedLabels && options.length > 0) {
    return options.map((opt) => ({ ...opt, label: translatedLabels[opt.value] ?? opt.label }));
  }
  return options;
}

export function SelectFlowField({
  fieldName,
  label,
  displayLabel,
  options,
  value,
  multiple,
  listMode,
  required,
  description,
  error,
  disabled,
  onChange,
}: {
  readonly fieldName: string;
  readonly label: string;
  readonly displayLabel: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly value: unknown;
  readonly multiple: boolean;
  readonly listMode: boolean;
  readonly required: boolean;
  readonly description?: string;
  readonly error?: string;
  readonly disabled: boolean;
  readonly onChange: (next: unknown) => void;
}) {
  const { theme } = useHausUi();
  const dark = theme.mode === 'dark';

  if (multiple) {
    const activeSet = new Set(Array.isArray(value) ? value.map(String) : []);
    return (
      <Stack gapPx={6} style={{ layout: { width: pct(100) } }}>
        <Text size={12} weight={600}>
          {displayLabel}
        </Text>
        <Row gapPx={6} wrap style={{ layout: { width: pct(100) } }}>
          {options.map((opt) => {
            const selected = activeSet.has(opt.value);
            return (
              <Pressable
                key={opt.value}
                id={`flow-field-${fieldName}-${opt.value}`}
                ariaPressed={selected}
                disabled={disabled}
                onActivate={() => {
                  const next = new Set(activeSet);
                  if (selected) next.delete(opt.value);
                  else next.add(opt.value);
                  onChange([...next]);
                }}
                style={{
                  layout: {
                    direction: 'row',
                    alignItems: 'center',
                    gap: px(6),
                    padding: insets(6, 11),
                  },
                  material: new SolidMaterial(
                    selected
                      ? mixColor(colorToken('surface'), colorToken('accent'), dark ? 0.18 : 0.1)
                      : colorToken('surface'),
                  ),
                  border: {
                    width: 1,
                    color: selected ? colorToken('accent') : colorToken('border'),
                  },
                  corners: corners(999),
                }}
              >
                {selected && <UiIcon name="check" size={12} />}
                <Text size={12} weight={selected ? 600 : 500}>
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </Row>
        {description && (
          <Text size={11.5} tone="muted">
            {description}
          </Text>
        )}
        {error && (
          <Text size={11.5} tone="critical">
            {error}
          </Text>
        )}
      </Stack>
    );
  }

  const activeVal = value === undefined || value === null ? '' : String(value);
  if (options.length <= 5 || listMode) {
    return (
      <Stack gapPx={6} style={{ layout: { width: pct(100) } }}>
        <Text size={12} weight={600}>
          {displayLabel}
        </Text>
        <Stack gapPx={6} style={{ layout: { width: pct(100) } }}>
          {options.map((opt) => {
            const selected = activeVal === opt.value;
            return (
              <Pressable
                key={opt.value}
                id={`flow-field-${fieldName}-${opt.value}`}
                role="radio"
                ariaChecked={selected}
                disabled={disabled}
                onActivate={() => onChange(opt.value)}
                style={{
                  layout: {
                    direction: 'row',
                    alignItems: 'center',
                    gap: px(10),
                    width: pct(100),
                    padding: insets(9, 12),
                  },
                  material: new SolidMaterial(
                    selected
                      ? mixColor(colorToken('surface'), colorToken('accent'), dark ? 0.16 : 0.08)
                      : colorToken('surface'),
                  ),
                  border: {
                    width: 1,
                    color: selected ? colorToken('accent') : colorToken('borderSubtle'),
                  },
                  corners: corners(12),
                }}
              >
                <Box
                  ariaHidden
                  style={{
                    layout: { width: px(15), height: px(15), flexShrink: 0 },
                    border: {
                      width: selected ? 4.5 : 1.5,
                      color: selected ? colorToken('accent') : colorToken('border'),
                    },
                    corners: corners(999, 'round'),
                  }}
                />
                <Text size={12.5} weight={selected ? 600 : 500}>
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </Stack>
        {description && (
          <Text size={11.5} tone="muted">
            {description}
          </Text>
        )}
        {error && (
          <Text size={11.5} tone="critical">
            {error}
          </Text>
        )}
      </Stack>
    );
  }

  return (
    <Stack gapPx={6} style={{ layout: { width: pct(100) } }}>
      <Text size={12} weight={600}>
        {displayLabel}
      </Text>
      <HausSelect
        id={`flow-field-${fieldName}`}
        aria-label={label}
        value={activeVal}
        disabled={disabled}
        required={required}
        options={[{ value: '', label: 'Choose…' }, ...options]}
        onChange={(next) => onChange(!required && next === '' ? undefined : next)}
        style={{ layout: { width: pct(100) } }}
      />
      {description && (
        <Text size={11.5} tone="muted">
          {description}
        </Text>
      )}
      {error && (
        <Text size={11.5} tone="critical">
          {error}
        </Text>
      )}
    </Stack>
  );
}
