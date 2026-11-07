/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type {
  AutomationCondition,
  AutomationTrigger,
  HausAutomationRule,
  HausScene,
  HausScript,
  ScriptStep,
} from '../automation/types.js';
import type { HausDeviceGroup } from './room-move.js';

export function slugifySegment(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return cleaned || 'item';
}

export function rewriteRef(ref: string, rewrites: ReadonlyMap<string, string>): string {
  return rewrites.get(ref) ?? ref;
}

export function rewriteTrigger(
  trigger: AutomationTrigger,
  rewrites: ReadonlyMap<string, string>,
): { trigger: AutomationTrigger; changed: boolean } {
  if (trigger.type === 'state' || trigger.type === 'numeric_state') {
    const next = rewriteRef(trigger.endpointId, rewrites);
    if (next !== trigger.endpointId) {
      return { trigger: { ...trigger, endpointId: next }, changed: true };
    }
  } else if (trigger.type === 'event' && trigger.endpointId) {
    const next = rewriteRef(trigger.endpointId, rewrites);
    if (next !== trigger.endpointId) {
      return { trigger: { ...trigger, endpointId: next }, changed: true };
    }
  }
  return { trigger, changed: false };
}

export function rewriteCondition(
  condition: AutomationCondition,
  rewrites: ReadonlyMap<string, string>,
): { condition: AutomationCondition; changed: boolean } {
  if (condition.type === 'state') {
    const next = rewriteRef(condition.endpointId, rewrites);
    if (next !== condition.endpointId) {
      return { condition: { ...condition, endpointId: next }, changed: true };
    }
    return { condition, changed: false };
  }
  if (condition.type === 'and' || condition.type === 'or' || condition.type === 'not') {
    let anyChanged = false;
    const nextConds = condition.conditions.map((child) => {
      const res = rewriteCondition(child, rewrites);
      if (res.changed) anyChanged = true;
      return res.condition;
    });
    return anyChanged
      ? { condition: { ...condition, conditions: nextConds }, changed: true }
      : { condition, changed: false };
  }
  return { condition, changed: false };
}

export function rewriteStep(
  step: ScriptStep,
  rewrites: ReadonlyMap<string, string>,
): { step: ScriptStep; changed: boolean } {
  switch (step.type) {
    case 'action': {
      if (step.action.kind === 'device_command') {
        const nextEp = rewriteRef(step.action.payload.endpointId, rewrites);
        if (nextEp !== step.action.payload.endpointId) {
          return {
            step: {
              ...step,
              action: {
                ...step.action,
                payload: { ...step.action.payload, endpointId: nextEp },
              },
            },
            changed: true,
          };
        }
      }
      return { step, changed: false };
    }
    case 'condition': {
      const res = rewriteCondition(step.condition, rewrites);
      return res.changed
        ? { step: { ...step, condition: res.condition }, changed: true }
        : { step, changed: false };
    }
    case 'sequence':
    case 'parallel': {
      let changed = false;
      const nextSteps = step.steps.map((s) => {
        const res = rewriteStep(s, rewrites);
        if (res.changed) changed = true;
        return res.step;
      });
      return changed
        ? { step: { ...step, steps: nextSteps }, changed: true }
        : { step, changed: false };
    }
    case 'repeat': {
      let changed = false;
      let nextWhile = step.whileCondition;
      if (step.whileCondition) {
        const condRes = rewriteCondition(step.whileCondition, rewrites);
        if (condRes.changed) {
          changed = true;
          nextWhile = condRes.condition;
        }
      }
      const nextSteps = step.steps.map((s) => {
        const res = rewriteStep(s, rewrites);
        if (res.changed) changed = true;
        return res.step;
      });
      return changed
        ? { step: { ...step, whileCondition: nextWhile, steps: nextSteps }, changed: true }
        : { step, changed: false };
    }
    case 'choose': {
      let changed = false;
      const nextBranches = step.branches.map((branch) => {
        let branchChanged = false;
        const conds = branch.conditions.map((c) => {
          const r = rewriteCondition(c, rewrites);
          if (r.changed) branchChanged = true;
          return r.condition;
        });
        const steps = branch.steps.map((s) => {
          const r = rewriteStep(s, rewrites);
          if (r.changed) branchChanged = true;
          return r.step;
        });
        if (branchChanged) changed = true;
        return branchChanged ? { conditions: conds, steps } : branch;
      });
      let nextDefault = step.defaultSteps;
      if (step.defaultSteps) {
        const defSteps = step.defaultSteps.map((s) => {
          const r = rewriteStep(s, rewrites);
          if (r.changed) changed = true;
          return r.step;
        });
        if (changed) nextDefault = defSteps;
      }
      return changed
        ? { step: { ...step, branches: nextBranches, defaultSteps: nextDefault }, changed: true }
        : { step, changed: false };
    }
    default:
      return { step, changed: false };
  }
}

export function rewriteAllReferences(
  scenes: Record<string, HausScene>,
  scripts: Record<string, HausScript>,
  automations: Record<string, HausAutomationRule>,
  groups: Record<string, HausDeviceGroup>,
  rewrites: ReadonlyMap<string, string>,
  deviceId: string,
  fromRoomId: string,
  toRoomId: string,
): {
  updatedSceneIds: string[];
  updatedScriptIds: string[];
  updatedAutomationIds: string[];
  updatedGroupIds: string[];
} {
  const updatedSceneIds: string[] = [];
  for (const [sceneId, scene] of Object.entries(scenes)) {
    let changed = false;
    const members = scene.members.map((m) => {
      const nextEp = rewriteRef(m.endpointId, rewrites);
      if (nextEp !== m.endpointId) {
        changed = true;
        return { ...m, endpointId: nextEp };
      }
      return m;
    });
    if (changed) {
      scenes[sceneId] = {
        ...scene,
        roomId: scene.roomId === fromRoomId ? toRoomId : scene.roomId,
        members,
      };
      updatedSceneIds.push(sceneId);
    }
  }

  const updatedScriptIds: string[] = [];
  for (const [scriptId, script] of Object.entries(scripts)) {
    let changed = false;
    const steps = script.steps.map((s) => {
      const res = rewriteStep(s, rewrites);
      if (res.changed) changed = true;
      return res.step;
    });
    if (changed) {
      scripts[scriptId] = { ...script, steps };
      updatedScriptIds.push(scriptId);
    }
  }

  const updatedAutomationIds: string[] = [];
  for (const [ruleId, rule] of Object.entries(automations)) {
    let changed = false;
    const triggers = rule.triggers.map((t) => {
      const res = rewriteTrigger(t, rewrites);
      if (res.changed) changed = true;
      return res.trigger;
    });
    const conditions = rule.conditions?.map((c) => {
      const res = rewriteCondition(c, rewrites);
      if (res.changed) changed = true;
      return res.condition;
    });
    const actions = rule.actions.map((s) => {
      const res = rewriteStep(s, rewrites);
      if (res.changed) changed = true;
      return res.step;
    });
    if (changed) {
      automations[ruleId] = { ...rule, triggers, conditions, actions };
      updatedAutomationIds.push(ruleId);
    }
  }

  const updatedGroupIds: string[] = [];
  for (const [groupId, group] of Object.entries(groups)) {
    let changed = false;
    const memberAddresses = group.memberAddresses.map((addr) => {
      const nextAddr = rewriteRef(addr, rewrites);
      if (nextAddr !== addr) changed = true;
      return nextAddr;
    });
    const movesGroupRoom =
      group.memberDeviceIds.includes(deviceId) &&
      group.memberDeviceIds.length === 1 &&
      group.roomId === fromRoomId;
    if (changed || movesGroupRoom) {
      groups[groupId] = {
        ...group,
        roomId: movesGroupRoom ? toRoomId : group.roomId,
        memberAddresses,
      };
      updatedGroupIds.push(groupId);
    }
  }

  return {
    updatedSceneIds,
    updatedScriptIds,
    updatedAutomationIds,
    updatedGroupIds,
  };
}
