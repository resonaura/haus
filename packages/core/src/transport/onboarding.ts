/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export {
  computeCommissioningHint,
  detectSetupCodeFormat,
  type DetectedSetupCode,
  type SetupCodeBadgeTone,
  type SetupCodeDetectionKind,
} from './onboarding-codes.js';
export {
  createFlowLocalization,
  extractTranslationResources,
  flowEyebrowLabel,
  humanizeFlowIdentifier,
  normalizeLocalizedMenuOptions,
  parseOAuthCallbackInput,
  resolveIntegrationDisplayTitle,
  resolveStepDocumentationUrl,
  type FlowLocalizationHelpers,
  type NormalizedFlowMenuOption,
  type ParsedOAuthCallbackInput,
} from './onboarding/flow.js';
export {
  buildBrandIntegrationCatalog,
  CAMERA_SETUP_DOMAINS,
  compareBrandCatalogItems,
  countBrandCatalogEcosystems,
  filterBrandIntegrationCatalog,
  formatStabilityMedal,
  getBrandCatalogLetter,
  GOVEE_BUILTIN_DRIVERS,
  HAUS_GOVEE_WHY_GROUPED,
  INTEGRATION_CATALOG_ALPHABET,
  isGoveeAppId,
  parseEcosystemCatalogPayload,
  resolveBrandIdentity,
  stabilityTierFromScore,
  stabilityTierRank,
  VENDOR_GROUP_WHY_DEFAULT,
  type BrandCatalogItem,
  type BrandIdentity,
  type EcosystemCatalogSourceItem,
  type EcosystemRuntimeKind,
  type IntegrationEcosystem,
  type StabilityMedalInfo,
  type StabilityTier,
} from './onboarding/catalog.js';
import type { EcosystemCatalogSourceItem } from './onboarding/catalog.js';

export interface OnboardingDiscoveredFlow {
  readonly flowId: string;
  readonly domain: string;
  readonly title: string;
  readonly label: string;
  readonly source?: string;
  readonly sourceLabel: string;
}

export interface IntegrationCatalogChoice {
  readonly domain: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly category?: string;
  readonly popular?: boolean;
}

export interface FlowFormFieldRecord {
  readonly name: string;
  readonly type?: string;
  readonly label?: string;
  readonly placeholder?: string;
  readonly translation_key?: string;
  readonly required?: boolean;
  readonly optional?: boolean;
  readonly expanded?: boolean;
  readonly multiple?: boolean;
  readonly default?: unknown;
  readonly suggested_value?: unknown;
  readonly description?: string | Readonly<{ suggested_value?: unknown }>;
  readonly selector?: Readonly<Record<string, unknown>>;
  readonly options?: readonly unknown[] | Readonly<Record<string, string>>;
  readonly schema?: readonly FlowFormFieldRecord[];
  readonly value_min?: number;
  readonly value_max?: number;
}

export interface FlowStepRecord {
  readonly type: string;
  readonly flow_id: string;
  readonly handler: string;
  readonly step_id?: string;
  readonly translation_domain?: string;
  readonly supported_by?: string;
  readonly data_schema?: readonly FlowFormFieldRecord[];
  readonly errors?: Readonly<Record<string, string>>;
  readonly reason?: string;
  readonly title?: string;
  readonly description?: string;
  readonly submit_label?: string;
  readonly field_labels?: Readonly<Record<string, string>>;
  readonly data_descriptions?: Readonly<Record<string, string>>;
  readonly selector_translations?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly url?: string;
  readonly documentation_url?: string;
  readonly menu_options?: readonly string[] | Readonly<Record<string, string>>;
  readonly menu_descriptions?: Readonly<Record<string, string>>;
  readonly description_placeholders?: Readonly<Record<string, string>>;
  readonly progress_action?: string;
  readonly last_step?: boolean | null;
  readonly result?: Readonly<{ entry_id?: string; title?: string; device_id?: string }>;
}

export interface FlowStartTarget {
  readonly kind?: 'config' | 'options';
  readonly domain?: string;
  readonly entryId?: string;
  readonly flowId?: string;
  readonly title?: string;
  readonly reauth?: boolean;
  readonly reconfigure?: boolean;
  readonly repair?: Readonly<{ domain: string; issue_id: string; translation_key?: string }>;
  readonly appCatalogId?: string;
  readonly appRuntime?: 'hacs' | 'homebridge' | 'scrypted' | 'docker';
  readonly hacsRepositoryId?: string;
  readonly hacsDomain?: string;
}

export interface DemoOnboardingState {
  readonly discovered: readonly OnboardingDiscoveredFlow[];
  readonly catalog: readonly IntegrationCatalogChoice[];
  readonly ecosystemApps: readonly EcosystemCatalogSourceItem[];
}

export function formatDiscoverySource(source?: string): string {
  const key = source?.trim().toLowerCase();
  if (!key) return 'Discovered';
  if (key === 'mdns' || key === 'zeroconf') return 'mDNS';
  if (key === 'matter') return 'Matter';
  if (key === 'homekit' || key === 'homekit_controller') return 'HomeKit';
  if (key === 'bluetooth' || key === 'ble') return 'Bluetooth';
  if (key === 'dhcp') return 'DHCP';
  if (key === 'ssdp') return 'SSDP';
  if (key === 'usb') return 'USB';
  if (key === 'mqtt') return 'MQTT';
  if (key === 'hub') return 'Hub';
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export function substituteFlowPlaceholders(
  text: string,
  placeholders?: Readonly<Record<string, string>>,
): string {
  if (!placeholders) return text;
  let result = text;
  for (const [key, value] of Object.entries(placeholders)) {
    result = result.replaceAll(`{${key}}`, value);
  }
  return result;
}

function constantSelectorValue(selector: Readonly<Record<string, unknown>> | undefined): unknown {
  if (!selector || typeof selector.constant !== 'object' || selector.constant === null) {
    return undefined;
  }
  const constant = selector.constant as Readonly<Record<string, unknown>>;
  return 'value' in constant ? constant.value : undefined;
}

export function schemaDefaultsForFlow(
  schema: readonly FlowFormFieldRecord[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of schema) {
    const descObj =
      typeof field.description === 'object' && field.description !== null
        ? field.description
        : undefined;
    const suggested = field.suggested_value ?? descObj?.suggested_value;
    const explicitDefault = field.default ?? suggested;
    if (explicitDefault !== undefined) {
      result[field.name] = explicitDefault;
      continue;
    }
    if (field.schema) {
      const nested = schemaDefaultsForFlow(field.schema);
      if (Object.keys(nested).length > 0 || field.required || !field.optional || field.expanded) {
        result[field.name] = nested;
      }
      continue;
    }
    if (
      field.required &&
      (field.type === 'boolean' || Boolean(field.selector && 'boolean' in field.selector))
    ) {
      result[field.name] = false;
      continue;
    }
    if (field.required) {
      const constVal = constantSelectorValue(field.selector);
      if (constVal !== undefined) result[field.name] = constVal;
    }
  }
  return result;
}

export function validateFlowFormValues(
  schema: readonly FlowFormFieldRecord[],
  values: Readonly<Record<string, unknown>>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of schema) {
    const val = values[field.name];
    if (field.schema) {
      const nestedValues =
        val && typeof val === 'object' && !Array.isArray(val)
          ? (val as Readonly<Record<string, unknown>>)
          : {};
      const nestedErrors = validateFlowFormValues(field.schema, nestedValues);
      for (const [childKey, msg] of Object.entries(nestedErrors)) {
        errors[`${field.name}.${childKey}`] = msg;
      }
      continue;
    }
    const isBool =
      field.type === 'boolean' || Boolean(field.selector && 'boolean' in field.selector);
    const isRequired = field.required === true && field.optional !== true;
    const isEmpty =
      val === undefined || val === null || (typeof val === 'string' && val.trim().length === 0);
    if (isRequired && !isBool && isEmpty) {
      errors[field.name] = 'required';
      continue;
    }
    if (
      !isEmpty &&
      (field.type === 'integer' || field.type === 'float' || field.type === 'number')
    ) {
      const num = typeof val === 'number' ? val : Number(val);
      if (!Number.isFinite(num)) {
        errors[field.name] = 'invalid_number';
      } else if (field.value_min !== undefined && num < field.value_min) {
        errors[field.name] = 'below_min';
      } else if (field.value_max !== undefined && num > field.value_max) {
        errors[field.name] = 'above_max';
      }
    }
  }
  return errors;
}

function humanizeSlug(slug: string): string {
  return slug.replaceAll('_', ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export function normalizeFlowMenuOptions(
  step: FlowStepRecord,
): readonly { readonly key: string; readonly label: string; readonly description?: string }[] {
  const raw = step.menu_options;
  const descriptions = step.menu_descriptions ?? {};
  if (Array.isArray(raw)) {
    return raw.map((key) => ({
      key,
      label: humanizeSlug(key),
      ...(descriptions[key] ? { description: descriptions[key] } : {}),
    }));
  }
  if (raw && typeof raw === 'object') {
    return Object.entries(raw).map(([key, label]) => ({
      key,
      label: String(label || humanizeSlug(key)),
      ...(descriptions[key] ? { description: descriptions[key] } : {}),
    }));
  }
  return [];
}

export function buildFlowStartPayload(
  target: FlowStartTarget,
  domain: string,
): Record<string, unknown> {
  const kind = target.kind ?? 'config';
  return {
    handler: kind === 'options' ? (target.entryId ?? domain) : domain,
    ...(kind === 'options' && domain ? { domain } : {}),
    ...(target.repair ? { issue_id: target.repair.issue_id } : {}),
    ...(target.entryId && kind !== 'options' ? { entry_id: target.entryId } : {}),
    ...(target.reauth ? { reauth: true, source: 'reauth', reauth_entry_id: target.entryId } : {}),
    ...(target.reconfigure ? { source: 'reconfigure', show_advanced_options: false } : {}),
  };
}

export function isCompletedFlowStep(step: FlowStepRecord): boolean {
  return (
    step.type === 'create_entry' ||
    (step.type === 'abort' &&
      (step.reason === 'reauth_successful' || step.reason === 'reconfigure_successful'))
  );
}

export function filterIntegrationChoices(
  choices: readonly IntegrationCatalogChoice[],
  query: string,
): readonly IntegrationCatalogChoice[] {
  const trimmed = query.trim().toLocaleLowerCase();
  const filtered = trimmed
    ? choices.filter((item) =>
        `${item.title} ${item.domain} ${item.subtitle ?? ''} ${item.category ?? ''}`
          .toLocaleLowerCase()
          .includes(trimmed),
      )
    : choices;
  return [...filtered].sort((a, b) => {
    if (trimmed) {
      const aExact = a.title.toLocaleLowerCase().startsWith(trimmed) || a.domain === trimmed;
      const bExact = b.title.toLocaleLowerCase().startsWith(trimmed) || b.domain === trimmed;
      if (aExact !== bExact) return aExact ? -1 : 1;
    } else if (Boolean(a.popular) !== Boolean(b.popular)) {
      return a.popular ? -1 : 1;
    }
    return a.title.localeCompare(b.title);
  });
}

export function extractFlowErrorMessage(err: unknown): string {
  const message =
    err instanceof Error ? err.message.trim() : typeof err === 'string' ? err.trim() : '';
  if (message.includes('integration_entity_conflict')) {
    return 'A Home Assistant entity ID is already owned by another integration. Haus left the configuration unchanged; resolve the registry conflict before retrying.';
  }
  if (message.includes('ha_runtime_unavailable')) {
    return 'The Hub could not start its Home Assistant compatibility runtime. Haus left the configuration unchanged; retry when the runtime is available.';
  }
  if (message.includes('discovery_flow_unavailable')) {
    return 'This discovered device is no longer waiting for automatic pairing. Retry, pair using a setup code, or configure the integration directly.';
  }
  if (message) return message;
  return 'The integration flow failed.';
}

export {
  advanceDemoConfigFlow,
  buildDemoOnboardingState,
  startDemoConfigFlow,
} from './onboarding/demo.js';
