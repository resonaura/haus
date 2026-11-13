/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { DiscoveryRegistry } from './discovery-deduplicator.js';
import {
  KNOWN_FLOW_DOMAINS,
  type DomainFlowDefinition,
  type DomainFlowStepSpec,
} from './flow-domains.js';
import {
  applyFieldDefaults,
  buildCatalogFlowStep,
  generateEntryId,
  generateFlowId,
  isBlankValue,
  resolveMenuChoice,
} from './flow-helpers.js';
import type {
  FlowCatalogResolver,
  FlowDomainHandler,
  FlowInitOptions,
  FlowSubmissionOptions,
  IntegrationFlowSession,
  IntegrationFlowStep,
} from './flow-types.js';

export class IntegrationFlowEngine {
  private readonly sessions = new Map<string, IntegrationFlowSession>();
  private readonly domainHandlers = new Map<string, FlowDomainHandler>();

  constructor(
    private readonly discoveryRegistry?: DiscoveryRegistry,
    private catalogResolver?: FlowCatalogResolver,
  ) {}

  registerDomainHandler(domain: string, handler: FlowDomainHandler): void {
    this.domainHandlers.set(domain, handler);
  }

  setCatalogResolver(resolver: FlowCatalogResolver): void {
    this.catalogResolver = resolver;
  }

  getCatalogResolver(): FlowCatalogResolver | undefined {
    return this.catalogResolver;
  }

  getAvailableDomains(): readonly string[] {
    const known = Object.keys(KNOWN_FLOW_DOMAINS);
    const catalog = this.catalogResolver?.getAllDomains?.() ?? [];
    return Array.from(new Set([...known, ...catalog])).sort();
  }

  private buildStepFromSpec(
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

  private resolveDefaults(
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

  async startFlow(options: FlowInitOptions): Promise<IntegrationFlowStep> {
    const { domain, homeId, userId } = options;
    if (!homeId || !userId) {
      throw new Error('home_and_user_required');
    }

    const flowId = generateFlowId();
    const source = options.source ?? 'user';
    const now = Date.now();
    const candidate = options.candidateId
      ? this.discoveryRegistry?.getCandidate(options.candidateId)
      : undefined;
    const targetEntryId = options.entryId ?? options.reauthEntryId;

    if (options.candidateId && this.discoveryRegistry) {
      this.discoveryRegistry.markInProgress(options.candidateId, flowId);
    }

    const def = KNOWN_FLOW_DOMAINS[domain];
    const catalogManifest =
      !def && this.catalogResolver ? this.catalogResolver.getManifest(domain) : undefined;
    const defaults = this.resolveDefaults(options, candidate?.addresses, candidate?.port);
    const customHandler = this.domainHandlers.get(domain);
    const customStep = customHandler
      ? await customHandler.start?.({ flowId, domain, source, options })
      : undefined;

    let initialStep: IntegrationFlowStep;

    if (customStep) {
      initialStep = customStep;
    } else if (source === 'options') {
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
      initialStep = {
        type: 'form',
        flowId,
        handler: domain,
        stepId: 'init',
        title: def?.optionsTitle ?? `${def?.title ?? catalogManifest?.name ?? domain} Options`,
        description: 'Update configuration options for this integration entry.',
        documentationUrl: def?.documentationUrl ?? catalogManifest?.documentation,
        lastStep: true,
        dataSchema: applyFieldDefaults(schema, defaults),
      };
    } else if (def) {
      if (def.authMethod === 'zero_config') {
        const entryId = targetEntryId ?? generateEntryId(domain);
        initialStep = {
          type: 'create_entry',
          flowId,
          handler: domain,
          stepId: 'done',
          title: def.title,
          documentationUrl: def.documentationUrl,
          result: { entryId, title: def.title, data: options.initialData ?? {} },
        };
        if (options.candidateId && this.discoveryRegistry) {
          this.discoveryRegistry.markConfigured(options.candidateId, true);
        }
      } else if (def.authMethod === 'oauth') {
        initialStep = {
          type: 'external',
          flowId,
          handler: domain,
          stepId: 'oauth',
          title: def.title,
          url: def.oauthUrl,
          documentationUrl: def.documentationUrl,
          description: `Authorize ${def.title} in your browser to continue setup.`,
        };
      } else if (def.steps && Object.keys(def.steps).length > 0) {
        const initialId =
          source === 'reauth' && def.steps.reauth ? 'reauth' : (def.initialStepId ?? 'user');
        const stepSpec = def.steps[initialId] ?? Object.values(def.steps)[0];
        initialStep = this.buildStepFromSpec(flowId, domain, initialId, stepSpec, def, defaults);
      } else if (source === 'reauth' || source === 'repair') {
        initialStep = {
          type: 'form',
          flowId,
          handler: domain,
          stepId: source,
          title: source === 'repair' ? `Repair ${def.title}` : `Re-authenticate ${def.title}`,
          description: def.description,
          documentationUrl: def.documentationUrl,
          lastStep: true,
          dataSchema: applyFieldDefaults(def.schema, defaults),
        };
      } else {
        initialStep = {
          type: 'form',
          flowId,
          handler: domain,
          stepId: 'user',
          title: source === 'reconfigure' ? `Reconfigure ${def.title}` : def.title,
          description: def.description,
          documentationUrl: def.documentationUrl,
          lastStep: !def.requires2fa,
          dataSchema: applyFieldDefaults(def.schema, defaults),
        };
      }
    } else if (
      catalogManifest ||
      (this.catalogResolver && this.catalogResolver.hasDomain(domain))
    ) {
      const manifest = catalogManifest ?? { domain, name: domain };
      const built = buildCatalogFlowStep({
        flowId,
        domain,
        manifest,
        options,
        candidateAddresses: candidate?.addresses,
        candidatePort: candidate?.port,
        defaults,
        targetEntryId,
      });
      initialStep = built.step;
      if (built.configuredNow && options.candidateId && this.discoveryRegistry) {
        this.discoveryRegistry.markConfigured(options.candidateId, true);
      }
    } else {
      initialStep = {
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
      };
    }

    const session: IntegrationFlowSession = {
      flowId,
      domain,
      source,
      candidateId: options.candidateId,
      entryId: targetEntryId,
      homeId,
      userId,
      createdAt: now,
      updatedAt: now,
      currentStep: initialStep,
      history: [initialStep],
      context: {
        ...options.initialData,
        ...(options.manualAddress ? { manualAddress: options.manualAddress } : {}),
        ...(targetEntryId ? { reauthEntryId: targetEntryId, entryId: targetEntryId } : {}),
        collectedData: {},
      },
    };

    this.sessions.set(flowId, session);
    return initialStep;
  }

  getFlow(
    flowId: string,
    auth: { homeId: string; userId?: string },
  ): IntegrationFlowStep | undefined {
    const s = this.sessions.get(flowId);
    if (!s || s.homeId !== auth.homeId) return undefined;
    return s.currentStep;
  }

  async submitStep(submission: FlowSubmissionOptions): Promise<IntegrationFlowStep> {
    const s = this.sessions.get(submission.flowId);
    if (!s || s.homeId !== submission.homeId) {
      throw new Error('flow_not_found');
    }

    const customHandler = this.domainHandlers.get(s.domain);
    const customNext = customHandler ? await customHandler.submit?.(s, submission) : undefined;
    if (customNext) {
      const merged = {
        ...(s.context.collectedData as Record<string, unknown> | undefined),
        ...submission.values,
      };
      this.updateSession(s, customNext, { collectedData: merged });
      if (customNext.type === 'create_entry' && s.candidateId && this.discoveryRegistry) {
        this.discoveryRegistry.markConfigured(s.candidateId, true);
      }
      return customNext;
    }

    const def = KNOWN_FLOW_DOMAINS[s.domain];
    const stepId = submission.stepId ?? s.currentStep.stepId;

    if (s.currentStep.type === 'menu') {
      const choice = resolveMenuChoice(s.currentStep, submission);
      if (!choice) {
        const errStep: IntegrationFlowStep = {
          ...s.currentStep,
          errors: { base: 'invalid_menu_option', next_step_id: 'required' },
        };
        this.updateSession(s, errStep);
        return errStep;
      }
      const mappedTarget = s.currentStep.menuNextStepIds?.[choice] ?? choice;
      const spec = def?.steps?.[mappedTarget];
      if (!spec || !def) {
        const entryId = s.entryId ?? generateEntryId(s.domain, choice);
        const doneStep: IntegrationFlowStep = {
          type: 'create_entry',
          flowId: s.flowId,
          handler: s.domain,
          stepId: 'done',
          title: def?.title ?? s.domain,
          result: { entryId, title: def?.title ?? s.domain, data: { action: choice } },
        };
        this.updateSession(s, doneStep, { selectedMenuOption: choice });
        return doneStep;
      }
      const nextStep = this.buildStepFromSpec(
        s.flowId,
        s.domain,
        mappedTarget,
        spec,
        def,
        s.context,
      );
      this.updateSession(s, nextStep, { selectedMenuOption: choice });
      return nextStep;
    }

    const errors: Record<string, string> = {};
    if (s.currentStep.type === 'form' && s.currentStep.dataSchema) {
      for (const field of s.currentStep.dataSchema) {
        if (field.required && isBlankValue(submission.values[field.name])) {
          errors[field.name] = 'required';
        }
      }
    }

    const stepSpec = def?.steps?.[stepId];
    if (Object.keys(errors).length === 0 && stepSpec?.validate) {
      const customErrors = stepSpec.validate(submission.values, s.context);
      if (customErrors) Object.assign(errors, customErrors);
    }

    if (Object.keys(errors).length > 0) {
      const errStep: IntegrationFlowStep = { ...s.currentStep, errors };
      this.updateSession(s, errStep);
      return errStep;
    }

    const mergedData: Record<string, unknown> = {
      ...(s.context.collectedData as Record<string, unknown> | undefined),
      ...submission.values,
    };

    if (s.currentStep.type === 'external') {
      const entryId = s.entryId ?? generateEntryId(s.domain, 'oauth');
      const title = def?.title ?? s.domain;
      const doneStep: IntegrationFlowStep = {
        type: 'create_entry',
        flowId: s.flowId,
        handler: s.domain,
        stepId: 'done',
        title,
        result: { entryId, title, data: mergedData },
      };
      this.updateSession(s, doneStep, { collectedData: mergedData });
      if (s.candidateId && this.discoveryRegistry) {
        this.discoveryRegistry.markConfigured(s.candidateId, true);
      }
      return doneStep;
    }

    if (s.source !== 'options' && def?.requires2fa && stepId === 'user') {
      const twoFaStep: IntegrationFlowStep = {
        type: 'form',
        flowId: s.flowId,
        handler: s.domain,
        stepId: '2fa',
        title: 'Enter Verification Code',
        description: 'A 6-digit verification code was sent to your device.',
        lastStep: true,
        dataSchema: [{ name: 'verification_code', type: 'pin', label: 'SMS Code', required: true }],
      };
      this.updateSession(s, twoFaStep, {
        userCredentials: submission.values,
        collectedData: mergedData,
      });
      return twoFaStep;
    }

    if (s.source !== 'options' && stepSpec?.nextStepId && def?.steps?.[stepSpec.nextStepId]) {
      const nextId = stepSpec.nextStepId;
      const nextStep = this.buildStepFromSpec(
        s.flowId,
        s.domain,
        nextId,
        def.steps[nextId],
        def,
        mergedData,
      );
      this.updateSession(s, nextStep, { collectedData: mergedData });
      return nextStep;
    }

    const entryId =
      s.entryId ??
      (s.context.reauthEntryId ? String(s.context.reauthEntryId) : generateEntryId(s.domain));
    const fallbackTitle = def?.title ?? s.currentStep.title ?? s.domain;
    const title =
      s.source === 'options'
        ? fallbackTitle
        : (def?.buildEntryTitle?.(mergedData) ?? fallbackTitle);

    const completedStep: IntegrationFlowStep = {
      type: 'create_entry',
      flowId: s.flowId,
      handler: s.domain,
      stepId: 'done',
      title,
      result: {
        entryId,
        title,
        deviceId: s.candidateId,
        ...(s.source === 'options' ? { options: mergedData } : { data: mergedData }),
      },
    };

    this.updateSession(s, completedStep, {
      finalValues: submission.values,
      collectedData: mergedData,
    });

    if (s.candidateId && this.discoveryRegistry) {
      this.discoveryRegistry.markConfigured(s.candidateId, true);
    }

    return completedStep;
  }

  cancelFlow(flowId: string, auth: { homeId: string; userId?: string }): boolean {
    const s = this.sessions.get(flowId);
    if (!s || s.homeId !== auth.homeId) return false;

    if (s.candidateId && this.discoveryRegistry) {
      this.discoveryRegistry.releaseInProgress(flowId);
    }

    this.sessions.delete(flowId);
    return true;
  }

  listActiveFlows(homeId: string): readonly IntegrationFlowStep[] {
    const list: IntegrationFlowStep[] = [];
    for (const s of this.sessions.values()) {
      if (
        s.homeId === homeId &&
        s.currentStep.type !== 'create_entry' &&
        s.currentStep.type !== 'abort'
      ) {
        list.push(s.currentStep);
      }
    }
    return list;
  }

  private updateSession(
    s: IntegrationFlowSession,
    nextStep: IntegrationFlowStep,
    extraContext?: Record<string, unknown>,
  ): void {
    const updated: IntegrationFlowSession = {
      ...s,
      currentStep: nextStep,
      history: [...s.history, nextStep],
      context: { ...s.context, ...extraContext },
      updatedAt: Date.now(),
    };
    this.sessions.set(s.flowId, updated);
  }
}
