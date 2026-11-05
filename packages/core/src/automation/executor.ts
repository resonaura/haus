/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { evaluateCondition } from './evaluator.js';
import {
  ExecutionStatus,
  StepStatus,
  StepType,
  type ActionStep,
  type ExecutionHistoryRecord,
  type HausScene,
  type HausScript,
  type NotificationActionPayload,
  type ScriptAction,
  type ScriptStep,
  type StepExecutionResult,
} from './types.js';

export interface AutomationExecutorEnvironment {
  getEndpointState(endpointId: string, property: string): unknown;
  executeDeviceCommand(
    endpointId: string,
    capability: string,
    command: string,
    params?: Record<string, unknown>,
  ): Promise<void>;
  activateScene(sceneId: string, signal?: AbortSignal): Promise<void>;
  callScript(
    scriptId: string,
    params?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<void>;
  sendNotification(payload: NotificationActionPayload): Promise<void>;
  now(): Date;
  sleep?(ms: number, signal?: AbortSignal): Promise<void>;
}

export class ExecutionHistoryRingBuffer {
  private readonly records: ExecutionHistoryRecord[] = [];

  constructor(private readonly maxCapacity: number = 200) {}

  record(record: ExecutionHistoryRecord): void {
    if (this.records.length >= this.maxCapacity) {
      this.records.shift();
    }
    this.records.push(record);
  }

  list(sourceId?: string): readonly ExecutionHistoryRecord[] {
    if (!sourceId) return [...this.records];
    return this.records.filter((r) => r.sourceId === sourceId);
  }

  clear(): void {
    this.records.length = 0;
  }
}

async function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new Error('Execution was aborted.');
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      reject(new Error('Execution was aborted.'));
    }

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export class AutomationExecutor {
  constructor(
    private readonly env: AutomationExecutorEnvironment,
    readonly history: ExecutionHistoryRingBuffer = new ExecutionHistoryRingBuffer(),
  ) {}

  private async sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (this.env.sleep) {
      return this.env.sleep(ms, signal);
    }
    return defaultSleep(ms, signal);
  }

  async executeScene(
    scene: HausScene,
    signal?: AbortSignal,
  ): Promise<ExecutionHistoryRecord> {
    const startedAt = this.env.now().toISOString();
    const startTime = Date.now();
    const stepResults: StepExecutionResult[] = [];
    let hasFailure = false;

    if (signal?.aborted) {
      const record: ExecutionHistoryRecord = {
        executionId: `exec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        sourceId: scene.id,
        sourceKind: 'scene',
        startedAt,
        completedAt: this.env.now().toISOString(),
        durationMs: 0,
        status: ExecutionStatus.Cancelled,
        stepResults: [],
      };
      this.history.record(record);
      return record;
    }

    const memberPromises = scene.members.map(async (member, idx) => {
      const stepStart = Date.now();
      try {
        if (signal?.aborted) throw new Error('Scene execution aborted.');

        for (const [capability, value] of Object.entries(member.targetState)) {
          if (value === undefined) continue;
          await this.env.executeDeviceCommand(member.endpointId, capability, 'set', {
            value,
            transition: member.transitionSeconds,
          });
        }

        stepResults.push({
          stepIndex: idx,
          stepType: StepType.Action,
          status: StepStatus.Completed,
          durationMs: Date.now() - stepStart,
        });
      } catch (err) {
        hasFailure = true;
        stepResults.push({
          stepIndex: idx,
          stepType: StepType.Action,
          status: StepStatus.Failed,
          durationMs: Date.now() - stepStart,
          error: String(err),
        });
      }
    });

    await Promise.allSettled(memberPromises);

    const completedAt = this.env.now().toISOString();
    const durationMs = Date.now() - startTime;
    let status = ExecutionStatus.Completed;

    if (signal?.aborted) {
      status = ExecutionStatus.Cancelled;
    } else if (hasFailure) {
      const allFailed = stepResults.every((r) => r.status === StepStatus.Failed);
      status = allFailed ? ExecutionStatus.Failed : ExecutionStatus.Partial;
    }

    const record: ExecutionHistoryRecord = {
      executionId: `exec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      sourceId: scene.id,
      sourceKind: 'scene',
      startedAt,
      completedAt,
      durationMs,
      status,
      stepResults,
    };

    this.history.record(record);
    return record;
  }

  async executeScript(
    script: HausScript,
    signal?: AbortSignal,
  ): Promise<ExecutionHistoryRecord> {
    const startedAt = this.env.now().toISOString();
    const startTime = Date.now();
    const stepResults: StepExecutionResult[] = [];
    let overallStatus: ExecutionStatus = ExecutionStatus.Completed;
    let fatalError: string | undefined;

    try {
      await this.runSteps(script.steps, stepResults, signal, (partial) => {
        if (partial && overallStatus === ExecutionStatus.Completed) {
          overallStatus = ExecutionStatus.Partial;
        }
      });
    } catch (err) {
      if (signal?.aborted) {
        overallStatus = ExecutionStatus.Cancelled;
      } else {
        overallStatus = ExecutionStatus.Failed;
        fatalError = String(err);
      }
    }

    const completedAt = this.env.now().toISOString();
    const durationMs = Date.now() - startTime;

    const record: ExecutionHistoryRecord = {
      executionId: `exec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      sourceId: script.id,
      sourceKind: 'script',
      startedAt,
      completedAt,
      durationMs,
      status: overallStatus,
      stepResults,
      error: fatalError,
    };

    this.history.record(record);
    return record;
  }

  private async runSteps(
    steps: readonly ScriptStep[],
    results: StepExecutionResult[],
    signal?: AbortSignal,
    onPartial?: (partial: boolean) => void,
  ): Promise<void> {
    for (let idx = 0; idx < steps.length; idx++) {
      if (signal?.aborted) throw new Error('Execution was cancelled.');
      const step = steps[idx];
      if (!step) continue;

      const stepStart = Date.now();

      switch (step.type) {
        case 'action': {
          try {
            await this.runActionWithTimeout(step, signal);
            results.push({
              stepIndex: results.length,
              stepType: StepType.Action,
              status: StepStatus.Completed,
              durationMs: Date.now() - stepStart,
            });
          } catch (err) {
            results.push({
              stepIndex: results.length,
              stepType: StepType.Action,
              status: StepStatus.Failed,
              durationMs: Date.now() - stepStart,
              error: String(err),
            });

            if (step.continueOnError) {
              onPartial?.(true);
            } else {
              throw err;
            }
          }
          break;
        }
        case 'condition': {
          const satisfied = evaluateCondition(step.condition, this.env);
          results.push({
            stepIndex: results.length,
            stepType: StepType.Condition,
            status: satisfied ? StepStatus.Completed : StepStatus.Skipped,
            durationMs: Date.now() - stepStart,
          });
          if (!satisfied) {
            // Condition not met, graceful completion of current branch
            return;
          }
          break;
        }
        case 'delay': {
          await this.sleep(step.durationMs, signal);
          results.push({
            stepIndex: results.length,
            stepType: StepType.Delay,
            status: StepStatus.Completed,
            durationMs: Date.now() - stepStart,
          });
          break;
        }
        case 'sequence': {
          await this.runSteps(step.steps, results, signal, onPartial);
          break;
        }
        case 'parallel': {
          const branchPromises = step.steps.map((subStep) =>
            this.runSteps([subStep], results, signal, onPartial),
          );
          await Promise.allSettled(branchPromises);
          break;
        }
        case 'repeat': {
          const maxIterations = Math.min(step.count ?? 100, 1000);
          for (let iter = 0; iter < maxIterations; iter++) {
            if (signal?.aborted) throw new Error('Execution was cancelled.');
            if (step.whileCondition && !evaluateCondition(step.whileCondition, this.env)) {
              break;
            }
            await this.runSteps(step.steps, results, signal, onPartial);
          }
          break;
        }
        case 'choose': {
          let chosen = false;
          for (const branch of step.branches) {
            const allMet = branch.conditions.every((c) => evaluateCondition(c, this.env));
            if (allMet) {
              chosen = true;
              await this.runSteps(branch.steps, results, signal, onPartial);
              break;
            }
          }
          if (!chosen && step.defaultSteps) {
            await this.runSteps(step.defaultSteps, results, signal, onPartial);
          }
          break;
        }
      }
    }
  }

  private async runActionWithTimeout(
    step: ActionStep,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!step.timeoutMs || step.timeoutMs <= 0) {
      return this.dispatchAction(step.action, signal);
    }

    const timeoutCtrl = new AbortController();
    const timeoutTimer = setTimeout(() => {
      timeoutCtrl.abort(new Error(`Action timed out after ${step.timeoutMs}ms.`));
    }, step.timeoutMs);

    const onParentAbort = () => timeoutCtrl.abort(new Error('Execution was aborted.'));
    signal?.addEventListener('abort', onParentAbort, { once: true });

    try {
      await this.dispatchAction(step.action, timeoutCtrl.signal);
    } finally {
      clearTimeout(timeoutTimer);
      signal?.removeEventListener('abort', onParentAbort);
    }
  }

  private async dispatchAction(
    action: ScriptAction,
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted) throw new Error('Action was aborted.');

    switch (action.kind) {
      case 'device_command':
        return this.env.executeDeviceCommand(
          action.payload.endpointId,
          action.payload.capability,
          action.payload.command,
          action.payload.parameters,
        );
      case 'activate_scene':
        return this.env.activateScene(action.payload.sceneId, signal);
      case 'call_script':
        return this.env.callScript(action.payload.scriptId, action.payload.parameters, signal);
      case 'send_notification':
        return this.env.sendNotification(action.payload);
      case 'custom':
        // Custom action types delegated or handled by extended environments
        return;
    }
  }
}
