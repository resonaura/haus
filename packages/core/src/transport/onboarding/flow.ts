/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { FlowFormFieldRecord, FlowStartTarget, FlowStepRecord } from '../onboarding.js';

export interface FlowLocalizationHelpers {
  readonly lookupText: (suffix: string) => string | undefined;
  readonly text: (suffix: string, fallback: string) => string;
  readonly humanizeSlug: (value: string) => string;
  readonly title: string;
  readonly description?: string;
  readonly submitLabel: string;
  readonly fieldLabel: (key: string, field?: FlowFormFieldRecord) => string;
  readonly fieldDescription: (key: string, field?: FlowFormFieldRecord) => string | undefined;
  readonly selectorOptions: (
    key: string,
    field?: { readonly translation_key?: string },
  ) => Readonly<Record<string, string>> | undefined;
  readonly errorText: (code: string) => string;
  readonly abortTitle: (reason?: string) => string;
  readonly progressText: (action?: string, fallback?: string) => string;
}

export interface NormalizedFlowMenuOption {
  readonly key: string;
  readonly label: string;
  readonly description?: string;
}

export interface ParsedOAuthCallbackInput {
  readonly state?: string;
  readonly code?: string;
  readonly error?: string;
}

export function humanizeFlowIdentifier(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export function extractTranslationResources(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const obj = raw as Readonly<Record<string, unknown>>;
  const source =
    obj.resources && typeof obj.resources === 'object' && !Array.isArray(obj.resources)
      ? (obj.resources as Readonly<Record<string, unknown>>)
      : obj;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

export function flowEyebrowLabel(target: {
  readonly repair?: unknown;
  readonly reauth?: boolean;
  readonly reconfigure?: boolean;
  readonly kind?: 'config' | 'options';
  readonly appRuntime?: string;
}): string {
  if (target.repair) return 'REPAIR INTEGRATION';
  if (target.reauth) return 'REAUTHENTICATE';
  if (target.reconfigure) return 'RECONFIGURE';
  if (target.appRuntime) return 'INSTALL DRIVER';
  return target.kind === 'options' ? 'INTEGRATION OPTIONS' : 'CONNECT YOUR HOME';
}

export function resolveIntegrationDisplayTitle(
  domain: string,
  options?: {
    readonly explicitTitle?: string;
    readonly providedNames?: Readonly<Record<string, string>>;
    readonly pickerNames?: Readonly<Record<string, string>>;
    readonly translations?: Readonly<Record<string, string>>;
    readonly supportedBy?: string;
  },
): string {
  if (options?.explicitTitle) return options.explicitTitle;
  if (!domain) return '';
  const { providedNames, pickerNames, translations, supportedBy } = options ?? {};
  return (
    providedNames?.[domain] ??
    pickerNames?.[`component.${domain}.title`] ??
    pickerNames?.[domain] ??
    translations?.[`component.${domain}.title`] ??
    (supportedBy ? translations?.[`component.${supportedBy}.title`] : undefined) ??
    humanizeFlowIdentifier(domain)
  );
}

export function resolveStepDocumentationUrl(
  step: FlowStepRecord | null | undefined,
  domain?: string,
): string | undefined {
  if (
    step &&
    typeof step.documentation_url === 'string' &&
    /^https?:\/\//.test(step.documentation_url)
  ) {
    return step.documentation_url;
  }
  if (
    step &&
    typeof step.url === 'string' &&
    step.type !== 'external' &&
    /^https?:\/\//.test(step.url)
  ) {
    return step.url;
  }
  if (domain && /^[a-z0-9_]+$/.test(domain)) {
    return `https://www.home-assistant.io/integrations/${domain}`;
  }
  return undefined;
}

/**
 * Resolves Home Assistant config, options, repair fix-flow, and selector translations
 * for an active config flow step with placeholder interpolation.
 */
export function createFlowLocalization(params: {
  readonly domain: string;
  readonly integrationTitle?: string;
  readonly kind?: 'config' | 'options';
  readonly repair?: FlowStartTarget['repair'];
  readonly step: FlowStepRecord | null;
  readonly translations?: Readonly<Record<string, string>>;
}): FlowLocalizationHelpers {
  const { domain, integrationTitle, kind = 'config', repair, step, translations = {} } = params;
  const translationDomains = [
    ...new Set(
      [domain, step?.translation_domain, step?.supported_by].filter((x): x is string => Boolean(x)),
    ),
  ];

  const substitute = (input: string): string => {
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

  const text = (suffix: string, fallback: string): string =>
    lookupText(suffix) ?? substitute(fallback);

  const humanizeSlug = (value: string): string =>
    value.includes(' ') ? value : humanizeFlowIdentifier(value);

  const domainDisplayTitle = resolveIntegrationDisplayTitle(domain, {
    explicitTitle: integrationTitle,
    translations,
    supportedBy: step?.supported_by,
  });

  const titleFromTr = step?.step_id ? lookupText(`step.${step.step_id}.title`) : undefined;
  const title = step
    ? titleFromTr && !/\{[a-zA-Z0-9_]+\}/.test(titleFromTr)
      ? titleFromTr
      : step.title
        ? substitute(step.title)
        : (titleFromTr ?? (step.type === 'menu' ? 'Select Action' : domainDisplayTitle))
    : integrationTitle || 'Connect an integration';

  const descFromTr = step?.step_id ? lookupText(`step.${step.step_id}.description`) : undefined;
  const description = descFromTr ?? (step?.description ? substitute(step.description) : undefined);

  const submitLabel =
    (step?.step_id ? lookupText(`step.${step.step_id}.submit`) : undefined) ??
    step?.submit_label ??
    'Submit';

  const fieldLabel = (key: string, field?: FlowFormFieldRecord): string => {
    const direct = step?.field_labels?.[key];
    if (direct) return substitute(direct);
    if (key.includes('.')) {
      const [sec, ...restPath] = key.split('.');
      return text(
        `step.${step?.step_id}.sections.${sec}.data.${restPath.join('.')}`,
        field?.label || humanizeFlowIdentifier(restPath.join('.')),
      );
    }
    return text(`step.${step?.step_id}.data.${key}`, field?.label || humanizeFlowIdentifier(key));
  };

  const fieldDescription = (key: string, field?: FlowFormFieldRecord): string | undefined => {
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

  const selectorOptions = (
    key: string,
    field?: { readonly translation_key?: string },
  ): Readonly<Record<string, string>> | undefined => {
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

  const errorText = (code: string): string => {
    if (code === 'required') return 'This field is required.';
    if (code === 'invalid_number') return 'Enter a valid number.';
    if (code === 'below_min') return 'Value is below the minimum allowed.';
    if (code === 'above_max') return 'Value exceeds the maximum allowed.';
    return text(`error.${code}`, humanizeSlug(code));
  };

  const abortTitle = (reason?: string): string => {
    if (!reason) return 'Setup ended';
    if (reason === 'reauth_successful')
      return lookupText(`abort.${reason}`) ?? 'Reauthentication successful';
    if (reason === 'reconfigure_successful')
      return lookupText(`abort.${reason}`) ?? 'Configuration updated';
    if (reason === 'already_configured')
      return lookupText(`abort.${reason}`) ?? 'Already configured';
    if (reason === 'single_instance_allowed')
      return lookupText(`abort.${reason}`) ?? 'Only a single configuration is allowed';
    return text(`abort.${reason}`, humanizeSlug(reason));
  };

  const progressText = (action?: string, fallback?: string): string => {
    if (action) {
      const translated = lookupText(`progress.${action}`);
      if (translated) return translated;
    }
    if (fallback) return substitute(fallback);
    return action ? humanizeSlug(action) : 'Working…';
  };

  return {
    lookupText,
    text,
    humanizeSlug,
    title,
    ...(description ? { description } : {}),
    submitLabel,
    fieldLabel,
    fieldDescription,
    selectorOptions,
    errorText,
    abortTitle,
    progressText,
  };
}

export function normalizeLocalizedMenuOptions(
  step: FlowStepRecord,
  localization?: Pick<FlowLocalizationHelpers, 'lookupText' | 'humanizeSlug'>,
): readonly NormalizedFlowMenuOption[] {
  const raw = step.menu_options;
  const descriptions = step.menu_descriptions ?? {};
  const resolveDesc = (key: string): string | undefined =>
    descriptions[key] ??
    (step.step_id
      ? localization?.lookupText(`step.${step.step_id}.menu_option_descriptions.${key}`)
      : undefined);
  const resolveLabel = (key: string, fallbackLabel?: string): string => {
    const tr = step.step_id
      ? localization?.lookupText(`step.${step.step_id}.menu_options.${key}`)
      : undefined;
    if (tr) return tr;
    if (fallbackLabel) return fallbackLabel;
    return localization ? localization.humanizeSlug(key) : humanizeFlowIdentifier(key);
  };

  if (Array.isArray(raw)) {
    return raw.map((key) => {
      const desc = resolveDesc(key);
      return {
        key,
        label: resolveLabel(key),
        ...(desc ? { description: desc } : {}),
      };
    });
  }
  if (raw && typeof raw === 'object') {
    return Object.entries(raw).map(([key, label]) => {
      const desc = resolveDesc(key);
      return {
        key,
        label: resolveLabel(key, typeof label === 'string' && label ? label : undefined),
        ...(desc ? { description: desc } : {}),
      };
    });
  }
  return [];
}

export function parseOAuthCallbackInput(rawInput: string): ParsedOAuthCallbackInput {
  const trimmed = rawInput.trim();
  if (!trimmed) return {};
  try {
    const url = new URL(trimmed);
    const code = url.searchParams.get('code') ?? undefined;
    const state = url.searchParams.get('state') ?? undefined;
    const error = url.searchParams.get('error') ?? undefined;
    if (code || state || error) {
      return {
        ...(state ? { state } : {}),
        ...(code ? { code } : {}),
        ...(error ? { error } : {}),
      };
    }
  } catch {
    /* Treat non-URL text as raw OAuth authorization code. */
  }
  return { code: trimmed };
}
