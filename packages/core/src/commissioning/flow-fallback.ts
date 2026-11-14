/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import {
  KNOWN_FLOW_DOMAINS,
  type DomainFlowDefinition,
  type DomainFlowStepSpec,
} from './flow-domains.js';
import {
  applyFieldDefaults,
  buildCatalogFlowStep,
  generateEntryId,
  isBlankValue,
  resolveMenuChoice,
} from './flow-helpers.js';
import type {
  FlowCatalogManifest,
  FlowCatalogResolver,
  FlowInitOptions,
  FlowSource,
  FlowSubmissionOptions,
  IntegrationFlowSession,
  IntegrationFlowStep,
} from './flow-types.js';

export interface FallbackInitResult {
  readonly step: IntegrationFlowStep;
  readonly configuredNow: boolean;
}

export interface FallbackSubmitResult {
  readonly nextStep: IntegrationFlowStep;
  readonly extraContext?: Record<string, unknown>;
  readonly configuredNow?: boolean;
}

function buildStepFromSpec(
  flowId: string,
  domain: string,
  stepId: string,
  spec: DomainFlowStepSpec,
  def: DomainFlowDefinition,
  defaults: Readonly<Record<string, unknown>>,
): IntegrationFlowStep {
  return {
    type: spec.type,
    flowId,
    handler: domain,
    stepId,
    title: spec.title,
    description: spec.description,
    documentationUrl: def.documentationUrl,
    lastStep: spec.lastStep ?? !spec.nextStepId,
    dataSchema: applyFieldDefaults(
      spec.buildSchema ? spec.buildSchema(defaults, flowId) : spec.schema,
      defaults,
    ),
    menuOptions: spec.menuOptions,
    menuDescriptions: spec.menuDescriptions,
    menuNextStepIds: spec.menuNextStepIds,
    url: spec.url,
  };
}

export function resolveFlowDefaults(
  options: FlowInitOptions,
  candidateAddresses?: readonly string[],
  candidatePort?: number,
): Record<string, unknown> {
  return {
    ...options.initialData,
    ...(options.manualAddress?.host || candidateAddresses?.[0]
      ? {
          host: options.manualAddress?.host ?? candidateAddresses?.[0],
          address: options.manualAddress?.host ?? candidateAddresses?.[0],
        }
      : {}),
    ...((options.manualAddress?.port ?? candidatePort)
      ? { port: options.manualAddress?.port ?? candidatePort }
      : {}),
  };
}

export function buildFallbackInitialStep(params: {
  readonly flowId: string;
  readonly domain: string;
  readonly source: FlowSource;
  readonly options: FlowInitOptions;
  readonly catalogResolver?: FlowCatalogResolver;
  readonly defaults: Readonly<Record<string, unknown>>;
  readonly candidateAddresses?: readonly string[];
  readonly candidatePort?: number;
  readonly targetEntryId?: string;
}): FallbackInitResult {
  const {
    flowId,
    domain,
    source,
    options,
    catalogResolver,
    defaults,
    candidateAddresses,
    candidatePort,
    targetEntryId,
  } = params;
  const def = KNOWN_FLOW_DOMAINS[domain];
  const catalogManifest: FlowCatalogManifest | undefined =
    !def && catalogResolver ? catalogResolver.getManifest(domain) : undefined;

  if (source === 'options') {
    const schema = def?.optionsSchema ??
      (def?.schema ? applyFieldDefaults(def.schema, defaults) : undefined) ?? [
        {
          name: 'scan_interval',
          type: 'integer',
          label: 'Polling interval (seconds)',
          defaultValue: 30,
          min: 5,
          max: 3600,
        },
      ];
    return {
      configuredNow: false,
      step: {
        type: 'form',
        flowId,
        handler: domain,
        stepId: 'init',
        title: def?.optionsTitle ?? `${def?.title ?? catalogManifest?.name ?? domain} Options`,
        description: 'Update configuration options for this integration entry.',
        documentationUrl: def?.documentationUrl ?? catalogManifest?.documentation,
        lastStep: true,
        dataSchema: applyFieldDefaults(schema, defaults),
      },
    };
  }

  if (def) {
    if (def.authMethod === 'zero_config') {
      const entryId = targetEntryId ?? generateEntryId(domain);
      return {
        configuredNow: true,
        step: {
          type: 'create_entry',
          flowId,
          handler: domain,
          stepId: 'done',
          title: def.title,
          documentationUrl: def.documentationUrl,
          result: { entryId, title: def.title, data: options.initialData ?? {} },
        },
      };
    }
    if (def.authMethod === 'oauth') {
      return {
        configuredNow: false,
        step: {
          type: 'external',
          flowId,
          handler: domain,
          stepId: 'oauth',
          title: def.title,
          url: def.oauthUrl,
          documentationUrl: def.documentationUrl,
          description: `Authorize ${def.title} in your browser to continue setup.`,
        },
      };
    }
    if (def.steps && Object.keys(def.steps).length > 0) {
      const initialId =
        source === 'reauth' && def.steps.reauth ? 'reauth' : (def.initialStepId ?? 'user');
      const stepSpec = def.steps[initialId] ?? Object.values(def.steps)[0];
      return {
        configuredNow: false,
        step: buildStepFromSpec(flowId, domain, initialId, stepSpec, def, defaults),
      };
    }
    if (source === 'reauth' || source === 'repair') {
      return {
        configuredNow: false,
        step: {
          type: 'form',
          flowId,
          handler: domain,
          stepId: source,
          title: source === 'repair' ? `Repair ${def.title}` : `Re-authenticate ${def.title}`,
          description: def.description,
          documentationUrl: def.documentationUrl,
          lastStep: true,
          dataSchema: applyFieldDefaults(def.schema, defaults),
        },
      };
    }
    return {
      configuredNow: false,
      step: {
        type: 'form',
        flowId,
        handler: domain,
        stepId: 'user',
        title: source === 'reconfigure' ? `Reconfigure ${def.title}` : def.title,
        description: def.description,
        documentationUrl: def.documentationUrl,
        lastStep: !def.requires2fa,
        dataSchema: applyFieldDefaults(def.schema, defaults),
      },
    };
  }

  if (catalogManifest || catalogResolver?.hasDomain(domain)) {
    const manifest = catalogManifest ?? { domain, name: domain };
    return buildCatalogFlowStep({
      flowId,
      domain,
      manifest,
      options,
      candidateAddresses,
      candidatePort,
      defaults,
      targetEntryId,
    });
  }

  return {
    configuredNow: false,
    step: {
      type: 'abort',
      flowId,
      handler: domain,
      stepId: 'abort',
      title: `Unsupported Integration: ${domain}`,
      description: `Integration "${domain}" is not supported natively by Haus without Home Assistant Core.`,
      unsupportedRequirements: [
        {
          category: 'runtime',
          name: domain,
          description: `Integration "${domain}" requires external Python runtime execution.`,
        },
      ],
    },
  };
}

export function submitFallbackStep(
  session: IntegrationFlowSession,
  submission: FlowSubmissionOptions,
): FallbackSubmitResult {
  const def = KNOWN_FLOW_DOMAINS[session.domain];
  const stepId = submission.stepId ?? session.currentStep.stepId;

  if (session.currentStep.type === 'menu') {
    const choice = resolveMenuChoice(session.currentStep, submission);
    if (!choice) {
      return {
        nextStep: {
          ...session.currentStep,
          errors: { base: 'invalid_menu_option', next_step_id: 'required' },
        },
      };
    }
    const mappedTarget = session.currentStep.menuNextStepIds?.[choice] ?? choice;
    const spec = def?.steps?.[mappedTarget];
    if (!spec || !def) {
      const entryId = session.entryId ?? generateEntryId(session.domain, choice);
      return {
        extraContext: { selectedMenuOption: choice },
        configuredNow: true,
        nextStep: {
          type: 'create_entry',
          flowId: session.flowId,
          handler: session.domain,
          stepId: 'done',
          title: def?.title ?? session.domain,
          result: { entryId, title: def?.title ?? session.domain, data: { action: choice } },
        },
      };
    }
    return {
      extraContext: { selectedMenuOption: choice },
      nextStep: buildStepFromSpec(
        session.flowId,
        session.domain,
        mappedTarget,
        spec,
        def,
        session.context,
      ),
    };
  }

  const errors: Record<string, string> = {};
  if (session.currentStep.type === 'form' && session.currentStep.dataSchema) {
    for (const field of session.currentStep.dataSchema) {
      if (field.required && isBlankValue(submission.values[field.name])) {
        errors[field.name] = 'required';
      }
    }
  }

  const stepSpec = def?.steps?.[stepId];
  if (Object.keys(errors).length === 0 && stepSpec?.validate) {
    const customErrors = stepSpec.validate(submission.values, session.context);
    if (customErrors) Object.assign(errors, customErrors);
  }

  if (Object.keys(errors).length > 0) {
    return { nextStep: { ...session.currentStep, errors } };
  }

  const mergedData: Record<string, unknown> = {
    ...(session.context.collectedData as Record<string, unknown> | undefined),
    ...submission.values,
  };

  if (session.currentStep.type === 'external') {
    const entryId = session.entryId ?? generateEntryId(session.domain, 'oauth');
    const title = def?.title ?? session.domain;
    return {
      extraContext: { collectedData: mergedData },
      configuredNow: true,
      nextStep: {
        type: 'create_entry',
        flowId: session.flowId,
        handler: session.domain,
        stepId: 'done',
        title,
        result: { entryId, title, data: mergedData },
      },
    };
  }

  if (session.source !== 'options' && def?.requires2fa && stepId === 'user') {
    return {
      extraContext: { userCredentials: submission.values, collectedData: mergedData },
      nextStep: {
        type: 'form',
        flowId: session.flowId,
        handler: session.domain,
        stepId: '2fa',
        title: 'Enter Verification Code',
        description: 'A 6-digit verification code was sent to your device.',
        lastStep: true,
        dataSchema: [{ name: 'verification_code', type: 'pin', label: 'SMS Code', required: true }],
      },
    };
  }

  if (session.source !== 'options' && stepSpec?.nextStepId && def?.steps?.[stepSpec.nextStepId]) {
    const nextId = stepSpec.nextStepId;
    return {
      extraContext: { collectedData: mergedData },
      nextStep: buildStepFromSpec(
        session.flowId,
        session.domain,
        nextId,
        def.steps[nextId],
        def,
        mergedData,
      ),
    };
  }

  const entryId =
    session.entryId ??
    (session.context.reauthEntryId
      ? String(session.context.reauthEntryId)
      : generateEntryId(session.domain));
  const fallbackTitle = def?.title ?? session.currentStep.title ?? session.domain;
  const title =
    session.source === 'options'
      ? fallbackTitle
      : (def?.buildEntryTitle?.(mergedData) ?? fallbackTitle);

  return {
    extraContext: { finalValues: submission.values, collectedData: mergedData },
    configuredNow: true,
    nextStep: {
      type: 'create_entry',
      flowId: session.flowId,
      handler: session.domain,
      stepId: 'done',
      title,
      result: {
        entryId,
        title,
        deviceId: session.candidateId,
        ...(session.source === 'options' ? { options: mergedData } : { data: mergedData }),
      },
    },
  };
}
