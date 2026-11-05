/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { HausAutomationRule, HausScene } from '../automation/types.js';

export interface ReplicatedRulePackage {
  readonly rules: readonly HausAutomationRule[];
  readonly scenes: readonly HausScene[];
  readonly revision: number;
  readonly updatedByHubId: string;
  readonly timestamp: string;
}

export interface RuleExecutorAssignment {
  readonly ruleId: string;
  readonly executorHubId: string;
  readonly locality: 'local_only' | 'cross_hub';
  readonly remoteEndpointOwners: ReadonlyMap<string, string>;
}

export interface CrossHubCommandRouter {
  dispatchLocalCommand(
    endpointId: string,
    capability: string,
    command: string,
    params?: Record<string, unknown>,
  ): Promise<void>;
  dispatchRemoteCommand(
    targetHubId: string,
    endpointId: string,
    capability: string,
    command: string,
    params?: Record<string, unknown>,
  ): Promise<void>;
  isHubReachable(hubId: string): boolean;
}

export interface CrossHubExecutionReport {
  readonly ruleId: string;
  readonly executorHubId: string;
  readonly status: 'completed' | 'partial' | 'failed';
  readonly localStepCount: number;
  readonly remoteStepCount: number;
  readonly unreachableHubs: readonly string[];
  readonly completedAt: string;
}

export class ClusterAutomationSynchronizer {
  private currentRevision: number = 0;
  private readonly rules = new Map<string, HausAutomationRule>();
  private readonly scenes = new Map<string, HausScene>();
  private readonly executorAssignments = new Map<string, RuleExecutorAssignment>();
  private readonly activeExecutions = new Set<string>();

  syncConfiguration(pkg: ReplicatedRulePackage): boolean {
    if (pkg.revision <= this.currentRevision) {
      // Stale or duplicate package ignored
      return false;
    }

    this.currentRevision = pkg.revision;
    this.rules.clear();
    for (const r of pkg.rules) this.rules.set(r.id, r);

    this.scenes.clear();
    for (const s of pkg.scenes) this.scenes.set(s.id, s);

    return true;
  }

  getRevision(): number {
    return this.currentRevision;
  }

  electRuleExecutor(
    rule: HausAutomationRule,
    localHubId: string,
    endpointToHubMap: ReadonlyMap<string, string>,
    coordinatorHubId: string,
  ): RuleExecutorAssignment {
    const remoteEndpointOwners = new Map<string, string>();
    const involvedHubCounts = new Map<string, number>();

    // Inspect endpoints in actions
    for (const step of rule.actions) {
      if (step.type === 'action' && step.action.kind === 'device_command') {
        const ep = step.action.payload.endpointId;
        const ownerHub = endpointToHubMap.get(ep) ?? coordinatorHubId;
        if (ownerHub !== localHubId) {
          remoteEndpointOwners.set(ep, ownerHub);
        }
        involvedHubCounts.set(ownerHub, (involvedHubCounts.get(ownerHub) ?? 0) + 1);
      }
    }

    let electedHubId = coordinatorHubId;
    let maxEndpoints = 0;

    // Locality preference: hub owning the most action endpoints is elected executor
    for (const [hubId, count] of involvedHubCounts) {
      if (count > maxEndpoints) {
        maxEndpoints = count;
        electedHubId = hubId;
      }
    }

    const locality = remoteEndpointOwners.size === 0 ? 'local_only' : 'cross_hub';

    const assignment: RuleExecutorAssignment = {
      ruleId: rule.id,
      executorHubId: electedHubId,
      locality,
      remoteEndpointOwners,
    };

    this.executorAssignments.set(rule.id, assignment);
    return assignment;
  }

  shouldExecuteLocally(ruleId: string, localHubId: string): boolean {
    const assignment = this.executorAssignments.get(ruleId);
    if (!assignment) {
      // If unassigned, only coordinator executes by default
      return true;
    }
    // STRICT RULE: Exactly ONE hub is the elected executor!
    return assignment.executorHubId === localHubId;
  }

  async executeSynchronizedRule(
    rule: HausAutomationRule,
    localHubId: string,
    router: CrossHubCommandRouter,
  ): Promise<CrossHubExecutionReport> {
    if (!this.shouldExecuteLocally(rule.id, localHubId)) {
      throw new Error(
        `[ClusterSync] Hub "${localHubId}" is NOT the elected executor for rule "${rule.id}". Execution blocked to prevent duplicate runs.`,
      );
    }

    if (this.activeExecutions.has(rule.id)) {
      throw new Error(
        `[ClusterSync] Rule "${rule.id}" is already executing. No two active executions permitted.`,
      );
    }

    this.activeExecutions.add(rule.id);
    const assignment = this.executorAssignments.get(rule.id);
    const unreachableHubs: string[] = [];
    let localStepCount = 0;
    let remoteStepCount = 0;
    let hasFailure = false;

    try {
      for (const step of rule.actions) {
        if (step.type === 'action' && step.action.kind === 'device_command') {
          const payload = step.action.payload;
          const targetHubId = assignment?.remoteEndpointOwners.get(payload.endpointId);

          if (!targetHubId || targetHubId === localHubId) {
            // Local dispatch
            localStepCount++;
            await router.dispatchLocalCommand(
              payload.endpointId,
              payload.capability,
              payload.command,
              payload.parameters,
            );
          } else {
            // Remote dispatch through resource owner
            remoteStepCount++;
            if (!router.isHubReachable(targetHubId)) {
              hasFailure = true;
              if (!unreachableHubs.includes(targetHubId)) {
                unreachableHubs.push(targetHubId);
              }
              continue;
            }

            try {
              await router.dispatchRemoteCommand(
                targetHubId,
                payload.endpointId,
                payload.capability,
                payload.command,
                payload.parameters,
              );
            } catch {
              hasFailure = true;
            }
          }
        }
      }
    } finally {
      this.activeExecutions.delete(rule.id);
    }

    let status: CrossHubExecutionReport['status'] = 'completed';
    if (hasFailure) {
      status = localStepCount > 0 ? 'partial' : 'failed';
    }

    return {
      ruleId: rule.id,
      executorHubId: localHubId,
      status,
      localStepCount,
      remoteStepCount,
      unreachableHubs,
      completedAt: new Date().toISOString(),
    };
  }
}
