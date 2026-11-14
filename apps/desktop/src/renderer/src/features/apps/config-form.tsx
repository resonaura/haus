/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { Label, Switch } from '@heroui/react';
import type { AppOptionSchema, AppSecretDeclaration } from '@haus/apps';

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
