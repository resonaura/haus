/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  AutomationExecutor,
  LocalAutomationEngine,
  type AtomicRoomMoveCoordinator,
  type AutomationExecutorEnvironment,
  type ExecutionHistoryRecord,
  type HausAutomationRule,
  type HausScene,
  type HausScript,
  type TriggerEvent,
} from '@haus/core';
import type { LiveService } from '../live/types.js';
import type { StatsCollector } from '../stats/stats.collector.js';
import {
  normalizeScene,
  normalizeSteps,
  type StandaloneHomePersistence,
} from './home.persistence.js';

export interface HomeRulesDeps {
  readonly scenes: Map<string, HausScene>;
  readonly scripts: Map<string, HausScript>;
  readonly automations: Map<string, HausAutomationRule>;
  readonly roomCoordinator: Pick<
    AtomicRoomMoveCoordinator,
    'putScene' | 'removeScene' | 'putScript' | 'removeScript' | 'putAutomation' | 'removeAutomation'
  >;
  readonly persistence: Pick<StandaloneHomePersistence, 'save' | 'remove'>;
  readonly automationExecutor: AutomationExecutor;
  readonly automationEngine: LocalAutomationEngine;
  readonly resolveEndpointId: (ref: string) => string;
  readonly getStatsCollector: () => StatsCollector | undefined;
  readonly liveService?: LiveService;
  readonly onConfigChanged?: (resourceId: string) => void;
}

/** Builds AutomationExecutor, LocalAutomationEngine, and HomeRulesManager together. */
export function createHomeRulesRuntime(
  env: AutomationExecutorEnvironment,
  deps: Omit<HomeRulesDeps, 'automationExecutor' | 'automationEngine'>,
): {
  automationExecutor: AutomationExecutor;
  automationEngine: LocalAutomationEngine;
  rulesManager: HomeRulesManager;
} {
  const normalizedEnv: AutomationExecutorEnvironment = {
    ...env,
    executeDeviceCommand: (endpointId, capability, command, parameters) => {
      const normalizedCommand =
        capability === 'on_off' && command === 'set' && typeof parameters?.value === 'boolean'
          ? parameters.value
            ? 'turn_on'
            : 'turn_off'
          : command;
      return env.executeDeviceCommand(endpointId, capability, normalizedCommand, parameters);
    },
  };
  const automationExecutor = new AutomationExecutor(normalizedEnv);
  const automationEngine = new LocalAutomationEngine(normalizedEnv, {
    resolveEndpointId: deps.resolveEndpointId,
  });
  const rulesManager = new HomeRulesManager({
    ...deps,
    automationExecutor,
    automationEngine,
  });
  return { automationExecutor, automationEngine, rulesManager };
}

/** Coordinates scene, script, and automation storage, execution, and live publication. */
export class HomeRulesManager {
  constructor(private readonly deps: HomeRulesDeps) {}

  registerScene(scene: HausScene): HausScene {
    const normalized = normalizeScene(scene);
    this.deps.scenes.set(normalized.id, normalized);
    void this.deps.roomCoordinator.putScene(normalized);
    void this.deps.persistence.save('scene', normalized.id, normalized);
    this.deps.onConfigChanged?.(`scene:${normalized.id}`);
    this.deps.liveService?.publish('scenes');
    return normalized;
  }

  listScenes(): HausScene[] {
    return Array.from(this.deps.scenes.values());
  }

  removeScene(sceneId: string): boolean {
    const existed = this.deps.scenes.delete(sceneId);
    if (!existed) return false;
    void this.deps.roomCoordinator.removeScene(sceneId);
    void this.deps.persistence.remove('scene', sceneId);
    this.deps.onConfigChanged?.(`scene:${sceneId}`);
    this.deps.liveService?.publish('scenes');
    return true;
  }

  async activateScene(sceneId: string, signal?: AbortSignal): Promise<ExecutionHistoryRecord> {
    const scene = this.deps.scenes.get(sceneId);
    if (!scene) throw new Error('scene_not_found');
    const record = await this.deps.automationExecutor.executeScene(scene, signal);
    this.deps.liveService?.publish('scenes');
    return record;
  }

  registerScript(script: HausScript): HausScript {
    const normalized: HausScript = { ...script, steps: normalizeSteps(script.steps) };
    this.deps.scripts.set(normalized.id, normalized);
    void this.deps.roomCoordinator.putScript(normalized);
    void this.deps.persistence.save('script', normalized.id, normalized);
    this.deps.onConfigChanged?.(`script:${normalized.id}`);
    this.deps.liveService?.publish('scripts');
    return normalized;
  }

  listScripts(): HausScript[] {
    return Array.from(this.deps.scripts.values());
  }

  removeScript(scriptId: string): boolean {
    const existed = this.deps.scripts.delete(scriptId);
    if (!existed) return false;
    void this.deps.roomCoordinator.removeScript(scriptId);
    void this.deps.persistence.remove('script', scriptId);
    this.deps.onConfigChanged?.(`script:${scriptId}`);
    this.deps.liveService?.publish('scripts');
    return true;
  }

  async executeScript(scriptId: string, signal?: AbortSignal): Promise<ExecutionHistoryRecord> {
    const script = this.deps.scripts.get(scriptId);
    if (!script) throw new Error('script_not_found');
    const record = await this.deps.automationExecutor.executeScript(script, signal);
    this.deps.liveService?.publish('scripts');
    return record;
  }

  registerAutomation(rule: HausAutomationRule): HausAutomationRule {
    const normalized: HausAutomationRule = { ...rule, actions: normalizeSteps(rule.actions) };
    this.deps.automations.set(normalized.id, normalized);
    void this.deps.roomCoordinator.putAutomation(normalized);
    this.deps.automationEngine.updateRule(normalized);
    void this.deps.persistence.save('automation', normalized.id, normalized);
    this.deps.onConfigChanged?.(`automation:${normalized.id}`);
    this.deps.liveService?.publish('automations');
    return normalized;
  }

  listAutomations(): HausAutomationRule[] {
    return Array.from(this.deps.automations.values());
  }

  removeAutomation(ruleId: string): boolean {
    const existed = this.deps.automations.delete(ruleId);
    void this.deps.roomCoordinator.removeAutomation(ruleId);
    this.deps.automationEngine.unregisterRule(ruleId);
    void this.deps.persistence.remove('automation', ruleId);
    if (existed) {
      this.deps.onConfigChanged?.(`automation:${ruleId}`);
      this.deps.liveService?.publish('automations');
    }
    return existed;
  }

  async triggerAutomation(ruleId: string, signal?: AbortSignal): Promise<ExecutionHistoryRecord> {
    const rule = this.deps.automations.get(ruleId);
    if (!rule) throw new Error('automation_not_found');
    const raw = await this.deps.automationExecutor.executeScript(
      {
        schemaVersion: 1,
        id: rule.id,
        name: rule.name,
        mode: rule.mode,
        maxRuns: rule.maxRuns,
        steps: rule.actions,
      },
      signal,
    );
    const record: ExecutionHistoryRecord = { ...raw, sourceKind: 'automation' };
    this.deps
      .getStatsCollector()
      ?.ingestAutomationExecution(rule.id, record.durationMs, record.status === 'completed');
    this.deps.liveService?.publish('automations');
    return record;
  }

  async dispatchAutomationEvent(event: TriggerEvent): Promise<readonly ExecutionHistoryRecord[]> {
    const canonicalEvent: TriggerEvent = event.endpointId
      ? { ...event, endpointId: this.deps.resolveEndpointId(event.endpointId) }
      : event;
    const records = await this.deps.automationEngine.dispatch(canonicalEvent);
    const collector = this.deps.getStatsCollector();
    for (const record of records) {
      this.deps.automationExecutor.history.record(record);
      collector?.ingestAutomationExecution(
        record.sourceId,
        record.durationMs,
        record.status === 'completed',
      );
    }
    if (records.length > 0) this.deps.liveService?.publish('automations');
    return records;
  }

  listExecutionHistory(sourceId?: string): readonly ExecutionHistoryRecord[] {
    return this.deps.automationExecutor.history.list(sourceId);
  }
}
