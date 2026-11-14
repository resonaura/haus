/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useState, useEffect } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import type { Snapshot } from '../../model';
import { humanize, type FormField } from '../../ha/management';
import { QrCodeField } from './QrCodeField';
import { renderHaSelectorField, type RichSelectorConfig } from './HaSelectorFields';

interface SelectorFilter {
  domain?: string | string[];
  integration?: string;
  manufacturer?: string;
  model?: string;
}

interface SelectorConfig extends RichSelectorConfig {
  data?: unknown;
  label?: unknown;
  value?: unknown;
  options?: unknown;
  filter?: SelectorFilter;
  domain?: string | string[];
  integration?: string;
  manufacturer?: string;
  model?: string;
  multiple?: boolean;
  mode?: string;
  type?: string;
  error_correction_level?: unknown;
}

export function JsonField({
  label,
  value,
  onChange,
  required = false,
}: {
  label: string;
  value: unknown;
  onChange: (value: unknown) => void;
  required?: boolean;
}) {
  const [draft, setDraft] = useState(() => JSON.stringify(value ?? {}, null, 2));
  const [error, setError] = useState('');
  useEffect(() => {
    try {
      if (JSON.stringify(JSON.parse(draft)) === JSON.stringify(value ?? {})) return;
    } catch {
      /* Preserve incomplete edits until the parent configuration changes. */
    }
    setDraft(JSON.stringify(value ?? {}, null, 2));
  }, [value]);
  const [shape] = useState(() => (Array.isArray(value) ? 'array' : 'object'));
  return (
    <label className="management-field">
      <span>{label}</span>
      <textarea
        spellCheck={false}
        required={required}
        value={draft}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          try {
            const parsed = JSON.parse(next);
            if (
              shape === 'array'
                ? !Array.isArray(parsed)
                : parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)
            )
              throw new Error('Invalid configuration type');
            event.target.setCustomValidity('');
            setError('');
            onChange(parsed);
          } catch {
            event.target.setCustomValidity('Enter valid JSON');
            setError('Enter valid JSON');
          }
        }}
      />
      <small className={error ? 'form-error' : ''}>{error || 'JSON configuration'}</small>
    </label>
  );
}

export function SchemaFields({
  schema,
  values,
  onChange,
  snapshot,
  label = (key, field) => field?.label || humanize(key),
  description,
  selectorOptions,
  errors = {},
}: {
  schema: FormField[];
  values: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  snapshot: Snapshot;
  label?: (key: string, field?: FormField) => string;
  description?: (key: string, field?: FormField) => string | undefined;
  selectorOptions?: (key: string, field?: FormField) => Record<string, string> | undefined;
  errors?: Record<string, string>;
}) {
  const [revealedSecrets, setRevealedSecrets] = useState<Record<string, boolean>>({});

  return (
    <div className="management-fields">
      {schema.map((field) => {
        const key = field.name;
        const set = (value: unknown) => onChange({ ...values, [key]: value });
        const selector = field.selector ?? {};
        const type = Object.keys(selector)[0] ?? field.type ?? 'string';
        const config = (selector[type] ?? {}) as SelectorConfig;
        const value = values[key];
        const caption = label(key, field);
        const fieldDesc =
          description?.(key, field) ??
          (typeof field.description === 'string' ? field.description : undefined);

        if (field.schema) {
          const childErrors = Object.fromEntries(
            Object.entries(errors)
              .filter(([errKey]) => errKey.startsWith(`${key}.`))
              .map(([errKey, errVal]) => [errKey.slice(key.length + 1), errVal]),
          );
          const nestedNode = (
            <SchemaFields
              schema={field.schema}
              values={(value ?? {}) as Record<string, unknown>}
              onChange={set}
              snapshot={snapshot}
              label={(subKey, subField) => label(`${key}.${subKey}`, subField)}
              description={
                description
                  ? (subKey, subField) => description(`${key}.${subKey}`, subField)
                  : undefined
              }
              selectorOptions={
                selectorOptions
                  ? (subKey, subField) => selectorOptions(`${key}.${subKey}`, subField)
                  : undefined
              }
              errors={childErrors}
            />
          );
          if (type === 'expandable' || field.type === 'expandable') {
            return (
              <details key={key} className="management-expandable" open={Boolean(field.expanded)}>
                <summary>{caption}</summary>
                {fieldDesc && <small className="management-field-desc">{fieldDesc}</small>}
                {nestedNode}
              </details>
            );
          }
          return (
            <fieldset key={key}>
              <legend>{caption}</legend>
              {fieldDesc && <small className="management-field-desc">{fieldDesc}</small>}
              {nestedNode}
            </fieldset>
          );
        }
        if (type === 'qr_code' || field.type === 'qr_code') {
          const qrData = String(config.data ?? value ?? field.default ?? '');
          return (
            <QrCodeField
              key={key}
              label={caption}
              data={qrData}
              description={fieldDesc}
              errorCorrectionLevel={config.error_correction_level}
            />
          );
        }
        if (type === 'constant') {
          return (
            <div key={key} className="management-field">
              <span>{caption}</span>
              <div className="management-notice">
                {String(config.label ?? config.value ?? value ?? '')}
              </div>
            </div>
          );
        }
        if (['boolean', 'bool'].includes(type))
          return (
            <label key={key} className="management-check">
              <input
                type="checkbox"
                checked={value === true}
                onChange={(event) => set(event.target.checked)}
              />
              <span>
                {caption}
                {fieldDesc && <small className="management-field-desc"> — {fieldDesc}</small>}
              </span>
              {errors[key] && <small className="form-error">{errors[key]}</small>}
            </label>
          );
        let options: { value: string; label: string }[] = [];
        const rawOptions = config.options ?? field.options;
        if (Array.isArray(rawOptions))
          options = rawOptions.map((item) =>
            typeof item === 'object' && item !== null
              ? { value: String(item.value), label: item.label ?? String(item.value) }
              : { value: String(item), label: String(item) },
          );
        else if (rawOptions && typeof rawOptions === 'object')
          options = Object.entries(rawOptions).map(([val, lbl]) => ({
            value: val,
            label: String(lbl),
          }));
        if (type === 'entity') {
          const domains = config.filter?.domain ?? config.domain;
          const allowed = domains ? (Array.isArray(domains) ? domains : [domains]) : [];
          options = snapshot.states
            .filter((s) => !allowed.length || allowed.includes(s.entity_id.split('.')[0]))
            .map((s) => ({
              value: s.entity_id,
              label: `${s.attributes.friendly_name ?? s.entity_id} · ${s.entity_id}`,
            }));
        } else if (type === 'device') {
          const filter = config.filter ?? config;
          options = snapshot.devices
            .filter(
              (device) =>
                (!filter.integration ||
                  snapshot.entities.some(
                    (entry) =>
                      entry.device_id === device.id && entry.platform === filter.integration,
                  )) &&
                (!filter.manufacturer || device.manufacturer === filter.manufacturer) &&
                (!filter.model || device.model === filter.model),
            )
            .map((d) => ({
              value: d.id,
              label: d.name_by_user ?? d.name ?? d.id,
            }));
        } else if (type === 'area')
          options = snapshot.areas.map((a) => ({ value: a.area_id, label: a.name }));

        const optionTranslations = selectorOptions?.(key, field);
        if (optionTranslations && options.length > 0) {
          options = options.map((opt) => ({
            ...opt,
            label: optionTranslations[opt.value] ?? opt.label,
          }));
        }

        const richField = renderHaSelectorField({
          fieldKey: key,
          type,
          field,
          config,
          value,
          values,
          caption,
          description: fieldDesc,
          error: errors[key],
          options,
          snapshot,
          set,
        });
        if (richField) return richField;

        if (
          [
            'object',
            'dict',
            'list',
            'target',
            'action',
            'condition',
            'trigger',
            'template',
          ].includes(type)
        )
          return (
            <JsonField
              key={key}
              label={caption}
              value={value ?? (type === 'list' ? [] : {})}
              onChange={set}
              required={field.required}
            />
          );
        const multiple = Boolean(config.multiple || field.multiple || type === 'multi_select');
        if ((multiple || Array.isArray(value)) && !options.length)
          return (
            <JsonField
              key={key}
              label={caption}
              value={value ?? []}
              onChange={set}
              required={field.required}
            />
          );

        if (options.length > 0 && !config.custom_value && !multiple && config.mode === 'list') {
          return (
            <div className="management-field" key={key}>
              <span>
                {caption}
                {field.required && <i aria-label="required"> *</i>}
              </span>
              {fieldDesc && <small className="management-field-desc">{fieldDesc}</small>}
              <div className="flow-radio-inline" role="radiogroup" aria-label={caption}>
                {options.map((option) => {
                  const active = String(value ?? '') === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      className={`flow-action-option ${active ? 'is-selected' : ''}`}
                      onClick={() => set(option.value)}
                    >
                      <span className="flow-radio-dot" aria-hidden="true" />
                      <span>{option.label}</span>
                    </button>
                  );
                })}
              </div>
              {errors[key] && <small className="form-error">{errors[key]}</small>}
            </div>
          );
        }

        const number = ['number', 'integer', 'float', 'positive_int', 'duration'].includes(type);
        const isSecret =
          type === 'password' ||
          config.type === 'password' ||
          /password|api_key|token|secret/i.test(key);
        const inputType = number
          ? 'number'
          : ['date', 'time', 'datetime-local', 'url', 'email'].includes(type)
            ? type
            : config.type === 'url'
              ? 'url'
              : config.type === 'email'
                ? 'email'
                : isSecret
                  ? revealedSecrets[key]
                    ? 'text'
                    : 'password'
                  : 'text';
        const placeholder =
          field.placeholder ??
          (type === 'country' ? 'e.g. US or UA' : type === 'language' ? 'e.g. en' : undefined);

        const hasError = Boolean(errors[key]);
        return (
          <label className={`management-field${hasError ? ' has-error' : ''}`} key={key}>
            <span>
              {caption}
              {field.required && <i aria-label="required"> *</i>}
            </span>
            {options.length && !config.custom_value ? (
              <select
                required={field.required}
                multiple={multiple}
                aria-invalid={hasError || undefined}
                value={
                  multiple ? (Array.isArray(value) ? value.map(String) : []) : String(value ?? '')
                }
                onChange={(event) =>
                  set(
                    multiple
                      ? [...event.target.selectedOptions].map((o) => o.value)
                      : event.target.value,
                  )
                }
              >
                {!multiple && <option value="">Choose…</option>}
                {options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : isSecret ? (
              <div className="management-password-wrap">
                <input
                  type={inputType}
                  autoComplete="new-password"
                  required={field.required}
                  aria-invalid={hasError || undefined}
                  placeholder={placeholder}
                  value={typeof value === 'string' || typeof value === 'number' ? value : ''}
                  onChange={(event) => set(event.target.value)}
                />
                <button
                  type="button"
                  className="management-password-toggle"
                  aria-label={revealedSecrets[key] ? 'Hide value' : 'Show value'}
                  onClick={() => setRevealedSecrets((prev) => ({ ...prev, [key]: !prev[key] }))}
                >
                  {revealedSecrets[key] ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            ) : (
              <input
                type={inputType}
                autoComplete="off"
                required={field.required}
                aria-invalid={hasError || undefined}
                placeholder={placeholder}
                min={config.min ?? field.value_min}
                max={config.max ?? field.value_max}
                step={config.step ?? (type === 'integer' || type === 'positive_int' ? 1 : 'any')}
                value={typeof value === 'string' || typeof value === 'number' ? value : ''}
                onChange={(event) => {
                  if (number && event.target.value !== '') set(event.target.valueAsNumber);
                  else set(event.target.value);
                }}
              />
            )}
            {fieldDesc && !errors[key] && <small>{fieldDesc}</small>}
            {errors[key] && (
              <small className="form-error" role="alert">
                {errors[key]}
              </small>
            )}
          </label>
        );
      })}
    </div>
  );
}
