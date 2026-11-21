/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { useEffect, useState } from 'react';
import { Label, Switch } from '@heroui/react';
import type { AppOptionSchema, AppSecretDeclaration } from '@haus/apps';

export const REDACTED_SECRET_PLACEHOLDER = '<unchanged>';

const SECRET_KEY_RE = /^(?:.*[_-])?(?:pass(?:word)?|secret|token|api_?key)$/i;

export interface NativeConfigFieldMeta {
  readonly title?: string;
  readonly description?: string;
  readonly type?: 'string' | 'number' | 'boolean' | 'select' | 'object' | 'array';
  readonly secret?: boolean;
  readonly choices?: readonly (string | number)[];
}

function NestedJsonOption({
  name,
  label,
  description,
  value,
  disabled,
  onChange,
}: {
  readonly name: string;
  readonly label: string;
  readonly description?: string;
  readonly value: unknown;
  readonly disabled: boolean;
  readonly onChange: (next: unknown) => void;
}) {
  const [draft, setDraft] = useState(() => JSON.stringify(value, null, 2));
  const [syntaxError, setSyntaxError] = useState('');

  useEffect(() => {
    try {
      if (JSON.stringify(JSON.parse(draft)) === JSON.stringify(value)) return;
    } catch {
      // Preserve in-progress user edits while invalid.
    }
    setDraft(JSON.stringify(value, null, 2));
    setSyntaxError('');
  }, [value]);

  const rows = Math.min(12, Math.max(3, draft.split('\n').length));
  return (
    <label className="native-app-field" key={name}>
      <span>{label}</span>
      <textarea
        className="native-app-json"
        rows={rows}
        disabled={disabled}
        spellCheck={false}
        value={draft}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          try {
            const parsed: unknown = JSON.parse(next);
            if (
              Array.isArray(value)
                ? !Array.isArray(parsed)
                : typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)
            ) {
              setSyntaxError(
                Array.isArray(value) ? 'Must be a JSON array.' : 'Must be a JSON object.',
              );
              return;
            }
            setSyntaxError('');
            onChange(parsed);
          } catch {
            setSyntaxError('Enter valid JSON.');
          }
        }}
      />
      {syntaxError ? (
        <small className="form-error">{syntaxError}</small>
      ) : (
        description && <small>{description}</small>
      )}
    </label>
  );
}

/**
 * Renders an installed App's exact native configuration keys without overriding or dropping
 * native properties (such as Homebridge `lightDevices` or HA add-on `mqtt` / `options.json`).
 */
export function NativeAppConfigFields({
  values,
  configuredSecrets,
  fieldMeta,
  disabled,
  onChange,
}: {
  readonly values: Record<string, unknown>;
  readonly configuredSecrets?: ReadonlySet<string>;
  readonly fieldMeta?: Readonly<Record<string, NativeConfigFieldMeta>>;
  readonly disabled: boolean;
  readonly onChange: (name: string, value: unknown) => void;
}) {
  const keys = Object.keys(values);
  if (keys.length === 0) {
    return (
      <p className="management-hint">
        No native configuration keys recorded yet. Switch to JSON to add options.
      </p>
    );
  }

  return (
    <div className="native-app-fields">
      {keys.map((key) => {
        const value = values[key];
        const meta = fieldMeta?.[key];
        const label = meta?.title || key;
        const isSecret =
          value === REDACTED_SECRET_PLACEHOLDER ||
          Boolean(configuredSecrets?.has(key)) ||
          meta?.secret === true ||
          SECRET_KEY_RE.test(key);

        if (isSecret && (typeof value === 'string' || value === undefined || value === null)) {
          const isUnchanged = value === REDACTED_SECRET_PLACEHOLDER;
          return (
            <label className="native-app-field" key={key}>
              <span>{label}</span>
              <input
                type="password"
                autoComplete="new-password"
                disabled={disabled}
                placeholder={
                  isUnchanged || configuredSecrets?.has(key)
                    ? 'Configured — leave blank to keep current value'
                    : ''
                }
                value={isUnchanged ? '' : typeof value === 'string' ? value : ''}
                onChange={(event) => {
                  const next = event.target.value;
                  onChange(
                    key,
                    next === '' && configuredSecrets?.has(key) ? REDACTED_SECRET_PLACEHOLDER : next,
                  );
                }}
              />
              {meta?.description && <small>{meta.description}</small>}
            </label>
          );
        }

        if (typeof value === 'boolean') {
          return (
            <div className="native-app-toggle" key={key}>
              <Switch
                isSelected={value}
                isDisabled={disabled}
                onChange={(selected) => onChange(key, selected)}
              >
                <Switch.Content>
                  <Label>{label}</Label>
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                </Switch.Content>
              </Switch>
              {meta?.description && <small>{meta.description}</small>}
            </div>
          );
        }

        if (typeof value === 'number') {
          return (
            <label className="native-app-field" key={key}>
              <span>{label}</span>
              <input
                type="number"
                disabled={disabled}
                value={Number.isFinite(value) ? String(value) : ''}
                onChange={(event) => {
                  const raw = event.target.value;
                  if (raw === '') return;
                  const num = Number(raw);
                  if (Number.isFinite(num)) onChange(key, num);
                }}
              />
              {meta?.description && <small>{meta.description}</small>}
            </label>
          );
        }

        if (value !== null && typeof value === 'object') {
          return (
            <NestedJsonOption
              key={key}
              name={key}
              label={label}
              description={meta?.description}
              value={value}
              disabled={disabled}
              onChange={(next) => onChange(key, next)}
            />
          );
        }

        if (meta?.choices && meta.choices.length > 0) {
          const stringVal = value == null ? '' : String(value);
          const choices = meta.choices.map(String);
          const optionsList =
            choices.includes(stringVal) || !stringVal ? choices : [stringVal, ...choices];
          return (
            <label className="native-app-field" key={key}>
              <span>{label}</span>
              <select
                disabled={disabled}
                value={stringVal}
                onChange={(event) => onChange(key, event.target.value)}
              >
                {optionsList.map((choice) => (
                  <option key={choice} value={choice}>
                    {choice}
                  </option>
                ))}
              </select>
              {meta.description && <small>{meta.description}</small>}
            </label>
          );
        }

        return (
          <label className="native-app-field" key={key}>
            <span>{label}</span>
            <input
              type="text"
              disabled={disabled}
              value={value == null ? '' : String(value)}
              onChange={(event) => onChange(key, event.target.value)}
            />
            {meta?.description && <small>{meta.description}</small>}
          </label>
        );
      })}
    </div>
  );
}

export function AppConfigFields({
  options,
  secrets,
  values,
  disabled,
  jsonText,
  onJsonChange,
  onChange,
  secretsOptional,
}: {
  options?: readonly AppOptionSchema[];
  secrets?: readonly AppSecretDeclaration[];
  values: Record<string, unknown>;
  disabled: boolean;
  jsonText?: string;
  onJsonChange?: (value: string) => void;
  onChange: (name: string, value: unknown) => void;
  secretsOptional?: boolean;
}) {
  const hasSchemaFields = Boolean(
    (options && options.length > 0) || (secrets && secrets.length > 0),
  );
  if (!hasSchemaFields && onJsonChange !== undefined) {
    return (
      <div className="native-app-fields">
        <label className="native-app-field">
          <span>Configuration (JSON)</span>
          <textarea
            rows={4}
            value={jsonText ?? '{}'}
            disabled={disabled}
            onChange={(event) => onJsonChange(event.target.value)}
            spellCheck={false}
          />
          <small>Optional JSON object passed to this App runtime.</small>
        </label>
      </div>
    );
  }
  if (!hasSchemaFields) return null;
  return (
    <div className="native-app-fields">
      {secrets?.map((secret) => (
        <label className="native-app-field" key={secret.name}>
          <span>
            {secret.name}
            {secret.required && !secretsOptional ? ' *' : ''}
          </span>
          <input
            type="password"
            autoComplete="new-password"
            disabled={disabled}
            placeholder={secretsOptional ? 'Leave blank to keep current value' : ''}
            value={typeof values[secret.name] === 'string' ? String(values[secret.name]) : ''}
            onChange={(event) => onChange(secret.name, event.target.value)}
          />
          {secret.description && <small>{secret.description}</small>}
        </label>
      ))}
      {options?.map((opt) => {
        if (opt.type === 'boolean') {
          return (
            <div className="native-app-toggle" key={opt.name}>
              <Switch
                isSelected={values[opt.name] === true}
                isDisabled={disabled}
                onChange={(selected) => onChange(opt.name, selected)}
              >
                <Switch.Content>
                  <Label>{opt.name}</Label>
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                </Switch.Content>
              </Switch>
              {opt.description && <small>{opt.description}</small>}
            </div>
          );
        }
        if (opt.type === 'select' && opt.choices && opt.choices.length > 0) {
          return (
            <label className="native-app-field" key={opt.name}>
              <span>
                {opt.name}
                {opt.required ? ' *' : ''}
              </span>
              <select
                disabled={disabled}
                value={String(values[opt.name] ?? opt.choices[0])}
                onChange={(event) => onChange(opt.name, event.target.value)}
              >
                {opt.choices.map((choice) => (
                  <option key={String(choice)} value={String(choice)}>
                    {String(choice)}
                  </option>
                ))}
              </select>
              {opt.description && <small>{opt.description}</small>}
            </label>
          );
        }
        return (
          <label className="native-app-field" key={opt.name}>
            <span>
              {opt.name}
              {opt.required ? ' *' : ''}
            </span>
            <input
              type={opt.type === 'number' ? 'number' : 'text'}
              disabled={disabled}
              placeholder={opt.type === 'list' ? 'Comma-separated values' : ''}
              value={values[opt.name] === undefined ? '' : String(values[opt.name])}
              onChange={(event) =>
                onChange(
                  opt.name,
                  opt.type === 'number'
                    ? event.target.value === ''
                      ? ''
                      : Number(event.target.value)
                    : event.target.value,
                )
              }
            />
            {opt.description && <small>{opt.description}</small>}
          </label>
        );
      })}
    </div>
  );
}
