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
import { HaFlowWorkerError, type HaFlowRuntime, type HaFlowStepEnvelope } from '@haus/kitsune';
import type { DynamicCatalogService } from '../catalog/dynamic.js';
import { convertHaSchemaToFlowFields } from './schema.js';

export interface HaConfigFlowBridgeOptions {
  readonly ensureReady?: () => Promise<void>;
  readonly ensureEntrySynced?: (entryId: string) => Promise<void>;
  readonly getExtraSupportedDomains?: () => readonly string[];
}

interface TrackedHaFlow {
  readonly kind: 'config' | 'options';
  readonly domain: string;
  readonly step: IntegrationFlowStep;
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

function buildMissingReqAbortStep(
  domain: string,
  flowId: string,
  err: HaFlowWorkerError,
): IntegrationFlowStep {
  return {
    type: 'abort',
    flowId,
    handler: domain,
    stepId: 'abort',
    title: domain,
    abortReason: err.message,
    description: err.message,
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

function sanitizeFormValues(values: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(values)) {
    if (val === undefined) continue;
    if (typeof val === 'number' && Number.isNaN(val)) continue;
    clean[key] = val;
  }
  return clean;
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
    try {
      const { handlers } = await this.runtime.listFlowHandlers();
      for (const h of handlers) this.dynamicHandlers.add(h);
      this.handlersWarmed = true;
    } catch {
      // Catalog translations & manifests still cover flow discovery without throwing
    }
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

    try {
      const env = await this.runtime.initFlow({
        domain: options.domain,
        source,
        flowKind,
        entryId: targetEntryId,
        showAdvancedOptions: options.showAdvancedOptions,
        data: source === 'user' ? undefined : options.initialData,
      });
      return this.recordEnvelope(env, flowKind, options.domain);
    } catch (err) {
      if (err instanceof HaFlowWorkerError) {
        if (flowKind === 'options' && err.message.includes('Unknown HA config entry')) {
          return undefined;
        }
        if (err.code === 'missing_requirements') {
          return buildMissingReqAbortStep(options.domain, `ha_err_${Date.now()}`, err);
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
      if (err instanceof HaFlowWorkerError && /unknown flow/i.test(err.message)) {
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
      userInput = choice ? { next_step_id: choice } : sanitizeFormValues(submission.values);
    } else {
      userInput = sanitizeFormValues(submission.values);
    }

    const env = await this.runtime.configureFlow({
      flowId: submission.flowId,
      flowKind: kind,
      userInput,
    });

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
      if (err instanceof HaFlowWorkerError && /unknown flow/i.test(err.message)) {
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
      });
    }
    return step;
  }
}
