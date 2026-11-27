/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useState } from 'react';
import type {
  FlowFormFieldRecord,
  FlowLocalizationHelpers,
  FlowStepRecord,
} from '@haus/core/transport';
import { colorToken, corners, insets, pct, px } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import {
  HausButton,
  HausDisclosure,
  HausSwitch,
  HausTextArea,
  Row,
  Stack,
  Text,
  TextInput,
} from '../../primitives/index.js';
import { ManagementGlassCard } from '../brand/index.js';
import { UiIcon } from '../icon.js';
import {
  asFieldRec,
  DurationFlowField,
  extractFlowSelectOptions,
  FLOW_FIELD_INPUT_STYLE,
  LocationFlowField,
  QrCodeFlowField,
  SelectFlowField,
  StructuredJsonFlowField,
  type FlowFieldSnapshotContext,
} from './flow/field-selectors.js';

export type { FlowFieldSnapshotContext } from './flow/field-selectors.js';

export function humanizeFlowSlug(name: string): string {
  return name.replaceAll('_', ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
}

/**
 * Rich Home Assistant schema field renderer for GPUIX and React DOM, supporting
 * localized labels/options, switches, radio cards, native `<HausSelect />` dropdowns,
 * multi-select pills, entity/device/area pickers, duration/location/JSON/QR,
 * password reveal, and collapsible sections.
 */
export function FlowFieldInput({
  field,
  step,
  value,
  error,
  fieldErrors,
  keyPrefix = '',
  disabled,
  localization,
  snapshot,
  onCopyText,
  onChange,
}: {
  readonly field: FlowFormFieldRecord;
  readonly step: FlowStepRecord;
  readonly value: unknown;
  readonly error?: string;
  readonly fieldErrors?: Readonly<Record<string, string>>;
  readonly keyPrefix?: string;
  readonly disabled: boolean;
  readonly localization?: FlowLocalizationHelpers;
  readonly snapshot?: FlowFieldSnapshotContext;
  readonly onCopyText?: (text: string) => void;
  readonly onChange: (next: unknown) => void;
}) {
  const [revealed, setRevealed] = useState(false);

  const fullKey = keyPrefix ? `${keyPrefix}.${field.name}` : field.name;
  const label = localization
    ? localization.fieldLabel(fullKey, field)
    : (step.field_labels?.[fullKey] ?? field.label ?? humanizeFlowSlug(field.name));
  const description = localization
    ? localization.fieldDescription(fullKey, field)
    : (step.data_descriptions?.[fullKey] ??
      (typeof field.description === 'string' ? field.description : undefined));
  const required = field.required === true && field.optional !== true;
  const displayLabel = required ? `${label} *` : label;

  const selector = field.selector ?? {};
  const selectorType = Object.keys(selector)[0] ?? field.type ?? 'string';
  const config = asFieldRec(selector[selectorType]) ?? {};

  if (field.schema) {
    const nested = asFieldRec(value) ?? {};
    const content = (
      <Stack gapPx={10} style={{ layout: { width: pct(100) } }}>
        {description && (
          <Text size={11.5} tone="muted">
            {description}
          </Text>
        )}
        {field.schema.map((child) => {
          const childFullKey = `${fullKey}.${child.name}`;
          const rawErr = fieldErrors?.[childFullKey] ?? step.errors?.[childFullKey];
          const childError = rawErr && localization ? localization.errorText(rawErr) : rawErr;
          return (
            <FlowFieldInput
              key={child.name}
              field={child}
              step={step}
              value={nested[child.name]}
              error={childError}
              fieldErrors={fieldErrors}
              keyPrefix={fullKey}
              disabled={disabled}
              localization={localization}
              snapshot={snapshot}
              onCopyText={onCopyText}
              onChange={(childVal) => onChange({ ...nested, [child.name]: childVal })}
            />
          );
        })}
      </Stack>
    );

    if (selectorType === 'expandable' || field.type === 'expandable') {
      return (
        <HausDisclosure
          defaultOpen={Boolean(field.expanded)}
          summary={label}
          style={{ layout: { width: pct(100) } }}
        >
          {content}
        </HausDisclosure>
      );
    }

    return (
      <ManagementGlassCard
        radius={16}
        padding={insets(12, 14)}
        style={{ layout: { width: pct(100), gap: px(10) } }}
      >
        <Text size={12.5} weight={600}>
          {label}
        </Text>
        {content}
      </ManagementGlassCard>
    );
  }

  if (selectorType === 'qr_code' || field.type === 'qr_code') {
    return (
      <QrCodeFlowField
        label={label}
        qrData={String(config.data ?? value ?? field.default ?? '')}
        description={description}
        onCopyText={onCopyText}
      />
    );
  }

  if (selectorType === 'constant') {
    return (
      <ManagementGlassCard
        radius={14}
        padding={insets(10, 12)}
        style={{ layout: { width: pct(100), gap: px(4) } }}
      >
        <Text size={11.5} weight={600} tone="muted">
          {label}
        </Text>
        <Text size={13} weight={500}>
          {String(config.label ?? config.value ?? value ?? '')}
        </Text>
      </ManagementGlassCard>
    );
  }

  if (selectorType === 'boolean' || selectorType === 'bool') {
    return (
      <Stack gapPx={4} style={{ layout: { width: pct(100) } }}>
        <Row
          justify="between"
          align="center"
          gapPx={12}
          style={{
            layout: { width: pct(100), padding: insets(10, 12) },
            material: new SolidMaterial(colorToken('surface')),
            border: {
              width: 1,
              color: error ? colorToken('critical') : colorToken('borderSubtle'),
            },
            corners: corners(12),
          }}
        >
          <Stack gapPx={2} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
            <Text size={13} weight={500}>
              {label}
            </Text>
            {description && (
              <Text
                size={11.5}
                tone="muted"
                style={{ typography: { size: 11.5, lineHeight: 1.35 } }}
              >
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
        {error && (
          <Text size={11.5} tone="critical">
            {error}
          </Text>
        )}
      </Stack>
    );
  }

  if (selectorType === 'location') {
    return (
      <LocationFlowField
        label={label}
        displayLabel={displayLabel}
        value={value}
        enableRadius={Boolean(config.radius)}
        description={description}
        error={error}
        disabled={disabled}
        onChange={onChange}
      />
    );
  }

  if (
    selectorType === 'duration' &&
    (field.selector?.duration !== undefined || Boolean(asFieldRec(value)))
  ) {
    return (
      <DurationFlowField
        label={label}
        displayLabel={displayLabel}
        value={value}
        enableDay={Boolean(config.enable_day)}
        description={description}
        error={error}
        disabled={disabled}
        onChange={onChange}
      />
    );
  }

  const translatedOpts = localization?.selectorOptions(fullKey, field);
  const selectOptions = extractFlowSelectOptions(
    field,
    selectorType,
    config,
    snapshot,
    translatedOpts,
  );
  const multiple = Boolean(config.multiple || field.multiple || selectorType === 'multi_select');

  if (selectOptions.length > 0 && !config.custom_value) {
    return (
      <SelectFlowField
        fieldName={field.name}
        label={label}
        displayLabel={displayLabel}
        options={selectOptions}
        value={value}
        multiple={multiple}
        listMode={config.mode === 'list'}
        required={required}
        description={description}
        error={error}
        disabled={disabled}
        onChange={onChange}
      />
    );
  }

  if (
    ['object', 'dict', 'list', 'target', 'action', 'condition', 'trigger'].includes(selectorType)
  ) {
    return (
      <StructuredJsonFlowField
        id={`flow-field-${field.name}`}
        label={displayLabel}
        value={value ?? (selectorType === 'list' ? [] : {})}
        description={description}
        error={error}
        disabled={disabled}
        onChange={onChange}
      />
    );
  }

  if (selectorType === 'template' || Boolean(config.multiline)) {
    const textValue = value === undefined || value === null ? '' : String(value);
    return (
      <Stack gapPx={5} style={{ layout: { width: pct(100) } }}>
        <Text size={12} weight={600}>
          {displayLabel}
        </Text>
        <HausTextArea
          id={`flow-field-${field.name}`}
          ariaLabel={label}
          rows={3}
          value={textValue}
          disabled={disabled}
          onChange={onChange}
          style={{
            layout: { width: pct(100), padding: insets(8, 12) },
            material: new SolidMaterial(colorToken('surface')),
            border: { width: 1, color: error ? colorToken('critical') : colorToken('border') },
            corners: corners(11),
            typography: { size: 12.5, color: colorToken('textPrimary') },
          }}
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

  const isPassword =
    selectorType === 'password' ||
    config.type === 'password' ||
    /password|token|secret|api_key|local_key/i.test(field.name);
  const textValue = value === undefined || value === null ? '' : String(value);
  const isInteger =
    selectorType === 'integer' || selectorType === 'positive_int' || field.type === 'integer';
  const isNumber =
    isInteger ||
    selectorType === 'float' ||
    selectorType === 'number' ||
    field.type === 'float' ||
    field.type === 'number';
  const minVal = typeof config.min === 'number' ? config.min : field.value_min;
  const maxVal = typeof config.max === 'number' ? config.max : field.value_max;
  const rangeHint =
    isNumber && (minVal !== undefined || maxVal !== undefined)
      ? `${minVal ?? ''}–${maxVal ?? ''}`
      : undefined;

  return (
    <Stack gapPx={5} style={{ layout: { width: pct(100) } }}>
      <Row justify="between" align="center">
        <Text size={12} weight={600}>
          {displayLabel}
        </Text>
        {isPassword ? (
          <HausButton variant="ghost" size="sm" onPress={() => setRevealed((prev) => !prev)}>
            <UiIcon name={revealed ? 'eye-off' : 'eye'} size={13} />
            <Text size={11}>{revealed ? 'Hide' : 'Show'}</Text>
          </HausButton>
        ) : rangeHint ? (
          <Text size={11} mono tone="muted">
            {rangeHint}
          </Text>
        ) : null}
      </Row>
      <TextInput
        id={`flow-field-${field.name}`}
        ariaLabel={label}
        inputType={isPassword && !revealed ? 'password' : 'text'}
        value={textValue}
        placeholder={field.placeholder ?? ''}
        disabled={disabled}
        onChange={(next) => {
          if (isInteger) {
            if (!next.trim()) onChange('');
            else onChange(/^-?\d+$/.test(next.trim()) ? Number.parseInt(next.trim(), 10) : next);
          } else if (isNumber) {
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
          ...FLOW_FIELD_INPUT_STYLE,
          border: { width: 1, color: error ? colorToken('critical') : colorToken('border') },
        }}
      />
      {description && !error && (
        <Text size={11.5} tone="muted" style={{ typography: { size: 11.5, lineHeight: 1.35 } }}>
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
