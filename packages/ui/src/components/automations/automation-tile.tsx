/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useState } from 'react';
import {
  describeAutomationCard,
  type AutomationStarterTemplate,
  type EditableConfig,
} from '@haus/core/transport';
import {
  colorToken,
  corners,
  insets,
  mixColor,
  pct,
  px,
  transparentColor,
} from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import type { UiStyleSpec } from '../../ir/node.js';
import { Box, Pressable, Row, Text, useHausUi } from '../../primitives/index.js';
import { GlassRim } from '../../primitives/glass-rim.js';
import { resolveColorToCss } from '../../renderers/contract.js';
import { DeviceTileIconOrb, DeviceTileStateText, DeviceTileWash } from '../devices/tile-effects.js';
import { buildTileFrameStyle, getDeviceTileTokens } from '../devices/tile-theme.js';
import { UiIcon } from '../icon.js';

export interface PortableAutomationItem {
  readonly entityId: string;
  readonly ruleId: string;
  readonly name: string;
  readonly statusLabel: string;
  readonly enabled: boolean;
  readonly toggleDisabled: boolean;
  readonly canEdit: boolean;
  readonly cutoverDisabled?: boolean;
  readonly needsCutover: boolean;
  readonly cuttingOver: boolean;
  readonly config?: EditableConfig;
}

const tileStyles = {
  top: {
    layout: {
      direction: 'row',
      alignItems: 'center',
      justifyContent: 'between',
      margin: insets(0, 0, 11, 0),
      zIndex: 1,
      position: 'relative',
    },
  },
  body: {
    layout: {
      direction: 'column',
      width: pct(100),
      alignItems: 'start',
      position: 'relative',
      zIndex: 1,
    },
    cursor: 'pointer',
    material: new SolidMaterial(transparentColor),
    border: { width: 0, style: 'none', color: transparentColor },
  },
  subtitle: {
    typography: { size: 10, color: colorToken('textMuted'), lineHeight: 1.3, maxLines: 1 },
  },
  name: {
    layout: { margin: { top: px(3) } },
    typography: {
      size: 13,
      weight: 600,
      color: colorToken('textPrimary'),
      lineHeight: 1.35,
      maxLines: 1,
      truncate: true,
    },
  },
  state: {
    layout: { margin: { top: px(3) } },
    typography: {
      size: 11,
      color: colorToken('textMuted'),
      lineHeight: 1.25,
      maxLines: 1,
      truncate: true,
    },
  },
} satisfies Record<string, UiStyleSpec>;

/**
 * Monochrome 1:1 DesktopDeviceTile-proportioned automation card:
 * - Top-left orb toggles Active/Paused with spring pop + radial motion-blurred neutral wash.
 * - Hover lifts card (-2px), deepens elevation shadow, brightens GlassRim, and reveals quick Run.
 * - Crisp 3-line body (category, title, single concise state line) opens the dedicated editor screen.
 */
export function AutomationTile({
  item,
  resolveEntityName,
  onEdit,
  onToggle,
  onRun,
  onCutover,
}: {
  readonly item: PortableAutomationItem;
  readonly resolveEntityName?: (entityId: string) => string;
  readonly onEdit: (entityId: string) => void;
  readonly onToggle: (entityId: string) => void;
  readonly onRun?: (entityId: string) => void;
  readonly onCutover: (item: PortableAutomationItem) => void;
}) {
  const { theme, viewport } = useHausUi();
  const [hovered, setHovered] = useState(false);
  const tokens = getDeviceTileTokens(theme.mode);
  const isActive = item.enabled;
  const deviceColor = tokens.deviceNeutral;
  const card = describeAutomationCard(item.config, item.name, resolveEntityName);

  const frameLayout = buildTileFrameStyle({
    mode: theme.mode,
    active: isActive,
    hovered,
    highContrast: viewport.highContrast,
    reducedTransparency: viewport.reducedTransparency,
    deviceColor,
    hasRestore: item.needsCutover,
  });

  const stateText = item.needsCutover
    ? 'Paused · Pending cutover'
    : isActive
      ? card.compactSummary
        ? `Active · ${card.compactSummary}`
        : 'Active'
      : card.compactSummary
        ? `Paused · ${card.compactSummary}`
        : 'Paused';

  const mutedCss = resolveColorToCss(colorToken('textMuted'), theme, false);
  const inkCss = resolveColorToCss(colorToken('textPrimary'), theme, false);

  return (
    <Box
      id={`automation-row-${item.entityId}`}
      semantic="article"
      className="accessory-tile automation-tile"
      dataAttrs={{
        'data-haus-device-tile': 'shared',
        'data-haus-automation-tile': 'shared',
        'data-haus-glass-rim': 'managed',
        ...(isActive ? { 'data-active': true } : {}),
      }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      style={{
        layout: {
          display: 'flex',
          direction: 'column',
          minHeight: px(item.needsCutover ? 168 : 126),
          padding: insets(13, 14),
          position: 'relative',
          overflow: 'hidden',
        },
        material: frameLayout.material,
        border: frameLayout.border,
        shadows: frameLayout.shadows,
        corners: corners(26),
        transitionMs: 220,
      }}
    >
      {frameLayout.sheenMaterial && (
        <Box
          ariaHidden
          style={{
            layout: { position: 'absolute', inset: insets(0), width: pct(100), height: pct(100) },
            corners: corners(25),
            pointerEvents: 'none',
            material: frameLayout.sheenMaterial,
          }}
        />
      )}

      <DeviceTileWash active={isActive} deviceColor={deviceColor} />

      <Box className="tile-top" style={tileStyles.top}>
        <DeviceTileIconOrb
          id={`rule-${item.entityId}`}
          active={isActive}
          deviceColor={deviceColor}
          ariaLabel={`Enable ${item.name}`}
          disabled={item.toggleDisabled}
          onQuick={() => onToggle(item.entityId)}
          renderIcon={(orbColor) => (
            <UiIcon
              name={card.iconHint}
              size={18}
              color={resolveColorToCss(orbColor, theme, false)}
            />
          )}
        />

        {onRun && !item.needsCutover && (
          <Box style={{ opacity: hovered ? 1 : 0, transitionMs: 160 }}>
            <Pressable
              id={`automation-run-${item.entityId}`}
              ariaLabel={`Run ${item.name} now`}
              stopPropagation
              onActivate={() => onRun(item.entityId)}
              style={{
                layout: {
                  width: px(28),
                  height: px(28),
                  alignItems: 'center',
                  justifyContent: 'center',
                },
                cursor: 'pointer',
                material: new SolidMaterial(
                  mixColor(transparentColor, colorToken('ink'), 0.07),
                ),
                border: {
                  width: 1,
                  color: mixColor(transparentColor, colorToken('ink'), 0.12),
                },
                corners: corners(999, 'round'),
                transitionMs: 160,
                states: {
                  hover: {
                    material: new SolidMaterial(mixColor(transparentColor, colorToken('ink'), 0.14)),
                  },
                  pressed: { transform: { scale: 0.9 } },
                },
              }}
            >
              <UiIcon name="play" size={12} color={hovered ? inkCss : mutedCss} />
            </Pressable>
          </Box>
        )}
      </Box>

      <Pressable
        id={`automation-edit-${item.entityId}`}
        className="tile-body"
        disabled={!item.canEdit}
        onActivate={() => onEdit(item.entityId)}
        style={tileStyles.body}
      >
        <Row gapPx={5} align="center" style={{ layout: { maxWidth: pct(100) } }}>
          <Text semantic="small" style={tileStyles.subtitle}>
            {card.categoryLabel}
          </Text>
          {item.needsCutover && (
            <Box
              style={{
                layout: { padding: insets(2, 6), alignItems: 'center', justifyContent: 'center' },
                pointerEvents: 'none',
                corners: corners(10),
                material: new SolidMaterial(mixColor(transparentColor, colorToken('ink'), 0.07)),
                border: { width: 1, color: mixColor(transparentColor, colorToken('ink'), 0.1) },
              }}
            >
              <Text size={8.5} weight={600} tone="muted" style={{ typography: { lineHeight: 1.1 } }}>
                HA Cutover
              </Text>
            </Box>
          )}
        </Row>

        <Text semantic="strong" style={tileStyles.name}>
          {item.name}
        </Text>

        <DeviceTileStateText
          state={stateText}
          stateKey={`${isActive ? 'on' : 'off'}:${stateText}`}
          style={{
            ...tileStyles.state,
            typography: {
              ...tileStyles.state.typography,
              color: isActive ? colorToken('textSecondary') : colorToken('textMuted'),
            },
          }}
        />
      </Pressable>

      {item.needsCutover && (
        <Pressable
          id={`automation-cutover-${item.entityId}`}
          className="tile-restore"
          disabled={item.cuttingOver || (item.cutoverDisabled ?? !item.canEdit)}
          onActivate={() => onCutover(item)}
          style={{
            layout: {
              margin: { top: px(10) },
              direction: 'row',
              alignItems: 'center',
              alignSelf: 'start',
              gap: px(6),
              minHeight: px(28),
              padding: insets(0, 10),
              zIndex: 2,
            },
            cursor: 'pointer',
            corners: corners(8),
            border: { width: 1, color: colorToken('border') },
            material: new SolidMaterial(colorToken('card')),
            transitionMs: 150,
            states: {
              hover: { material: new SolidMaterial(colorToken('soft')) },
              pressed: { transform: { scale: 0.97 } },
            },
          }}
        >
          <UiIcon name="check-circle" size={13} color={inkCss} />
          <Text size={10.5} weight={600} tone="primary">
            {item.cuttingOver ? 'Cutting over…' : 'I disabled the HA source'}
          </Text>
        </Pressable>
      )}

      <GlassRim
        preset="card"
        variant="card"
        opacity={isActive ? (hovered ? 0.88 : 0.76) : hovered ? 0.76 : 0.56}
        tintColor={isActive ? deviceColor : undefined}
      />
    </Box>
  );
}

/** Monochrome starter card sharing DeviceTile glass frame, hover lift, icon orb, and superellipse rim. */
export function StarterAutomationTile({
  template,
  onSelect,
}: {
  readonly template: AutomationStarterTemplate;
  readonly onSelect: () => void;
}) {
  const { theme, viewport } = useHausUi();
  const [hovered, setHovered] = useState(false);
  const tokens = getDeviceTileTokens(theme.mode);
  const frameLayout = buildTileFrameStyle({
    mode: theme.mode,
    active: false,
    hovered,
    highContrast: viewport.highContrast,
    reducedTransparency: viewport.reducedTransparency,
    deviceColor: tokens.deviceNeutral,
    hasRestore: false,
  });
  const mutedCss = resolveColorToCss(colorToken('textMuted'), theme, false);
  const inkCss = resolveColorToCss(colorToken('textPrimary'), theme, false);

  return (
    <Box
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      style={{
        layout: {
          flexGrow: 1,
          minWidth: px(185),
          maxWidth: px(280),
          minHeight: px(112),
          position: 'relative',
          overflow: 'hidden',
        },
        material: frameLayout.material,
        border: frameLayout.border,
        shadows: frameLayout.shadows,
        corners: corners(24),
        transitionMs: 220,
      }}
    >
      {frameLayout.sheenMaterial && (
        <Box
          ariaHidden
          style={{
            layout: { position: 'absolute', inset: insets(0), width: pct(100), height: pct(100) },
            corners: corners(23),
            pointerEvents: 'none',
            material: frameLayout.sheenMaterial,
          }}
        />
      )}
      <Pressable
        id={`automation-template-${template.id}`}
        onActivate={onSelect}
        style={{
          layout: {
            width: pct(100),
            minHeight: px(112),
            padding: insets(13, 14),
            direction: 'column',
            justifyContent: 'between',
            alignItems: 'start',
            position: 'relative',
            zIndex: 1,
          },
          cursor: 'pointer',
          material: new SolidMaterial(transparentColor),
          border: { width: 0, style: 'none', color: transparentColor },
          states: { pressed: { transform: { scale: 0.98 } } },
        }}
      >
        <Row align="center" justify="between" style={{ layout: { width: pct(100) } }}>
          <DeviceTileIconOrb
            active={hovered}
            deviceColor={tokens.deviceNeutral}
            ariaLabel={template.title}
            renderIcon={(orbColor) => (
              <UiIcon
                name={template.iconHint}
                size={17}
                color={resolveColorToCss(orbColor, theme, false)}
              />
            )}
          />
          <UiIcon name="plus" size={14} color={hovered ? inkCss : mutedCss} />
        </Row>
        <Box style={{ layout: { margin: { top: px(10) } } }}>
          <Text size={13} weight={600}>
            {template.title}
          </Text>
          <Text
            size={11}
            tone="muted"
            style={{
              layout: { margin: { top: px(2) } },
              typography: { lineHeight: 1.3, maxLines: 1, truncate: true },
            }}
          >
            {template.subtitle}
          </Text>
        </Box>
      </Pressable>
      <GlassRim preset="card" variant="card" opacity={hovered ? 0.76 : 0.54} />
    </Box>
  );
}
