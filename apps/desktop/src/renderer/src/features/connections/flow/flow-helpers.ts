/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { FlowStep, FormField } from '../../../ha/management';

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

/** Checks required scalar/list fields on submit to display inline HA-style field errors. */
export function validateRequiredFormFields(
  schema: readonly FormField[] | undefined,
  values: Readonly<Record<string, unknown>>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!schema) return errors;
  for (const field of schema) {
    if (!field.required) continue;
    const selector = field.selector ?? {};
    const type = Object.keys(selector)[0] ?? field.type ?? 'string';
    if (type === 'boolean' || type === 'bool' || type === 'qr_code' || type === 'constant') {
      continue;
    }
    const raw = values[field.name];
    if (
      raw === undefined ||
      raw === null ||
      (typeof raw === 'string' && raw.trim().length === 0) ||
      (Array.isArray(raw) && raw.length === 0) ||
      (typeof raw === 'number' && !Number.isFinite(raw))
    ) {
      errors[field.name] = 'required';
    }
  }
  return errors;
}
