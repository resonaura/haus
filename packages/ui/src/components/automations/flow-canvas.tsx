/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { Fragment } from 'react';
import type { AutomationFlowDraft, AutomationRunMode } from '@haus/core/transport';
import { colorToken, corners, insets, pct } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import { HausButton, Pressable, Row, Stack, Text } from '../../primitives/index.js';
import { UiIcon } from '../icon.js';
import type { SceneControllableDevice } from '../scenes/target-grid.js';
import {
  AutomationFlowSpine,
  AutomationWhenCard,
  type AutomationEntityChoice,
} from './flow-blocks.js';
import { AutomationIfSection } from './if-section.js';
import {
  AutomationAddStepPalette,
  AutomationDoStepCard,
  type AutomationSceneChoice,
} from './step-cards.js';
import type { AutomationButtonControllerChoice } from './when-event-controls.js';

const RUN_MODES: readonly { readonly id: AutomationRunMode; readonly label: string }[] = [
  { id: 'single', label: 'Single' },
  { id: 'restart', label: 'Restart' },
  { id: 'queued', label: 'Queued' },
  { id: 'parallel', label: 'Parallel' },
];

export function AutomationFlowCanvas({
  draft,
  columns = 3,
  devices,
  scenes,
  entityOptions,
  buttonControllers = [],
  targetPlatform = 'hub',
  serviceOptions,
  onCommitDraft,
}: {
  readonly draft: AutomationFlowDraft;
  readonly columns?: number;
  readonly devices: readonly SceneControllableDevice[];
  readonly scenes: readonly AutomationSceneChoice[];
  readonly entityOptions: readonly AutomationEntityChoice[];
  readonly buttonControllers?: readonly AutomationButtonControllerChoice[];
  readonly targetPlatform?: 'hub' | 'ha';
  readonly serviceOptions: readonly { readonly value: string; readonly label: string }[];
  readonly onCommitDraft: (next: AutomationFlowDraft) => void;
}) {
  const defaultTrigger = {
    id: 'when-0',
    kind: 'sun' as const,
    event: 'sunset' as const,
    offsetMinutes: 0,
  };
  const visibleTriggers = draft.triggers.length > 0 ? draft.triggers : [defaultTrigger];

  return (
    <Stack gapPx={4} style={{ layout: { width: pct(100) } }}>
      {visibleTriggers.map((trigger, idx) => (
        <Fragment key={trigger.id}>
          {idx > 0 && <AutomationFlowSpine label="OR" />}
          <AutomationWhenCard
            trigger={trigger}
            index={idx}
            canRemove={visibleTriggers.length > 1}
            entityOptions={entityOptions}
            buttonControllers={buttonControllers}
            targetPlatform={targetPlatform}
            onChange={(nextTrigger) =>
              onCommitDraft({
                ...draft,
                triggers: visibleTriggers.map((item, i) => (i === idx ? nextTrigger : item)),
              })
            }
            onRemove={() =>
              onCommitDraft({
                ...draft,
                triggers: visibleTriggers.filter((_, i) => i !== idx),
              })
            }
          />
        </Fragment>
      ))}

      <Row align="center" gapPx={8} style={{ layout: { padding: insets(2, 0, 2, 8) } }}>
        <HausButton
          id="automation-add-triggers"
          variant="ghost"
          size="sm"
          onPress={() =>
            onCommitDraft({
              ...draft,
              triggers: [
                ...visibleTriggers,
                { id: `when-${Date.now()}`, kind: 'time', at: '08:00', weekdays: [] },
              ],
            })
          }
        >
          <UiIcon name="plus" size={13} />
          <Text size={11.5} tone="muted">
            Add alternative trigger
          </Text>
        </HausButton>
      </Row>

      <AutomationFlowSpine />

      <AutomationIfSection
        conditions={draft.conditions}
        logic={draft.conditionLogic}
        entityOptions={entityOptions}
        onLogicChange={(conditionLogic) => onCommitDraft({ ...draft, conditionLogic })}
        onAddCondition={() =>
          onCommitDraft({
            ...draft,
            conditions: [
              ...draft.conditions,
              { id: `if-${Date.now()}`, kind: 'sun', after: 'sunset', before: 'sunrise' },
            ],
          })
        }
        onUpdateCondition={(idx, nextCond) =>
          onCommitDraft({
            ...draft,
            conditions: draft.conditions.map((c, i) => (i === idx ? nextCond : c)),
          })
        }
        onRemoveCondition={(idx) =>
          onCommitDraft({
            ...draft,
            conditions: draft.conditions.filter((_, i) => i !== idx),
          })
        }
      />

      <AutomationFlowSpine label="DO" />

      {draft.steps.map((step, idx) => (
        <Fragment key={step.id}>
          {idx > 0 && <AutomationFlowSpine />}
          <AutomationDoStepCard
            step={step}
            index={idx}
            total={draft.steps.length}
            columns={columns}
            devices={devices}
            scenes={scenes}
            entityOptions={entityOptions}
            serviceOptions={serviceOptions}
            onChange={(nextStep) =>
              onCommitDraft({
                ...draft,
                steps: draft.steps.map((s, i) => (i === idx ? nextStep : s)),
              })
            }
            onMoveUp={() => {
              if (idx === 0) return;
              const next = [...draft.steps];
              [next[idx - 1], next[idx]] = [next[idx]!, next[idx - 1]!];
              onCommitDraft({ ...draft, steps: next });
            }}
            onMoveDown={() => {
              if (idx >= draft.steps.length - 1) return;
              const next = [...draft.steps];
              [next[idx], next[idx + 1]] = [next[idx + 1]!, next[idx]!];
              onCommitDraft({ ...draft, steps: next });
            }}
            onRemove={() =>
              onCommitDraft({
                ...draft,
                steps: draft.steps.filter((_, i) => i !== idx),
              })
            }
          />
        </Fragment>
      ))}

      {draft.steps.length > 0 && <AutomationFlowSpine />}

      <AutomationAddStepPalette
        hasScenes={scenes.length > 0}
        onAddControlDevices={() =>
          onCommitDraft({
            ...draft,
            triggers: visibleTriggers,
            steps: [...draft.steps, { id: `do-${Date.now()}`, kind: 'control_devices', targets: {} }],
          })
        }
        onAddScene={() =>
          onCommitDraft({
            ...draft,
            triggers: visibleTriggers,
            steps: [
              ...draft.steps,
              {
                id: `do-${Date.now()}`,
                kind: 'activate_scene',
                sceneEntityId: scenes[0]?.entityId ?? '',
              },
            ],
          })
        }
        onAddWait={() =>
          onCommitDraft({
            ...draft,
            steps: [...draft.steps, { id: `do-${Date.now()}`, kind: 'wait', seconds: 30 }],
          })
        }
        onAddService={() =>
          onCommitDraft({
            ...draft,
            steps: [
              ...draft.steps,
              {
                id: `do-${Date.now()}`,
                kind: 'service',
                service: serviceOptions[0]?.value ?? 'light.turn_on',
                entityId: entityOptions[0]?.value ?? '',
              },
            ],
          })
        }
      />

      <Row
        align="center"
        justify="between"
        gapPx={10}
        wrap
        style={{ layout: { width: pct(100), padding: insets(10, 4, 0, 4) } }}
      >
        <Text size={11.5} weight={600} tone="muted">
          When already running
        </Text>
        <Row gapPx={6} wrap>
          {RUN_MODES.map((m) => {
            const active = draft.mode === m.id;
            return (
              <Pressable
                key={m.id}
                ariaPressed={active}
                onActivate={() => onCommitDraft({ ...draft, mode: m.id })}
                style={{
                  layout: { padding: insets(4, 10) },
                  material: new SolidMaterial(
                    active ? colorToken('surfaceActive') : colorToken('surfaceSecondary'),
                  ),
                  border: {
                    width: 1,
                    color: active ? colorToken('accent') : colorToken('border'),
                  },
                  corners: corners(999, 'round'),
                }}
              >
                <Text size={11.5} weight={active ? 600 : 500}>
                  {m.label}
                </Text>
              </Pressable>
            );
          })}
        </Row>
      </Row>
    </Stack>
  );
}
