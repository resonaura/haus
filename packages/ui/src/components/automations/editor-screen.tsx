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
  HausSegmentedControl,
  HausTextArea,
  Heading,
  Pressable,
  Row,
  Stack,
  Text,
  TextInput,
  useHausUi,
} from '../../primitives/index.js';
import { GlassRim } from '../../primitives/glass-rim.js';
import { resolveColorToCss } from '../../renderers/contract.js';
import { DeviceTileIconOrb } from '../devices/tile-effects.js';
import { getDeviceTileTokens } from '../devices/tile-theme.js';
import { UiIcon } from '../icon.js';
import type { SceneControllableDevice } from '../scenes/target-grid.js';
import type { AutomationEntityChoice } from './flow-blocks.js';
import { AutomationFlowCanvas } from './flow-canvas.js';
import type { AutomationSceneChoice } from './step-cards.js';
import { automationPillStyle } from './theme.js';
import type { AutomationButtonControllerChoice } from './when-event-controls.js';

export interface AutomationEditorScreenProps {
  readonly editing: boolean;
  readonly demo: boolean;
  readonly loading: boolean;
  readonly busy: boolean;
  readonly canDelete: boolean;
  readonly advanced: boolean;
  readonly columns?: number;
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
}

/**
 * Full-page Automation Editor screen (replaces modal dialog on the Automations page),
 * matching Haus's detail-screen motion, back-bar navigation, and GlassRim surfaces.
 */
export function AutomationEditorScreen({
  editing,
  demo,
  loading,
  busy,
  canDelete,
  advanced,
  columns = 3,
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
}: AutomationEditorScreenProps) {
  const { theme } = useHausUi();
  const tileTokens = getDeviceTileTokens(theme.mode);
  const draft = parseAutomationFlow(config, { resolveDeviceEventEntity });
  const summary = describeAutomationCard(config, draft.alias || 'New automation');

  const commitDraft = (nextDraft: AutomationFlowDraft) => {
    onConfigChange(compileAutomationFlow(nextDraft, { targetPlatform }));
  };

  return (
    <Box
      motion={{
        initial: { opacity: 0, x: 12 },
        animate: { opacity: 1, x: 0 },
        durationMs: 220,
        ease: [0.2, 0.7, 0.2, 1],
      }}
      style={{ layout: { width: pct(100), flexShrink: 0 } }}
    >
      <Stack gapPx={18} style={{ layout: { width: pct(100) } }}>
        <Row align="center" justify="between" gapPx={12} wrap style={{ layout: { width: pct(100) } }}>
          <HausButton
            id="automation-editor-back"
            variant="ghost"
            size="sm"
            onPress={onRequestClose}
          >
            <Row align="center" gapPx={6}>
              <UiIcon name="arrow-left" size={15} />
              <Text size={12.5}>All automations</Text>
            </Row>
          </HausButton>

          <Row align="center" gapPx={8} wrap>
            <Box style={{ layout: { width: px(220) } }}>
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

            {onTestActions && (
              <HausButton
                id="config-editor-test"
                variant="secondary"
                size="sm"
                disabled={demo || busy || draft.steps.length === 0}
                onPress={onTestActions}
              >
                <UiIcon name="play" size={13} />
                <Text size={12}>Test actions</Text>
              </HausButton>
            )}

            {canDelete && (
              <HausButton
                id="config-editor-delete"
                variant="danger"
                size="sm"
                disabled={busy}
                onPress={onRequestDelete}
              >
                <Text size={12}>Delete</Text>
              </HausButton>
            )}

            <HausButton
              id="config-editor-cancel"
              variant="ghost"
              size="sm"
              onPress={onRequestClose}
            >
              <Text size={12}>Cancel</Text>
            </HausButton>

            <HausButton
              id="config-editor-save"
              variant="primary"
              size="sm"
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

        {confirmDiscard && (
          <Row
            role="alert"
            align="center"
            justify="between"
            gapPx={10}
            wrap
            style={{
              layout: { width: pct(100), padding: insets(12, 16) },
              material: new SolidMaterial(colorToken('surfaceSecondary')),
              border: { width: 1, color: colorToken('border') },
              corners: corners(14),
            }}
          >
            <Text size={12.5}>Discard unsaved automation changes?</Text>
            <Row gapPx={8}>
              <HausButton
                id="automation-discard-confirm"
                variant="danger"
                size="sm"
                onPress={onConfirmDiscard}
              >
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
              layout: { width: pct(100), padding: insets(12, 16) },
              material: new SolidMaterial(colorToken('surfaceSecondary')),
              border: { width: 1, color: colorToken('border') },
              corners: corners(14),
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

        {(error || testMessage) && (
          <Row align="center" justify="between" gapPx={10} wrap>
            {error ? (
              <Text role="alert" tone="critical" size={12.5}>
                {error}
              </Text>
            ) : (
              <Text size={12} tone="muted">
                {testMessage}
              </Text>
            )}
          </Row>
        )}

        {loading ? (
          <Text size={13} tone="muted" role="status">
            Loading automation…
          </Text>
        ) : (
          <>
            <Stack
              gapPx={12}
              dataAttrs={{ 'data-haus-glass-rim': 'managed' }}
              style={{
                layout: {
                  width: pct(100),
                  padding: insets(18, 20),
                  position: 'relative',
                  overflow: 'hidden',
                },
                material: new SolidMaterial(colorToken('surfaceSecondary')),
                border: { width: 1, color: colorToken('border') },
                corners: corners(22, 'superellipse', 1.4),
              }}
            >
              <Row align="center" justify="between" gapPx={10} wrap style={{ layout: { zIndex: 1 } }}>
                <Row align="center" gapPx={10}>
                  <Heading level={2} size={17} weight={600}>
                    {editing ? 'Edit automation' : 'New automation'}
                  </Heading>
                  <Text size={11} weight={600} tone="muted">
                    WHEN → IF → DO
                  </Text>
                </Row>
                {!editing && (
                  <Text size={11.5} tone="muted">
                    Saved paused initially so you can enable it when ready.
                  </Text>
                )}
              </Row>

              <Row align="center" gapPx={14} wrap style={{ layout: { width: pct(100), zIndex: 1 } }}>
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
                <Stack gapPx={6} style={{ layout: { flexGrow: 1, minWidth: px(240) } }}>
                  <TextInput
                    id="config-editor-name"
                    ariaLabel="Automation name"
                    required
                    value={draft.alias}
                    placeholder="Switch Press, Good Morning, Sunset Glow…"
                    onChange={(alias) => commitDraft({ ...draft, alias })}
                    style={{
                      layout: { width: pct(100), minHeight: px(38), padding: insets(6, 12) },
                      material: new SolidMaterial(colorToken('surface')),
                      border: { width: 1, color: colorToken('border') },
                      corners: corners(11),
                      typography: { size: 14.5, weight: 600, color: colorToken('textPrimary') },
                    }}
                  />
                  <TextInput
                    id="config-editor-description"
                    ariaLabel="Automation note"
                    value={draft.description}
                    placeholder="Optional note about what this automation does"
                    onChange={(description) => commitDraft({ ...draft, description })}
                    style={{
                      layout: { width: pct(100), minHeight: px(32), padding: insets(4, 12) },
                      material: new SolidMaterial(colorToken('surface')),
                      border: { width: 1, color: colorToken('border') },
                      corners: corners(10),
                      typography: { size: 12, color: colorToken('textSecondary') },
                    }}
                  />
                </Stack>
              </Row>

              {!editing && onApplyTemplate && (
                <Row align="center" gapPx={6} wrap style={{ layout: { zIndex: 1 } }}>
                  <Text size={11} weight={600} tone="muted">
                    Templates:
                  </Text>
                  {AUTOMATION_STARTER_TEMPLATES.map((tpl) => (
                    <Pressable
                      key={tpl.id}
                      onActivate={() => onApplyTemplate(tpl.id)}
                      style={automationPillStyle({
                        active: false,
                        padding: insets(5, 10),
                        restToken: 'surface',
                      })}
                    >
                      <Text size={11.5} weight={500}>
                        {tpl.title}
                      </Text>
                    </Pressable>
                  ))}
                </Row>
              )}

              <GlassRim preset="card" variant="card" opacity={0.52} />
            </Stack>

            {advanced ? (
              <HausTextArea
                id="config-editor-json"
                label="Complete automation configuration"
                rows={16}
                value={jsonText}
                error={jsonError}
                onChange={onJsonChange}
              />
            ) : (
              <AutomationFlowCanvas
                draft={draft}
                columns={columns}
                devices={devices}
                scenes={scenes}
                entityOptions={entityOptions}
                buttonControllers={buttonControllers}
                targetPlatform={targetPlatform}
                serviceOptions={serviceOptions}
                onCommitDraft={commitDraft}
              />
            )}
          </>
        )}
      </Stack>
    </Box>
  );
}
