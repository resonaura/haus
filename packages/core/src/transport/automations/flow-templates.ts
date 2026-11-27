/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { EditableConfig } from '../config-editor.js';
import { compileAutomationFlow, type AutomationFlowDraft } from './flow.js';

export interface AutomationStarterTemplate {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly iconHint: 'toggle-left' | 'sunrise' | 'sunset' | 'radar' | 'shield-check' | 'moon-star';
}

export const AUTOMATION_STARTER_TEMPLATES: readonly AutomationStarterTemplate[] = [
  {
    id: 'switch_button',
    title: 'Switch Press',
    subtitle: 'Hue dimmer or wireless button · Control lights or scene',
    iconHint: 'toggle-left',
  },
  {
    id: 'good_morning',
    title: 'Good Morning',
    subtitle: 'Weekdays at 07:30 · Warm lights & open blinds',
    iconHint: 'sunrise',
  },
  {
    id: 'sunset_glow',
    title: 'Sunset Glow',
    subtitle: '15m before Sunset · Cozy evening mood',
    iconHint: 'sunset',
  },
  {
    id: 'motion_nightlight',
    title: 'Motion Nightlight',
    subtitle: 'On motion after Sunset · Soft 20% glow for 2m',
    iconHint: 'radar',
  },
  {
    id: 'bedtime',
    title: 'Wind Down',
    subtitle: 'Every night at 23:00 · Lights off & secure locks',
    iconHint: 'moon-star',
  },
];

export interface AutomationTemplateContext {
  readonly lightEntityIds?: readonly string[];
  readonly coverEntityIds?: readonly string[];
  readonly motionEntityIds?: readonly string[];
  readonly lockEntityIds?: readonly string[];
  readonly sceneEntityIds?: readonly string[];
  readonly buttonEventEntityIds?: readonly string[];
  readonly targetPlatform?: 'hub' | 'ha';
}

export function instantiateAutomationTemplate(
  templateId: string,
  context: AutomationTemplateContext = {},
): EditableConfig {
  const firstLight = context.lightEntityIds?.[0];
  const secondLight = context.lightEntityIds?.[1];
  const firstCover = context.coverEntityIds?.[0];
  const firstMotion = context.motionEntityIds?.[0] ?? '';
  const firstLock = context.lockEntityIds?.[0];
  const firstScene = context.sceneEntityIds?.[0];
  const firstButton = context.buttonEventEntityIds?.[0] ?? '';

  const build = (draft: Omit<AutomationFlowDraft, 'preservedExtra'>): EditableConfig =>
    compileAutomationFlow(
      {
        ...draft,
        preservedExtra: { initial_state: false },
      },
      { targetPlatform: context.targetPlatform ?? 'hub' },
    );

  switch (templateId) {
    case 'switch_button': {
      const targets: Record<string, Record<string, unknown>> = {};
      if (firstLight) {
        targets[firstLight] = { state: 'on', brightness: 204, color_temp_kelvin: 2800 };
      }
      return build({
        alias: 'Switch Press',
        description: 'Run room lighting or a scene from a Hue or wireless switch button.',
        mode: 'restart',
        triggers: firstButton
          ? [
              {
                id: 'when-0',
                kind: 'button_event',
                entityId: firstButton,
                eventTypes: ['short_release'],
              },
            ]
          : [
              {
                id: 'when-0',
                kind: 'bus_event',
                eventType: 'hue_event',
                eventData: { subtype: 1, type: 'short_release' },
              },
            ],
        conditionLogic: 'all',
        conditions: [],
        steps: firstScene
          ? [{ id: 'do-0', kind: 'activate_scene', sceneEntityId: firstScene }]
          : [{ id: 'do-0', kind: 'control_devices', targets }],
      });
    }
    case 'good_morning': {
      const targets: Record<string, Record<string, unknown>> = {};
      if (firstLight) {
        targets[firstLight] = { state: 'on', brightness: 190, color_temp_kelvin: 3200 };
      }
      if (firstCover) {
        targets[firstCover] = { state: 'open', current_position: 100 };
      }
      return build({
        alias: 'Good Morning',
        description: 'Gently brighten the home on weekday mornings.',
        mode: 'single',
        triggers: [
          {
            id: 'when-0',
            kind: 'time',
            at: '07:30',
            weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'],
          },
        ],
        conditionLogic: 'all',
        conditions: [],
        steps: [{ id: 'do-0', kind: 'control_devices', targets }],
      });
    }
    case 'sunset_glow': {
      return build({
        alias: 'Sunset Glow',
        description: 'Ease into the evening before sunset.',
        mode: 'single',
        triggers: [{ id: 'when-0', kind: 'sun', event: 'sunset', offsetMinutes: -15 }],
        conditionLogic: 'all',
        conditions: [],
        steps: firstScene
          ? [{ id: 'do-0', kind: 'activate_scene', sceneEntityId: firstScene }]
          : [
              {
                id: 'do-0',
                kind: 'control_devices',
                targets: Object.fromEntries(
                  [firstLight, secondLight]
                    .filter((id): id is string => Boolean(id))
                    .map((id) => [id, { state: 'on', brightness: 115, color_temp_kelvin: 2500 }]),
                ),
              },
            ],
      });
    }
    case 'motion_nightlight': {
      const nightTargets = firstLight
        ? { [firstLight]: { state: 'on', brightness: 51, color_temp_kelvin: 2200 } }
        : {};
      const offTargets = firstLight ? { [firstLight]: { state: 'off' } } : {};
      return build({
        alias: 'Motion Nightlight',
        description: 'Soft guide light on motion after sunset, then off automatically.',
        mode: 'restart',
        triggers: [{ id: 'when-0', kind: 'device', entityId: firstMotion, toState: 'on' }],
        conditionLogic: 'all',
        conditions: [{ id: 'if-0', kind: 'sun', after: 'sunset', before: 'sunrise' }],
        steps: [
          { id: 'do-0', kind: 'control_devices', targets: nightTargets },
          { id: 'do-1', kind: 'wait', seconds: 120 },
          { id: 'do-2', kind: 'control_devices', targets: offTargets },
        ],
      });
    }
    default: {
      const targets: Record<string, Record<string, unknown>> = {};
      for (const id of (context.lightEntityIds ?? []).slice(0, 3)) {
        targets[id] = { state: 'off' };
      }
      if (firstCover) targets[firstCover] = { state: 'closed' };
      if (firstLock) targets[firstLock] = { state: 'locked' };
      return build({
        alias: 'Wind Down',
        description: 'Turn off lights and close up for the night.',
        mode: 'single',
        triggers: [{ id: 'when-0', kind: 'time', at: '23:00', weekdays: [] }],
        conditionLogic: 'all',
        conditions: [],
        steps: [{ id: 'do-0', kind: 'control_devices', targets }],
      });
    }
  }
}
