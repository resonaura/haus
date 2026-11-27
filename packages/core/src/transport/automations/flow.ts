/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { EditableConfig } from '../config-editor.js';
import { describeSavedTargetValues } from '../scenes/editor-model.js';
import { parseAutomationFlow } from './flow-compiler.js';
import {
  describeButtonGesture,
  statePresetsForEntity,
  type AutomationActionStep,
  type AutomationCardPresentation,
  type AutomationTriggerBlock,
  type AutomationWeekday,
} from './flow-types.js';

export * from './flow-types.js';
export * from './flow-compiler.js';

export function formatWaitDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} sec`;
  if (seconds % 3600 === 0) return `${seconds / 3600} hr`;
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function isOpaqueMachineId(value: string): boolean {
  const clean = value.includes('.') ? (value.split('.')[1] ?? value) : value;
  return /^(ep_[a-z0-9_]{10,}|[0-9a-f]{16,})$/i.test(clean);
}

function humanizeSlug(slug: string): string {
  const stripped = slug
    .replace(/_stateful_scene$/i, '')
    .replace(/^stateful_scene_/i, '')
    .replace(/_input_p.*$/i, '')
    .trim();
  if (!stripped) return 'Accessory';
  return stripped
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function humanizeAutomationTargetName(
  rawId: string,
  resolveName: (id: string) => string = (id) => id,
  fallback = 'Accessory',
): string {
  if (!rawId) return fallback;
  const resolved = resolveName(rawId);
  if (resolved && resolved !== rawId && !isOpaqueMachineId(resolved) && !resolved.includes('.')) {
    return resolved;
  }
  if (isOpaqueMachineId(rawId)) return fallback;
  const slug = rawId.includes('.') ? (rawId.split('.')[1] ?? rawId) : rawId;
  if (isOpaqueMachineId(slug)) return fallback;
  return humanizeSlug(slug);
}

export function describeTriggerSummary(
  trigger: AutomationTriggerBlock | undefined,
  resolveName: (id: string) => string = (id) => id,
): string {
  if (!trigger) return 'Manual trigger';
  if (trigger.kind === 'time') {
    const days =
      trigger.weekdays.length === 5 &&
      ['mon', 'tue', 'wed', 'thu', 'fri'].every((d) =>
        trigger.weekdays.includes(d as AutomationWeekday),
      )
        ? 'weekdays'
        : trigger.weekdays.length === 2 &&
            trigger.weekdays.includes('sat') &&
            trigger.weekdays.includes('sun')
          ? 'weekends'
          : trigger.weekdays.length > 0 && trigger.weekdays.length < 7
            ? trigger.weekdays.map((d) => d.slice(0, 3)).join(', ')
            : 'every day';
    return `At ${trigger.at} · ${days}`;
  }
  if (trigger.kind === 'sun') {
    const label = trigger.event === 'sunrise' ? 'Sunrise' : 'Sunset';
    if (!trigger.offsetMinutes) return `At ${label}`;
    const abs = Math.abs(trigger.offsetMinutes);
    return `${abs}m ${trigger.offsetMinutes < 0 ? 'before' : 'after'} ${label}`;
  }
  if (trigger.kind === 'button_event') {
    const targetName = trigger.entityId
      ? humanizeAutomationTargetName(trigger.entityId, resolveName, 'Switch')
      : trigger.haDeviceTrigger?.subtype
        ? `${trigger.haDeviceTrigger.domain.toUpperCase()} · Button ${trigger.haDeviceTrigger.subtype}`
        : 'Wireless switch';
    const gestureText =
      trigger.eventTypes.length > 0
        ? trigger.eventTypes.map(describeButtonGesture).join(' / ')
        : 'Short press';
    return `${targetName} · ${gestureText}`;
  }
  if (trigger.kind === 'bus_event') {
    const entries = Object.entries(trigger.eventData);
    if (entries.length === 0) return `On ${trigger.eventType}`;
    const detail = entries
      .slice(0, 2)
      .map(([k, v]) => `${k}: ${String(v)}`)
      .join(', ');
    return `On ${trigger.eventType} (${detail})`;
  }
  if (trigger.kind === 'device') {
    const label = humanizeAutomationTargetName(trigger.entityId, resolveName, 'Accessory');
    const preset = statePresetsForEntity(trigger.entityId).find((p) => p.value === trigger.toState);
    const verb = preset ? preset.whenLabel.toLowerCase() : `becomes ${trigger.toState}`;
    return `When ${label} ${verb}`;
  }
  if (trigger.kind === 'threshold') {
    const label = humanizeAutomationTargetName(trigger.entityId, resolveName, 'Sensor');
    if (trigger.above !== undefined && trigger.below !== undefined) {
      return `When ${label} is ${trigger.above}–${trigger.below}`;
    }
    if (trigger.above !== undefined) return `When ${label} rises above ${trigger.above}`;
    if (trigger.below !== undefined) return `When ${label} drops below ${trigger.below}`;
    return `When ${label} changes`;
  }
  return trigger.summary;
}

export function describeStepSummary(
  step: AutomationActionStep | undefined,
  resolveName: (id: string) => string = (id) => id,
): string {
  if (!step) return 'Add actions';
  if (step.kind === 'control_devices') {
    const entries = Object.entries(step.targets);
    if (entries.length === 0) return 'Choose accessories';
    if (entries.length === 1) {
      const [id, setting] = entries[0]!;
      const targetLabel = humanizeAutomationTargetName(id, resolveName, 'Accessory');
      if (/_stateful_scene$/i.test(id)) return `Scene · ${targetLabel}`;
      return `${targetLabel} · ${describeSavedTargetValues(id, setting)}`;
    }
    return `Set ${entries.length} accessories`;
  }
  if (step.kind === 'activate_scene') {
    return step.sceneEntityId
      ? `Run "${humanizeAutomationTargetName(step.sceneEntityId, resolveName, 'Scene')}"`
      : 'Run a scene';
  }
  if (step.kind === 'wait') {
    return `Wait ${formatWaitDuration(step.seconds)}`;
  }
  const [domain = '', method = ''] = step.service.split('.', 2);
  if (domain === 'telegram_bot' || domain === 'notify') return 'Send notification';
  const cleanMethod = (method || step.service).replaceAll('_', ' ');
  const verb = cleanMethod.charAt(0).toUpperCase() + cleanMethod.slice(1);
  if (!step.entityId || isOpaqueMachineId(step.entityId)) return verb;
  return `${verb} ${humanizeAutomationTargetName(step.entityId, resolveName, '')}`.trim();
}

function describeCompactTriggerCue(trigger: AutomationTriggerBlock | undefined): string {
  if (!trigger) return '';
  if (trigger.kind === 'button_event') {
    return trigger.eventTypes.length > 0
      ? trigger.eventTypes.map(describeButtonGesture).join(' / ')
      : 'Short press';
  }
  if (trigger.kind === 'bus_event') {
    return trigger.eventType === 'hue_event' ? 'Hue event' : trigger.eventType;
  }
  if (trigger.kind === 'sun') {
    const label = trigger.event === 'sunrise' ? 'Sunrise' : 'Sunset';
    if (!trigger.offsetMinutes) return label;
    const abs = Math.abs(trigger.offsetMinutes);
    return `${abs}m ${trigger.offsetMinutes < 0 ? 'before' : 'after'} ${label}`;
  }
  if (trigger.kind === 'time') {
    return trigger.at;
  }
  if (trigger.kind === 'threshold') {
    if (trigger.above !== undefined) return `Above ${trigger.above}`;
    if (trigger.below !== undefined) return `Below ${trigger.below}`;
    return 'Threshold';
  }
  if (trigger.kind === 'device') {
    const preset = statePresetsForEntity(trigger.entityId).find((p) => p.value === trigger.toState);
    return preset ? preset.whenLabel : '';
  }
  return '';
}

export function describeAutomationCard(
  config: EditableConfig | undefined,
  fallbackName: string,
  resolveName: (id: string) => string = (id) => id,
): AutomationCardPresentation {
  if (!config) {
    const lower = fallbackName.toLowerCase();
    if (/hue|switch|dimmer|button|dial|remote/.test(lower)) {
      return {
        iconHint: 'toggle-left',
        categoryLabel: 'Switch',
        compactSummary: '',
        whenText: 'Button press',
        doText: 'Run assigned actions',
        stepCount: 1,
      };
    }
    if (/sunset|evening|night|bedtime|sleep/.test(lower)) {
      return {
        iconHint: 'sunset',
        categoryLabel: 'Evening',
        compactSummary: '',
        whenText: 'Evening schedule',
        doText: 'Adjust home mood',
        stepCount: 1,
      };
    }
    if (/morning|sunrise|wake/.test(lower)) {
      return {
        iconHint: 'sunrise',
        categoryLabel: 'Morning',
        compactSummary: '',
        whenText: 'Morning schedule',
        doText: 'Start the day',
        stepCount: 1,
      };
    }
    if (/motion|sensor|presence|arrive|door|lock/.test(lower)) {
      return {
        iconHint: 'radar',
        categoryLabel: 'Sensor',
        compactSummary: '',
        whenText: 'Sensor activity',
        doText: 'Respond automatically',
        stepCount: 1,
      };
    }
    return {
      iconHint: 'zap',
      categoryLabel: 'Automation',
      compactSummary: '',
      whenText: 'Automatic rule',
      doText: 'Open to edit flow',
      stepCount: 1,
    };
  }

  const draft = parseAutomationFlow(config);
  const firstTrigger = draft.triggers[0];
  const firstStep = draft.steps[0];
  const whenText = describeTriggerSummary(firstTrigger, resolveName);
  const doText =
    draft.steps.length > 1
      ? `${describeStepSummary(firstStep, resolveName)} +${draft.steps.length - 1} more`
      : describeStepSummary(firstStep, resolveName);
  const compactSummary = describeCompactTriggerCue(firstTrigger);

  if (firstTrigger?.kind === 'button_event') {
    const isDial =
      /rotary|dial/i.test(firstTrigger.entityId) ||
      firstTrigger.eventTypes.some((t) => /rotate|clock_wise/i.test(t));
    return {
      iconHint: isDial ? 'rotate-cw' : 'toggle-left',
      categoryLabel: isDial ? 'Dial' : 'Switch',
      compactSummary,
      whenText,
      doText,
      stepCount: Math.max(1, draft.steps.length),
    };
  }
  if (firstTrigger?.kind === 'bus_event') {
    return {
      iconHint: 'zap',
      categoryLabel: 'Event',
      compactSummary,
      whenText,
      doText,
      stepCount: Math.max(1, draft.steps.length),
    };
  }
  if (firstTrigger?.kind === 'sun') {
    return {
      iconHint: firstTrigger.event === 'sunrise' ? 'sunrise' : 'sunset',
      categoryLabel: firstTrigger.event === 'sunrise' ? 'Sunrise' : 'Sunset',
      compactSummary,
      whenText,
      doText,
      stepCount: Math.max(1, draft.steps.length),
    };
  }
  if (firstTrigger?.kind === 'time') {
    return {
      iconHint: 'clock-3',
      categoryLabel: 'Schedule',
      compactSummary,
      whenText,
      doText,
      stepCount: Math.max(1, draft.steps.length),
    };
  }
  if (firstTrigger?.kind === 'threshold') {
    return {
      iconHint: 'thermometer',
      categoryLabel: 'Threshold',
      compactSummary,
      whenText,
      doText,
      stepCount: Math.max(1, draft.steps.length),
    };
  }
  if (firstTrigger?.kind === 'device') {
    const isSensor = firstTrigger.entityId.startsWith('binary_sensor.');
    return {
      iconHint: isSensor ? 'radar' : 'lightbulb',
      categoryLabel: isSensor ? 'Sensor' : 'Accessory',
      compactSummary,
      whenText,
      doText,
      stepCount: Math.max(1, draft.steps.length),
    };
  }
  return {
    iconHint: firstStep?.kind === 'activate_scene' ? 'sparkles' : 'zap',
    categoryLabel: 'Automation',
    compactSummary,
    whenText,
    doText,
    stepCount: Math.max(1, draft.steps.length),
  };
}
