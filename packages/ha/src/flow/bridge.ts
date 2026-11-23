/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type {
  ExternalFlowProgressEntry,
  ExternalFlowRuntime,
  FlowInitOptions,
  FlowSource,
  FlowStepType,
  FlowSubmissionOptions,
  IntegrationFlowStep,
} from '@haus/core';
import {
  HaFlowWorkerError,
  type HaFlowRuntime,
  type HaFlowStepEnvelope,
  type HaSerializedFlowSchemaField,
} from '@haus/kitsune';
import type { DynamicCatalogService } from '../catalog/dynamic.js';
import { convertHaSchemaToFlowFields, sanitizeHaFormValues } from './schema.js';

export interface HaConfigFlowBridgeOptions {
  readonly ensureReady?: () => Promise<void>;
  readonly ensureEntrySynced?: (entryId: string) => Promise<void>;
  readonly ensureDiscoveryFlow?: (
    domain: string,
    candidateId: string,
  ) => Promise<IntegrationFlowStep | undefined>;
  readonly getExtraSupportedDomains?: () => readonly string[];
}

interface TrackedHaFlow {
  readonly kind: 'config' | 'options';
  readonly domain: string;
  readonly step: IntegrationFlowStep;
  readonly rawSchema?: readonly HaSerializedFlowSchemaField[];
}

function mapStepType(rawType: string): FlowStepType {
  switch (rawType) {
    case 'form':
    case 'menu':
    case 'external':
    case 'progress':
    case 'create_entry':
    case 'abort':
      return rawType;
    case 'external_done':
    case 'progress_done':
      return 'progress';
    default:
      return 'abort';
  }
}

function isUnknownFlowStepError(err: unknown): boolean {
  if (!(err instanceof HaFlowWorkerError)) return false;
  return err.code === 'UnknownStep' || /doesn't support step/i.test(err.message);
}

function isUnknownFlowError(err: unknown): boolean {
  if (!(err instanceof HaFlowWorkerError)) return false;
  return err.code === 'UnknownFlow' || /unknown flow/i.test(err.message);
}

function buildMissingReqAbortStep(
  domain: string,
  flowId: string,
  err: HaFlowWorkerError,
  title?: string,
): IntegrationFlowStep {
  return {
    type: 'abort',
    flowId,
    handler: domain,
    stepId: 'abort',
    ...(title ? { title } : {}),
    abortReason: 'requirements_install_failed',
    description: 'The Hub could not prepare this integration. Update the Hub and try again.',
    unsupportedRequirements: (err.missingRequirements ?? []).map((req) => ({
      category: 'runtime' as const,
      name: req,
      description: `Missing Python requirement: ${req}`,
    })),
  };
}

function mqttTopicMatchesPattern(pattern: string, topic: string): boolean {
  if (pattern === topic || pattern === '#') return true;
  const pParts = pattern.split('/');
  const tParts = topic.split('/');
  for (let i = 0; i < pParts.length; i++) {
    const p = pParts[i];
    if (p === '#') return true;
    if (p !== '+' && p !== tParts[i]) return false;
  }
  return pParts.length === tParts.length;
}

export class HaConfigFlowBridge implements ExternalFlowRuntime {
  private readonly tracked = new Map<string, TrackedHaFlow>();
  private readonly dynamicHandlers = new Set<string>();
  private handlersWarmed = false;

  constructor(
    private readonly runtime: HaFlowRuntime,
    private readonly catalog: DynamicCatalogService,
    private readonly options: HaConfigFlowBridgeOptions = {},
  ) {}

  async warmupHandlers(): Promise<void> {
    if (this.handlersWarmed) return;
    const { handlers } = await this.runtime.listFlowHandlers();
    for (const handler of handlers) this.dynamicHandlers.add(handler);
    this.handlersWarmed = true;
  }

  async reloadCustomComponents(): Promise<readonly string[]> {
    const { handlers, customDomains } = await this.runtime.reloadCustomComponents();
    this.dynamicHandlers.clear();
    for (const handler of handlers) this.dynamicHandlers.add(handler);
    this.handlersWarmed = true;
    return customDomains;
  }

  supportsDomain(domain: string): boolean {
    if (this.dynamicHandlers.has(domain)) return true;
    if (this.catalog.getTranslations().hasFlowHandler(domain)) return true;
    const manifest = this.catalog.getCatalog().getManifest(domain);
    if (manifest?.config_flow === true) return true;
    if (manifest?.supported_by && this.supportsDomain(manifest.supported_by)) return true;
    const extra = this.options.getExtraSupportedDomains?.() ?? [];
    return extra.includes(domain);
  }

  async startFlow(options: FlowInitOptions): Promise<IntegrationFlowStep | undefined> {
    const source: FlowSource = options.source ?? 'user';
    const flowKind: 'config' | 'options' = source === 'options' ? 'options' : 'config';
    const targetEntryId = options.entryId ?? options.reauthEntryId;

    await this.options.ensureReady?.();
    if (targetEntryId && this.options.ensureEntrySynced) {
      await this.options.ensureEntrySynced(targetEntryId);
    }

    if (source === 'discovery' && options.candidateId) {
      const findMatch = async () => {
        const flows = await this.listProgressFlows();
        return flows.find(
          (flow) =>
            flow.handler === options.domain && flow.context.discovery_key === options.candidateId,
        );
      };
      const match = await findMatch();
      const step = match && (await this.getFlow(match.flowId));
      if (step) return step;
      const triggered = await this.options.ensureDiscoveryFlow?.(
        options.domain,
        options.candidateId,
      );
      if (triggered) return triggered;
      const retryMatch = await findMatch();
      const retryStep = retryMatch && (await this.getFlow(retryMatch.flowId));
      if (retryStep) return retryStep;
      throw new Error('discovery_flow_unavailable');
    }

    const initForSource = async (activeSource: FlowSource) =>
      this.runtime.initFlow({
        domain: options.domain,
        source: activeSource,
        flowKind,
        entryId: targetEntryId,
        showAdvancedOptions: options.showAdvancedOptions,
        data:
          activeSource === 'user' || activeSource === 'reconfigure'
            ? undefined
            : options.initialData,
      });

    try {
      const env = await initForSource(source);
      return this.recordEnvelope(env, flowKind, options.domain);
    } catch (err) {
      if (err instanceof HaFlowWorkerError && err.code === 'missing_requirements') {
        const manifestName = this.catalog.getCatalog().getManifest(options.domain)?.name;
        return buildMissingReqAbortStep(options.domain, `ha_err_${Date.now()}`, err, manifestName);
      }
      if (source === 'reconfigure' && targetEntryId && isUnknownFlowStepError(err)) {
        try {
          const reauthEnv = await initForSource('reauth');
          return this.recordEnvelope(reauthEnv, flowKind, options.domain);
        } catch (reauthErr) {
          if (reauthErr instanceof HaFlowWorkerError && reauthErr.code === 'missing_requirements') {
            const manifestName = this.catalog.getCatalog().getManifest(options.domain)?.name;
            return buildMissingReqAbortStep(
              options.domain,
              `ha_err_${Date.now()}`,
              reauthErr,
              manifestName,
            );
          }
          throw reauthErr;
        }
      }
      throw err;
    }
  }

  async getFlow(flowId: string): Promise<IntegrationFlowStep | undefined> {
    const tracked = this.tracked.get(flowId);
    if (tracked && (tracked.step.type === 'create_entry' || tracked.step.type === 'abort')) {
      return tracked.step;
    }
    try {
      const env = await this.runtime.getFlow(flowId, tracked?.kind);
      return this.recordEnvelope(env, tracked?.kind ?? 'config', tracked?.domain);
    } catch (err) {
      if (isUnknownFlowError(err)) {
        return undefined;
      }
      throw err;
    }
  }

  async submitStep(submission: FlowSubmissionOptions): Promise<IntegrationFlowStep> {
    const tracked = this.tracked.get(submission.flowId);
    const kind = tracked?.kind ?? 'config';

    let userInput: Record<string, unknown>;
    if (tracked?.step.type === 'menu') {
      const choice =
        submission.nextStepId ??
        (typeof submission.values.next_step_id === 'string'
          ? submission.values.next_step_id
          : undefined);
      userInput = choice
        ? { next_step_id: choice }
        : sanitizeHaFormValues(submission.values, tracked.step.dataSchema, tracked.rawSchema);
    } else {
      userInput = sanitizeHaFormValues(
        submission.values,
        tracked?.step.dataSchema,
        tracked?.rawSchema,
      );
    }

    let env: HaFlowStepEnvelope;
    try {
      env = await this.runtime.configureFlow({
        flowId: submission.flowId,
        flowKind: kind,
        userInput,
      });
    } catch (err) {
      if (isUnknownFlowError(err)) {
        this.tracked.delete(submission.flowId);
        throw new Error('flow_not_found');
      }
      throw err;
    }

    if (env.invalidData && tracked) {
      const updatedStep: IntegrationFlowStep = {
        ...tracked.step,
        errors: env.errors ?? { base: 'invalid_data' },
      };
      this.tracked.set(submission.flowId, { ...tracked, step: updatedStep });
      return updatedStep;
    }

    return this.recordEnvelope(env, kind, tracked?.domain);
  }

  async abortFlow(flowId: string, source?: FlowSource): Promise<void> {
    const tracked = this.tracked.get(flowId);
    this.tracked.delete(flowId);
    const kind = tracked?.kind ?? (source === 'options' ? 'options' : 'config');
    try {
      await this.runtime.abortFlow(flowId, kind);
    } catch (err) {
      if (isUnknownFlowError(err)) {
        return;
      }
      throw err;
    }
  }

  async completeExternal(input: {
    readonly flowId?: string;
    readonly state?: unknown;
    readonly code?: string;
    readonly error?: string;
  }): Promise<IntegrationFlowStep> {
    const env = await this.runtime.completeExternal(input);
    const fid = env.flowResult?.flow_id ?? input.flowId;
    const tracked = fid ? this.tracked.get(fid) : undefined;
    return this.recordEnvelope(env, tracked?.kind ?? 'config', tracked?.domain);
  }

  async listProgressFlows(): Promise<readonly ExternalFlowProgressEntry[]> {
    const { flows } = await this.runtime.listProgressFlows();
    return flows.map((item) => ({
      flowId: item.flow_id,
      handler: item.handler,
      stepId: item.step_id,
      title: item.title,
      context: item.context,
    }));
  }

  async triggerDiscovery(input: {
    readonly domain: string;
    readonly protocol: string;
    readonly info: Record<string, unknown>;
    readonly discoveryKey?: string;
  }): Promise<{ readonly outcome: string; readonly step?: IntegrationFlowStep }> {
    let info = input.info;
    if (
      input.protocol.toLowerCase() === 'mqtt' &&
      !info.subscribedTopic &&
      !info.subscribed_topic &&
      typeof info.topic === 'string'
    ) {
      const patterns = this.catalog.getCatalog().getManifest(input.domain)?.mqtt ?? [];
      const matched = patterns.find((p) => mqttTopicMatchesPattern(p, String(info.topic)));
      if (matched) {
        info = { ...info, subscribedTopic: matched };
      }
    }
    const res = await this.runtime.triggerDiscovery({ ...input, info });
    if (!res.flowResult) {
      return { outcome: res.outcome };
    }
    const step = this.recordEnvelope(res, 'config', input.domain);
    return { outcome: res.outcome, step };
  }

  mapEnvelope(
    env: HaFlowStepEnvelope,
    flowKind: 'config' | 'options' = 'config',
    requestedDomain?: string,
  ): IntegrationFlowStep {
    return this.recordEnvelope(env, flowKind, requestedDomain);
  }

  private recordEnvelope(
    env: HaFlowStepEnvelope,
    flowKind: 'config' | 'options',
    requestedDomain?: string,
  ): IntegrationFlowStep {
    const raw = env.flowResult;
    if (!raw) {
      throw new Error('Missing flowResult in HA worker response');
    }
    const localized = env.localized;
    const trDomain = raw.translation_domain ?? raw.handler;
    const type = mapStepType(raw.type);
    const flowId = raw.flow_id ?? '';
    const errors =
      localized && Object.keys(localized.errors).length > 0
        ? localized.errors
        : raw.errors && Object.keys(raw.errors).length > 0
          ? raw.errors
          : undefined;

    const menuOptions =
      localized && Object.keys(localized.menuOptions).length > 0
        ? localized.menuOptions
        : raw.menu_options;
    const menuDescriptions =
      localized && Object.keys(localized.menuOptionDescriptions).length > 0
        ? localized.menuOptionDescriptions
        : undefined;

    const manifest = this.catalog
      .getCatalog()
      .getManifest(localized?.supportedBy ?? requestedDomain ?? raw.handler);

    const step: IntegrationFlowStep = {
      type,
      flowId,
      handler: raw.handler,
      stepId: raw.step_id ?? (type === 'create_entry' ? 'done' : type),
      title:
        localized?.stepTitle ??
        localized?.flowTitle ??
        localized?.title ??
        raw.title ??
        manifest?.name ??
        raw.handler,
      description:
        localized?.description ??
        (type === 'abort' ? (localized?.abortReason ?? raw.reason) : undefined),
      descriptionPlaceholders: raw.description_placeholders,
      documentationUrl: manifest?.documentation,
      url: raw.url,
      lastStep: raw.last_step ?? undefined,
      progressAction: raw.progress_action,
      submitLabel: localized?.submitLabel ?? undefined,
      supportedBy: localized?.supportedBy ?? undefined,
      translationDomain: trDomain,
      fieldLabels: localized?.fieldLabels,
      dataDescriptions: localized?.dataDescriptions,
      selectorTranslations: localized?.selectorTranslations,
      abortReason: raw.reason ?? localized?.abortReason ?? undefined,
      context: env.context,
      dataSchema: convertHaSchemaToFlowFields(raw.data_schema, localized, trDomain),
      menuOptions,
      menuDescriptions,
      errors,
      result:
        type === 'create_entry' || (type === 'abort' && Boolean(env.entry?.entry_id))
          ? {
              entryId: env.entry?.entry_id ?? String(raw.result?.entry_id ?? ''),
              uniqueId: env.entry?.unique_id,
              haVersion: env.entry?.version,
              haMinorVersion: env.entry?.minor_version,
              title: env.entry?.title ?? String(raw.title ?? manifest?.name ?? raw.handler),
              data: env.entry?.data ?? (raw.result?.data as Record<string, unknown> | undefined),
              options:
                env.entry?.options ?? (raw.result?.options as Record<string, unknown> | undefined),
            }
          : undefined,
    };

    if (flowId) {
      this.tracked.set(flowId, {
        kind: flowKind,
        domain: requestedDomain ?? raw.handler,
        step,
        rawSchema: raw.data_schema,
      });
    }
    return step;
  }
}
