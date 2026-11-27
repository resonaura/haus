/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useState } from 'react';
import { colorToken, corners, insets, pct, px } from '../../../ir/geometry.js';
import { SolidMaterial } from '../../../ir/materials.js';
import {
  Box,
  HausButton,
  HausTextArea,
  Row,
  Stack,
  Text,
  TextInput,
} from '../../../primitives/index.js';
import { ManagementGlassCard } from '../../brand/index.js';
import { UiIcon } from '../../icon.js';
import { asFieldRec } from './field-select.js';

export {
  asFieldRec,
  extractFlowSelectOptions,
  SelectFlowField,
  type FlowFieldSnapshotContext,
} from './field-select.js';

export const FLOW_FIELD_INPUT_STYLE = {
  layout: { width: pct(100), minHeight: px(38), padding: insets(8, 12) },
  material: new SolidMaterial(colorToken('surface')),
  corners: corners(11),
  typography: { size: 13, color: colorToken('textPrimary') },
} as const;

export function StructuredJsonFlowField({
  id,
  label,
  value,
  description,
  error,
  disabled,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: unknown;
  readonly description?: string;
  readonly error?: string;
  readonly disabled: boolean;
  readonly onChange: (next: unknown) => void;
}) {
  const [draft, setDraft] = useState(() =>
    typeof value === 'string' ? value : JSON.stringify(value ?? {}, null, 2),
  );
  const [parseError, setParseError] = useState('');
  return (
    <Stack gapPx={5} style={{ layout: { width: pct(100) } }}>
      <Text size={12} weight={600}>
        {label}
      </Text>
      <HausTextArea
        id={id}
        ariaLabel={label}
        rows={4}
        spellCheck={false}
        value={draft}
        disabled={disabled}
        onChange={(next) => {
          setDraft(next);
          try {
            const parsed = JSON.parse(next) as unknown;
            setParseError('');
            onChange(parsed);
          } catch {
            setParseError('Enter valid JSON');
          }
        }}
        style={{
          layout: { width: pct(100), padding: insets(8, 12) },
          material: new SolidMaterial(colorToken('surface')),
          border: {
            width: 1,
            color: parseError || error ? colorToken('critical') : colorToken('border'),
          },
          corners: corners(11),
          typography: { fontFamily: 'mono', size: 12, color: colorToken('textPrimary') },
        }}
      />
      {description && !parseError && !error && (
        <Text size={11.5} tone="muted">
          {description}
        </Text>
      )}
      {(parseError || error) && (
        <Text size={11.5} tone="critical">
          {parseError || error}
        </Text>
      )}
    </Stack>
  );
}

export function QrCodeFlowField({
  label,
  qrData,
  description,
  onCopyText,
}: {
  readonly label: string;
  readonly qrData: string;
  readonly description?: string;
  readonly onCopyText?: (text: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <ManagementGlassCard
      radius={16}
      padding={insets(14)}
      style={{ layout: { width: pct(100), gap: px(8) } }}
    >
      <Row align="center" justify="between" gapPx={8}>
        <Row align="center" gapPx={8}>
          <UiIcon name="qr-code" size={16} />
          <Text size={13} weight={600}>
            {label}
          </Text>
        </Row>
        {qrData && onCopyText && (
          <HausButton
            variant="secondary"
            size="sm"
            onPress={() => {
              onCopyText(qrData);
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            }}
          >
            <UiIcon name={copied ? 'check' : 'copy'} size={13} />
            <Text size={11.5}>{copied ? 'Copied' : 'Copy'}</Text>
          </HausButton>
        )}
      </Row>
      {description && (
        <Text size={12} tone="muted">
          {description}
        </Text>
      )}
      <Box
        style={{
          layout: { width: pct(100), padding: insets(10, 12) },
          material: new SolidMaterial(colorToken('surface')),
          border: { width: 1, color: colorToken('borderSubtle') },
          corners: corners(10),
        }}
      >
        <Text size={12} mono>
          {qrData || 'Waiting for QR payload from integration…'}
        </Text>
      </Box>
    </ManagementGlassCard>
  );
}

export function LocationFlowField({
  label,
  displayLabel,
  value,
  enableRadius,
  description,
  error,
  disabled,
  onChange,
}: {
  readonly label: string;
  readonly displayLabel: string;
  readonly value: unknown;
  readonly enableRadius: boolean;
  readonly description?: string;
  readonly error?: string;
  readonly disabled: boolean;
  readonly onChange: (next: unknown) => void;
}) {
  const loc = asFieldRec(value) ?? {};
  const updateLoc = (
    patch: Partial<Record<'latitude' | 'longitude' | 'radius', number | undefined>>,
  ) => {
    const next: Record<string, number> = {};
    const lat = patch.latitude ?? (typeof loc.latitude === 'number' ? loc.latitude : undefined);
    const lon = patch.longitude ?? (typeof loc.longitude === 'number' ? loc.longitude : undefined);
    const rad = patch.radius ?? (typeof loc.radius === 'number' ? loc.radius : undefined);
    if (lat !== undefined && Number.isFinite(lat)) next.latitude = lat;
    if (lon !== undefined && Number.isFinite(lon)) next.longitude = lon;
    if (rad !== undefined && Number.isFinite(rad)) next.radius = rad;
    onChange(next);
  };
  return (
    <Stack gapPx={5} style={{ layout: { width: pct(100) } }}>
      <Text size={12} weight={600}>
        {displayLabel}
      </Text>
      <Row gapPx={8} wrap style={{ layout: { width: pct(100) } }}>
        <TextInput
          ariaLabel={`${label} latitude`}
          placeholder="Latitude"
          value={typeof loc.latitude === 'number' ? String(loc.latitude) : ''}
          disabled={disabled}
          onChange={(v) => updateLoc({ latitude: v === '' ? undefined : Number(v) })}
          style={{
            ...FLOW_FIELD_INPUT_STYLE,
            layout: { ...FLOW_FIELD_INPUT_STYLE.layout, flexGrow: 1, minWidth: px(110) },
            border: { width: 1, color: colorToken('border') },
          }}
        />
        <TextInput
          ariaLabel={`${label} longitude`}
          placeholder="Longitude"
          value={typeof loc.longitude === 'number' ? String(loc.longitude) : ''}
          disabled={disabled}
          onChange={(v) => updateLoc({ longitude: v === '' ? undefined : Number(v) })}
          style={{
            ...FLOW_FIELD_INPUT_STYLE,
            layout: { ...FLOW_FIELD_INPUT_STYLE.layout, flexGrow: 1, minWidth: px(110) },
            border: { width: 1, color: colorToken('border') },
          }}
        />
        {enableRadius && (
          <TextInput
            ariaLabel={`${label} radius`}
            placeholder="Radius (m)"
            value={typeof loc.radius === 'number' ? String(loc.radius) : ''}
            disabled={disabled}
            onChange={(v) => updateLoc({ radius: v === '' ? undefined : Number(v) })}
            style={{
              ...FLOW_FIELD_INPUT_STYLE,
              layout: { ...FLOW_FIELD_INPUT_STYLE.layout, flexGrow: 1, minWidth: px(90) },
              border: { width: 1, color: colorToken('border') },
            }}
          />
        )}
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

export function DurationFlowField({
  label,
  displayLabel,
  value,
  enableDay,
  description,
  error,
  disabled,
  onChange,
}: {
  readonly label: string;
  readonly displayLabel: string;
  readonly value: unknown;
  readonly enableDay: boolean;
  readonly description?: string;
  readonly error?: string;
  readonly disabled: boolean;
  readonly onChange: (next: unknown) => void;
}) {
  const dur = asFieldRec(value) ?? {};
  const updateDur = (part: 'days' | 'hours' | 'minutes' | 'seconds', rawVal: string) => {
    const next: Record<string, unknown> = { ...dur };
    const num = rawVal === '' ? Number.NaN : Number(rawVal);
    if (Number.isFinite(num) && num >= 0) next[part] = Math.trunc(num);
    else delete next[part];
    onChange(next);
  };
  const parts: readonly {
    readonly key: 'days' | 'hours' | 'minutes' | 'seconds';
    readonly label: string;
  }[] = [
    ...(enableDay ? [{ key: 'days' as const, label: 'Days' }] : []),
    { key: 'hours', label: 'Hours' },
    { key: 'minutes', label: 'Min' },
    { key: 'seconds', label: 'Sec' },
  ];
  return (
    <Stack gapPx={5} style={{ layout: { width: pct(100) } }}>
      <Text size={12} weight={600}>
        {displayLabel}
      </Text>
      <Row gapPx={8} wrap style={{ layout: { width: pct(100) } }}>
        {parts.map((part) => (
          <TextInput
            key={part.key}
            ariaLabel={`${label} ${part.label}`}
            placeholder={part.label}
            value={typeof dur[part.key] === 'number' ? String(dur[part.key]) : ''}
            disabled={disabled}
            onChange={(v) => updateDur(part.key, v)}
            style={{
              ...FLOW_FIELD_INPUT_STYLE,
              layout: { ...FLOW_FIELD_INPUT_STYLE.layout, flexGrow: 1, minWidth: px(72) },
              border: { width: 1, color: colorToken('border') },
            }}
          />
        ))}
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
