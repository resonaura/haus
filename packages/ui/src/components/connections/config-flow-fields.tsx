/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useState } from 'react';
import type { FlowFormFieldRecord, FlowStepRecord } from '@haus/core/transport';
import { colorToken, corners, insets, pct, px } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import {
  HausButton,
  HausSwitch,
  Pressable,
  Row,
  Stack,
  Text,
  TextInput,
} from '../../primitives/index.js';
import { UiIcon } from '../icon.js';

export function humanizeFlowSlug(name: string): string {
  return name.replaceAll('_', ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function extractSelectOptions(
  field: FlowFormFieldRecord,
): readonly { readonly value: string; readonly label: string }[] {
  const selectCfg =
    field.selector && typeof field.selector.select === 'object' && field.selector.select !== null
      ? (field.selector.select as Readonly<Record<string, unknown>>)
      : undefined;
  const raw = field.options ?? (selectCfg?.options as FlowFormFieldRecord['options']);
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.flatMap((entry) => {
      if (typeof entry === 'string' || typeof entry === 'number') {
        const val = String(entry);
        return [{ value: val, label: val }];
      }
      if (Array.isArray(entry) && entry.length >= 2) {
        return [{ value: String(entry[0]), label: String(entry[1]) }];
      }
      if (entry && typeof entry === 'object' && 'value' in entry) {
        const rec = entry as Readonly<Record<string, unknown>>;
        const value = String(rec.value);
        return [{ value, label: typeof rec.label === 'string' ? rec.label : value }];
      }
      return [];
    });
  }
  return Object.entries(raw).map(([value, label]) => ({ value, label: String(label) }));
}

export function FlowFieldInput({
  field,
  step,
  value,
  error,
  disabled,
  onChange,
}: {
  readonly field: FlowFormFieldRecord;
  readonly step: FlowStepRecord;
  readonly value: unknown;
  readonly error?: string;
  readonly disabled: boolean;
  readonly onChange: (next: unknown) => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const label = step.field_labels?.[field.name] ?? field.label ?? humanizeFlowSlug(field.name);
  const description =
    step.data_descriptions?.[field.name] ??
    (typeof field.description === 'string' ? field.description : undefined);

  if (field.schema) {
    const nested =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Readonly<Record<string, unknown>>)
        : {};
    return (
      <Stack
        gapPx={10}
        style={{
          layout: { width: pct(100), padding: insets(12) },
          material: new SolidMaterial(colorToken('surfaceSecondary')),
          border: { width: 1, color: colorToken('border') },
          corners: corners(12),
        }}
      >
        <Text size={12.5} weight={600}>
          {label}
        </Text>
        {field.schema.map((child) => (
          <FlowFieldInput
            key={child.name}
            field={child}
            step={step}
            value={nested[child.name]}
            disabled={disabled}
            onChange={(childVal) => onChange({ ...nested, [child.name]: childVal })}
          />
        ))}
      </Stack>
    );
  }

  const isBoolean = field.type === 'boolean' || Boolean(field.selector && 'boolean' in field.selector);
  if (isBoolean) {
    return (
      <Stack gapPx={4}>
        <Row justify="between" align="center" gapPx={12}>
          <Stack gapPx={2} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
            <Text size={13}>{label}</Text>
            {description && (
              <Text size={11.5} tone="muted">
                {description}
              </Text>
            )}
          </Stack>
          <HausSwitch
            id={`flow-field-${field.name}`}
            aria-label={label}
            isSelected={Boolean(value)}
            isDisabled={disabled}
            onChange={(checked) => onChange(checked)}
          />
        </Row>
        {error && <Text size={11.5} tone="critical">{error}</Text>}
      </Stack>
    );
  }

  const selectOptions = extractSelectOptions(field);
  if (selectOptions.length > 0 && selectOptions.length <= 8) {
    const activeVal = value === undefined ? '' : String(value);
    return (
      <Stack gapPx={6}>
        <Text size={12} weight={600}>
          {label}
        </Text>
        <Row gapPx={8} wrap>
          {selectOptions.map((opt) => {
            const selected = activeVal === opt.value;
            return (
              <Pressable
                key={opt.value}
                id={`flow-field-${field.name}-${opt.value}`}
                ariaPressed={selected}
                disabled={disabled}
                onActivate={() => onChange(opt.value)}
                style={{
                  layout: { padding: insets(6, 12) },
                  material: new SolidMaterial(
                    selected ? colorToken('surfaceActive') : colorToken('surfaceSecondary'),
                  ),
                  border: { width: 1, color: selected ? colorToken('accent') : colorToken('border') },
                  corners: corners(999),
                }}
              >
                <Text size={12} weight={selected ? 600 : 500}>
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </Row>
        {description && <Text size={11.5} tone="muted">{description}</Text>}
        {error && <Text size={11.5} tone="critical">{error}</Text>}
      </Stack>
    );
  }

  const isPassword =
    field.type === 'password' ||
    Boolean(field.selector && 'password' in field.selector) ||
    /password|token|secret|api_key|local_key/i.test(field.name);
  const textValue = value === undefined || value === null ? '' : String(value);

  return (
    <Stack gapPx={5}>
      <Row justify="between" align="center">
        <Text size={12} weight={600}>
          {field.required && field.optional !== true ? `${label} *` : label}
        </Text>
        {isPassword && (
          <HausButton variant="ghost" size="sm" onPress={() => setRevealed((prev) => !prev)}>
            <UiIcon name={revealed ? 'eye-off' : 'eye'} size={13} />
            <Text size={11}>{revealed ? 'Hide' : 'Show'}</Text>
          </HausButton>
        )}
      </Row>
      <TextInput
        id={`flow-field-${field.name}`}
        ariaLabel={label}
        inputType={isPassword && !revealed ? 'password' : 'text'}
        value={textValue}
        placeholder={field.placeholder ?? ''}
        disabled={disabled}
        onChange={(next) => {
          if (field.type === 'integer') {
            if (!next.trim()) onChange('');
            else onChange(/^-?\d+$/.test(next.trim()) ? Number.parseInt(next.trim(), 10) : next);
          } else if (field.type === 'float' || field.type === 'number') {
            if (!next.trim()) onChange('');
            else {
              const parsed = Number(next);
              onChange(Number.isFinite(parsed) && !next.endsWith('.') ? parsed : next);
            }
          } else {
            onChange(next);
          }
        }}
        style={{
          layout: { width: pct(100), minHeight: px(38), padding: insets(8, 12) },
          material: new SolidMaterial(colorToken('surfaceSecondary')),
          border: { width: 1, color: error ? colorToken('critical') : colorToken('border') },
          corners: corners(10),
          typography: { size: 13, color: colorToken('textPrimary') },
        }}
      />
      {description && <Text size={11.5} tone="muted">{description}</Text>}
      {error && <Text size={11.5} tone="critical">{error}</Text>}
    </Stack>
  );
}
