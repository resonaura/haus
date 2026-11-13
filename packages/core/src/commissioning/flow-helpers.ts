/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type {
  FlowCatalogManifest,
  FlowFormField,
  FlowInitOptions,
  FlowSubmissionOptions,
  IntegrationFlowStep,
} from './flow-types.js';

let entryCounter = 0;

export function generateFlowId(): string {
  return `flow_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function generateEntryId(domain: string, suffix = ''): string {
  entryCounter += 1;
  const tag = suffix ? `${suffix}_` : '';
  return `${domain}_${tag}${Date.now()}_${entryCounter}`;
}

export function isBlankValue(val: unknown): boolean {
  if (val === undefined || val === null || val === '') return true;
  if (Array.isArray(val) && val.length === 0) return true;
  return false;
}

export function applyFieldDefaults(
  schema: readonly FlowFormField[] | undefined,
  defaults: Readonly<Record<string, unknown>>,
): readonly FlowFormField[] | undefined {
  if (!schema) return undefined;
  return schema.map((field) => {
    const fallback = defaults[field.name];
    if (fallback !== undefined && field.type !== 'pin' && field.type !== 'password') {
      return { ...field, defaultValue: fallback };
    }
    return field;
  });
}

export function resolveMenuChoice(
  step: IntegrationFlowStep,
  submission: FlowSubmissionOptions,
): string | undefined {
  const raw = submission.nextStepId ?? submission.values.next_step_id ?? submission.values.action;
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  const choice = raw.trim();
  if (!step.menuOptions) return undefined;
  const valid = Array.isArray(step.menuOptions)
    ? step.menuOptions.includes(choice)
    : Object.prototype.hasOwnProperty.call(step.menuOptions, choice);
  return valid ? choice : undefined;
}

export function buildCatalogFlowStep(input: {
  readonly flowId: string;
  readonly domain: string;
  readonly manifest: FlowCatalogManifest;
  readonly options: FlowInitOptions;
  readonly candidateAddresses?: readonly string[];
  readonly candidatePort?: number;
  readonly defaults: Readonly<Record<string, unknown>>;
  readonly targetEntryId?: string;
}): { readonly step: IntegrationFlowStep; readonly configuredNow: boolean } {
  const {
    flowId,
    domain,
    manifest,
    options,
    candidateAddresses,
    candidatePort,
    defaults,
    targetEntryId,
  } = input;
  const name = manifest.name || domain;
  const iotClass = manifest.iot_class ?? 'local_push';
  const isBluetooth = Boolean(manifest.bluetooth && manifest.bluetooth.length > 0);
  const isZeroConfig =
    manifest.config_flow === false || iotClass === 'calculated' || iotClass === 'system';

  if (isZeroConfig) {
    const entryId = targetEntryId ?? generateEntryId(domain);
    return {
      configuredNow: true,
      step: {
        type: 'create_entry',
        flowId,
        handler: domain,
        stepId: 'done',
        title: name,
        documentationUrl: manifest.documentation,
        result: { entryId, title: name, data: {} },
      },
    };
  }

  if (isBluetooth) {
    const schema: FlowFormField[] = [
      {
        name: 'address',
        type: 'string',
        label: 'Bluetooth Device MAC',
        required: true,
        defaultValue: options.manualAddress?.host ?? candidateAddresses?.[0],
      },
      {
        name: 'bindkey',
        type: 'pin',
        label: 'Encryption Bindkey (optional)',
        required: false,
      },
    ];
    return {
      configuredNow: false,
      step: {
        type: 'form',
        flowId,
        handler: domain,
        stepId: 'user',
        title: `Configure ${name}`,
        description: `Enter the Bluetooth address and optional encryption bindkey for ${name}.`,
        documentationUrl: manifest.documentation,
        lastStep: true,
        dataSchema: applyFieldDefaults(schema, defaults),
      },
    };
  }

  const schema: FlowFormField[] = iotClass.startsWith('cloud')
    ? [
        { name: 'username', type: 'string', label: 'Account Username / Email', required: true },
        {
          name: 'password',
          type: 'pin',
          label: 'Account Password / API Token',
          required: true,
        },
      ]
    : [
        {
          name: 'host',
          type: 'string',
          label: 'Host / IP Address',
          required: true,
          defaultValue: options.manualAddress?.host ?? candidateAddresses?.[0],
        },
        {
          name: 'port',
          type: 'number',
          label: 'Port',
          required: false,
          defaultValue: options.manualAddress?.port ?? candidatePort,
        },
        {
          name: 'api_key',
          type: 'pin',
          label: 'API Key or Access Token (optional)',
          required: false,
        },
      ];

  return {
    configuredNow: false,
    step: {
      type: 'form',
      flowId,
      handler: domain,
      stepId: 'user',
      title: `Configure ${name}`,
      description: `Set up ${name} (${iotClass}).`,
      documentationUrl: manifest.documentation,
      lastStep: true,
      dataSchema: applyFieldDefaults(schema, defaults),
    },
  };
}
