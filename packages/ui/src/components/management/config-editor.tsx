/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { colorToken, corners, insets, pct } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import {
  Box,
  HausButton,
  HausDialog,
  HausSegmentedControl,
  HausSelect,
  HausTextArea,
  Row,
  Stack,
  Text,
  TextInput,
} from '../../primitives/index.js';
import { UiIcon } from '../icon.js';
import {
  AutomationBlockList,
  SceneVisualSection,
  editorInputStyle,
  type PortableAutomationBlock,
  type PortableOptionItem,
  type PortableSceneAccessoryOption,
} from './config-editor-sections.js';

export function PortableConfigEditorModal({
  kind,
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
  nameValue,
  descriptionValue,
  modeValue,
  sceneIcon,
  sceneSearch,
  sceneAccessories,
  sceneTargets,
  triggers,
  conditions,
  actions,
  entityOptions,
  serviceOptions,
  onSetAdvanced,
  onNameChange,
  onDescriptionChange,
  onModeChange,
  onJsonChange,
  onSceneIconChange,
  onSceneSearchChange,
  onToggleAccessory,
  onToggleTargetState,
  onChangeBrightness,
  onAddBlock,
  onRemoveBlock,
  onUpdateBlock,
  onTestScene,
  onRequestClose,
  onConfirmDiscard,
  onCancelDiscard,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
  onSave,
}: {
  readonly kind: 'scene' | 'automation';
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
  readonly nameValue: string;
  readonly descriptionValue: string;
  readonly modeValue: string;
  readonly sceneIcon?: string;
  readonly sceneSearch: string;
  readonly sceneAccessories: readonly PortableSceneAccessoryOption[];
  readonly sceneTargets: Readonly<Record<string, { readonly on: boolean; readonly brightness?: number }>>;
  readonly triggers: readonly PortableAutomationBlock[];
  readonly conditions: readonly PortableAutomationBlock[];
  readonly actions: readonly PortableAutomationBlock[];
  readonly entityOptions: readonly PortableOptionItem[];
  readonly serviceOptions: readonly PortableOptionItem[];
  readonly onSetAdvanced: (advanced: boolean) => void;
  readonly onNameChange: (value: string) => void;
  readonly onDescriptionChange: (value: string) => void;
  readonly onModeChange: (value: string) => void;
  readonly onJsonChange: (value: string) => void;
  readonly onSceneIconChange: (icon: string) => void;
  readonly onSceneSearchChange: (value: string) => void;
  readonly onToggleAccessory: (entityId: string) => void;
  readonly onToggleTargetState: (entityId: string, on: boolean) => void;
  readonly onChangeBrightness: (entityId: string, pctValue: number) => void;
  readonly onAddBlock: (kind: 'triggers' | 'conditions' | 'actions') => void;
  readonly onRemoveBlock: (kind: 'triggers' | 'conditions' | 'actions', index: number) => void;
  readonly onUpdateBlock: (
    kind: 'triggers' | 'conditions' | 'actions',
    index: number,
    next: PortableAutomationBlock,
  ) => void;
  readonly onTestScene: () => void;
  readonly onRequestClose: () => void;
  readonly onConfirmDiscard: () => void;
  readonly onCancelDiscard: () => void;
  readonly onRequestDelete: () => void;
  readonly onConfirmDelete: () => void;
  readonly onCancelDelete: () => void;
  readonly onSave: () => void;
}) {
  return (
    <HausDialog
      size="lg"
      title={`${editing ? 'Edit' : 'New'} ${kind}`}
      scrollable
      onClose={onRequestClose}
      footer={
        <Row align="center" justify="between" gapPx={10} style={{ layout: { width: pct(100) } }}>
          <Box>
            {canDelete && (
              <HausButton id="config-editor-delete" variant="danger" disabled={busy} onPress={onRequestDelete}>
                <Text size={12.5}>Delete</Text>
              </HausButton>
            )}
          </Box>
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
              <Text size={12.5} style={{ typography: { color: colorToken('accentForeground'), weight: 600 } }}>
                {demo ? 'Connect to save' : 'Save'}
              </Text>
            </HausButton>
          </Row>
        </Row>
      }
    >
      {loading ? (
        <Text size={13} tone="muted" role="status">
          Loading configuration…
        </Text>
      ) : (
        <Stack gapPx={14} style={{ layout: { width: pct(100) } }}>
          <Stack gapPx={6}>
            <Text size={12} weight={600} tone="muted">
              Name
            </Text>
            <TextInput
              id="config-editor-name"
              ariaLabel="Name"
              required
              value={nameValue}
              placeholder={kind === 'scene' ? 'Evening glow' : 'Turn lights on at sunset'}
              onChange={onNameChange}
              style={editorInputStyle}
            />
          </Stack>

          {kind === 'automation' && !editing && (
            <Text size={12} tone="muted">
              New automations are saved paused. Enable one when you are ready.
            </Text>
          )}

          <HausSegmentedControl
            id="config-editor-mode"
            value={advanced ? 'advanced' : 'visual'}
            options={[
              { value: 'visual', label: kind === 'scene' ? 'Accessories' : 'Visual editor' },
              { value: 'advanced', label: kind === 'scene' ? 'Advanced' : 'Configuration' },
            ]}
            onChange={(value) => onSetAdvanced(value === 'advanced')}
          />

          {advanced ? (
            <HausTextArea
              id="config-editor-json"
              label="Complete configuration"
              rows={10}
              value={jsonText}
              error={jsonError}
              onChange={onJsonChange}
            />
          ) : kind === 'scene' ? (
            <>
              <SceneVisualSection
                icon={sceneIcon}
                search={sceneSearch}
                accessories={sceneAccessories}
                selectedTargets={sceneTargets}
                onIconChange={onSceneIconChange}
                onSearchChange={onSceneSearchChange}
                onToggleAccessory={onToggleAccessory}
                onToggleTargetState={onToggleTargetState}
                onChangeBrightness={onChangeBrightness}
              />
              <Row align="center" gapPx={10} wrap>
                <HausButton
                  id="config-editor-test"
                  variant="secondary"
                  size="sm"
                  disabled={demo || busy || Object.keys(sceneTargets).length === 0}
                  onPress={onTestScene}
                >
                  <UiIcon name="play" size={14} />
                  <Text size={12}>Test this scene</Text>
                </HausButton>
                <Text size={11.5} tone="muted">
                  {testMessage || 'Editing changes the draft. Testing applies these settings now.'}
                </Text>
              </Row>
            </>
          ) : (
            <Stack gapPx={14}>
              <Stack gapPx={6}>
                <Text size={12} weight={600} tone="muted">
                  Description
                </Text>
                <TextInput
                  id="config-editor-description"
                  ariaLabel="Description"
                  value={descriptionValue}
                  placeholder="Optional note for this automation"
                  onChange={onDescriptionChange}
                  style={editorInputStyle}
                />
              </Stack>
              {(['triggers', 'conditions', 'actions'] as const).map((blockKind) => (
                <AutomationBlockList
                  key={blockKind}
                  kind={blockKind}
                  blocks={
                    blockKind === 'triggers' ? triggers : blockKind === 'conditions' ? conditions : actions
                  }
                  entityOptions={entityOptions}
                  serviceOptions={serviceOptions}
                  onAdd={() => onAddBlock(blockKind)}
                  onRemove={(index) => onRemoveBlock(blockKind, index)}
                  onUpdate={(index, next) => onUpdateBlock(blockKind, index, next)}
                />
              ))}
              <Stack gapPx={6}>
                <Text size={12} weight={600} tone="muted">
                  When already running
                </Text>
                <HausSelect
                  id="config-editor-run-mode"
                  aria-label="When already running"
                  value={modeValue}
                  options={['single', 'restart', 'queued', 'parallel'].map((mode) => ({
                    value: mode,
                    label: mode,
                  }))}
                  onChange={onModeChange}
                />
              </Stack>
            </Stack>
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
                layout: { padding: insets(12) },
                material: new SolidMaterial(colorToken('surfaceSecondary')),
                border: { width: 1, color: colorToken('border') },
                corners: corners(12),
              }}
            >
              <Text size={12.5}>Discard unsaved changes?</Text>
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
                layout: { padding: insets(12) },
                material: new SolidMaterial(colorToken('surfaceSecondary')),
                border: { width: 1, color: colorToken('border') },
                corners: corners(12),
              }}
            >
              <Text size={12.5}>{`Delete "${nameValue || kind}" from Haus Hub?`}</Text>
              <Row gapPx={8}>
                <HausButton variant="danger" size="sm" disabled={busy} onPress={onConfirmDelete}>
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
