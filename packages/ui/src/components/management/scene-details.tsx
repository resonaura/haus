/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { colorToken, corners, insets, pct, px, rgba } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import {
  Box,
  HausButton,
  HausDialog,
  HausDivider,
  Row,
  Stack,
  Text,
  useHausUi,
} from '../../primitives/index.js';
import { UiIcon } from '../icon.js';

export interface PortableSceneTargetDetail {
  readonly id: string;
  readonly name: string;
  readonly targetSummary: string;
  readonly currentState: string;
  readonly swatchRgb?: readonly [number, number, number];
}

export function SceneDetailsModal({
  title,
  roomName,
  source,
  targets,
  hiddenView,
  applying,
  unavailable,
  canEdit,
  onClose,
  onEdit,
  onRestore,
  onApply,
}: {
  readonly title: string;
  readonly roomName: string;
  readonly source?: string;
  readonly targets: readonly PortableSceneTargetDetail[];
  readonly hiddenView?: boolean;
  readonly applying?: boolean;
  readonly unavailable?: boolean;
  readonly canEdit: boolean;
  readonly onClose: () => void;
  readonly onEdit: () => void;
  readonly onRestore?: () => void;
  readonly onApply: () => void;
}) {
  const { theme } = useHausUi();
  const primaryFg = theme.mode === 'dark' ? '#101010' : '#ffffff';
  return (
    <HausDialog
      size="md"
      title={title}
      subtitle={`SCENE DETAILS · ${roomName.toUpperCase()}`}
      scrollable
      onClose={onClose}
      footer={
        <Row align="center" justify="between" gapPx={10} style={{ layout: { width: pct(100) } }}>
          <HausButton id="scene-details-edit" variant="ghost" disabled={!canEdit} onPress={onEdit}>
            <UiIcon name="info" size={14} />
            <Text size={12.5}>Edit scene</Text>
          </HausButton>
          {hiddenView && onRestore ? (
            <HausButton id="scene-details-restore" variant="primary" onPress={onRestore}>
              <UiIcon name="eye" size={14} color={primaryFg} />
              <Text size={12.5} style={{ typography: { color: colorToken('accentForeground'), weight: 600 } }}>
                Restore to Haus
              </Text>
            </HausButton>
          ) : (
            <HausButton
              id="scene-details-apply"
              variant="primary"
              disabled={Boolean(applying || unavailable)}
              isPending={applying}
              onPress={onApply}
            >
              <UiIcon name="play" size={14} color={primaryFg} />
              <Text size={12.5} style={{ typography: { color: colorToken('accentForeground'), weight: 600 } }}>
                {applying ? 'Applying…' : 'Apply scene'}
              </Text>
            </HausButton>
          )}
        </Row>
      }
    >
      <Stack gapPx={14} style={{ layout: { width: pct(100) } }}>
        {source && (
          <Row>
            <Box
              style={{
                layout: { padding: insets(3, 8) },
                material: new SolidMaterial(colorToken('surfaceSecondary')),
                border: { width: 1, color: colorToken('border') },
                corners: corners(999),
              }}
            >
              <Text size={10.5} weight={600} tone="secondary">
                {source}
              </Text>
            </Box>
          </Row>
        )}

        <Text size={12.5} tone="muted" style={{ typography: { lineHeight: 1.5 } }}>
          These are the targets saved for this scene. Previewing does not change your devices.
        </Text>

        {targets.length > 0 ? (
          <Stack gapPx={0} style={{ layout: { width: pct(100) } }}>
            {targets.map((target, index) => (
              <Stack key={target.id} gapPx={0}>
                {index > 0 && <HausDivider />}
                <Row align="center" gapPx={12} style={{ layout: { padding: insets(12, 2) } }}>
                  <Box
                    style={{
                      layout: { width: px(16), height: px(16), flexShrink: 0 },
                      corners: corners(999),
                      border: { width: 1, color: colorToken('border') },
                      material: new SolidMaterial(
                        target.swatchRgb
                          ? rgba(target.swatchRgb[0], target.swatchRgb[1], target.swatchRgb[2])
                          : colorToken('surfaceSecondary'),
                      ),
                    }}
                  />
                  <Stack gapPx={2} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
                    <Text size={13} weight={600}>
                      {target.name}
                    </Text>
                    <Text size={11.5} tone="muted">
                      {target.targetSummary}
                    </Text>
                  </Stack>
                  <Text size={11} tone="muted">
                    {`Now: ${target.currentState}`}
                  </Text>
                </Row>
              </Stack>
            ))}
          </Stack>
        ) : (
          <Text size={12.5} tone="muted">
            This scene does not have target accessories yet. Edit the scene to add target accessories.
          </Text>
        )}
      </Stack>
    </HausDialog>
  );
}
