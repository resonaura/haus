/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import {
  formatWaitDuration,
  type AutomationActionStep,
  type SceneTarget,
} from '@haus/core/transport';
import { colorToken, corners, insets, pct, px, rgba } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import {
  Box,
  HausButton,
  HausSelect,
  Pressable,
  Row,
  Stack,
  Text,
  TextInput,
  useHausUi,
} from '../../primitives/index.js';
import { GlassRim } from '../../primitives/glass-rim.js';
import { UiIcon } from '../icon.js';
import { SceneIcon } from '../scenes/artwork.js';
import { SceneTargetGrid, type SceneControllableDevice } from '../scenes/target-grid.js';
import type { AutomationEntityChoice } from './flow-blocks.js';
import { automationPillStyle, getAutomationNeutralTokens } from './theme.js';

export interface AutomationSceneChoice {
  readonly entityId: string;
  readonly name: string;
  readonly roomName: string;
  readonly icon?: string;
  readonly leadColor?: string;
}

const WAIT_PRESETS = [5, 15, 30, 60, 120, 300, 900] as const;

export function AutomationDoStepCard({
  step,
  index,
  total,
  columns = 3,
  devices,
  scenes,
  entityOptions,
  serviceOptions,
  onChange,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  readonly step: AutomationActionStep;
  readonly index: number;
  readonly total: number;
  readonly columns?: number;
  readonly devices: readonly SceneControllableDevice[];
  readonly scenes: readonly AutomationSceneChoice[];
  readonly entityOptions: readonly AutomationEntityChoice[];
  readonly serviceOptions: readonly { readonly value: string; readonly label: string }[];
  readonly onChange: (next: AutomationActionStep) => void;
  readonly onMoveUp: () => void;
  readonly onMoveDown: () => void;
  readonly onRemove: () => void;
}) {
  const { theme } = useHausUi();
  const neutral = getAutomationNeutralTokens(theme.mode);

  const stepMeta =
    step.kind === 'control_devices'
      ? { icon: 'sliders-horizontal' as const, title: 'Set Accessories' }
      : step.kind === 'activate_scene'
        ? { icon: 'sparkles' as const, title: 'Run Scene' }
        : step.kind === 'wait'
          ? { icon: 'timer' as const, title: `Wait · ${formatWaitDuration(step.seconds)}` }
          : { icon: 'zap' as const, title: 'Custom Service Action' };

  return (
    <Stack
      gapPx={12}
      dataAttrs={{ 'data-haus-glass-rim': 'managed' }}
      style={{
        layout: { width: pct(100), padding: insets(14, 16), position: 'relative', overflow: 'hidden' },
        material: new SolidMaterial(colorToken('surfaceSecondary')),
        border: { width: 1, color: colorToken('border') },
        corners: corners(22, 'superellipse', 1.4),
      }}
    >
      <Row align="center" justify="between" gapPx={8} wrap>
        <Row align="center" gapPx={10}>
          <Box
            style={{
              layout: {
                width: px(28),
                height: px(28),
                alignItems: 'center',
                justifyContent: 'center',
              },
              material: neutral.badgeSurface,
              corners: corners(999, 'round'),
            }}
          >
            <UiIcon name={stepMeta.icon} size={14} color={neutral.iconCss} />
          </Box>
          <Row align="center" gapPx={6}>
            <Text size={10.5} weight={700} tone="muted">
              {`STEP ${index + 1}`}
            </Text>
            <Text size={13} weight={600}>
              {stepMeta.title}
            </Text>
          </Row>
        </Row>

        <Row align="center" gapPx={4}>
          {total > 1 && (
            <>
              <HausButton
                variant="ghost"
                size="sm"
                disabled={index === 0}
                aria-label="Move step up"
                onPress={onMoveUp}
              >
                <UiIcon name="arrow-up" size={13} />
              </HausButton>
              <HausButton
                variant="ghost"
                size="sm"
                disabled={index === total - 1}
                aria-label="Move step down"
                onPress={onMoveDown}
              >
                <UiIcon name="arrow-down" size={13} />
              </HausButton>
            </>
          )}
          <HausButton
            variant="ghost"
            size="sm"
            aria-label="Remove step"
            onPress={onRemove}
          >
            <UiIcon name="x" size={14} />
          </HausButton>
        </Row>
      </Row>

      {step.kind === 'control_devices' && (
        <SceneTargetGrid
          entities={step.targets}
          devices={devices}
          columns={columns}
          compactHeader
          emptyTitle="Choose accessories for this step"
          emptySubtitle="Pick lights, switches, climate, covers, or locks to adjust at this step in the automation."
          removeLabel="Remove from step"
          onChange={(nextTargets) =>
            onChange({
              ...step,
              targets: nextTargets as Record<string, SceneTarget>,
            })
          }
        />
      )}

      {step.kind === 'activate_scene' && (
        <Stack gapPx={8}>
          {scenes.length > 0 ? (
            <Row gapPx={8} wrap>
              {scenes.map((scene) => {
                const selected = step.sceneEntityId === scene.entityId;
                return (
                  <Pressable
                    key={scene.entityId}
                    ariaPressed={selected}
                    onActivate={() => onChange({ ...step, sceneEntityId: scene.entityId })}
                    style={{
                      ...automationPillStyle({
                        active: selected,
                        padding: insets(8, 12),
                        cornerSpec: corners(12),
                      }),
                      layout: {
                        padding: insets(8, 12),
                        direction: 'row',
                        alignItems: 'center',
                        gap: px(8),
                      },
                    }}
                  >
                    <SceneIcon name={scene.name} icon={scene.icon} />
                    <Stack gapPx={1}>
                      <Text size={12.5} weight={600}>
                        {scene.name}
                      </Text>
                      <Text size={10.5} tone="muted">
                        {scene.roomName}
                      </Text>
                    </Stack>
                  </Pressable>
                );
              })}
            </Row>
          ) : (
            <Text size={12} tone="muted">
              No scenes created yet. Create a scene first or use Set Accessories.
            </Text>
          )}
        </Stack>
      )}

      {step.kind === 'wait' && (
        <Row align="center" gapPx={8} wrap>
          {WAIT_PRESETS.map((secs) => {
            const active = step.seconds === secs;
            return (
              <Pressable
                key={secs}
                ariaPressed={active}
                onActivate={() => onChange({ ...step, seconds: secs })}
                style={automationPillStyle({
                  active,
                  padding: insets(6, 11),
                })}
              >
                <Text size={12} weight={active ? 600 : 500}>
                  {formatWaitDuration(secs)}
                </Text>
              </Pressable>
            );
          })}
          <Row align="center" gapPx={6}>
            <Box style={{ layout: { width: px(78) } }}>
              <TextInput
                ariaLabel="Wait seconds"
                value={String(step.seconds)}
                onChange={(raw) => {
                  const n = Number(raw);
                  if (Number.isFinite(n) && n > 0) onChange({ ...step, seconds: Math.round(n) });
                }}
                style={{
                  layout: { width: pct(100), minHeight: px(32), padding: insets(4, 8) },
                  material: new SolidMaterial(colorToken('surface')),
                  border: { width: 1, color: colorToken('border') },
                  corners: corners(8),
                  typography: { size: 12, color: colorToken('textPrimary') },
                }}
              />
            </Box>
            <Text size={11.5} tone="muted">
              sec
            </Text>
          </Row>
        </Row>
      )}

      {step.kind === 'service' && (
        <Stack gapPx={8}>
          <HausSelect
            aria-label="Action service"
            value={step.service}
            options={serviceOptions}
            onChange={(service) => onChange({ ...step, service, raw: undefined })}
          />
          <HausSelect
            aria-label="Target entity"
            value={step.entityId}
            options={entityOptions}
            onChange={(entityId) => onChange({ ...step, entityId, raw: undefined })}
          />
        </Stack>
      )}
      <GlassRim preset="card" variant="card" opacity={0.46} />
    </Stack>
  );
}

export function AutomationAddStepPalette({
  hasScenes,
  onAddControlDevices,
  onAddScene,
  onAddWait,
  onAddService,
}: {
  readonly hasScenes: boolean;
  readonly onAddControlDevices: () => void;
  readonly onAddScene: () => void;
  readonly onAddWait: () => void;
  readonly onAddService: () => void;
}) {
  return (
    <Stack
      gapPx={8}
      style={{
        layout: { width: pct(100), padding: insets(12, 14) },
        material: new SolidMaterial(rgba(128, 128, 128, 0.06)),
        border: { width: 1, color: colorToken('border') },
        corners: corners(16, 'superellipse', 1.4),
      }}
    >
      <Text size={11} weight={700} tone="muted">
        ADD ACTION
      </Text>
      <Row gapPx={8} wrap>
        <HausButton
          id="automation-add-actions"
          variant="secondary"
          size="sm"
          onPress={onAddControlDevices}
        >
          <UiIcon name="sliders-horizontal" size={13} />
          <Text size={12}>Set Accessories</Text>
        </HausButton>
        {hasScenes && (
          <HausButton
            id="automation-add-scene"
            variant="secondary"
            size="sm"
            onPress={onAddScene}
          >
            <UiIcon name="sparkles" size={13} />
            <Text size={12}>Run Scene</Text>
          </HausButton>
        )}
        <HausButton
          id="automation-add-wait"
          variant="secondary"
          size="sm"
          onPress={onAddWait}
        >
          <UiIcon name="timer" size={13} />
          <Text size={12}>Wait</Text>
        </HausButton>
        <HausButton
          id="automation-add-service"
          variant="ghost"
          size="sm"
          onPress={onAddService}
        >
          <UiIcon name="zap" size={13} />
          <Text size={12}>Custom Service</Text>
        </HausButton>
      </Row>
    </Stack>
  );
}
