/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { SceneTarget } from '../scenes/targets.js';
import { asRecord } from './types.js';

export type AutomationWeekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export const AUTOMATION_WEEKDAYS: readonly {
  readonly id: AutomationWeekday;
  readonly short: string;
  readonly label: string;
}[] = [
  { id: 'mon', short: 'M', label: 'Mon' },
  { id: 'tue', short: 'T', label: 'Tue' },
  { id: 'wed', short: 'W', label: 'Wed' },
  { id: 'thu', short: 'T', label: 'Thu' },
  { id: 'fri', short: 'F', label: 'Fri' },
  { id: 'sat', short: 'S', label: 'Sat' },
  { id: 'sun', short: 'S', label: 'Sun' },
];

export interface ButtonGestureOption {
  readonly value: string;
  readonly label: string;
}

export const BUTTON_GESTURE_CATALOG: readonly ButtonGestureOption[] = [
  { value: 'short_release', label: 'Short press' },
  { value: 'initial_press', label: 'Initial press' },
  { value: 'single_press', label: 'Single press' },
  { value: 'press', label: 'Press' },
  { value: 'double_short_release', label: 'Double press' },
  { value: 'double_press', label: 'Double press' },
  { value: 'triple_press', label: 'Triple press' },
  { value: 'long_press', label: 'Hold' },
  { value: 'repeat', label: 'Hold (repeat)' },
  { value: 'long_release', label: 'Release after hold' },
  { value: 'rotate_right', label: 'Rotate right' },
  { value: 'clock_wise', label: 'Rotate right' },
  { value: 'rotate_left', label: 'Rotate left' },
  { value: 'counter_clock_wise', label: 'Rotate left' },
  { value: 'start', label: 'Start rotation' },
];

export const DEFAULT_HUE_BUTTON_EVENT_TYPES: readonly string[] = [
  'initial_press',
  'short_release',
  'repeat',
  'long_release',
];

export const BUS_EVENT_PRESETS: readonly {
  readonly eventType: string;
  readonly label: string;
}[] = [
  { eventType: 'hue_event', label: 'Hue event (hue_event)' },
  { eventType: 'zha_event', label: 'Zigbee event (zha_event)' },
  { eventType: 'deconz_event', label: 'deCONZ event' },
  { eventType: 'matter_event', label: 'Matter event' },
  { eventType: 'call_service', label: 'Service call' },
];

export interface HaDeviceTriggerRef {
  readonly domain: string;
  readonly deviceId: string;
  readonly subtype?: string;
}

export type AutomationTriggerBlock =
  | {
      readonly id: string;
      readonly kind: 'time';
      readonly at: string;
      readonly weekdays: readonly AutomationWeekday[];
    }
  | {
      readonly id: string;
      readonly kind: 'sun';
      readonly event: 'sunrise' | 'sunset';
      readonly offsetMinutes: number;
    }
  | {
      readonly id: string;
      readonly kind: 'button_event';
      readonly entityId: string;
      readonly eventTypes: readonly string[];
      readonly haDeviceTrigger?: HaDeviceTriggerRef;
    }
  | {
      readonly id: string;
      readonly kind: 'bus_event';
      readonly eventType: string;
      readonly eventData: Readonly<Record<string, string | number | boolean>>;
    }
  | {
      readonly id: string;
      readonly kind: 'device';
      readonly entityId: string;
      readonly toState: string;
      readonly forSeconds?: number;
    }
  | {
      readonly id: string;
      readonly kind: 'threshold';
      readonly entityId: string;
      readonly above?: number;
      readonly below?: number;
    }
  | {
      readonly id: string;
      readonly kind: 'raw';
      readonly raw: Record<string, unknown>;
      readonly summary: string;
    };

export type AutomationConditionBlock =
  | {
      readonly id: string;
      readonly kind: 'device';
      readonly entityId: string;
      readonly state: string;
    }
  | {
      readonly id: string;
      readonly kind: 'time_window';
      readonly after?: string;
      readonly before?: string;
      readonly weekdays?: readonly AutomationWeekday[];
    }
  | {
      readonly id: string;
      readonly kind: 'sun';
      readonly after?: 'sunrise' | 'sunset';
      readonly before?: 'sunrise' | 'sunset';
    }
  | {
      readonly id: string;
      readonly kind: 'threshold';
      readonly entityId: string;
      readonly above?: number;
      readonly below?: number;
    }
  | {
      readonly id: string;
      readonly kind: 'raw';
      readonly raw: Record<string, unknown>;
      readonly summary: string;
    };

export type AutomationActionStep =
  | {
      readonly id: string;
      readonly kind: 'control_devices';
      readonly targets: Record<string, SceneTarget>;
    }
  | {
      readonly id: string;
      readonly kind: 'activate_scene';
      readonly sceneEntityId: string;
    }
  | {
      readonly id: string;
      readonly kind: 'wait';
      readonly seconds: number;
    }
  | {
      readonly id: string;
      readonly kind: 'service';
      readonly service: string;
      readonly entityId: string;
      readonly data?: Record<string, unknown>;
      readonly raw?: Record<string, unknown>;
    };

export type AutomationRunMode = 'single' | 'restart' | 'queued' | 'parallel';

export interface AutomationFlowDraft {
  readonly alias: string;
  readonly description: string;
  readonly mode: AutomationRunMode;
  readonly triggers: readonly AutomationTriggerBlock[];
  readonly conditionLogic: 'all' | 'any';
  readonly conditions: readonly AutomationConditionBlock[];
  readonly steps: readonly AutomationActionStep[];
  readonly preservedExtra: Record<string, unknown>;
}

export interface AutomationStatePreset {
  readonly value: string;
  readonly whenLabel: string;
  readonly ifLabel: string;
}

export type AutomationCardIconHint =
  | 'sunrise'
  | 'sunset'
  | 'clock-3'
  | 'radar'
  | 'thermometer'
  | 'sparkles'
  | 'lightbulb'
  | 'shield-check'
  | 'toggle-left'
  | 'rotate-cw'
  | 'zap';

export interface AutomationCardPresentation {
  readonly iconHint: AutomationCardIconHint;
  readonly categoryLabel: string;
  readonly compactSummary: string;
  readonly whenText: string;
  readonly doText: string;
  readonly stepCount: number;
}

export function describeButtonGesture(eventType: string): string {
  const known = BUTTON_GESTURE_CATALOG.find((item) => item.value === eventType);
  if (known) return known.label;
  if (!eventType.trim()) return 'Press';
  const normalized = eventType.trim().replaceAll('_', ' ');
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export function gesturesForEventTypes(
  supportedEventTypes?: readonly string[],
): readonly ButtonGestureOption[] {
  const list =
    supportedEventTypes && supportedEventTypes.length > 0
      ? supportedEventTypes
      : DEFAULT_HUE_BUTTON_EVENT_TYPES;
  return list.map((value) => ({
    value,
    label: describeButtonGesture(value),
  }));
}

export function statePresetsForEntity(
  entityId: string,
  deviceClass?: string,
): readonly AutomationStatePreset[] {
  const domain = entityId.split('.')[0] ?? '';
  if (domain === 'binary_sensor') {
    if (deviceClass === 'motion' || deviceClass === 'occupancy' || deviceClass === 'presence') {
      return [
        { value: 'on', whenLabel: 'Detects motion', ifLabel: 'Motion detected' },
        { value: 'off', whenLabel: 'Clears', ifLabel: 'Clear' },
      ];
    }
    if (deviceClass === 'door' || deviceClass === 'window' || deviceClass === 'opening') {
      return [
        { value: 'on', whenLabel: 'Opens', ifLabel: 'Is open' },
        { value: 'off', whenLabel: 'Closes', ifLabel: 'Is closed' },
      ];
    }
    return [
      { value: 'on', whenLabel: 'Activates', ifLabel: 'Is active' },
      { value: 'off', whenLabel: 'Clears', ifLabel: 'Is clear' },
    ];
  }
  if (domain === 'lock') {
    return [
      { value: 'unlocked', whenLabel: 'Unlocks', ifLabel: 'Is unlocked' },
      { value: 'locked', whenLabel: 'Locks', ifLabel: 'Is locked' },
    ];
  }
  if (domain === 'cover') {
    return [
      { value: 'open', whenLabel: 'Opens', ifLabel: 'Is open' },
      { value: 'closed', whenLabel: 'Closes', ifLabel: 'Is closed' },
    ];
  }
  if (domain === 'climate') {
    return [
      { value: 'heat', whenLabel: 'Starts heating', ifLabel: 'Is heating' },
      { value: 'cool', whenLabel: 'Starts cooling', ifLabel: 'Is cooling' },
      { value: 'off', whenLabel: 'Turns off', ifLabel: 'Is off' },
    ];
  }
  if (domain === 'person') {
    return [
      { value: 'home', whenLabel: 'Arrives home', ifLabel: 'Is home' },
      { value: 'not_home', whenLabel: 'Leaves home', ifLabel: 'Is away' },
    ];
  }
  return [
    { value: 'on', whenLabel: 'Turns on', ifLabel: 'Is on' },
    { value: 'off', whenLabel: 'Turns off', ifLabel: 'Is off' },
  ];
}

export function asAutomationRecordList(value: unknown): Record<string, unknown>[] {
  if (value === undefined || value === null) return [];
  const items = Array.isArray(value) ? value : [value];
  return items.flatMap((item) => {
    const rec = asRecord(item);
    return rec ? [rec] : [];
  });
}

export function normalizeTimeDisplay(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return '08:00';
  const match = /^(\d{1,2}):(\d{2})/.exec(raw.trim());
  if (!match) return raw.trim();
  return `${match[1]!.padStart(2, '0')}:${match[2]}`;
}

export function toFullTime(at: string): string {
  const clean = normalizeTimeDisplay(at);
  return /^\d{2}:\d{2}$/.test(clean) ? `${clean}:00` : clean;
}

export function parseOffsetMinutes(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.round(raw / 60);
  if (typeof raw !== 'string' || !raw.trim()) return 0;
  const trimmed = raw.trim();
  const sign = trimmed.startsWith('-') ? -1 : 1;
  const body = trimmed.replace(/^[+-]/, '');
  const parts = body.split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return 0;
  return sign * ((parts[0] ?? 0) * 60 + (parts[1] ?? 0));
}

export function formatOffsetString(minutes: number): string | undefined {
  if (!minutes || !Number.isFinite(minutes)) return undefined;
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(Math.round(minutes));
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${sign}${hh}:${mm}:00`;
}

export function parseDurationSeconds(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return Math.round(raw);
  const rec = asRecord(raw);
  if (rec) {
    const h = typeof rec.hours === 'number' ? rec.hours : 0;
    const m = typeof rec.minutes === 'number' ? rec.minutes : 0;
    const s = typeof rec.seconds === 'number' ? rec.seconds : 0;
    const total = Math.round(h * 3600 + m * 60 + s);
    return total > 0 ? total : undefined;
  }
  if (typeof raw === 'string' && /^\d{1,2}:\d{2}(:\d{2})?$/.test(raw.trim())) {
    const [h = 0, m = 0, s = 0] = raw.trim().split(':').map(Number);
    const total = h * 3600 + m * 60 + s;
    return total > 0 ? total : undefined;
  }
  return undefined;
}

export function formatDelayObject(seconds: number): Record<string, number> {
  const safe = Math.max(1, Math.round(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  return {
    ...(hours > 0 ? { hours } : {}),
    ...(minutes > 0 ? { minutes } : {}),
    ...(secs > 0 || (hours === 0 && minutes === 0) ? { seconds: secs } : {}),
  };
}
