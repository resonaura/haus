/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { DiscoveryRegistry } from './discovery-deduplicator.js';
import { KNOWN_FLOW_DOMAINS } from './flow-domains.js';
import {
  createAdoptedExternalSession,
  refreshExternalFlowSession,
  submitExternalFlowStep,
  tryStartExternalFlow,
} from './flow-external.js';
import {
  buildFallbackInitialStep,
  resolveFlowDefaults,
  submitFallbackStep,
} from './flow-fallback.js';
import { generateFlowId } from './flow-helpers.js';
import type {
  ExternalFlowProgressEntry,
  ExternalFlowRuntime,
  FlowCatalogResolver,
  FlowDomainHandler,
  FlowInitOptions,
  FlowSource,
  FlowSubmissionOptions,
  IntegrationFlowSession,
  IntegrationFlowStep,
} from './flow-types.js';

export class IntegrationFlowEngine {
  private readonly sessions = new Map<string, IntegrationFlowSession>();
  private readonly domainHandlers = new Map<string, FlowDomainHandler>();
  private externalRuntime?: ExternalFlowRuntime;

  constructor(
    private readonly discoveryRegistry?: DiscoveryRegistry,
    private catalogResolver?: FlowCatalogResolver,
    externalRuntime?: ExternalFlowRuntime,
  ) {
    this.externalRuntime = externalRuntime;
  }

  setExternalRuntime(runtime: ExternalFlowRuntime | undefined): void {
    this.externalRuntime = runtime;
  }

  getExternalRuntime(): ExternalFlowRuntime | undefined {
    return this.externalRuntime;
  }

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

  async startFlow(options: FlowInitOptions): Promise<IntegrationFlowStep> {
    const { domain, homeId, userId } = options;
    if (!homeId || !userId) {
      throw new Error('home_and_user_required');
    }

    const source = options.source ?? 'user';
    const targetEntryId = options.entryId ?? options.reauthEntryId;
    const customHandler = this.domainHandlers.get(domain);

    if (customHandler?.start) {
      const flowId = generateFlowId();
      const customStep = await customHandler.start({ flowId, domain, source, options });
      if (customStep) {
        if (options.candidateId && this.discoveryRegistry) {
          this.discoveryRegistry.markInProgress(options.candidateId, customStep.flowId);
          if (customStep.type === 'create_entry') {
            this.discoveryRegistry.markConfigured(options.candidateId, true);
          }
        }
        const now = Date.now();
        this.sessions.set(customStep.flowId, {
          flowId: customStep.flowId,
          domain,
          source,
          candidateId: options.candidateId,
          entryId: targetEntryId,
          homeId,
          userId,
          createdAt: now,
          updatedAt: now,
          currentStep: customStep,
          history: [customStep],
          context: {
            ...options.initialData,
            ...(options.manualAddress ? { manualAddress: options.manualAddress } : {}),
            ...(targetEntryId ? { reauthEntryId: targetEntryId, entryId: targetEntryId } : {}),
            collectedData: {},
          },
        });
        return customStep;
      }
    }

    const externalResult = await tryStartExternalFlow(
      this.externalRuntime,
      options,
      this.discoveryRegistry,
    );
    if (externalResult) {
      this.sessions.set(externalResult.session.flowId, externalResult.session);
      return externalResult.step;
    }

    const flowId = generateFlowId();
    const now = Date.now();
    const candidate = options.candidateId
      ? this.discoveryRegistry?.getCandidate(options.candidateId)
      : undefined;

    if (options.candidateId && this.discoveryRegistry) {
      this.discoveryRegistry.markInProgress(options.candidateId, flowId);
    }

    const defaults = resolveFlowDefaults(options, candidate?.addresses, candidate?.port);
    const built = buildFallbackInitialStep({
      flowId,
      domain,
      source,
      options,
      catalogResolver: this.catalogResolver,
      defaults,
      candidateAddresses: candidate?.addresses,
      candidatePort: candidate?.port,
      targetEntryId,
    });

    if (built.configuredNow && options.candidateId && this.discoveryRegistry) {
      this.discoveryRegistry.markConfigured(options.candidateId, true);
    }

    this.sessions.set(flowId, {
      flowId,
      domain,
      source,
      candidateId: options.candidateId,
      entryId: targetEntryId,
      homeId,
      userId,
      createdAt: now,
      updatedAt: now,
      currentStep: built.step,
      history: [built.step],
      context: {
        ...options.initialData,
        ...(options.manualAddress ? { manualAddress: options.manualAddress } : {}),
        ...(targetEntryId ? { reauthEntryId: targetEntryId, entryId: targetEntryId } : {}),
        collectedData: {},
      },
    });

    return built.step;
  }

  getFlow(
    flowId: string,
    auth: { homeId: string; userId?: string },
  ): IntegrationFlowStep | undefined {
    const s = this.sessions.get(flowId);
    if (!s || s.homeId !== auth.homeId) return undefined;
    return s.currentStep;
  }

  async refreshFlow(
    flowId: string,
    auth: { homeId: string; userId?: string },
  ): Promise<IntegrationFlowStep | undefined> {
    const s = this.sessions.get(flowId);
    if (!s) {
      if (!this.externalRuntime?.getFlow) return undefined;
      const extStep = await this.externalRuntime.getFlow(flowId);
      if (!extStep) return undefined;
      return this.adoptExternalStep(
        extStep,
        { homeId: auth.homeId, userId: auth.userId ?? 'system' },
        'discovery',
      );
    }
    if (s.homeId !== auth.homeId) return undefined;

    if (s.context.external === true && this.externalRuntime) {
      const next = await refreshExternalFlowSession(this.externalRuntime, s);
      if (next) {
        const changed =
          next.type !== s.currentStep.type ||
          next.stepId !== s.currentStep.stepId ||
          next.progressAction !== s.currentStep.progressAction;
        if (changed) {
          this.updateSession(s, next);
        } else {
          this.sessions.set(s.flowId, { ...s, currentStep: next, updatedAt: Date.now() });
        }
        if (next.type === 'create_entry' && s.candidateId && this.discoveryRegistry) {
          this.discoveryRegistry.markConfigured(s.candidateId, true);
        }
        return next;
      }
    }

    return s.currentStep;
  }

  adoptExternalStep(
    step: IntegrationFlowStep,
    auth: { homeId: string; userId: string },
    source: FlowSource = 'discovery',
  ): IntegrationFlowStep {
    const existing = this.sessions.get(step.flowId);
    if (existing && existing.homeId === auth.homeId) {
      this.updateSession(existing, step);
      return step;
    }
    const adopted = createAdoptedExternalSession(step, auth.homeId, auth.userId, source);
    this.sessions.set(adopted.flowId, adopted);
    return step;
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

    if (s.context.external === true && this.externalRuntime) {
      const next = await submitExternalFlowStep(
        this.externalRuntime,
        s,
        submission,
        this.discoveryRegistry,
      );
      const merged = {
        ...(s.context.collectedData as Record<string, unknown> | undefined),
        ...submission.values,
      };
      this.updateSession(s, next, { collectedData: merged });
      return next;
    }

    const result = submitFallbackStep(s, submission);
    this.updateSession(s, result.nextStep, result.extraContext);
    if (
      result.configuredNow &&
      result.nextStep.type === 'create_entry' &&
      s.candidateId &&
      this.discoveryRegistry
    ) {
      this.discoveryRegistry.markConfigured(s.candidateId, true);
    }
    return result.nextStep;
  }

  async completeExternalFlow(
    input: {
      readonly flowId?: string;
      readonly state?: unknown;
      readonly code?: string;
      readonly error?: string;
    },
    auth?: { homeId: string; userId: string },
  ): Promise<IntegrationFlowStep> {
    if (!this.externalRuntime?.completeExternal) {
      throw new Error('external_flow_completion_unsupported');
    }
    const step = await this.externalRuntime.completeExternal(input);
    const existing = this.sessions.get(step.flowId);
    if (existing) {
      this.updateSession(existing, step);
      if (step.type === 'create_entry' && existing.candidateId && this.discoveryRegistry) {
        this.discoveryRegistry.markConfigured(existing.candidateId, true);
      }
    } else if (auth) {
      this.adoptExternalStep(step, auth, 'user');
    }
    return step;
  }

  cancelFlow(flowId: string, auth: { homeId: string; userId?: string }): boolean {
    const s = this.sessions.get(flowId);
    if (!s || s.homeId !== auth.homeId) return false;

    if (s.candidateId && this.discoveryRegistry) {
      this.discoveryRegistry.releaseInProgress(flowId);
    }
    this.sessions.delete(flowId);

    if (s.context.external === true && this.externalRuntime?.abortFlow) {
      void this.externalRuntime.abortFlow(flowId, s.source).then(undefined, (err: unknown) => {
        console.warn('[IntegrationFlowEngine] background abortFlow failed:', err);
      });
    }
    return true;
  }

  async cancelFlowAsync(
    flowId: string,
    auth: { homeId: string; userId?: string },
  ): Promise<boolean> {
    const s = this.sessions.get(flowId);
    if (!s || s.homeId !== auth.homeId) return false;

    if (s.candidateId && this.discoveryRegistry) {
      this.discoveryRegistry.releaseInProgress(flowId);
    }
    this.sessions.delete(flowId);

    if (s.context.external === true && this.externalRuntime?.abortFlow) {
      await this.externalRuntime.abortFlow(flowId, s.source);
    }
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

  async listProgressFlows(homeId: string): Promise<readonly ExternalFlowProgressEntry[]> {
    const byId = new Map<string, ExternalFlowProgressEntry>();
    if (this.externalRuntime?.listProgressFlows) {
      const external = await this.externalRuntime.listProgressFlows();
      for (const entry of external) {
        byId.set(entry.flowId, entry);
      }
    }
    for (const s of this.sessions.values()) {
      if (
        s.homeId === homeId &&
        s.currentStep.type !== 'create_entry' &&
        s.currentStep.type !== 'abort' &&
        !byId.has(s.flowId)
      ) {
        byId.set(s.flowId, {
          flowId: s.flowId,
          handler: s.domain,
          stepId: s.currentStep.stepId,
          title: s.currentStep.title ?? s.domain,
          context: { source: s.source },
        });
      }
    }
    return [...byId.values()];
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
