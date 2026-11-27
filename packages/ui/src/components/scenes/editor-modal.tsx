/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useState } from 'react';
import { colorToken, corners, insets, pct, px, rgba } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import {
  Box,
  HausButton,
  HausDialog,
  HausSegmentedControl,
  HausSelect,
  HausTextArea,
  Pressable,
  Row,
  Stack,
  Text,
  TextInput,
} from '../../primitives/index.js';
import { UiIcon } from '../icon.js';
import type { UiIconName } from '../icons.js';
import { SceneIcon } from './artwork.js';
import { SceneTargetGrid, type SceneControllableDevice } from './target-grid.js';

export const RICH_SCENE_ICON_CHOICES: readonly {
  readonly id: string;
  readonly label: string;
  readonly icon: UiIconName;
}[] = [
  { id: 'mdi:sparkles', label: 'Mood', icon: 'sparkles' },
  { id: 'mdi:weather-night', label: 'Night', icon: 'moon-star' },
  { id: 'mdi:white-balance-sunny', label: 'Bright', icon: 'sun' },
  { id: 'mdi:sofa', label: 'Relax', icon: 'armchair' },
  { id: 'mdi:movie-open', label: 'Movie', icon: 'clapperboard' },
  { id: 'mdi:book-open-variant', label: 'Read', icon: 'book-open' },
  { id: 'mdi:party-popper', label: 'Party', icon: 'party' },
  { id: 'mdi:home', label: 'Home', icon: 'house' },
];

export interface SceneRoomChoice {
  readonly value: string;
  readonly label: string;
}

export function SceneEditorModal({
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
  sceneIcon,
  roomId,
  roomOptions,
  entities,
  devices,
  onSetAdvanced,
  onNameChange,
  onSceneIconChange,
  onRoomChange,
  onEntitiesChange,
  onJsonChange,
  onTestScene,
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
  readonly nameValue: string;
  readonly sceneIcon?: string;
  readonly roomId?: string;
  readonly roomOptions?: readonly SceneRoomChoice[];
  readonly entities: Record<string, unknown>;
  readonly devices: readonly SceneControllableDevice[];
  readonly onSetAdvanced: (advanced: boolean) => void;
  readonly onNameChange: (value: string) => void;
  readonly onSceneIconChange: (icon: string) => void;
  readonly onRoomChange?: (roomId: string) => void;
  readonly onEntitiesChange: (entities: Record<string, unknown>) => void;
  readonly onJsonChange: (raw: string) => void;
  readonly onTestScene: () => void;
  readonly onRequestClose: () => void;
  readonly onConfirmDiscard: () => void;
  readonly onCancelDiscard: () => void;
  readonly onRequestDelete: () => void;
  readonly onConfirmDelete: () => void;
  readonly onCancelDelete: () => void;
  readonly onSave: () => void;
}) {
  const [pickingIcon, setPickingIcon] = useState(false);

  return (
    <HausDialog
      size="lg"
      title={editing ? 'Edit scene' : 'New scene'}
      subtitle="SCENE COMPOSER · ACCESSORIES & MOOD"
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
            <HausButton
              id="config-editor-test"
              variant="secondary"
              disabled={demo || busy || Object.keys(entities).length === 0}
              onPress={onTestScene}
            >
              <UiIcon name="play" size={13} />
              <Text size={12.5}>Test scene</Text>
            </HausButton>
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
                {demo ? 'Connect to save' : 'Save scene'}
              </Text>
            </HausButton>
          </Row>
        </Row>
      }
    >
      {loading ? (
        <Text size={13} tone="muted" role="status">
          Loading scene configuration…
        </Text>
      ) : (
        <Stack gapPx={16} style={{ layout: { width: pct(100) } }}>
          <Stack
            gapPx={12}
            style={{
              layout: { width: pct(100), padding: insets(14, 16) },
              material: new SolidMaterial(colorToken('surfaceSecondary')),
              border: { width: 1, color: colorToken('border') },
              corners: corners(16, 'superellipse', 1.4),
            }}
          >
            <Row align="end" gapPx={12} wrap>
              <Pressable
                id="scene-identity-icon"
                ariaLabel="Choose scene icon"
                ariaExpanded={pickingIcon}
                onActivate={() => setPickingIcon(!pickingIcon)}
                style={{
                  layout: {
                    width: px(46),
                    height: px(46),
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  },
                  material: new SolidMaterial(rgba(120, 160, 255, 0.16)),
                  border: {
                    width: 1,
                    color: pickingIcon ? colorToken('accent') : colorToken('border'),
                  },
                  corners: corners(14, 'superellipse', 1.4),
                }}
              >
                <SceneIcon name={nameValue || 'Scene'} icon={sceneIcon} />
              </Pressable>

              <Stack gapPx={5} style={{ layout: { flexGrow: 1, minWidth: px(200) } }}>
                <Text size={11.5} weight={600} tone="muted">
                  Scene name
                </Text>
                <TextInput
                  id="config-editor-name"
                  ariaLabel="Scene name"
                  required
                  value={nameValue}
                  placeholder="Evening glow"
                  onChange={onNameChange}
                  style={{
                    layout: { width: pct(100), minHeight: px(38), padding: insets(6, 12) },
                    material: new SolidMaterial(colorToken('surface')),
                    border: { width: 1, color: colorToken('border') },
                    corners: corners(11),
                    typography: { size: 13.5, weight: 600, color: colorToken('textPrimary') },
                  }}
                />
              </Stack>

              {roomOptions && roomOptions.length > 0 && onRoomChange && (
                <Stack gapPx={5} style={{ layout: { width: px(180), flexShrink: 0 } }}>
                  <Text size={11.5} weight={600} tone="muted">
                    Room
                  </Text>
                  <HausSelect
                    id="scene-editor-room"
                    aria-label="Scene room"
                    value={roomId ?? ''}
                    options={roomOptions}
                    onChange={onRoomChange}
                  />
                </Stack>
              )}
            </Row>

            {pickingIcon && (
              <Row gapPx={6} wrap>
                {RICH_SCENE_ICON_CHOICES.map((choice) => {
                  const active = sceneIcon === choice.id;
                  return (
                    <Pressable
                      key={choice.id}
                      ariaPressed={active}
                      onActivate={() => {
                        onSceneIconChange(choice.id);
                        setPickingIcon(false);
                      }}
                      style={{
                        layout: {
                          padding: insets(6, 10),
                          direction: 'row',
                          alignItems: 'center',
                          gap: px(6),
                        },
                        material: new SolidMaterial(
                          active ? colorToken('surfaceActive') : colorToken('surface'),
                        ),
                        border: {
                          width: 1,
                          color: active ? colorToken('accent') : colorToken('border'),
                        },
                        corners: corners(10),
                      }}
                    >
                      <UiIcon name={choice.icon} size={14} />
                      <Text size={11.5} weight={active ? 600 : 500}>
                        {choice.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </Row>
            )}
          </Stack>

          <Row align="center" justify="between" gapPx={12} wrap>
            <Box style={{ layout: { width: px(240) } }}>
              <HausSegmentedControl
                id="config-editor-mode"
                value={advanced ? 'advanced' : 'visual'}
                options={[
                  { value: 'visual', label: 'Accessories' },
                  { value: 'advanced', label: 'Advanced JSON' },
                ]}
                onChange={(value) => onSetAdvanced(value === 'advanced')}
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
              label="Complete scene configuration"
              rows={12}
              value={jsonText}
              error={jsonError}
              onChange={onJsonChange}
            />
          ) : (
            <SceneTargetGrid
              entities={entities}
              devices={devices}
              columns={3}
              onChange={onEntitiesChange}
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
              <Text size={12.5}>Discard unsaved scene changes?</Text>
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
              <Text size={12.5}>{`Delete "${nameValue || 'scene'}" permanently?`}</Text>
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
