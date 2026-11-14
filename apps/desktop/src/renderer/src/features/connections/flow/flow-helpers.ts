/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  humanize,
  nativeApi,
  rest,
  translationStrings,
  type FlowProgress,
  type FlowStep,
  type FormField,
} from '../../../ha/management';

export interface FlowLocalizationHelpers {
  lookupText: (suffix: string) => string | undefined;
  text: (suffix: string, fallback: string) => string;
  humanizeSlug: (value: string) => string;
  title: string;
  submitLabel: string;
  fieldLabel: (key: string, field?: FormField) => string;
  fieldDescription: (key: string, field?: FormField) => string | undefined;
  selectorOptions: (
    key: string,
    field?: { translation_key?: string },
  ) => Record<string, string> | undefined;
}

/** Resolves HA config/options/issues/selector localized text for an active flow step. */
export function createFlowLocalizationHelpers(params: {
  domain: string;
  kind: 'config' | 'options';
  repair?: { issue_id: string; translation_key?: string };
  step: FlowStep | null;
  translations: Readonly<Record<string, string>>;
}): FlowLocalizationHelpers {
  const { domain, kind, repair, step, translations } = params;
  const translationDomains = [
    ...new Set(
      [domain, step?.translation_domain, step?.supported_by].filter((x): x is string => Boolean(x)),
    ),
  ];
  const substitute = (input: string) => {
    let result = input;
    for (const [key, value] of Object.entries(step?.description_placeholders ?? {})) {
      result = result.replaceAll(`{${key}}`, value);
    }
    return result;
  };
  const lookupText = (suffix: string): string | undefined => {
    for (const td of translationDomains) {
      const prefix = repair
        ? `component.${td}.issues.${repair.translation_key ?? repair.issue_id}.fix_flow`
        : `component.${td}.${kind}`;
      const hit = translations[`${prefix}.${suffix}`];
      if (hit !== undefined) return substitute(hit);
    }
    return undefined;
  };
  const text = (suffix: string, fallback: string) => lookupText(suffix) ?? substitute(fallback);
  const humanizeSlug = (value: string) => (value.includes(' ') ? value : humanize(value));
  const titleFromTr = step ? lookupText(`step.${step.step_id}.title`) : undefined;
  const title = step
    ? titleFromTr && !/\{[a-zA-Z0-9_]+\}/.test(titleFromTr)
      ? titleFromTr
      : step.title
        ? substitute(step.title)
        : (titleFromTr ?? (step.type === 'menu' ? 'Select Action' : humanize(domain)))
    : 'Connect an integration';
  const submitLabel =
    (step?.step_id ? lookupText(`step.${step.step_id}.submit`) : undefined) ??
    step?.submit_label ??
    'Submit';
  const fieldLabel = (key: string, field?: FormField) => {
    const direct = step?.field_labels?.[key];
    if (direct) return substitute(direct);
    if (key.includes('.')) {
      const [sec, ...restPath] = key.split('.');
      return text(
        `step.${step?.step_id}.sections.${sec}.data.${restPath.join('.')}`,
        field?.label || humanize(restPath.join('.')),
      );
    }
    return text(`step.${step?.step_id}.data.${key}`, field?.label || humanize(key));
  };
  const fieldDescription = (key: string, field?: FormField) => {
    const direct =
      step?.data_descriptions?.[key] ??
      (typeof field?.description === 'string' ? field.description : undefined);
    if (direct) return substitute(direct);
    if (key.includes('.')) {
      const [sec, ...restPath] = key.split('.');
      return lookupText(
        `step.${step?.step_id}.sections.${sec}.data_description.${restPath.join('.')}`,
      );
    }
    return lookupText(`step.${step?.step_id}.data_description.${key}`);
  };
  const selectorOptions = (key: string, field?: { translation_key?: string }) => {
    const tk = field?.translation_key ?? key.split('.').at(-1) ?? key;
    const direct = step?.selector_translations?.[tk];
    if (direct && typeof direct === 'object') return direct;
    const collected: Record<string, string> = {};
    for (const td of translationDomains) {
      const prefix = `component.${td}.selector.${tk}.options.`;
      for (const [k, v] of Object.entries(translations)) {
        if (k.startsWith(prefix)) collected[k.slice(prefix.length)] = v;
      }
    }
    return Object.keys(collected).length > 0 ? collected : undefined;
  };
  return {
    lookupText,
    text,
    humanizeSlug,
    title,
    submitLabel,
    fieldLabel,
    fieldDescription,
    selectorOptions,
  };
}

/** Loads available flow handlers, active discovery progress flows, and title translations for the picker. */
export async function fetchFlowPickerBootstrap(domains?: ReadonlySet<string>): Promise<{
  handlers: string[];
  discovered: FlowProgress[];
  names: Record<string, string>;
}> {
  const [available, progress, titles] = await Promise.all([
    rest<string[]>('GET', 'config/config_entries/flow_handlers'),
    nativeApi().request<FlowProgress[]>({ type: 'config_entries/flow/progress' }),
    nativeApi().request<{ resources: Record<string, string> }>({
      type: 'frontend/get_translations',
      language: 'en',
      category: 'title',
      config_flow: true,
    }),
  ]);
  return {
    handlers: domains ? available.filter((domain) => domains.has(domain)) : available,
    discovered: domains ? progress.filter((flow) => domains.has(flow.handler)) : progress,
    names: translationStrings(titles.resources),
  };
}

/** Fetches main (config/options/issues) and selector translations for one or more domains. */
export async function fetchStepTranslationResources(
  domainList: readonly string[],
  category: 'issues' | 'config' | 'options',
): Promise<Record<string, string>> {
  const api = nativeApi();
  const integration = domainList.length === 1 ? domainList[0] : domainList;
  const [mainRes, selectorRes] = await Promise.all([
    api.request<{ resources: Record<string, string> }>({
      type: 'frontend/get_translations',
      language: 'en',
      category,
      integration,
    }),
    api
      .request<{ resources: Record<string, string> }>({
        type: 'frontend/get_translations',
        language: 'en',
        category: 'selector',
        integration,
      })
      .catch(() => ({ resources: {} })),
  ]);
  return {
    ...translationStrings(selectorRes.resources),
    ...translationStrings(mainRes.resources),
  };
}

export interface NormalizedMenuOption {
  readonly key: string;
  readonly label: string;
  readonly description?: string;
}

export function extractMenuOptions(
  step: FlowStep,
  menuLabels: Record<string, string>,
  fallbackHumanize: (value: string) => string,
): readonly NormalizedMenuOption[] {
  const descriptions = step.menu_descriptions ?? {};
  if (Array.isArray(step.menu_options)) {
    return step.menu_options.map((key) => ({
      key,
      label: menuLabels[key] || fallbackHumanize(key),
      description: descriptions[key],
    }));
  }
  if (step.menu_options && typeof step.menu_options === 'object') {
    return Object.entries(step.menu_options).map(([key, label]) => ({
      key,
      label:
        menuLabels[key] || (typeof label === 'string' && label ? label : fallbackHumanize(key)),
      description: descriptions[key],
    }));
  }
  return [];
}

export function extractFlowErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  if (typeof err === 'string' && err.trim()) return err;
  return 'Could not complete configuration step. Please check the integration settings and try again.';
}

export function resolveFieldLabel(
  field: FormField,
  labels: Record<string, string>,
  fallbackHumanize: (value: string) => string,
): string {
  return labels[field.name] || field.label || fallbackHumanize(field.name);
}

export function resolveStepDocumentationUrl(step: FlowStep): string | undefined {
  if (typeof step.documentation_url === 'string' && /^https?:\/\//.test(step.documentation_url)) {
    return step.documentation_url;
  }
  if (typeof step.url === 'string' && step.type !== 'external' && /^https?:\/\//.test(step.url)) {
    return step.url;
  }
  return undefined;
}

export function buildMenuLabels(
  step: FlowStep | null,
  text: (suffix: string, fallback: string) => string,
  humanizeFn: (value: string) => string,
): Record<string, string> {
  if (step?.type !== 'menu') return {};
  const keys = Array.isArray(step.menu_options)
    ? step.menu_options
    : Object.keys(step.menu_options ?? {});
  return Object.fromEntries(
    keys.map((key) => [
      key,
      text(
        `step.${step.step_id}.menu_options.${key}`,
        Array.isArray(step.menu_options)
          ? humanizeFn(key)
          : String((step.menu_options as Record<string, string>)[key] ?? humanizeFn(key)),
      ),
    ]),
  );
}

/** Checks required scalar/list/section fields on submit to display inline HA-style field errors. */
export function validateRequiredFormFields(
  schema: readonly FormField[] | undefined,
  values: Readonly<Record<string, unknown>>,
  prefix = '',
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!schema) return errors;
  for (const field of schema) {
    const errorKey = prefix ? `${prefix}.${field.name}` : field.name;
    const raw = values[field.name];
    if (field.schema) {
      if (!field.optional || field.required || (raw && typeof raw === 'object')) {
        Object.assign(
          errors,
          validateRequiredFormFields(
            field.schema,
            raw && typeof raw === 'object' && !Array.isArray(raw)
              ? (raw as Record<string, unknown>)
              : {},
            errorKey,
          ),
        );
      }
      continue;
    }
    if (!field.required) continue;
    const selector = field.selector ?? {};
    const type = Object.keys(selector)[0] ?? field.type ?? 'string';
    if (type === 'boolean' || type === 'bool' || type === 'qr_code' || type === 'constant') {
      continue;
    }
    if (
      raw === undefined ||
      raw === null ||
      (typeof raw === 'string' && raw.trim().length === 0) ||
      (Array.isArray(raw) && raw.length === 0) ||
      (typeof raw === 'number' && !Number.isFinite(raw))
    ) {
      errors[errorKey] = 'required';
    }
  }
  return errors;
}
