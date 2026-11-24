/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { ReactNode } from 'react';
import { colorToken, corners, insets, pct, px } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import { Box, HausButton, Heading, Pressable, Row, Stack, Text } from '../../primitives/index.js';
import { DashboardGrid } from '../home.js';
import { UiIcon } from '../icon.js';

export interface PortableHiddenCameraItem {
  readonly id: string;
  readonly name: string;
  readonly preview?: ReactNode;
}

export function HiddenItemsView({
  hasAccessories,
  accessoriesContent,
  cameras,
  hasScenes,
  scenesContent,
  onOpenCamera,
  onRestoreEntity,
}: {
  readonly hasAccessories: boolean;
  readonly accessoriesContent?: ReactNode;
  readonly cameras: readonly PortableHiddenCameraItem[];
  readonly hasScenes: boolean;
  readonly scenesContent?: ReactNode;
  readonly onOpenCamera: (id: string) => void;
  readonly onRestoreEntity: (id: string) => void;
}) {
  const isEmpty = !hasAccessories && cameras.length === 0 && !hasScenes;

  if (isEmpty) {
    return (
      <Stack
        align="center"
        gapPx={8}
        style={{
          layout: { width: pct(100), padding: insets(38, 20) },
          material: new SolidMaterial(colorToken('surfaceSecondary')),
          border: { width: 1, color: colorToken('border') },
          corners: corners(16),
        }}
      >
        <UiIcon name="archive" size={28} />
        <Heading level={3} size={16} weight={600}>
          Nothing hidden
        </Heading>
        <Text size={12.5} tone="muted">
          Devices and scenes you hide from Haus will be kept here, ready to restore.
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gapPx={24} style={{ layout: { width: pct(100) } }}>
      {hasAccessories && (
        <Stack gapPx={12}>
          <Heading level={2} size={17} weight={600}>
            Devices
          </Heading>
          {accessoriesContent}
        </Stack>
      )}

      {cameras.length > 0 && (
        <Stack gapPx={12}>
          <Row align="center" gapPx={8}>
            <UiIcon name="radio" size={16} />
            <Heading level={2} size={17} weight={600}>
              Cameras
            </Heading>
            <Text size={11.5} tone="muted">
              {`${cameras.length} ${cameras.length === 1 ? 'camera' : 'cameras'}`}
            </Text>
          </Row>
          <DashboardGrid columns={3}>
            {cameras.map((cam) => (
              <Stack
                key={cam.id}
                gapPx={10}
                style={{
                  layout: { padding: insets(12) },
                  material: new SolidMaterial(colorToken('surfaceSecondary')),
                  border: { width: 1, color: colorToken('border') },
                  corners: corners(16),
                }}
              >
                <Pressable
                  onActivate={() => onOpenCamera(cam.id)}
                  style={{ layout: { width: pct(100), gap: px(8) } }}
                >
                  {cam.preview && (
                    <Box
                      style={{
                        layout: { width: pct(100), aspectRatio: 16 / 9, overflow: 'hidden' },
                        corners: corners(10),
                        material: new SolidMaterial(colorToken('surface')),
                      }}
                    >
                      {cam.preview}
                    </Box>
                  )}
                  <Text size={13} weight={600}>
                    {cam.name}
                  </Text>
                </Pressable>
                <HausButton
                  id={`restore-hidden-${cam.id}`}
                  variant="secondary"
                  size="sm"
                  onPress={() => onRestoreEntity(cam.id)}
                >
                  <UiIcon name="eye" size={14} />
                  <Text size={12}>Restore to Haus</Text>
                </HausButton>
              </Stack>
            ))}
          </DashboardGrid>
        </Stack>
      )}

      {hasScenes && (
        <Stack gapPx={12}>
          <Row align="center" gapPx={8}>
            <UiIcon name="sparkles" size={16} />
            <Heading level={2} size={17} weight={600}>
              Scenes
            </Heading>
          </Row>
          {scenesContent}
        </Stack>
      )}
    </Stack>
  );
}
