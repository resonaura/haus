/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { memo } from 'react';
import { INTEGRATION_CATALOG_ALPHABET } from '@haus/core/transport';
import {
  colorToken,
  corners,
  insets,
  mixColor,
  pct,
  px,
  transparentColor,
} from '../../../ir/geometry.js';
import { SolidMaterial } from '../../../ir/materials.js';
import { Box, Pressable, Row, Stack, Text, useHausUi } from '../../../primitives/index.js';
import { DashboardGrid } from '../../home.js';

const TILE_ENTER_EASE = [0.22, 1, 0.36, 1] as const;
const OVERLAY_MOTION = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  durationMs: 180,
  ease: TILE_ENTER_EASE,
} as const;

export interface IntegrationLetterSectionSummary {
  readonly letter: string;
  readonly count: number;
}

/**
 * Animated A–Z semantic zoom overlay shared between GPUIX and Electron.
 * Displays every letter (`#`, `A`–`Z`) with its integration count and staggered
 * wave entrance so users can inspect distribution and jump straight to any letter.
 */
export const IntegrationAlphabetOverlay = memo(function IntegrationAlphabetOverlay({
  sectionCounts,
  activeLetter,
  selectedLetter,
  onPickLetter,
  onShowAll,
  onClose,
}: {
  readonly sectionCounts: ReadonlyMap<string, number>;
  readonly activeLetter: string | null;
  readonly selectedLetter: string | null;
  readonly onPickLetter: (letter: string) => void;
  readonly onShowAll?: () => void;
  readonly onClose: () => void;
}) {
  const { viewport } = useHausUi();
  const columns = viewport.width < 520 ? 4 : viewport.width < 720 ? 5 : 7;

  return (
    <Box
      id="flow-picker-alphabet-overlay"
      role="region"
      ariaLabel="Jump to letter"
      motion={OVERLAY_MOTION}
      style={{ layout: { width: pct(100), padding: insets(4, 2), flexShrink: 0 } }}
    >
      <Stack gapPx={12} style={{ layout: { width: pct(100), flexShrink: 0 } }}>
        <Row align="center" justify="between" gapPx={10} style={{ layout: { width: pct(100) } }}>
          <Stack gapPx={2}>
            <Text size={13} weight={600}>
              Jump to letter
            </Text>
            <Text size={11.5} tone="muted">
              Click a letter or press A–Z to jump directly
            </Text>
          </Stack>
          <Row align="center" gapPx={6}>
            {activeLetter && onShowAll && (
              <Pressable
                id="flow-picker-alpha-all"
                onActivate={onShowAll}
                style={{
                  layout: {
                    direction: 'row',
                    padding: insets(5, 10),
                    alignItems: 'center',
                    justifyContent: 'center',
                  },
                  material: new SolidMaterial(colorToken('controlFill')),
                  border: { width: 1, color: colorToken('border') },
                  corners: corners(999),
                  states: {
                    hover: { material: new SolidMaterial(colorToken('controlFillHover')) },
                  },
                }}
              >
                <Text size={11.5} weight={500}>
                  All letters
                </Text>
              </Pressable>
            )}
            <Pressable
              id="flow-picker-alpha-close"
              onActivate={onClose}
              style={{
                layout: {
                  direction: 'row',
                  padding: insets(5, 10),
                  alignItems: 'center',
                  justifyContent: 'center',
                },
                material: new SolidMaterial(colorToken('controlFill')),
                border: { width: 1, color: colorToken('border') },
                corners: corners(999),
                states: { hover: { material: new SolidMaterial(colorToken('controlFillHover')) } },
              }}
            >
              <Text size={11.5} weight={500} tone="muted">
                Back to list
              </Text>
            </Pressable>
          </Row>
        </Row>

        <DashboardGrid columns={columns}>
          {INTEGRATION_CATALOG_ALPHABET.map((ch, idx) => {
            const count = sectionCounts.get(ch) ?? 0;
            const disabled = count === 0;
            const isSelected = selectedLetter === ch;
            const isCurrent = activeLetter === ch && count > 0;

            return (
              <Box
                key={ch}
                motion={{
                  initial: { opacity: 0, scale: 0.88, y: 8 },
                  animate: { opacity: disabled ? 0.34 : 1, scale: 1, y: 0 },
                  durationMs: 240,
                  delayMs: 24 + idx * 9,
                  ease: TILE_ENTER_EASE,
                  originX: 0.5,
                  originY: 0.5,
                }}
                style={{ layout: { width: pct(100) } }}
              >
                <Pressable
                  id={`flow-picker-letter-tile-${ch}`}
                  disabled={disabled}
                  ariaPressed={isCurrent || isSelected}
                  ariaLabel={
                    count > 0
                      ? `Jump to ${ch}, ${count} ${count === 1 ? 'integration' : 'integrations'}`
                      : `${ch}, no integrations`
                  }
                  onActivate={() => onPickLetter(ch)}
                  style={{
                    layout: {
                      width: pct(100),
                      height: px(68),
                      display: 'flex',
                      direction: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: px(3),
                    },
                    material: new SolidMaterial(
                      isSelected
                        ? colorToken('accent')
                        : isCurrent
                          ? colorToken('controlFillActive')
                          : disabled
                            ? transparentColor
                            : colorToken('surface'),
                    ),
                    border: {
                      width: 1,
                      style: disabled ? 'dashed' : 'solid',
                      color: isSelected
                        ? colorToken('accent')
                        : isCurrent
                          ? colorToken('controlBorderActive')
                          : colorToken('border'),
                    },
                    corners: corners(16, 'superellipse', 1.4),
                    cursor: disabled ? 'default' : 'pointer',
                    transitionMs: 140,
                    states: disabled
                      ? undefined
                      : {
                          hover: {
                            material: new SolidMaterial(
                              isSelected
                                ? colorToken('accentHover')
                                : colorToken('controlFillHover'),
                            ),
                            border: {
                              width: 1,
                              style: 'solid',
                              color: colorToken('controlBorderActive'),
                            },
                            transform: { translateY: -1.5, scale: 1.02 },
                          },
                          pressed: { transform: { scale: 0.96 } },
                        },
                  }}
                >
                  <Text
                    size={20}
                    weight={700}
                    style={{
                      typography: {
                        size: 20,
                        weight: 700,
                        lineHeight: 1.1,
                        letterSpacing: -0.4,
                        color: isSelected
                          ? colorToken('accentForeground')
                          : colorToken('textPrimary'),
                      },
                    }}
                  >
                    {ch}
                  </Text>
                  <Text
                    size={11}
                    mono
                    style={{
                      typography: {
                        size: 11,
                        weight: 500,
                        tabularNums: true,
                        color: isSelected
                          ? colorToken('accentForeground')
                          : colorToken('textMuted'),
                      },
                    }}
                  >
                    {count > 0 ? count.toLocaleString() : '—'}
                  </Text>
                </Pressable>
              </Box>
            );
          })}
        </DashboardGrid>
      </Stack>
    </Box>
  );
});

/** Grouped alphabetical section header with clickable A–Z jump pill, hairline divider, and count. */
export const IntegrationLetterSectionHeader = memo(function IntegrationLetterSectionHeader({
  letter,
  count,
  highlighted = false,
  filteredSingle = false,
  onOpenIndex,
  onClearLetter,
}: {
  readonly letter: string;
  readonly count: number;
  readonly highlighted?: boolean;
  readonly filteredSingle?: boolean;
  readonly onOpenIndex: () => void;
  readonly onClearLetter?: () => void;
}) {
  return (
    <Row
      align="center"
      gapPx={10}
      style={{ layout: { width: pct(100), padding: insets(4, 2, 2, 2), flexShrink: 0 } }}
    >
      <Pressable
        id={`flow-picker-section-pill-${letter}`}
        ariaLabel={`Section ${letter}, ${count} integrations. Open alphabet index`}
        onActivate={onOpenIndex}
        style={{
          layout: {
            direction: 'row',
            minWidth: px(30),
            height: px(24),
            padding: insets(0, 8),
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          },
          material: new SolidMaterial(
            highlighted
              ? colorToken('accent')
              : mixColor(transparentColor, colorToken('ink'), 0.08),
          ),
          border: {
            width: 1,
            color: highlighted ? colorToken('accent') : colorToken('border'),
          },
          corners: corners(8),
          transitionMs: 150,
          states: {
            hover: {
              material: new SolidMaterial(colorToken('accent')),
              textColor: colorToken('accentForeground'),
              border: { width: 1, color: colorToken('accent') },
            },
            pressed: { transform: { scale: 0.95 } },
          },
        }}
      >
        <Text
          size={11.5}
          weight={700}
          style={{
            typography: {
              size: 11.5,
              weight: 700,
              color: highlighted ? colorToken('accentForeground') : colorToken('textPrimary'),
            },
          }}
        >
          {letter}
        </Text>
      </Pressable>
      <Box
        ariaHidden
        style={{
          layout: { flexGrow: 1, height: px(1) },
          material: new SolidMaterial(colorToken('borderSubtle')),
        }}
      />
      <Text
        size={11}
        tone="muted"
        mono
        style={{ typography: { size: 11, tabularNums: true, color: colorToken('textMuted') } }}
      >
        {count.toLocaleString()}
      </Text>
      {filteredSingle && onClearLetter && (
        <Pressable
          id="flow-picker-clear-letter"
          onActivate={onClearLetter}
          style={{
            layout: {
              direction: 'row',
              padding: insets(2, 8),
              alignItems: 'center',
              justifyContent: 'center',
            },
            material: new SolidMaterial(colorToken('controlFill')),
            border: { width: 1, color: colorToken('border') },
            corners: corners(999),
            states: { hover: { material: new SolidMaterial(colorToken('controlFillHover')) } },
          }}
        >
          <Text size={10.5} weight={500} tone="muted">
            Show all
          </Text>
        </Pressable>
      )}
    </Row>
  );
});
