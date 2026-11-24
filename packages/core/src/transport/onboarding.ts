/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export {
  computeCommissioningHint,
  detectSetupCodeFormat,
  type DetectedSetupCode,
  type SetupCodeBadgeTone,
  type SetupCodeDetectionKind,
} from './onboarding-codes.js';

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
  readonly required?: boolean;
  readonly optional?: boolean;
  readonly expanded?: boolean;
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
  readonly data_schema?: readonly FlowFormFieldRecord[];
  readonly errors?: Readonly<Record<string, string>>;
  readonly reason?: string;
  readonly title?: string;
  readonly description?: string;
  readonly submit_label?: string;
  readonly field_labels?: Readonly<Record<string, string>>;
  readonly data_descriptions?: Readonly<Record<string, string>>;
  readonly url?: string;
  readonly documentation_url?: string;
  readonly menu_options?: readonly string[] | Readonly<Record<string, string>>;
  readonly menu_descriptions?: Readonly<Record<string, string>>;
  readonly description_placeholders?: Readonly<Record<string, string>>;
  readonly progress_action?: string;
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
}

export interface DemoOnboardingState {
  readonly discovered: readonly OnboardingDiscoveredFlow[];
  readonly catalog: readonly IntegrationCatalogChoice[];
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
    if (field.required && (field.type === 'boolean' || Boolean(field.selector && 'boolean' in field.selector))) {
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
    const isBool = field.type === 'boolean' || Boolean(field.selector && 'boolean' in field.selector);
    const isRequired = field.required === true && field.optional !== true;
    const isEmpty =
      val === undefined ||
      val === null ||
      (typeof val === 'string' && val.trim().length === 0);
    if (isRequired && !isBool && isEmpty) {
      errors[field.name] = 'required';
      continue;
    }
    if (!isEmpty && (field.type === 'integer' || field.type === 'float' || field.type === 'number')) {
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
  if (err instanceof Error) return err.message || 'The integration flow failed.';
  if (typeof err === 'string' && err.trim()) return err;
  return 'The integration flow failed.';
}

const DEMO_DISCOVERED_FLOWS: readonly OnboardingDiscoveredFlow[] = [
  {
    flowId: 'demo-flow-hue',
    domain: 'hue',
    title: 'Philips Hue',
    label: 'Philips Hue Bridge',
    source: 'zeroconf',
    sourceLabel: 'mDNS',
  },
  {
    flowId: 'demo-flow-matter',
    domain: 'matter',
    title: 'Matter',
    label: 'Matter Smart Plug',
    source: 'matter',
    sourceLabel: 'Matter',
  },
  {
    flowId: 'demo-flow-homekit',
    domain: 'homekit_controller',
    title: 'Apple HomeKit Device',
    label: 'Aqara Presence FP2',
    source: 'homekit',
    sourceLabel: 'HomeKit',
  },
];

const DEMO_INTEGRATION_CATALOG: readonly IntegrationCatalogChoice[] = [
  { domain: 'hue', title: 'Philips Hue', subtitle: 'Bridges & local lights', category: 'Lighting', popular: true },
  { domain: 'matter', title: 'Matter', subtitle: 'Thread & Wi-Fi Matter accessories', category: 'Protocol', popular: true },
  { domain: 'homekit_controller', title: 'HomeKit Device', subtitle: 'Local HAP accessories over IP & BLE', category: 'Protocol', popular: true },
  { domain: 'tuya', title: 'Tuya', subtitle: 'Smart Life & local LAN pairing', category: 'Ecosystem', popular: true },
  { domain: 'shelly', title: 'Shelly', subtitle: 'Gen1–Gen3 switches & energy meters', category: 'Switches', popular: true },
  { domain: 'esphome', title: 'ESPHome', subtitle: 'Native API sensors & relays', category: 'DIY', popular: true },
  { domain: 'sonos', title: 'Sonos', subtitle: 'Speakers & rooms', category: 'Media', popular: true },
  { domain: 'unifiprotect', title: 'UniFi Protect', subtitle: 'Cameras, doorbells & NVR', category: 'Cameras', popular: true },
  { domain: 'zha', title: 'Zigbee Home Automation', subtitle: 'Direct coordinator mesh', category: 'Protocol', popular: false },
  { domain: 'mqtt', title: 'MQTT', subtitle: 'Broker discovery & devices', category: 'Protocol', popular: false },
  { domain: 'govee', title: 'Govee', subtitle: 'LAN light strips & lamps', category: 'Lighting', popular: false },
  { domain: 'reolink', title: 'Reolink', subtitle: 'IP cameras & NVR streams', category: 'Cameras', popular: false },
];

export function buildDemoOnboardingState(): DemoOnboardingState {
  return {
    discovered: DEMO_DISCOVERED_FLOWS,
    catalog: DEMO_INTEGRATION_CATALOG,
  };
}

export function startDemoConfigFlow(domain: string, title?: string): FlowStepRecord {
  const display =
    title ??
    DEMO_INTEGRATION_CATALOG.find((item) => item.domain === domain)?.title ??
    humanizeSlug(domain);
  const flowId = `demo-flow-${domain}`;

  if (domain === 'hue') {
    return {
      type: 'form',
      flow_id: flowId,
      handler: 'hue',
      step_id: 'link',
      title: display,
      description: 'Press the link button on your Hue Bridge, or confirm its local IP address to pair.',
      submit_label: 'Connect Bridge',
      data_schema: [
        { name: 'host', type: 'string', label: 'Bridge IP / Hostname', default: '192.168.1.42', required: true },
        { name: 'allow_insecure', type: 'boolean', label: 'Allow local self-signed TLS certificate', default: true },
      ],
    };
  }

  if (domain === 'tuya') {
    return {
      type: 'menu',
      flow_id: flowId,
      handler: 'tuya',
      step_id: 'user',
      title: display,
      description: 'Choose how Haus should pair your Tuya devices.',
      menu_options: ['cloud', 'local'],
      menu_descriptions: {
        cloud: 'Smart Life / Tuya Cloud QR & app credentials',
        local: 'Local LAN key pairing on your home subnet',
      },
    };
  }

  return {
    type: 'form',
    flow_id: flowId,
    handler: domain,
    step_id: 'user',
    title: display,
    description: `Enter connection details for ${display} on your local network.`,
    submit_label: 'Set up',
    data_schema: [
      { name: 'host', type: 'string', label: 'Host or IP address', default: '192.168.1.50', required: true },
      { name: 'name', type: 'string', label: 'Display name', default: display },
    ],
  };
}

export function advanceDemoConfigFlow(
  step: FlowStepRecord,
  input: Readonly<Record<string, unknown>>,
): FlowStepRecord {
  const display = step.title ?? humanizeSlug(step.handler);

  if (step.type === 'menu' && step.handler === 'tuya') {
    const mode = String(input.next_step_id ?? 'cloud');
    return {
      type: 'form',
      flow_id: step.flow_id,
      handler: 'tuya',
      step_id: 'credentials',
      title: display,
      description:
        mode === 'local'
          ? 'Enter the local LAN device ID and key to pair without cloud dependency.'
          : 'Confirm your Smart Life account code to link discovered Tuya devices.',
      submit_label: 'Pair Tuya',
      data_schema:
        mode === 'local'
          ? [
              { name: 'host', type: 'string', label: 'Device IP', default: '192.168.1.78', required: true },
              { name: 'local_key', type: 'password', label: 'Local key', default: 'demo-local-key', required: true },
            ]
          : [{ name: 'user_code', type: 'string', label: 'User code', default: 'HAUS-DEMO-88', required: true }],
    };
  }

  const chosenTitle =
    typeof input.name === 'string' && input.name.trim()
      ? input.name.trim()
      : display;
  return {
    type: 'create_entry',
    flow_id: step.flow_id,
    handler: step.handler,
    title: chosenTitle,
    description: `${chosenTitle} is configured and ready in Haus.`,
    result: {
      entry_id: `demo-entry-${step.handler}`,
      title: chosenTitle,
    },
  };
}
