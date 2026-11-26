/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useState, type ReactNode } from 'react';
import {
  colorToken,
  corners,
  insets,
  mixColor,
  pct,
  px,
  rgba,
  transparentColor,
} from '../ir/geometry.js';
import { GradientMaterial, SolidMaterial } from '../ir/materials.js';
import { useHausUi } from '../primitives/context.js';
import { Box, Pressable, Text } from '../primitives/elements.js';
import { GlassRim } from '../primitives/glass-rim.js';
import { resolveColorToCss } from '../renderers/contract.js';
import { parseCssColor } from './devices/tile-theme.js';
import { UiIcon } from './icon.js';
import {
  SCENE_ART_TOP_CORNERS,
  SceneArtwork,
  SceneIcon,
  type ParsedSceneSwatch,
} from './scenes/artwork.js';
import {
  buildSceneCardFrame,
  SCENE_BADGE_STYLE,
  SCENE_DETAILS_BACKDROP,
  SCENE_ICON_BACKDROP,
  SCENE_WHITE_INK,
  SceneRooms,
} from './scenes/theme.js';

export { SceneIcon, SceneRooms };

export interface SceneCardProps {
  readonly id?: string;
  readonly name: string;
  readonly title: string;
  readonly room: string;
  readonly icon?: string;
  readonly source?: string;
  readonly colors: readonly string[];
  readonly count: number;
  readonly dark?: boolean;
  readonly active?: boolean;
  readonly match?: boolean;
  readonly applying?: boolean;
  readonly completed?: boolean;
  readonly disabled?: boolean;
  readonly details?: boolean;
  readonly showAccessoryCount?: boolean;
  /** Retained for call-site compatibility; SceneCard renders the unified surface on all hosts. */
  readonly portable?: boolean;
  readonly menuOpen?: boolean;
  readonly options?: ReactNode;
  readonly onContextOptions?: () => void;
  readonly onActivate: () => void;
}

export function SceneCard({
  id,
  name,
  title,
  room,
  icon,
  source,
  colors,
  count,
  dark = false,
  active = false,
  match = false,
  applying = false,
  completed = false,
  disabled = false,
  details = false,
  showAccessoryCount = true,
  menuOpen = false,
  options,
  onContextOptions,
  onActivate,
}: SceneCardProps) {
  const { theme, viewport } = useHausUi();
  const [hovered, setHovered] = useState(false);
  const isDarkTheme = theme.mode === 'dark';
  const action = `${details ? 'Details for' : 'Apply'} ${name}`;
  const swatches: ParsedSceneSwatch[] = colors.slice(0, 5).flatMap((css) => {
    const parsed = parseCssColor(css);
    return parsed ? [{ css, color: parsed }] : [];
  });
  const caption = completed
    ? 'Applied'
    : showAccessoryCount
      ? `${count ? `${count} ${count === 1 ? 'accessory' : 'accessories'}` : 'Scene'}${match ? ' · Settings match' : ''}`
      : undefined;
  const hasOptionsButton = Boolean(options || onContextOptions);
  const whiteCss = resolveColorToCss(SCENE_WHITE_INK, theme, false);
  const ink = colorToken('ink');
  const frame = buildSceneCardFrame({
    mode: theme.mode,
    active,
    applying,
    hovered,
    highContrast: viewport.highContrast,
    reducedTransparency: viewport.reducedTransparency,
    leadColor: swatches[0]?.color,
  });

  return (
    <Box
      semantic="article"
      className={['mood-card', active && 'is-active-scene', dark && 'is-dark-scene']
        .filter(Boolean)
        .join(' ')}
      dataAttrs={{
        'data-haus-scene-card': 'shared',
        'data-haus-glass-rim': 'managed',
        'data-menu-open': menuOpen || undefined,
        'data-pending': applying || undefined,
      }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onSecondaryPress={onContextOptions}
      style={{
        layout: {
          display: 'flex',
          direction: 'column',
          width: pct(100),
          minWidth: px(0),
          minHeight: px(178),
          position: 'relative',
          overflow: 'hidden',
        },
        corners: corners(26),
        border: { width: 1, color: frame.borderColor },
        material: frame.material,
        shadows: frame.shadows,
        transitionMs: 220,
      }}
    >
      {frame.sheenMaterial && (
        <Box
          ariaHidden
          style={{
            layout: { position: 'absolute', inset: insets(0), width: pct(100), height: pct(100) },
            corners: corners(25),
            pointerEvents: 'none',
            material: frame.sheenMaterial,
          }}
        />
      )}
      <Pressable
        id={id}
        className="mood-activate"
        title={action}
        ariaLabel={`${action}${source ? `, ${source}` : ''}${active ? ', active settings' : ''}`}
        ariaBusy={applying}
        disabled={disabled}
        onActivate={onActivate}
        style={{
          layout: {
            display: 'flex',
            direction: 'column',
            width: pct(100),
            flexGrow: 1,
            alignItems: 'stretch',
            position: 'relative',
            zIndex: 1,
          },
          opacity: disabled ? 0.65 : 1,
          material: new SolidMaterial(transparentColor),
          border: { width: 0, style: 'none', color: transparentColor },
        }}
      >
        <Box
          className="mood-art"
          style={{
            layout: {
              position: 'relative',
              display: 'flex',
              direction: 'row',
              justifyContent: 'between',
              alignItems: 'end',
              width: pct(100),
              height: px(76),
              flexShrink: 0,
              padding: insets(12, 14),
              overflow: 'hidden',
            },
            corners: SCENE_ART_TOP_CORNERS,
          }}
        >
          <SceneArtwork swatches={swatches} darkScene={dark} isDarkTheme={isDarkTheme} />
          <Box
            ariaHidden
            style={{
              layout: {
                position: 'absolute',
                inset: insets(0),
                width: pct(100),
                height: pct(100),
                zIndex: 1,
              },
              pointerEvents: 'none',
              material: new GradientMaterial(
                [
                  { offset: 0, color: rgba(0, 0, 0, 0.3) },
                  { offset: 0.72, color: rgba(0, 0, 0, 0) },
                ],
                0,
                'linear',
              ),
            }}
          />
          {source && (
            <Box
              className="scene-source-badge"
              style={{
                ...SCENE_BADGE_STYLE,
                layout: {
                  ...SCENE_BADGE_STYLE.layout,
                  position: 'absolute',
                  inset: { top: px(10), left: px(14) },
                  zIndex: 2,
                },
                pointerEvents: 'none',
              }}
            >
              <Text style={{ typography: SCENE_BADGE_STYLE.typography }}>{source}</Text>
            </Box>
          )}
          {(active || applying) && (
            <Box
              className="scene-active-badge"
              style={{
                ...SCENE_BADGE_STYLE,
                layout: {
                  ...SCENE_BADGE_STYLE.layout,
                  position: 'absolute',
                  inset: { top: px(10), right: px(hasOptionsButton ? 46 : 12) },
                  zIndex: 2,
                },
                pointerEvents: 'none',
              }}
            >
              <UiIcon
                size={11}
                name={applying ? 'loader-circle' : 'check'}
                className={applying ? 'spin' : ''}
                color={whiteCss}
              />
              <Text style={{ typography: SCENE_BADGE_STYLE.typography }}>
                {applying ? 'Applying…' : 'Active'}
              </Text>
            </Box>
          )}
          <Box
            ariaHidden
            className="mood-icon"
            style={{
              layout: {
                position: 'relative',
                zIndex: 2,
                width: px(32),
                height: px(32),
                flexShrink: 0,
                alignItems: 'center',
                justifyContent: 'center',
              },
              corners: corners(9),
              material: SCENE_ICON_BACKDROP,
              pointerEvents: 'none',
            }}
          >
            {applying || completed ? (
              <UiIcon
                name={applying ? 'loader-circle' : 'check'}
                size={19}
                className={applying ? 'spin' : ''}
                color={whiteCss}
              />
            ) : (
              <SceneIcon name={name} icon={icon} color={whiteCss} />
            )}
          </Box>
          <Box
            className="scene-swatches"
            ariaLabel={swatches.length ? 'Configured light colors' : 'No scene colors provided'}
            style={{
              layout: {
                position: 'relative',
                zIndex: 2,
                direction: 'row',
                alignItems: 'center',
                gap: px(3),
              },
              pointerEvents: 'none',
            }}
          >
            {swatches.map(({ color }, index) => (
              <Box
                key={index}
                ariaHidden
                style={{
                  layout: { width: px(11), height: px(11), flexShrink: 0 },
                  material: new SolidMaterial(color),
                  corners: corners(999, 'round'),
                  border: { width: 1, color: rgba(255, 255, 255, 0.24) },
                }}
              />
            ))}
          </Box>
        </Box>
        <Box
          ariaHidden
          style={{
            layout: { width: pct(100), height: px(1), flexShrink: 0 },
            material: new SolidMaterial(mixColor(transparentColor, ink, 0.06)),
          }}
        />
        <Box
          className="mood-preview"
          style={{
            layout: {
              display: 'flex',
              direction: 'column',
              width: pct(100),
              flexGrow: 1,
              padding: insets(13, 14, 15, 14),
              gap: px(3),
            },
            material: active
              ? new GradientMaterial(
                  [
                    { offset: 0, color: mixColor(transparentColor, ink, 0.06) },
                    { offset: 0.8, color: transparentColor },
                  ],
                  125,
                  'linear',
                )
              : undefined,
          }}
        >
          <Text
            semantic="small"
            style={{
              typography: {
                size: 10,
                color: colorToken('textMuted'),
                lineHeight: 1.3,
                maxLines: 1,
                truncate: true,
              },
            }}
          >
            {room}
          </Text>
          <Text
            semantic="strong"
            style={{
              typography: {
                size: 13,
                weight: 600,
                color: colorToken('textPrimary'),
                lineHeight: 1.35,
                maxLines: 1,
                truncate: true,
              },
            }}
          >
            {title}
          </Text>
          {caption && (
            <Text
              style={{
                typography: {
                  size: 10.5,
                  color: colorToken('textMuted'),
                  lineHeight: 1.25,
                  maxLines: 1,
                  truncate: true,
                },
              }}
            >
              {caption}
            </Text>
          )}
        </Box>
      </Pressable>
      {!options && onContextOptions ? (
        <Pressable
          id={id ? `${id}-options` : undefined}
          className="mood-details"
          ariaLabel={`Options for ${name}`}
          onActivate={onContextOptions}
          style={{
            layout: {
              position: 'absolute',
              inset: { top: px(10), right: px(10) },
              width: px(28),
              height: px(28),
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 3,
            },
            corners: corners(999, 'round'),
            opacity: hovered || menuOpen ? 1 : 0,
            transitionMs: 140,
            material: SCENE_DETAILS_BACKDROP,
            border: { width: 0, style: 'none', color: transparentColor },
            states: { hover: { material: new SolidMaterial(rgba(0, 0, 0, 0.65)) } },
          }}
        >
          <UiIcon name="more-horizontal" size={16} color={whiteCss} />
        </Pressable>
      ) : (
        options
      )}
      <GlassRim preset="card" radiusPx={25} opacity={hovered ? 0.72 : 0.48} />
    </Box>
  );
}
