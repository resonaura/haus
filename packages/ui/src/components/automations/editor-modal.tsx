/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import {
  AUTOMATION_STARTER_TEMPLATES,
  compileAutomationFlow,
  describeAutomationCard,
  parseAutomationFlow,
  type AutomationFlowDraft,
  type EditableConfig,
  type ParseAutomationFlowOptions,
} from '@haus/core/transport';
import { colorToken, corners, insets, pct, px } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import {
  Box,
  HausButton,
  HausDialog,
  HausSegmentedControl,
  HausTextArea,
  Pressable,
  Row,
  Stack,
  Text,
  TextInput,
  useHausUi,
} from '../../primitives/index.js';
import { resolveColorToCss } from '../../renderers/contract.js';
import { DeviceTileIconOrb } from '../devices/tile-effects.js';
import { getDeviceTileTokens } from '../devices/tile-theme.js';
import { UiIcon } from '../icon.js';
import type { SceneControllableDevice } from '../scenes/target-grid.js';
import type { AutomationEntityChoice } from './flow-blocks.js';
import { AutomationFlowCanvas } from './flow-canvas.js';
import type { AutomationSceneChoice } from './step-cards.js';
import type { AutomationButtonControllerChoice } from './when-event-controls.js';

export function AutomationEditorModal({
  editing,
  demo,
  loading,
  busy,
  canDelete,
  advanced,
  error,
  jsonText,
  jsonError,
  testMessage,
  confirmDiscard,
  confirmDelete,
  config,
  devices,
  scenes,
  entityOptions,
  buttonControllers = [],
  targetPlatform = 'hub',
  resolveDeviceEventEntity,
  serviceOptions,
  onSetAdvanced,
  onConfigChange,
  onApplyTemplate,
  onJsonChange,
  onTestActions,
  onRequestClose,
  onConfirmDiscard,
  onCancelDiscard,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
  onSave,
}: {
  readonly editing: boolean;
  readonly demo: boolean;
  readonly loading: boolean;
  readonly busy: boolean;
  readonly canDelete: boolean;
  readonly advanced: boolean;
  readonly error?: string;
  readonly jsonText: string;
  readonly jsonError?: string;
  readonly testMessage?: string;
  readonly confirmDiscard: boolean;
  readonly confirmDelete: boolean;
  readonly config: EditableConfig;
  readonly devices: readonly SceneControllableDevice[];
  readonly scenes: readonly AutomationSceneChoice[];
  readonly entityOptions: readonly AutomationEntityChoice[];
  readonly buttonControllers?: readonly AutomationButtonControllerChoice[];
  readonly targetPlatform?: 'hub' | 'ha';
  readonly resolveDeviceEventEntity?: ParseAutomationFlowOptions['resolveDeviceEventEntity'];
  readonly serviceOptions: readonly { readonly value: string; readonly label: string }[];
  readonly onSetAdvanced: (advanced: boolean) => void;
  readonly onConfigChange: (next: EditableConfig) => void;
  readonly onApplyTemplate?: (templateId: string) => void;
  readonly onJsonChange: (raw: string) => void;
  readonly onTestActions?: () => void;
  readonly onRequestClose: () => void;
  readonly onConfirmDiscard: () => void;
  readonly onCancelDiscard: () => void;
  readonly onRequestDelete: () => void;
  readonly onConfirmDelete: () => void;
  readonly onCancelDelete: () => void;
  readonly onSave: () => void;
}) {
  const { theme } = useHausUi();
  const tileTokens = getDeviceTileTokens(theme.mode);
  const draft = parseAutomationFlow(config, { resolveDeviceEventEntity });
  const summary = describeAutomationCard(config, draft.alias || 'New automation');

  const commitDraft = (nextDraft: AutomationFlowDraft) => {
    onConfigChange(compileAutomationFlow(nextDraft, { targetPlatform }));
  };

  return (
    <HausDialog
      size="lg"
      title={editing ? 'Edit automation' : 'New automation'}
      subtitle="AUTOMATION FLOW · WHEN -> IF -> DO"
      scrollable
      onClose={onRequestClose}
      footer={
        <Row align="center" justify="between" gapPx={10} style={{ layout: { width: pct(100) } }}>
          <Row align="center" gapPx={8}>
            {canDelete && (
              <HausButton
                id="config-editor-delete"
                variant="danger"
                disabled={busy}
                onPress={onRequestDelete}
              >
                <Text size={12.5}>Delete</Text>
              </HausButton>
            )}
            {onTestActions && (
              <HausButton
                id="config-editor-test"
                variant="secondary"
                disabled={demo || busy || draft.steps.length === 0}
                onPress={onTestActions}
              >
                <UiIcon name="play" size={13} />
                <Text size={12.5}>Test actions</Text>
              </HausButton>
            )}
          </Row>
          <Row align="center" gapPx={8}>
            <HausButton id="config-editor-cancel" variant="ghost" onPress={onRequestClose}>
              <Text size={12.5}>Cancel</Text>
            </HausButton>
            <HausButton
              id="config-editor-save"
              variant="primary"
              isPending={busy}
              disabled={busy}
              onPress={onSave}
            >
              <Text
                size={12.5}
                style={{ typography: { color: colorToken('accentForeground'), weight: 600 } }}
              >
                {demo ? 'Connect to save' : 'Save automation'}
              </Text>
            </HausButton>
          </Row>
        </Row>
      }
    >
      {loading ? (
        <Text size={13} tone="muted" role="status">
          Loading automation…
        </Text>
      ) : (
        <Stack gapPx={14} style={{ layout: { width: pct(100) } }}>
          <Stack
            gapPx={10}
            style={{
              layout: { width: pct(100), padding: insets(14, 16) },
              material: new SolidMaterial(colorToken('surfaceSecondary')),
              border: { width: 1, color: colorToken('border') },
              corners: corners(20, 'superellipse', 1.4),
            }}
          >
            <Row align="center" gapPx={12} wrap>
              <DeviceTileIconOrb
                active={Boolean(draft.alias.trim())}
                deviceColor={tileTokens.deviceNeutral}
                ariaLabel="Automation icon"
                renderIcon={(orbColor) => (
                  <UiIcon
                    name={summary.iconHint}
                    size={19}
                    color={resolveColorToCss(orbColor, theme, false)}
                  />
                )}
              />
              <Stack gapPx={6} style={{ layout: { flexGrow: 1, minWidth: px(220) } }}>
                <TextInput
                  id="config-editor-name"
                  ariaLabel="Automation name"
                  required
                  value={draft.alias}
                  placeholder="Switch Press, Good Morning, Sunset Glow…"
                  onChange={(alias) => commitDraft({ ...draft, alias })}
                  style={{
                    layout: { width: pct(100), minHeight: px(36), padding: insets(6, 10) },
                    material: new SolidMaterial(colorToken('surface')),
                    border: { width: 1, color: colorToken('border') },
                    corners: corners(10),
                    typography: { size: 14, weight: 600, color: colorToken('textPrimary') },
                  }}
                />
                <TextInput
                  id="config-editor-description"
                  ariaLabel="Automation note"
                  value={draft.description}
                  placeholder="Optional note about what this automation does"
                  onChange={(description) => commitDraft({ ...draft, description })}
                  style={{
                    layout: { width: pct(100), minHeight: px(32), padding: insets(4, 10) },
                    material: new SolidMaterial(colorToken('surface')),
                    border: { width: 1, color: colorToken('border') },
                    corners: corners(9),
                    typography: { size: 12, color: colorToken('textSecondary') },
                  }}
                />
              </Stack>
            </Row>

            {!editing && (
              <Text size={11.5} tone="muted">
                New automations are saved paused so you can enable them whenever you are ready.
              </Text>
            )}
          </Stack>

          {!editing && onApplyTemplate && draft.triggers.length === 0 && draft.steps.length === 0 && (
            <Row align="center" gapPx={6} wrap>
              <Text size={11} weight={600} tone="muted">
                Quick start:
              </Text>
              {AUTOMATION_STARTER_TEMPLATES.map((tpl) => (
                <Pressable
                  key={tpl.id}
                  onActivate={() => onApplyTemplate(tpl.id)}
                  style={{
                    layout: { padding: insets(5, 10) },
                    material: new SolidMaterial(colorToken('surfaceSecondary')),
                    border: { width: 1, color: colorToken('border') },
                    corners: corners(999, 'round'),
                  }}
                >
                  <Text size={11.5} weight={500}>
                    {tpl.title}
                  </Text>
                </Pressable>
              ))}
            </Row>
          )}

          <Row align="center" justify="between" gapPx={10} wrap>
            <Box style={{ layout: { width: px(250) } }}>
              <HausSegmentedControl
                id="config-editor-mode"
                value={advanced ? 'advanced' : 'visual'}
                options={[
                  { value: 'visual', label: 'Visual Flow' },
                  { value: 'advanced', label: 'JSON Config' },
                ]}
                onChange={(val) => onSetAdvanced(val === 'advanced')}
              />
            </Box>
            {testMessage && (
              <Text size={11.5} tone="muted">
                {testMessage}
              </Text>
            )}
          </Row>

          {advanced ? (
            <HausTextArea
              id="config-editor-json"
              label="Complete automation configuration"
              rows={12}
              value={jsonText}
              error={jsonError}
              onChange={onJsonChange}
            />
          ) : (
            <AutomationFlowCanvas
              draft={draft}
              devices={devices}
              scenes={scenes}
              entityOptions={entityOptions}
              buttonControllers={buttonControllers}
              targetPlatform={targetPlatform}
              serviceOptions={serviceOptions}
              onCommitDraft={commitDraft}
            />
          )}

          {error && (
            <Text role="alert" tone="critical" size={12.5}>
              {error}
            </Text>
          )}

          {confirmDiscard && (
            <Row
              role="alert"
              align="center"
              justify="between"
              gapPx={10}
              wrap
              style={{
                layout: { padding: insets(12, 14) },
                material: new SolidMaterial(colorToken('surfaceSecondary')),
                border: { width: 1, color: colorToken('border') },
                corners: corners(12),
              }}
            >
              <Text size={12.5}>Discard unsaved automation changes?</Text>
              <Row gapPx={8}>
                <HausButton variant="danger" size="sm" onPress={onConfirmDiscard}>
                  <Text size={12}>Discard</Text>
                </HausButton>
                <HausButton variant="ghost" size="sm" onPress={onCancelDiscard}>
                  <Text size={12}>Keep editing</Text>
                </HausButton>
              </Row>
            </Row>
          )}

          {confirmDelete && (
            <Row
              role="alert"
              align="center"
              justify="between"
              gapPx={10}
              wrap
              style={{
                layout: { padding: insets(12, 14) },
                material: new SolidMaterial(colorToken('surfaceSecondary')),
                border: { width: 1, color: colorToken('border') },
                corners: corners(12),
              }}
            >
              <Text size={12.5}>{`Delete "${draft.alias || 'automation'}" permanently?`}</Text>
              <Row gapPx={8}>
                <HausButton
                  variant="danger"
                  size="sm"
                  disabled={busy}
                  onPress={onConfirmDelete}
                >
                  <Text size={12}>Delete permanently</Text>
                </HausButton>
                <HausButton variant="ghost" size="sm" onPress={onCancelDelete}>
                  <Text size={12}>Keep</Text>
                </HausButton>
              </Row>
            </Row>
          )}
        </Stack>
      )}
    </HausDialog>
  );
}
