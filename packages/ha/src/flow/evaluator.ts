/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type {
  FlowAssessment,
  FlowCapabilityRequirement,
  FlowProgress,
  FlowStep,
  FormField,
} from './types.js';
import { getIntegrationFlowProfile } from './matrix.js';

export const SUPPORTED_STEP_TYPES = new Set<string>([
  'form',
  'menu',
  'external',
  'progress',
  'progress_done',
  'external_done',
  'create_entry',
  'abort',
]);

export const SUPPORTED_SELECTORS = new Set<string>([
  'string',
  'text',
  'password',
  'boolean',
  'bool',
  'number',
  'integer',
  'float',
  'positive_int',
  'select',
  'multi_select',
  'entity',
  'device',
  'area',
  'object',
  'dict',
  'list',
  'target',
  'action',
  'condition',
  'trigger',
  'template',
  'date',
  'time',
  'datetime-local',
  'url',
  'email',
  'qr_code',
  'constant',
  'country',
  'language',
  'duration',
]);

export const UNSUPPORTED_SELECTORS = new Set<string>([
  'addon',
  'theme',
  'icon',
  'conversation_agent',
  'navigation',
  'ui_action',
  'location',
  'color_rgb',
  'color_temp',
]);

function inspectFieldSelectors(fields: readonly FormField[]): readonly FlowCapabilityRequirement[] {
  const requirements: FlowCapabilityRequirement[] = [];

  for (const field of fields) {
    if (field.schema && field.schema.length > 0) {
      requirements.push(...inspectFieldSelectors(field.schema));
    }

    const selector = field.selector ?? {};
    const type = Object.keys(selector)[0] ?? field.type ?? 'string';

    if (
      UNSUPPORTED_SELECTORS.has(type) ||
      (!SUPPORTED_SELECTORS.has(type) && Boolean(field.selector))
    ) {
      requirements.push({
        category: 'selector',
        name: type,
        description: `Selector "${type}" requires Home Assistant Web interface controls.`,
      });
    }
  }

  return requirements;
}

export function evaluateFlowStep(step: FlowStep, options?: { serverUrl?: string }): FlowAssessment {
  const domain =
    typeof step.handler === 'string' && step.handler.trim() ? step.handler.trim() : 'integration';
  const profile = getIntegrationFlowProfile(domain);
  const cleanServerUrl = (options?.serverUrl ?? '').replace(/\/+$/, '');
  const flowId = typeof step.flow_id === 'string' && step.flow_id ? step.flow_id : 'unknown';
  const fallbackUrl = cleanServerUrl
    ? `${cleanServerUrl}/config/config_entries/flow/${flowId}`
    : `/config/config_entries/flow/${flowId}`;

  if (profile.defaultSupport === 'unsupported') {
    return {
      status: 'unsupported',
      domain,
      supported: false,
      requiresOAuth: false,
      requiresReauth: false,
      unsupportedRequirements: [
        {
          category: profile.authMethod === 'hardware' ? 'hardware' : 'runtime',
          name: domain,
          description:
            profile.notes ?? `Integration "${domain}" is not natively configurable in Haus.`,
        },
      ],
      fallbackReason:
        profile.notes ?? `Integration "${domain}" requires Home Assistant Web interface.`,
      fallbackUrl,
    };
  }

  if (!SUPPORTED_STEP_TYPES.has(step.type)) {
    return {
      status: 'unsupported',
      domain,
      supported: false,
      requiresOAuth: false,
      requiresReauth: false,
      unsupportedRequirements: [
        {
          category: 'step_type',
          name: step.type,
          description: `Flow step type "${step.type}" is not supported.`,
        },
      ],
      fallbackReason: `Setup step type "${step.type}" is not supported by Haus native setup.`,
      fallbackUrl,
    };
  }

  if (step.type === 'external') {
    return {
      status: 'supported-oauth',
      domain,
      supported: true,
      requiresOAuth: true,
      requiresReauth: false,
      unsupportedRequirements: [],
    };
  }

  if (step.type === 'form' && step.data_schema) {
    const selectorRequirements = inspectFieldSelectors(step.data_schema);
    if (selectorRequirements.length > 0) {
      const names = selectorRequirements.map((r) => r.name).join(', ');
      return {
        status: 'unsupported',
        domain,
        supported: false,
        requiresOAuth: false,
        requiresReauth: false,
        unsupportedRequirements: selectorRequirements,
        fallbackReason: `Setup step "${step.step_id ?? 'form'}" requires unsupported selectors (${names}).`,
        fallbackUrl,
      };
    }
  }

  return {
    status: 'supported',
    domain,
    supported: true,
    requiresOAuth: false,
    requiresReauth: false,
    unsupportedRequirements: [],
  };
}

export function evaluateFlowProgress(
  flow: FlowProgress,
  options?: { serverUrl?: string },
): FlowAssessment {
  const domain = flow.handler;
  const source = flow.context?.source ?? 'user';
  const cleanServerUrl = (options?.serverUrl ?? '').replace(/\/+$/, '');
  const fallbackUrl = cleanServerUrl
    ? `${cleanServerUrl}/config/config_entries/flow/${flow.flow_id}`
    : `/config/config_entries/flow/${flow.flow_id}`;

  const isReauth = source === 'reauth' || source === 'reconfigure';
  const profile = getIntegrationFlowProfile(domain);

  if (profile.defaultSupport === 'unsupported') {
    return {
      status: 'unsupported',
      domain,
      supported: false,
      requiresOAuth: false,
      requiresReauth: isReauth,
      unsupportedRequirements: [
        {
          category: profile.authMethod === 'hardware' ? 'hardware' : 'runtime',
          name: domain,
          description: profile.notes ?? `Integration "${domain}" is not supported.`,
        },
      ],
      fallbackReason: profile.notes,
      fallbackUrl,
    };
  }

  if (isReauth) {
    return {
      status: 'supported-reauth',
      domain,
      supported: true,
      requiresOAuth: profile.authMethod === 'oauth',
      requiresReauth: true,
      unsupportedRequirements: [],
    };
  }

  if (profile.authMethod === 'oauth') {
    return {
      status: 'supported-oauth',
      domain,
      supported: true,
      requiresOAuth: true,
      requiresReauth: false,
      unsupportedRequirements: [],
    };
  }

  return {
    status: 'supported',
    domain,
    supported: true,
    requiresOAuth: false,
    requiresReauth: false,
    unsupportedRequirements: [],
  };
}
