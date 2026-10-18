import { useState } from 'react';
import type { Snapshot } from '../../model';
import { humanize, type FormField } from '../../ha/management';

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
  label = humanize,
  errors = {},
}: {
  schema: FormField[];
  values: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  snapshot: Snapshot;
  label?: (key: string) => string;
  errors?: Record<string, string>;
}) {
  return (
    <div className="management-fields">
      {schema.map((field) => {
        const key = field.name;
        const set = (value: unknown) => onChange({ ...values, [key]: value });
        const selector = field.selector ?? {};
        const type = Object.keys(selector)[0] ?? field.type ?? 'string';
        const config = selector[type] ?? {};
        const value = values[key];
        const caption = label(key);
        if (field.schema)
          return (
            <fieldset key={key}>
              <legend>{caption}</legend>
              <SchemaFields
                schema={field.schema}
                values={(value ?? {}) as Record<string, unknown>}
                onChange={set}
                snapshot={snapshot}
              />
            </fieldset>
          );
        if (['boolean', 'bool'].includes(type))
          return (
            <label key={key} className="management-check">
              <input
                type="checkbox"
                checked={value === true}
                onChange={(event) => set(event.target.checked)}
              />
              <span>{caption}</span>
              {errors[key] && <small className="form-error">{errors[key]}</small>}
            </label>
          );
        let options: { value: string; label: string }[] = [];
        const rawOptions = config.options ?? field.options;
        if (Array.isArray(rawOptions))
          options = rawOptions.map((item) =>
            typeof item === 'object'
              ? { value: String(item.value), label: item.label ?? String(item.value) }
              : { value: String(item), label: String(item) },
          );
        else if (rawOptions && typeof rawOptions === 'object')
          options = Object.entries(rawOptions).map(([value, label]) => ({
            value,
            label: String(label),
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
        const multiple = config.multiple || field.multiple || type === 'multi_select';
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
        const number = ['number', 'integer', 'float', 'positive_int'].includes(type);
        const inputType = number
          ? 'number'
          : ['date', 'time', 'datetime-local', 'url', 'email', 'password'].includes(type)
            ? type
            : config.type === 'password' || /password|api_key|token|secret/i.test(key)
              ? 'password'
              : config.type === 'url'
                ? 'url'
                : 'text';
        return (
          <label className="management-field" key={key}>
            <span>
              {caption}
              {field.required && <i aria-label="required"> *</i>}
            </span>
            {options.length && !config.custom_value ? (
              <select
                required={field.required}
                multiple={multiple}
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
            ) : (
              <input
                type={inputType}
                autoComplete={inputType === 'password' ? 'new-password' : 'off'}
                required={field.required}
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
            {errors[key] && <small className="form-error">{errors[key]}</small>}
          </label>
        );
      })}
    </div>
  );
}
