/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { useEffect, useState } from 'react';
import {
  REDACTED_SECRET_PLACEHOLDER,
  isSecretConfigKey,
  type NativeConfigFieldMeta,
} from '@haus/core/transport';
import { Box, HausSwitch, SelectInput, Text, TextArea, TextInput } from '@haus/ui';
import type { AppOptionSchema, AppSecretDeclaration } from '@haus/apps';

export { REDACTED_SECRET_PLACEHOLDER, type NativeConfigFieldMeta };

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
    <Text semantic="label" className="native-app-field" key={name}>
      <Text>{label}</Text>
      <TextArea
        className="native-app-json"
        rows={rows}
        disabled={disabled}
        spellCheck={false}
        value={draft}
        onChange={(next) => {
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
        <Text semantic="small" className="form-error">
          {syntaxError}
        </Text>
      ) : (
        description && <Text semantic="small">{description}</Text>
      )}
    </Text>
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
      <Text semantic="p" className="management-hint">
        No native configuration keys recorded yet. Switch to JSON to add options.
      </Text>
    );
  }

  return (
    <Box className="native-app-fields">
      {keys.map((key) => {
        const value = values[key];
        const meta = fieldMeta?.[key];
        const label = meta?.title || key;
        const isSecret =
          value === REDACTED_SECRET_PLACEHOLDER ||
          Boolean(configuredSecrets?.has(key)) ||
          isSecretConfigKey(key, meta);

        if (isSecret && (typeof value === 'string' || value === undefined || value === null)) {
          const isUnchanged = value === REDACTED_SECRET_PLACEHOLDER;
          return (
            <Text semantic="label" className="native-app-field" key={key}>
              <Text>{label}</Text>
              <TextInput
                inputType="password"
                autoComplete="new-password"
                disabled={disabled}
                placeholder={
                  isUnchanged || configuredSecrets?.has(key)
                    ? 'Configured — leave blank to keep current value'
                    : ''
                }
                value={isUnchanged ? '' : typeof value === 'string' ? value : ''}
                onChange={(next) => {
                  onChange(
                    key,
                    next === '' && configuredSecrets?.has(key) ? REDACTED_SECRET_PLACEHOLDER : next,
                  );
                }}
              />
              {meta?.description && <Text semantic="small">{meta.description}</Text>}
            </Text>
          );
        }

        if (typeof value === 'boolean') {
          return (
            <Box className="native-app-toggle" key={key}>
              <HausSwitch
                isSelected={value}
                isDisabled={disabled}
                label={label}
                onChange={(selected) => onChange(key, selected)}
              />
              {meta?.description && <Text semantic="small">{meta.description}</Text>}
            </Box>
          );
        }

        if (typeof value === 'number') {
          return (
            <Text semantic="label" className="native-app-field" key={key}>
              <Text>{label}</Text>
              <TextInput
                inputType="number"
                disabled={disabled}
                value={Number.isFinite(value) ? String(value) : ''}
                onChange={(raw) => {
                  if (raw === '') return;
                  const num = Number(raw);
                  if (Number.isFinite(num)) onChange(key, num);
                }}
              />
              {meta?.description && <Text semantic="small">{meta.description}</Text>}
            </Text>
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
            <Text semantic="label" className="native-app-field" key={key}>
              <Text>{label}</Text>
              <SelectInput
                disabled={disabled}
                value={stringVal}
                options={optionsList.map((choice) => ({ value: choice, label: choice }))}
                onChange={(next) => onChange(key, next)}
              />
              {meta.description && <Text semantic="small">{meta.description}</Text>}
            </Text>
          );
        }

        return (
          <Text semantic="label" className="native-app-field" key={key}>
            <Text>{label}</Text>
            <TextInput
              inputType="text"
              disabled={disabled}
              value={value == null ? '' : String(value)}
              onChange={(next) => onChange(key, next)}
            />
            {meta?.description && <Text semantic="small">{meta.description}</Text>}
          </Text>
        );
      })}
    </Box>
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
      <Box className="native-app-fields">
        <Text semantic="label" className="native-app-field">
          <Text>Configuration (JSON)</Text>
          <TextArea
            rows={4}
            value={jsonText ?? '{}'}
            disabled={disabled}
            onChange={onJsonChange}
            spellCheck={false}
          />
          <Text semantic="small">Optional JSON object passed to this App runtime.</Text>
        </Text>
      </Box>
    );
  }
  if (!hasSchemaFields) return null;
  return (
    <Box className="native-app-fields">
      {secrets?.map((secret) => (
        <Text semantic="label" className="native-app-field" key={secret.name}>
          <Text>
            {secret.name}
            {secret.required && !secretsOptional ? ' *' : ''}
          </Text>
          <TextInput
            inputType="password"
            autoComplete="new-password"
            disabled={disabled}
            placeholder={secretsOptional ? 'Leave blank to keep current value' : ''}
            value={typeof values[secret.name] === 'string' ? String(values[secret.name]) : ''}
            onChange={(next) => onChange(secret.name, next)}
          />
          {secret.description && <Text semantic="small">{secret.description}</Text>}
        </Text>
      ))}
      {options?.map((opt) => {
        if (opt.type === 'boolean') {
          return (
            <Box className="native-app-toggle" key={opt.name}>
              <HausSwitch
                isSelected={values[opt.name] === true}
                isDisabled={disabled}
                label={opt.name}
                onChange={(selected) => onChange(opt.name, selected)}
              />
              {opt.description && <Text semantic="small">{opt.description}</Text>}
            </Box>
          );
        }
        if (opt.type === 'select' && opt.choices && opt.choices.length > 0) {
          return (
            <Text semantic="label" className="native-app-field" key={opt.name}>
              <Text>
                {opt.name}
                {opt.required ? ' *' : ''}
              </Text>
              <SelectInput
                disabled={disabled}
                value={String(values[opt.name] ?? opt.choices[0])}
                options={opt.choices.map((choice) => ({
                  value: String(choice),
                  label: String(choice),
                }))}
                onChange={(next) => onChange(opt.name, next)}
              />
              {opt.description && <Text semantic="small">{opt.description}</Text>}
            </Text>
          );
        }
        return (
          <Text semantic="label" className="native-app-field" key={opt.name}>
            <Text>
              {opt.name}
              {opt.required ? ' *' : ''}
            </Text>
            <TextInput
              inputType={opt.type === 'number' ? 'number' : 'text'}
              disabled={disabled}
              placeholder={opt.type === 'list' ? 'Comma-separated values' : ''}
              value={values[opt.name] === undefined ? '' : String(values[opt.name])}
              onChange={(next) =>
                onChange(opt.name, opt.type === 'number' ? (next === '' ? '' : Number(next)) : next)
              }
            />
            {opt.description && <Text semantic="small">{opt.description}</Text>}
          </Text>
        );
      })}
    </Box>
  );
}
