/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { ReactNode } from 'react';
import { colorToken, corners, insets, pct, px, rgba } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import {
  Box,
  HausButton,
  HausSelect,
  Heading,
  Row,
  Stack,
  Text,
  TextInput,
} from '../../primitives/index.js';
import { UiIcon } from '../icon.js';

export interface SceneScopeOption {
  readonly value: string;
  readonly label: string;
}

export function ScenesLibraryView({
  query,
  scope,
  scopeOptions,
  canCreate,
  canImportHa,
  hasAnyScenes,
  hasFilteredScenes,
  error,
  onQueryChange,
  onScopeChange,
  onCreate,
  onImportHa,
  children,
}: {
  readonly query: string;
  readonly scope: string;
  readonly scopeOptions: readonly SceneScopeOption[];
  readonly canCreate: boolean;
  readonly canImportHa?: boolean;
  readonly hasAnyScenes: boolean;
  readonly hasFilteredScenes: boolean;
  readonly error?: string;
  readonly onQueryChange: (value: string) => void;
  readonly onScopeChange: (value: string) => void;
  readonly onCreate: () => void;
  readonly onImportHa?: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Stack gapPx={20} style={{ layout: { width: pct(100) } }}>
      <Row
        align="center"
        justify="between"
        gapPx={16}
        wrap
        style={{
          layout: { width: pct(100), padding: insets(20) },
          material: new SolidMaterial(colorToken('surfaceSecondary')),
          border: { width: 1, color: colorToken('border') },
          corners: corners(17, 'superellipse', 1.4),
        }}
      >
        <Row align="center" gapPx={16} style={{ layout: { flexGrow: 1, minWidth: px(240) } }}>
          <Box
            style={{
              layout: {
                width: px(48),
                height: px(48),
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              },
              material: new SolidMaterial(rgba(120, 160, 255, 0.14)),
              corners: corners(15),
            }}
          >
            <UiIcon name="sparkles" size={24} />
          </Box>
          <Stack gapPx={4} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
            <Text size={15} weight={600}>
              A different feeling. One tap away.
            </Text>
            <Text size={11.5} tone="muted" style={{ typography: { lineHeight: 1.5 } }}>
              Tap a scene to apply it. Use the menu on a card to inspect its settings.
            </Text>
          </Stack>
        </Row>
        <Row align="center" gapPx={8} wrap>
          {canImportHa && onImportHa && (
            <HausButton
              id="scenes-import-ha"
              variant="secondary"
              size="sm"
              disabled={!canCreate}
              onPress={onImportHa}
            >
              <UiIcon name="file-up" size={14} />
              <Text size={12}>Import HA scenes</Text>
            </HausButton>
          )}
          <HausButton id="scenes-create" variant="secondary" size="sm" disabled={!canCreate} onPress={onCreate}>
            <UiIcon name="sparkles" size={14} />
            <Text size={12}>Create scene</Text>
          </HausButton>
        </Row>
      </Row>

      <Row align="center" gapPx={10} wrap style={{ layout: { width: pct(100) } }}>
        <Row
          align="center"
          gapPx={8}
          style={{
            layout: {
              flexGrow: 1,
              minWidth: px(200),
              minHeight: px(38),
              padding: insets(0, 12),
            },
            material: new SolidMaterial(colorToken('surfaceSecondary')),
            border: { width: 1, color: colorToken('border') },
            corners: corners(12),
          }}
        >
          <UiIcon name="search" size={16} />
          <TextInput
            id="scenes-search"
            ariaLabel="Search scenes"
            placeholder="Find a mood or a moment"
            value={query}
            onChange={onQueryChange}
            style={{
              layout: { flexGrow: 1, minWidth: px(0), height: px(34) },
              typography: { size: 13, color: colorToken('textPrimary') },
            }}
          />
        </Row>
        <Box style={{ layout: { width: px(180), flexShrink: 0 } }}>
          <HausSelect
            id="scenes-scope"
            aria-label="Filter scenes by room"
            value={scope}
            options={scopeOptions}
            onChange={onScopeChange}
          />
        </Box>
      </Row>

      {error && (
        <Text role="alert" tone="critical" size={12.5}>
          {error}
        </Text>
      )}

      {hasFilteredScenes ? (
        children
      ) : (
        <Stack
          align="center"
          gapPx={8}
          style={{
            layout: { width: pct(100), padding: insets(34, 20) },
            material: new SolidMaterial(colorToken('surfaceSecondary')),
            border: { width: 1, color: colorToken('border') },
            corners: corners(16),
          }}
        >
          <UiIcon name="sparkles" size={28} />
          <Heading level={3} size={16} weight={600}>
            {hasAnyScenes ? 'No scenes match' : 'Set the feeling of home'}
          </Heading>
          <Text size={12.5} tone="muted">
            {hasAnyScenes
              ? 'Try another room or scene name.'
              : 'Create a scene to bring your favorite device settings together.'}
          </Text>
        </Stack>
      )}
    </Stack>
  );
}
