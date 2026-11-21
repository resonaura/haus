/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const REDACTED_SECRET_PLACEHOLDER = '<unchanged>';

const SECRET_KEY_RE = /^(?:.*[_-])?(?:pass(?:word)?|secret|token|api_?key)$/i;

export interface NativeConfigFieldMeta {
  readonly title?: string;
  readonly description?: string;
  readonly type?: 'string' | 'number' | 'boolean' | 'select' | 'object' | 'array';
  readonly secret?: boolean;
  readonly choices?: readonly (string | number)[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isSecretConfigKey(key: string, declaredSecrets?: ReadonlySet<string>): boolean {
  if (declaredSecrets?.has(key)) return true;
  return SECRET_KEY_RE.test(key);
}

/**
 * Reads an App's live native `options.json` from its runtime data directory when readable,
 * falling back cleanly to the persisted `entry.config` without overriding or injecting keys.
 */
export function readNativeAppConfig(
  dataRoot: string | undefined,
  appId: string,
  fallbackConfig: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  if (dataRoot) {
    try {
      const raw = readFileSync(join(dataRoot, appId, 'data', 'options.json'), 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (isPlainObject(parsed)) {
        if (Object.keys(parsed).length > 0 || Object.keys(fallbackConfig).length === 0) {
          return parsed;
        }
      }
    } catch {
      // Unreadable or absent options.json; preserve persisted config.
    }
  }
  return { ...fallbackConfig };
}

function redactRecursive(
  value: unknown,
  declaredSecrets: ReadonlySet<string> | undefined,
  prefix: string,
  configuredSecrets: string[],
): unknown {
  if (Array.isArray(value)) {
    return value.map((item, idx) =>
      redactRecursive(item, declaredSecrets, `${prefix}[${idx}]`, configuredSecrets),
    );
  }
  if (!isPlainObject(value)) return value;

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isSecretConfigKey(key, declaredSecrets)) {
      if (typeof item === 'string' && item.length > 0) {
        configuredSecrets.push(path);
        out[key] = REDACTED_SECRET_PLACEHOLDER;
      } else {
        out[key] = item;
      }
    } else {
      out[key] = redactRecursive(item, declaredSecrets, path, configuredSecrets);
    }
  }
  return out;
}

/**
 * Produces a renderer-safe copy of an App's native config where configured secrets are replaced
 * with `<unchanged>` and listed in `configuredSecrets`. Plaintext secrets never cross to UI.
 */
export function redactAppConfig(
  config: Readonly<Record<string, unknown>>,
  declaredSecrets?: readonly string[],
): {
  readonly config: Record<string, unknown>;
  readonly configuredSecrets: readonly string[];
} {
  const secretSet = declaredSecrets?.length ? new Set(declaredSecrets) : undefined;
  const configuredSecrets: string[] = [];
  const redacted = redactRecursive(config, secretSet, '', configuredSecrets);
  return {
    config: isPlainObject(redacted) ? redacted : {},
    configuredSecrets,
  };
}

function restoreSecretsRecursive(
  existing: unknown,
  submitted: unknown,
  declaredSecrets: ReadonlySet<string> | undefined,
  preserveEmptySecrets: boolean,
): unknown {
  if (Array.isArray(submitted)) {
    return submitted.map((item, idx) =>
      restoreSecretsRecursive(
        Array.isArray(existing) ? existing[idx] : undefined,
        item,
        declaredSecrets,
        preserveEmptySecrets,
      ),
    );
  }
  if (!isPlainObject(submitted)) {
    if (submitted === REDACTED_SECRET_PLACEHOLDER && typeof existing === 'string') {
      return existing;
    }
    return submitted;
  }

  const prevObj = isPlainObject(existing) ? existing : undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(submitted)) {
    const prevVal = prevObj?.[key];
    if (isSecretConfigKey(key, declaredSecrets)) {
      if (value === REDACTED_SECRET_PLACEHOLDER && typeof prevVal === 'string') {
        out[key] = prevVal;
      } else if (
        preserveEmptySecrets &&
        (value === '' || value === undefined) &&
        typeof prevVal === 'string' &&
        prevVal.length > 0
      ) {
        out[key] = prevVal;
      } else {
        out[key] = value;
      }
    } else {
      out[key] = restoreSecretsRecursive(prevVal, value, declaredSecrets, preserveEmptySecrets);
    }
  }
  return out;
}

/**
 * Resolves a submitted configuration payload against `existingConfig`.
 * Supports both full native JSON replacement (`{ __hausReplace: true, values }`) and legacy
 * partial patches while preserving unchanged secrets without ever overriding native keys.
 */
export function resolveConfiguredAppOptions(
  existingConfig: Readonly<Record<string, unknown>>,
  rawSubmitted: Readonly<Record<string, unknown>> | undefined,
  declaredSecrets?: readonly string[],
): Record<string, unknown> {
  if (!rawSubmitted) return { ...existingConfig };
  const secretSet = declaredSecrets?.length ? new Set(declaredSecrets) : undefined;

  if (rawSubmitted.__hausReplace === true && isPlainObject(rawSubmitted.values)) {
    const restored = restoreSecretsRecursive(existingConfig, rawSubmitted.values, secretSet, false);
    return isPlainObject(restored) ? restored : {};
  }

  const merged = { ...existingConfig };
  for (const [key, value] of Object.entries(rawSubmitted)) {
    if (key === '__hausReplace') continue;
    const prevVal = existingConfig[key];
    if (isSecretConfigKey(key, secretSet)) {
      if (
        (value === REDACTED_SECRET_PLACEHOLDER || value === '' || value === undefined) &&
        typeof prevVal === 'string' &&
        prevVal.length > 0
      ) {
        merged[key] = prevVal;
      } else {
        merged[key] = value;
      }
    } else {
      merged[key] = restoreSecretsRecursive(prevVal, value, secretSet, true);
    }
  }
  return merged;
}

/**
 * Reads a Homebridge plugin's native `config.schema.json` to supply field titles, descriptions,
 * types, and choices without replacing or overriding the plugin's native configuration.
 */
export function readHomebridgeConfigSchema(
  pluginDirectory: string | undefined,
): Record<string, NativeConfigFieldMeta> | undefined {
  if (!pluginDirectory) return undefined;
  try {
    const raw = readFileSync(join(pluginDirectory, 'config.schema.json'), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainObject(parsed) || !isPlainObject(parsed.schema)) return undefined;
    const properties = parsed.schema.properties;
    if (!isPlainObject(properties)) return undefined;

    const fields: Record<string, NativeConfigFieldMeta> = {};
    for (const [name, prop] of Object.entries(properties)) {
      if (!isPlainObject(prop)) continue;
      const rawType = typeof prop.type === 'string' ? prop.type : undefined;
      const choices: Array<string | number> = [];
      if (Array.isArray(prop.enum)) {
        for (const item of prop.enum) {
          if (typeof item === 'string' || typeof item === 'number') choices.push(item);
        }
      } else if (Array.isArray(prop.oneOf)) {
        for (const item of prop.oneOf) {
          if (isPlainObject(item) && Array.isArray(item.enum)) {
            for (const v of item.enum) {
              if (typeof v === 'string' || typeof v === 'number') choices.push(v);
            }
          }
        }
      }
      const mappedType: NativeConfigFieldMeta['type'] =
        choices.length > 0
          ? 'select'
          : rawType === 'boolean'
            ? 'boolean'
            : rawType === 'integer' || rawType === 'number'
              ? 'number'
              : rawType === 'array'
                ? 'array'
                : rawType === 'object'
                  ? 'object'
                  : 'string';
      fields[name] = {
        ...(typeof prop.title === 'string' ? { title: prop.title } : {}),
        ...(typeof prop.description === 'string' ? { description: prop.description } : {}),
        type: mappedType,
        ...(isSecretConfigKey(name) || name === 'code' ? { secret: true } : {}),
        ...(choices.length > 0 ? { choices } : {}),
      };
    }
    return Object.keys(fields).length > 0 ? fields : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Strips Haus internal routing keys from an App's native config before passing it to a
 * Homebridge child bridge process, preserving every user-configured plugin key verbatim.
 */
export function buildHomebridgeChildConfig(params: {
  readonly isGovee: boolean;
  readonly manifestName: string;
  readonly rawConfig: Readonly<Record<string, unknown>>;
}): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params.rawConfig)) {
    if (['pluginPath', 'hybridSplit', 'outletsOnly', 'packageName', '_bridge'].includes(key)) {
      continue;
    }
    if ((key === 'code' || key === 'apiKey') && (typeof value !== 'string' || !value.trim())) {
      continue;
    }
    cleaned[key] = value;
  }
  if (params.isGovee) {
    return {
      ...cleaned,
      platform:
        typeof cleaned.platform === 'string' && cleaned.platform.trim().length > 0
          ? cleaned.platform
          : 'Govee',
      name:
        typeof cleaned.name === 'string' && cleaned.name.trim().length > 0 ? cleaned.name : 'Govee',
    };
  }
  return {
    ...cleaned,
    name:
      typeof cleaned.name === 'string' && cleaned.name.trim().length > 0
        ? cleaned.name
        : params.manifestName,
  };
}
