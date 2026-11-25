/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useEffect, useState, type ReactNode } from 'react';
import {
  REDACTED_SECRET_PLACEHOLDER,
  isSecretConfigKey,
  parseConfigJsonObject,
  type NativeConfigFieldMeta,
} from '@haus/core/transport';
import { colorToken, corners, insets, pct, px } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import type { UiStyleSpec } from '../../ir/node.js';
import {
  HausButton,
  HausSwitch,
  Pressable,
  Row,
  ScrollView,
  SelectInput,
  Stack,
  Text,
  TextArea,
  TextInput,
} from '../../primitives/index.js';
import { UiIcon } from '../icon.js';

const fieldInputStyle: UiStyleSpec = {
  layout: { width: pct(100), height: px(34), padding: insets(0, 10) },
  material: new SolidMaterial(colorToken('surface')),
  border: { width: 1, color: colorToken('border') },
  corners: corners(9),
  typography: { size: 12.5, color: colorToken('textPrimary') },
};

const fieldAreaStyle: UiStyleSpec = {
  layout: { width: pct(100), minHeight: px(76), padding: insets(8, 10) },
  material: new SolidMaterial(colorToken('surface')),
  border: { width: 1, color: colorToken('border') },
  corners: corners(9),
  typography: { size: 12, fontFamily: 'mono', color: colorToken('textPrimary') },
};

const pillStyle = (active: boolean): UiStyleSpec => ({
  layout: { direction: 'row', alignItems: 'center', padding: insets(5, 11) },
  material: new SolidMaterial(
    active ? colorToken('surfaceActive') : colorToken('surfaceSecondary'),
  ),
  border: { width: 1, color: active ? colorToken('accent') : colorToken('border') },
  corners: corners(999),
});

function FieldBlock({
  label,
  hint,
  description,
  errorText,
  children,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly description?: string;
  readonly errorText?: string;
  readonly children: ReactNode;
}) {
  return (
    <Stack gapPx={4} style={{ layout: { width: pct(100) } }}>
      <Row justify="between" align="center" gapPx={8}>
        <Text size={12} weight={600}>
          {label}
        </Text>
        {hint && (
          <Text size={11} tone="muted">
            {hint}
          </Text>
        )}
      </Row>
      {children}
      {errorText ? (
        <Text size={11.5} tone="critical">
          {errorText}
        </Text>
      ) : (
        description && (
          <Text size={11} tone="muted">
            {description}
          </Text>
        )
      )}
    </Stack>
  );
}

function NestedJsonField({
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
      /* Preserve invalid in-progress draft. */
    }
    setDraft(JSON.stringify(value, null, 2));
    setSyntaxError('');
  }, [value]);

  return (
    <FieldBlock label={label} description={description} errorText={syntaxError}>
      <TextArea
        id={`app-config-field-${name}`}
        ariaLabel={label}
        rows={Math.min(8, Math.max(3, draft.split('\n').length))}
        disabled={disabled}
        value={draft}
        style={fieldAreaStyle}
        onChange={(next) => {
          setDraft(next);
          try {
            const parsed: unknown = JSON.parse(next);
            const expectedArray = Array.isArray(value);
            if (
              expectedArray
                ? !Array.isArray(parsed)
                : typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)
            ) {
              setSyntaxError(expectedArray ? 'Must be a JSON array.' : 'Must be a JSON object.');
              return;
            }
            setSyntaxError('');
            onChange(parsed);
          } catch {
            setSyntaxError('Enter valid JSON.');
          }
        }}
      />
    </FieldBlock>
  );
}

export function AppConfigEditorPanel({
  values,
  configuredSecrets,
  fieldMeta,
  appRunning,
  loading,
  loaded,
  busy,
  saved,
  error,
  onReload,
  onSave,
}: {
  readonly values: Record<string, unknown>;
  readonly configuredSecrets: ReadonlySet<string>;
  readonly fieldMeta?: Readonly<Record<string, NativeConfigFieldMeta>>;
  readonly appRunning: boolean;
  readonly loading: boolean;
  readonly loaded: boolean;
  readonly busy: boolean;
  readonly saved: boolean;
  readonly error?: string;
  readonly onReload: () => void;
  readonly onSave: (options: Record<string, unknown>, restartAfter: boolean) => void;
}) {
  const [draftValues, setDraftValues] = useState<Record<string, unknown>>(() => ({ ...values }));
  const [mode, setMode] = useState<'fields' | 'json'>(() =>
    Object.keys(values).length > 0 ? 'fields' : 'json',
  );
  const [jsonText, setJsonText] = useState(() => JSON.stringify(values, null, 2));
  const [localError, setLocalError] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setDraftValues({ ...values });
    setJsonText(JSON.stringify(values, null, 2));
    setMode(Object.keys(values).length > 0 ? 'fields' : 'json');
    setLocalError('');
    setDirty(false);
  }, [values]);

  const keys = Object.keys(draftValues);

  const switchMode = (nextMode: 'fields' | 'json') => {
    if (nextMode === mode) return;
    setLocalError('');
    if (nextMode === 'json') {
      setJsonText(JSON.stringify(draftValues, null, 2));
      setMode('json');
      return;
    }
    const parsed = parseConfigJsonObject(jsonText);
    if (!parsed.ok) {
      setLocalError(
        parsed.error === 'Configuration must be valid JSON.'
          ? 'Fix invalid JSON before switching to Fields view.'
          : parsed.error,
      );
      return;
    }
    setDraftValues(parsed.value);
    setMode('fields');
  };

  const handleSave = (restartAfter: boolean) => {
    setLocalError('');
    if (mode === 'json') {
      const parsed = parseConfigJsonObject(jsonText);
      if (!parsed.ok) {
        setLocalError(parsed.error);
        return;
      }
      onSave(parsed.value, restartAfter);
      return;
    }
    onSave(draftValues, restartAfter);
  };

  const displayError = localError || error;

  const renderField = (key: string) => {
    const value = draftValues[key];
    const meta = fieldMeta?.[key];
    const label = meta?.title || key;
    const isSecret =
      value === REDACTED_SECRET_PLACEHOLDER ||
      configuredSecrets.has(key) ||
      isSecretConfigKey(key, meta);

    const setField = (next: unknown) => {
      setDirty(true);
      setDraftValues((prev) => ({ ...prev, [key]: next }));
    };

    if (isSecret && (typeof value === 'string' || value === undefined || value === null)) {
      const isUnchanged = value === REDACTED_SECRET_PLACEHOLDER;
      return (
        <FieldBlock
          key={key}
          label={label}
          hint={
            isUnchanged || configuredSecrets.has(key)
              ? 'Configured · leave blank to keep'
              : undefined
          }
          description={meta?.description}
        >
          <TextInput
            id={`app-config-field-${key}`}
            ariaLabel={label}
            inputType="password"
            disabled={busy}
            placeholder={
              isUnchanged || configuredSecrets.has(key)
                ? 'Configured — enter new value to replace'
                : 'Enter secret'
            }
            value={isUnchanged ? '' : typeof value === 'string' ? value : ''}
            style={fieldInputStyle}
            onChange={(next) =>
              setField(
                next === '' && configuredSecrets.has(key) ? REDACTED_SECRET_PLACEHOLDER : next,
              )
            }
          />
        </FieldBlock>
      );
    }

    if (typeof value === 'boolean') {
      return (
        <HausSwitch
          key={key}
          id={`app-config-field-${key}`}
          checked={value}
          disabled={busy}
          label={label}
          description={meta?.description}
          onChange={setField}
        />
      );
    }

    if (meta?.choices && meta.choices.length > 0) {
      const stringValue = value === undefined || value === null ? '' : String(value);
      return (
        <FieldBlock key={key} label={label} description={meta.description}>
          <SelectInput
            id={`app-config-field-${key}`}
            ariaLabel={label}
            disabled={busy}
            value={stringValue}
            options={meta.choices.map((choice) => ({
              value: String(choice),
              label: String(choice),
            }))}
            onChange={(selected) => {
              const match = meta.choices?.find((choice) => String(choice) === selected);
              setField(match ?? selected);
            }}
          />
        </FieldBlock>
      );
    }

    if (typeof value === 'number') {
      return (
        <FieldBlock key={key} label={label} description={meta?.description}>
          <TextInput
            id={`app-config-field-${key}`}
            ariaLabel={label}
            inputType="number"
            disabled={busy}
            value={Number.isFinite(value) ? String(value) : ''}
            style={fieldInputStyle}
            onChange={(raw) => {
              if (!raw.trim()) return;
              const num = Number(raw);
              if (Number.isFinite(num)) setField(num);
            }}
          />
        </FieldBlock>
      );
    }

    if (value !== null && typeof value === 'object') {
      return (
        <NestedJsonField
          key={key}
          name={key}
          label={label}
          description={meta?.description}
          value={value}
          disabled={busy}
          onChange={setField}
        />
      );
    }

    return (
      <FieldBlock key={key} label={label} description={meta?.description}>
        <TextInput
          id={`app-config-field-${key}`}
          ariaLabel={label}
          disabled={busy}
          value={typeof value === 'string' ? value : value === undefined ? '' : String(value)}
          style={fieldInputStyle}
          onChange={setField}
        />
      </FieldBlock>
    );
  };

  return (
    <Stack gapPx={12} style={{ layout: { width: pct(100) } }}>
      <Row align="center" justify="between" gapPx={8} wrap style={{ layout: { width: pct(100) } }}>
        <Row align="center" gapPx={6}>
          <Pressable
            id="app-config-mode-fields"
            ariaPressed={mode === 'fields'}
            onActivate={() => switchMode('fields')}
            style={pillStyle(mode === 'fields')}
          >
            <Text size={11.5} weight={mode === 'fields' ? 600 : 500}>
              Fields
            </Text>
          </Pressable>
          <Pressable
            id="app-config-mode-json"
            ariaPressed={mode === 'json'}
            onActivate={() => switchMode('json')}
            style={pillStyle(mode === 'json')}
          >
            <Text size={11.5} weight={mode === 'json' ? 600 : 500}>
              JSON
            </Text>
          </Pressable>
        </Row>
        <HausButton
          id="app-config-reload"
          variant="ghost"
          size="sm"
          disabled={loading || busy}
          onPress={onReload}
        >
          <UiIcon name="refresh-cw" size={13} />
          <Text size={12}>Reload</Text>
        </HausButton>
      </Row>

      {displayError && (
        <Text size={12} tone="critical" role="alert">
          {displayError}
        </Text>
      )}
      {saved && !dirty && !displayError && (
        <Text size={12} tone="accent" role="status">
          Configuration saved. Restart the App if its runtime reads options on startup.
        </Text>
      )}

      {loading && !loaded ? (
        <Text size={12.5} tone="muted">
          Loading configuration…
        </Text>
      ) : mode === 'fields' ? (
        <ScrollView
          orientation="vertical"
          style={{
            layout: { width: pct(100), maxHeight: px(250), padding: insets(12) },
            material: new SolidMaterial(colorToken('surfaceSecondary')),
            border: { width: 1, color: colorToken('border') },
            corners: corners(12),
          }}
        >
          {keys.length === 0 ? (
            <Text size={12} tone="muted">
              No native configuration keys recorded yet. Switch to JSON to add options.
            </Text>
          ) : (
            <Stack gapPx={12} style={{ layout: { width: pct(100) } }}>
              {keys.map(renderField)}
            </Stack>
          )}
        </ScrollView>
      ) : (
        <Stack gapPx={6} style={{ layout: { width: pct(100) } }}>
          <Text size={11.5} tone="muted">
            Native configuration (options.json). Secrets shown as &lt;unchanged&gt; stay preserved
            unless replaced.
          </Text>
          <TextArea
            id="app-config-json-textarea"
            ariaLabel="Native configuration JSON"
            rows={10}
            value={jsonText}
            disabled={busy}
            style={{
              ...fieldAreaStyle,
              layout: { width: pct(100), minHeight: px(190), padding: insets(10) },
            }}
            onChange={(next) => {
              setDirty(true);
              setJsonText(next);
            }}
          />
        </Stack>
      )}

      <Row align="center" gapPx={8} wrap>
        <HausButton
          id="app-config-save"
          variant="primary"
          size="sm"
          disabled={busy || loading}
          onPress={() => handleSave(false)}
        >
          <Text
            size={12.5}
            style={{ typography: { color: colorToken('accentForeground'), weight: 600 } }}
          >
            Save configuration
          </Text>
        </HausButton>
        {appRunning && (
          <HausButton
            id="app-config-save-restart"
            variant="outline"
            size="sm"
            disabled={busy || loading}
            onPress={() => handleSave(true)}
          >
            <UiIcon name="rotate-cw" size={13} />
            <Text size={12.5}>Save &amp; restart</Text>
          </HausButton>
        )}
      </Row>
    </Stack>
  );
}
