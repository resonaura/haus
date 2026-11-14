/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { appIntegrationTranslations } from '../app-flows.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function recordOfStrings(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'string') out[k] = v;
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = String(v);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function recordOfSelectorTranslations(
  value: unknown,
): Record<string, Record<string, string> | string> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, Record<string, string> | string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') {
      out[key] = entry;
    } else if (isRecord(entry)) {
      const nested = recordOfStrings(entry);
      if (nested) out[key] = nested;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeSelectOptions(
  rawOptions: unknown,
  rawChoices: unknown,
): Array<{ value: string; label: string }> | string[] | undefined {
  if (Array.isArray(rawOptions) && rawOptions.length > 0) {
    const items: Array<{ value: string; label: string }> = [];
    for (const entry of rawOptions) {
      if (isRecord(entry) && 'value' in entry) {
        const value = String(entry.value ?? '');
        const label = String(entry.label ?? value);
        items.push({ value, label });
      } else if (Array.isArray(entry) && entry.length >= 2) {
        items.push({ value: String(entry[0] ?? ''), label: String(entry[1] ?? '') });
      } else if (entry !== undefined && entry !== null) {
        const str = String(entry);
        items.push({ value: str, label: str });
      }
    }
    return items.length > 0 ? items : undefined;
  }
  if (isRecord(rawOptions)) {
    const entries = Object.entries(rawOptions);
    if (entries.length > 0) {
      return entries.map(([value, label]) => ({ value, label: String(label ?? value) }));
    }
  }
  if (Array.isArray(rawChoices) && rawChoices.length > 0) {
    return rawChoices.map((c) => String(c));
  }
  return undefined;
}

/** Normalizes a Core `FlowFormField` or HA `FormField` into an HA-compatible `FormField`. */
export function normalizeFieldTypeAndSelector(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw)) {
    return { name: 'value', type: 'string', selector: { text: {} } };
  }
  const name = typeof raw.name === 'string' && raw.name ? raw.name : 'value';
  const rawType = typeof raw.type === 'string' ? raw.type.toLowerCase() : 'string';
  const required = Boolean(raw.required);
  const optional = typeof raw.optional === 'boolean' ? raw.optional : !required;
  const rawDescObj = isRecord(raw.description) ? raw.description : undefined;
  const suggestedValue =
    raw.suggestedValue !== undefined
      ? raw.suggestedValue
      : raw.suggested_value !== undefined
        ? raw.suggested_value
        : rawDescObj?.suggested_value;
  const defaultValue = raw.defaultValue !== undefined ? raw.defaultValue : raw.default;
  const label = asString(raw.label);
  const description = isRecord(raw.description) ? raw.description : asString(raw.description);
  const placeholder = asString(raw.placeholder);
  const valueMin = asNumber(raw.min) ?? asNumber(raw.value_min);
  const valueMax = asNumber(raw.max) ?? asNumber(raw.value_max);
  const stepValue = asNumber(raw.step);
  const translationKey = asString(raw.translationKey) ?? asString(raw.translation_key);
  const unitOfMeasurement = asString(raw.unitOfMeasurement) ?? asString(raw.unit_of_measurement);

  if (Array.isArray(raw.schema) || rawType === 'expandable' || rawType === 'section') {
    const nestedSchema = Array.isArray(raw.schema)
      ? raw.schema.map((child) => normalizeFieldTypeAndSelector(child))
      : [];
    return {
      name,
      type: 'expandable',
      required,
      optional,
      expanded: Boolean(raw.expanded),
      ...(label !== undefined ? { label } : {}),
      ...(description !== undefined ? { description } : {}),
      schema: nestedSchema,
    };
  }

  const multiple = rawType === 'multi_select' || raw.multiple === true;
  const custom = Boolean(raw.custom);

  const existingSelector =
    isRecord(raw.selector) && Object.keys(raw.selector).length > 0 ? raw.selector : undefined;

  let options = normalizeSelectOptions(raw.options, raw.choices);
  if (!options && existingSelector && isRecord(existingSelector.select)) {
    options = normalizeSelectOptions(existingSelector.select.options, undefined);
  }

  let haType = rawType;
  let selector: Record<string, unknown>;

  if (existingSelector) {
    selector = { ...existingSelector };
    if (isRecord(selector.select)) {
      selector.select = {
        ...selector.select,
        ...(options && selector.select.options === undefined ? { options } : {}),
        ...(translationKey && selector.select.translation_key === undefined
          ? { translation_key: translationKey }
          : {}),
        ...(custom && selector.select.custom_value === undefined ? { custom_value: true } : {}),
      };
    }
    if (
      rawType === 'password' ||
      rawType === 'pin' ||
      rawType === 'email' ||
      rawType === 'url' ||
      rawType === 'text'
    ) {
      haType = 'string';
    } else if (rawType === 'multi_select') {
      haType = 'select';
    } else if (rawType === 'number') {
      haType = 'float';
    }
  } else if (rawType === 'boolean') {
    haType = 'boolean';
    selector = { boolean: {} };
  } else if (rawType === 'number' || rawType === 'integer' || rawType === 'float') {
    haType = rawType === 'integer' ? 'integer' : 'float';
    selector = {
      number: {
        ...(valueMin !== undefined ? { min: valueMin } : {}),
        ...(valueMax !== undefined ? { max: valueMax } : {}),
        ...(stepValue !== undefined ? { step: stepValue } : {}),
        ...(unitOfMeasurement ? { unit_of_measurement: unitOfMeasurement } : {}),
        mode: 'box',
      },
    };
  } else if (rawType === 'select' || rawType === 'multi_select') {
    haType = 'select';
    const count = options?.length ?? 0;
    selector = {
      select: {
        options: options ?? [],
        ...(multiple ? { multiple: true } : {}),
        ...(custom ? { custom_value: true } : {}),
        ...(translationKey ? { translation_key: translationKey } : {}),
        ...(count > 0 && count <= 5 && !multiple && !custom ? { mode: 'list' } : {}),
      },
    };
  } else if (rawType === 'password' || rawType === 'pin') {
    haType = 'string';
    selector = { text: { type: 'password' } };
  } else if (rawType === 'email') {
    haType = 'string';
    selector = { text: { type: 'email' } };
  } else if (rawType === 'url') {
    haType = 'string';
    selector = { text: { type: 'url' } };
  } else if (rawType === 'qr_code') {
    haType = 'qr_code';
    selector = {
      qr_code: {
        data: typeof defaultValue === 'string' ? defaultValue : '',
      },
    };
  } else if (
    [
      'file',
      'location',
      'duration',
      'color_rgb',
      'color_temp',
      'attribute',
      'icon',
      'date',
      'time',
      'datetime',
      'object',
    ].includes(rawType)
  ) {
    haType = rawType;
    selector = { [rawType]: {} };
  } else {
    haType = 'string';
    selector = { text: rawType === 'text' ? { multiline: true } : {} };
  }

  return {
    name,
    type: haType,
    required,
    optional,
    ...(label !== undefined ? { label } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(placeholder !== undefined ? { placeholder } : {}),
    ...(defaultValue !== undefined ? { default: defaultValue } : {}),
    ...(suggestedValue !== undefined ? { suggested_value: suggestedValue } : {}),
    ...(options !== undefined ? { options } : {}),
    ...(multiple ? { multiple: true } : {}),
    ...(custom ? { custom: true } : {}),
    ...(translationKey ? { translation_key: translationKey } : {}),
    ...(valueMin !== undefined ? { value_min: valueMin } : {}),
    ...(valueMax !== undefined ? { value_max: valueMax } : {}),
    selector,
  };
}

/**
 * Translates either a Core camelCase `IntegrationFlowStep` or an already HA-shaped `FlowStep`
 * into a unified, complete HA-compatible `FlowStep` with rich metadata preserved.
 */
export function normalizeCoreStepToHaStep(
  rawStep: unknown,
  fallbackFlowId?: string,
  fallbackHandler?: string,
): Record<string, unknown> {
  if (!isRecord(rawStep)) {
    return {
      type: 'abort',
      flow_id: fallbackFlowId ?? 'flow_unknown',
      handler: fallbackHandler ?? 'unknown',
      reason: 'flow_error',
      description: 'The Hub returned an empty configuration step.',
    };
  }

  const flowId =
    asString(rawStep.flow_id) ?? asString(rawStep.flowId) ?? fallbackFlowId ?? `flow_${Date.now()}`;
  const handler =
    asString(rawStep.handler) ?? asString(rawStep.domain) ?? fallbackHandler ?? 'unknown';
  const stepId = asString(rawStep.step_id) ?? asString(rawStep.stepId) ?? 'user';
  const type = asString(rawStep.type) ?? 'form';
  const title = asString(rawStep.title);
  const description = asString(rawStep.description);
  const reason =
    asString(rawStep.reason) ?? asString(rawStep.abort_reason) ?? asString(rawStep.abortReason);
  const url = asString(rawStep.url);
  const documentationUrl =
    asString(rawStep.documentation_url) ?? asString(rawStep.documentationUrl);
  const progressAction = asString(rawStep.progress_action) ?? asString(rawStep.progressAction);
  const submitLabel = asString(rawStep.submit_label) ?? asString(rawStep.submitLabel);
  const supportedBy = asString(rawStep.supported_by) ?? asString(rawStep.supportedBy);
  const translationDomain =
    asString(rawStep.translation_domain) ?? asString(rawStep.translationDomain);
  const lastStep =
    typeof rawStep.last_step === 'boolean'
      ? rawStep.last_step
      : typeof rawStep.lastStep === 'boolean'
        ? rawStep.lastStep
        : undefined;

  const descriptionPlaceholders = recordOfStrings(
    rawStep.description_placeholders ?? rawStep.descriptionPlaceholders,
  );
  const errors = recordOfStrings(rawStep.errors);
  const fieldLabels = recordOfStrings(rawStep.field_labels ?? rawStep.fieldLabels);
  const dataDescriptions = recordOfStrings(rawStep.data_descriptions ?? rawStep.dataDescriptions);
  const selectorTranslations = recordOfSelectorTranslations(
    rawStep.selector_translations ?? rawStep.selectorTranslations,
  );

  const rawMenu = rawStep.menu_options ?? rawStep.menuOptions;
  let menuOptions: readonly string[] | Record<string, string> | undefined;
  if (Array.isArray(rawMenu)) {
    menuOptions = rawMenu.map((item) => String(item));
  } else if (isRecord(rawMenu)) {
    menuOptions = recordOfStrings(rawMenu);
  }

  const menuDescriptions = recordOfStrings(rawStep.menu_descriptions ?? rawStep.menuDescriptions);
  const menuNextStepIds = recordOfStrings(rawStep.menu_next_step_ids ?? rawStep.menuNextStepIds);

  const rawSchema = rawStep.data_schema ?? rawStep.dataSchema;
  const dataSchema = Array.isArray(rawSchema)
    ? rawSchema.map((field) => normalizeFieldTypeAndSelector(field))
    : undefined;

  let result: Record<string, unknown> | undefined;
  if (isRecord(rawStep.result)) {
    const entryId = asString(rawStep.result.entry_id) ?? asString(rawStep.result.entryId);
    const resTitle = asString(rawStep.result.title);
    const deviceId = asString(rawStep.result.device_id) ?? asString(rawStep.result.deviceId);
    result = {
      ...(entryId ? { entry_id: entryId } : {}),
      ...(resTitle ? { title: resTitle } : {}),
      ...(deviceId ? { device_id: deviceId } : {}),
    };
  }

  const unsupported = rawStep.unsupported_requirements ?? rawStep.unsupportedRequirements;

  return {
    type,
    flow_id: flowId,
    handler,
    step_id: stepId,
    ...(title !== undefined ? { title } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(reason !== undefined ? { reason } : {}),
    ...(url !== undefined ? { url } : {}),
    ...(documentationUrl !== undefined ? { documentation_url: documentationUrl } : {}),
    ...(progressAction !== undefined ? { progress_action: progressAction } : {}),
    ...(submitLabel !== undefined ? { submit_label: submitLabel } : {}),
    ...(supportedBy !== undefined ? { supported_by: supportedBy } : {}),
    ...(translationDomain !== undefined ? { translation_domain: translationDomain } : {}),
    ...(lastStep !== undefined ? { last_step: lastStep } : {}),
    ...(descriptionPlaceholders ? { description_placeholders: descriptionPlaceholders } : {}),
    ...(errors ? { errors } : {}),
    ...(fieldLabels ? { field_labels: fieldLabels } : {}),
    ...(dataDescriptions ? { data_descriptions: dataDescriptions } : {}),
    ...(selectorTranslations ? { selector_translations: selectorTranslations } : {}),
    ...(menuOptions !== undefined ? { menu_options: menuOptions } : {}),
    ...(menuDescriptions ? { menu_descriptions: menuDescriptions } : {}),
    ...(menuNextStepIds ? { menu_next_step_ids: menuNextStepIds } : {}),
    ...(dataSchema ? { data_schema: dataSchema } : {}),
    ...(result ? { result } : {}),
    ...(Array.isArray(unsupported) && unsupported.length > 0
      ? { unsupported_requirements: unsupported }
      : {}),
  };
}

const COMMON_ERRORS: Readonly<Record<string, string>> = {
  required: 'Required',
  invalid_auth:
    'Invalid authentication credentials. Check username, password, or token and try again.',
  cannot_connect: 'Failed to connect to the host or service. Verify network reachability.',
  invalid_host: 'Enter a valid hostname or IP address.',
  invalid_token: 'Enter a valid 32-character hexadecimal device token.',
  invalid_code: 'Enter a valid verification or pairing code.',
  invalid_user_code:
    'Enter your exact case-sensitive User Code from Settings > Account and Security.',
  login_error: 'Login error ({code}): {msg}',
  already_configured: 'This device or account is already configured.',
  timeout_connect: 'Connection timed out while waiting for a response.',
  unknown: 'Unexpected error during setup. Please verify the values and try again.',
};

// Hub owns a custom HA-compatible Tuya Smart/Smart Life QR login step (`scan.data.QR`,
// `reauth_confirm`) that differs slightly from stock upstream HA's user_code prompt.
const NATIVE_TUYA_QR_TRANSLATIONS: Readonly<Record<string, unknown>> = {
  config: {
    step: {
      user: {
        title: 'Tuya',
        description:
          'Enter your Smart Life or Tuya Smart user code.\n\nYou can find this code in the Smart Life app or Tuya Smart app in **Settings > Account and Security** screen, and enter the code shown on the **User Code** field. The user code is case-sensitive, please be sure to enter it exactly as shown in the app.',
        data: {
          user_code: 'User code',
        },
      },
      scan: {
        title: 'Tuya',
        description:
          'Use the Smart Life app or Tuya Smart app to scan the following QR code to complete the login.\n\nContinue to the next step once you have completed this step in the app.',
        data: {
          QR: 'QR code',
        },
      },
      reauth_confirm: {
        title: 'Reauthenticate Tuya',
        description:
          'Your Smart Life or Tuya Smart account needs to be reauthenticated.\n\nSelect **Submit** to get a QR code to scan with the app.',
      },
      reauth_user_code: {
        title: 'Reauthenticate Tuya',
        description:
          'To reauthenticate with your Smart Life or Tuya Smart account, enter your User Code.\n\nYou can find this code in **Settings > Account and Security** in the app.',
        data: {
          user_code: 'User code',
        },
      },
    },
  },
};

/**
 * Provides offline/app-only fallback translations when Hub `/api/commissioning/translations`
 * cannot be reached or for Haus-specific flows (`govee`, `homebridge-govee`, `tuya` QR).
 */
export function hubFlowTranslations(
  category: string,
  integration?: string,
): Record<string, unknown> {
  const base = appIntegrationTranslations(category, integration);
  const baseComponent = isRecord(base.component) ? base.component : {};

  if (category === 'title') {
    const component: Record<string, unknown> = { ...baseComponent };
    if (!isRecord(component.tuya)) {
      component.tuya = { title: 'Tuya' };
    }
    return { component };
  }

  if (!integration) return base;

  const section = category === 'options' ? 'options' : 'config';
  const builtin = integration === 'tuya' ? NATIVE_TUYA_QR_TRANSLATIONS : undefined;
  const builtinSection = isRecord(builtin?.[section]) ? builtin[section] : {};
  const builtinStep = isRecord(builtinSection.step) ? builtinSection.step : {};
  const existing = isRecord(baseComponent[integration]) ? baseComponent[integration] : {};
  const existingSection = isRecord(existing[section]) ? existing[section] : {};
  const existingStep = isRecord(existingSection.step) ? existingSection.step : {};
  const existingError = isRecord(existingSection.error) ? existingSection.error : {};

  return {
    component: {
      ...baseComponent,
      [integration]: {
        ...existing,
        [section]: {
          ...builtinSection,
          ...existingSection,
          ...(Object.keys(builtinStep).length > 0 || Object.keys(existingStep).length > 0
            ? { step: { ...builtinStep, ...existingStep } }
            : {}),
          error: {
            ...COMMON_ERRORS,
            ...existingError,
          },
        },
      },
    },
  };
}
