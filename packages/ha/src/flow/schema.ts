/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { FlowFormField, FlowSelectChoice, FormFieldType } from '@haus/core';
import type { HaLocalizedFlowStrings, HaSerializedFlowSchemaField } from '@haus/kitsune';

function humanizeFieldName(name: string): string {
  return name.replaceAll('_', ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function asRecord(val: unknown): Record<string, unknown> | undefined {
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    return val as Record<string, unknown>;
  }
  return undefined;
}

function asNumber(val: unknown): number | undefined {
  return typeof val === 'number' && Number.isFinite(val) ? val : undefined;
}

function parseRawOptions(
  rawOptions: readonly unknown[] | Record<string, unknown> | undefined,
  selectorTranslations: Readonly<Record<string, string>> | undefined,
  translationDomain: string,
  translationKey: string | undefined,
): { options?: readonly FlowSelectChoice[]; choices?: readonly string[] } {
  if (!rawOptions) return {};
  const list: FlowSelectChoice[] = [];

  const lookupLabel = (value: string, explicitLabel?: string): string => {
    if (translationKey && selectorTranslations) {
      const trKey = `component.${translationDomain}.selector.${translationKey}.options.${value}`;
      const tr = selectorTranslations[trKey];
      if (tr) return tr;
    }
    return explicitLabel ?? value;
  };

  if (Array.isArray(rawOptions)) {
    for (const item of rawOptions) {
      if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
        const value = String(item);
        list.push({ value, label: lookupLabel(value) });
      } else if (Array.isArray(item) && item.length >= 2) {
        const value = String(item[0]);
        list.push({ value, label: lookupLabel(value, String(item[1])) });
      } else {
        const rec = asRecord(item);
        if (rec && 'value' in rec) {
          const value = String(rec.value);
          const label = typeof rec.label === 'string' ? rec.label : undefined;
          list.push({ value, label: lookupLabel(value, label) });
        }
      }
    }
  } else {
    for (const [value, label] of Object.entries(rawOptions)) {
      list.push({ value, label: lookupLabel(value, String(label)) });
    }
  }

  return list.length > 0 ? { options: list, choices: list.map((choice) => choice.value) } : {};
}

function mapSelectorType(selector: Record<string, unknown>): FormFieldType {
  if ('boolean' in selector) return 'boolean';
  if ('number' in selector) return 'number';
  if ('select' in selector) {
    const sel = asRecord(selector.select);
    return sel?.multiple === true ? 'multi_select' : 'select';
  }
  if ('multi_select' in selector) return 'multi_select';
  if ('color_rgb' in selector || 'color_temp' in selector) return 'color_rgb';
  if ('location' in selector) return 'location';
  if ('duration' in selector) return 'duration';
  if ('time' in selector) return 'time';
  if ('date' in selector) return 'date';
  if ('datetime' in selector) return 'datetime';
  if ('file' in selector) return 'file';
  if ('icon' in selector) return 'icon';
  if ('attribute' in selector) return 'attribute';
  if ('entity' in selector) return 'entity';
  if ('device' in selector) return 'device';
  if ('area' in selector) return 'area';
  if ('object' in selector) return 'object';
  if ('qr_code' in selector) return 'qr_code';
  if ('country' in selector || 'language' in selector) return 'select';
  if ('password' in selector) return 'password';
  if ('text' in selector) {
    const txt = asRecord(selector.text);
    if (txt?.type === 'password') return 'password';
    if (txt?.type === 'email') return 'email';
    if (txt?.type === 'url') return 'url';
    if (txt?.multiline === true) return 'text';
    return 'string';
  }
  return 'string';
}

function mapRawType(type: string | undefined): FormFieldType {
  switch (type) {
    case 'integer':
    case 'positive_int':
      return 'integer';
    case 'float':
    case 'number':
      return 'number';
    case 'boolean':
    case 'bool':
      return 'boolean';
    case 'password':
      return 'password';
    case 'select':
      return 'select';
    case 'multi_select':
      return 'multi_select';
    case 'expandable':
      return 'expandable';
    case 'object':
      return 'object';
    default:
      return 'string';
  }
}

export function convertHaSchemaToFlowFields(
  rawFields: readonly HaSerializedFlowSchemaField[] | undefined,
  localized: HaLocalizedFlowStrings | undefined,
  translationDomain: string,
  sectionPrefix?: string,
): readonly FlowFormField[] | undefined {
  if (!rawFields) return undefined;

  return rawFields.map((raw): FlowFormField => {
    const fieldPath = sectionPrefix ? `${sectionPrefix}.${raw.name}` : raw.name;
    const label =
      localized?.fieldLabels[fieldPath] ??
      localized?.fieldLabels[raw.name] ??
      humanizeFieldName(raw.name);
    const description =
      localized?.dataDescriptions[fieldPath] ?? localized?.dataDescriptions[raw.name];
    const suggestedValue = raw.description?.suggested_value;
    const required = raw.required === true ? true : raw.optional === true ? false : undefined;

    if (raw.type === 'expandable') {
      return {
        name: raw.name,
        type: 'expandable',
        label,
        description,
        required,
        optional: raw.optional,
        expanded: Boolean(raw.expanded),
        schema: convertHaSchemaToFlowFields(raw.schema, localized, translationDomain, fieldPath),
      };
    }

    const selector = raw.selector ? asRecord(raw.selector) : undefined;
    const fieldType = selector ? mapSelectorType(selector) : mapRawType(raw.type);
    const selectCfg = selector ? asRecord(selector.select) : undefined;
    const numCfg = selector ? asRecord(selector.number) : undefined;
    const translationKey =
      typeof selectCfg?.translation_key === 'string' ? selectCfg.translation_key : undefined;

    const optionSource =
      (selectCfg?.options as readonly unknown[] | Record<string, unknown> | undefined) ??
      raw.options;
    const parsedChoices = parseRawOptions(
      optionSource,
      localized?.selectorTranslations,
      translationDomain,
      translationKey,
    );

    const min = asNumber(numCfg?.min) ?? asNumber(raw.valueMin) ?? asNumber(raw.value_min);
    const max = asNumber(numCfg?.max) ?? asNumber(raw.valueMax) ?? asNumber(raw.value_max);
    const step = asNumber(numCfg?.step);

    return {
      name: raw.name,
      type: fieldType,
      label,
      description,
      required,
      optional: raw.optional,
      defaultValue: raw.default,
      suggestedValue,
      choices: parsedChoices.choices,
      options: parsedChoices.options,
      min,
      max,
      step,
      multiple: Boolean(selectCfg?.multiple ?? raw.multiple),
      custom: Boolean(selectCfg?.custom_value ?? raw.custom),
      translationKey,
      selector,
    };
  });
}
