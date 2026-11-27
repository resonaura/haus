/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useState } from 'react';
import { colorToken, corners, insets, pct, px, rgba } from '../../ir/geometry.js';
import { BackdropMaterial, SolidMaterial } from '../../ir/materials.js';
import { HausUiThemeScope, useHausUi } from '../../primitives/context.js';
import {
  Box,
  HausButton,
  Heading,
  Row,
  ScrollView,
  Stack,
  Text,
} from '../../primitives/index.js';
import { UiIcon } from '../icon.js';
import { StoryboardCardsShowcase } from './cards-showcase.js';
import { StoryboardConsoleHero } from './console-hero.js';
import { StoryboardControlsShowcase } from './controls-showcase.js';

export { ANSI_TERMINAL_SWATCHES, HAUS_ASCII_LOGO_LINES } from './console-hero.js';

export function isStoryboardToggleShortcut(input: {
  readonly key: string;
  readonly metaKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly shiftKey?: boolean;
  readonly altKey?: boolean;
}): boolean {
  const lower = input.key.toLowerCase();
  if ((input.metaKey || input.ctrlKey) && input.shiftKey && lower === 'u') return true;
  if (input.altKey && (input.key === '`' || input.key === '~')) return true;
  return false;
}

export function HausComponentStoryboard({
  rendererName,
  peekMode = false,
  onClose,
}: {
  readonly rendererName?: string;
  readonly peekMode?: boolean;
  readonly onClose: () => void;
}) {
  const parent = useHausUi();
  const [overrideMode, setOverrideMode] = useState<'dark' | 'light' | null>(null);
  const activeMode = overrideMode ?? parent.theme.mode;

  const content = (
    <Box
      id="haus-component-storyboard"
      role="dialog"
      ariaLabel="Haus UI Component Storyboard"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
      }}
      style={{
        layout: {
          position: 'fixed',
          inset: insets(0),
          width: pct(100),
          height: pct(100),
          zIndex: 950,
          display: 'flex',
          direction: 'column',
        },
        material: parent.viewport.reducedTransparency
          ? new SolidMaterial(colorToken('canvas'))
          : new BackdropMaterial(
              {
                blurRadius: 28,
                saturation: 1.3,
                tintColor: activeMode === 'dark' ? rgba(8, 9, 12, 0.92) : rgba(248, 248, 250, 0.94),
                tintOpacity: 0.93,
              },
              { fallbackColor: colorToken('canvas') },
            ),
      }}
    >
      <Row
        align="center"
        justify="between"
        gapPx={12}
        wrap
        style={{
          layout: { width: pct(100), padding: insets(14, 26), flexShrink: 0 },
          border: { width: 1, color: colorToken('borderSubtle') },
          material: new SolidMaterial(colorToken('surface')),
        }}
      >
        <Row align="center" gapPx={10}>
          <UiIcon name="terminal" size={18} />
          <Heading level={2} size={17} weight={600}>
            Haus Component Storyboard
          </Heading>
          <Box
            style={{
              layout: { padding: insets(3, 9) },
              corners: corners(999, 'round'),
              material: new SolidMaterial(colorToken('controlFill')),
              border: { width: 1, color: colorToken('borderSubtle') },
            }}
          >
            <Text size={11} tone="muted" mono>
              {peekMode ? 'Holding Option+` (release to close)' : '⌘⇧U / Option+`'}
            </Text>
          </Box>
        </Row>

        <Row align="center" gapPx={8}>
          <HausButton
            id="storyboard-toggle-theme"
            size="sm"
            variant="secondary"
            onPress={() => setOverrideMode(activeMode === 'dark' ? 'light' : 'dark')}
          >
            <UiIcon name={activeMode === 'dark' ? 'sun' : 'moon'} size={14} />
            <Text size={12}>{activeMode === 'dark' ? 'Light preview' : 'Dark preview'}</Text>
          </HausButton>
          <HausButton id="storyboard-close" size="sm" variant="primary" onPress={onClose}>
            Done
          </HausButton>
        </Row>
      </Row>

      <ScrollView
        id="storyboard-scroll"
        scrollId="storyboard-scroll"
        orientation="vertical"
        style={{ layout: { flexGrow: 1, minHeight: px(0), width: pct(100), direction: 'column' } }}
      >
        <Stack
          gapPx={24}
          style={{
            layout: {
              width: pct(100),
              maxWidth: px(1320),
              padding: insets(24, 28, 44, 28),
              alignSelf: 'center',
            },
          }}
        >
          <StoryboardConsoleHero
            rendererName={rendererName}
            onTogglePreviewMode={() => setOverrideMode(activeMode === 'dark' ? 'light' : 'dark')}
          />
          <StoryboardControlsShowcase />
          <StoryboardCardsShowcase />
        </Stack>
      </ScrollView>
    </Box>
  );

  if (overrideMode && overrideMode !== parent.theme.mode) {
    return <HausUiThemeScope mode={overrideMode}>{content}</HausUiThemeScope>;
  }

  return content;
}
