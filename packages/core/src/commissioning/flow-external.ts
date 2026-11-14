/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { DiscoveryRegistry } from './discovery-deduplicator.js';
import type {
  ExternalFlowRuntime,
  FlowInitOptions,
  FlowSource,
  FlowSubmissionOptions,
  IntegrationFlowSession,
  IntegrationFlowStep,
} from './flow-types.js';

export interface ExternalFlowSessionResult {
  readonly session: IntegrationFlowSession;
  readonly step: IntegrationFlowStep;
}

export async function tryStartExternalFlow(
  runtime: ExternalFlowRuntime | undefined,
  options: FlowInitOptions,
  discoveryRegistry?: DiscoveryRegistry,
): Promise<ExternalFlowSessionResult | undefined> {
  if (!runtime || !runtime.supportsDomain(options.domain)) return undefined;
  const externalStep = await runtime.startFlow(options);
  if (!externalStep) return undefined;

  const flowId = externalStep.flowId;
  const source: FlowSource = options.source ?? 'user';
  const now = Date.now();
  const targetEntryId = options.entryId ?? options.reauthEntryId;

  if (options.candidateId && discoveryRegistry) {
    discoveryRegistry.markInProgress(options.candidateId, flowId);
    if (externalStep.type === 'create_entry') {
      discoveryRegistry.markConfigured(options.candidateId, true);
    }
  }

  const session: IntegrationFlowSession = {
    flowId,
    domain: options.domain,
    source,
    candidateId: options.candidateId,
    entryId: targetEntryId,
    homeId: options.homeId,
    userId: options.userId,
    createdAt: now,
    updatedAt: now,
    currentStep: externalStep,
    history: [externalStep],
    context: {
      ...options.initialData,
      ...(options.manualAddress ? { manualAddress: options.manualAddress } : {}),
      ...(targetEntryId ? { reauthEntryId: targetEntryId, entryId: targetEntryId } : {}),
      collectedData: {},
      external: true,
    },
  };

  return { session, step: externalStep };
}

export async function refreshExternalFlowSession(
  runtime: ExternalFlowRuntime | undefined,
  session: IntegrationFlowSession,
): Promise<IntegrationFlowStep | undefined> {
  if (!runtime?.getFlow || session.context.external !== true) return undefined;
  return runtime.getFlow(session.flowId);
}

export async function submitExternalFlowStep(
  runtime: ExternalFlowRuntime,
  session: IntegrationFlowSession,
  submission: FlowSubmissionOptions,
  discoveryRegistry?: DiscoveryRegistry,
): Promise<IntegrationFlowStep> {
  const nextStep = await runtime.submitStep(submission);
  if (nextStep.type === 'create_entry' && session.candidateId && discoveryRegistry) {
    discoveryRegistry.markConfigured(session.candidateId, true);
  }
  return nextStep;
}

export function createAdoptedExternalSession(
  step: IntegrationFlowStep,
  homeId: string,
  userId: string,
  source: FlowSource = 'discovery',
): IntegrationFlowSession {
  const now = Date.now();
  return {
    flowId: step.flowId,
    domain: step.handler,
    source,
    homeId,
    userId,
    createdAt: now,
    updatedAt: now,
    currentStep: step,
    history: [step],
    context: { collectedData: {}, external: true },
  };
}
