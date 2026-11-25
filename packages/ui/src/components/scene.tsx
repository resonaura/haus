/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useState, type ReactNode } from 'react';
import { colorToken, corners, insets, mixColor, pct, px, rgba } from '../ir/geometry.js';
import { SolidMaterial } from '../ir/materials.js';
import { GradientMaterial } from '../ir/materials.js';
import type { UiStyleSpec } from '../ir/node.js';
import { Box, Heading, Pressable, Text } from '../primitives/elements.js';
import { GlassRim } from '../primitives/glass-rim.js';
import { Image } from '../primitives/media.js';
import { UiIcon } from './icon.js';
import type { UiIconName } from './icons.js';

const customIcons = new Map<string, UiIconName>([
  ['mdi:weather-night', 'moon-star'],
  ['mdi:white-balance-sunny', 'sun'],
  ['mdi:sofa', 'armchair'],
  ['mdi:movie-open', 'clapperboard'],
  ['mdi:book-open-variant', 'book-open'],
  ['mdi:home', 'house'],
  ['mdi:sparkles', 'sparkles'],
]);

const sceneIcons: readonly (readonly [RegExp, UiIconName])[] = [
  [/night|sleep/i, 'moon-star'],
  [/movie|cinema|netflix/i, 'clapperboard'],
  [/away|leave/i, 'door-open'],
  [/relax|chill/i, 'armchair'],
  [/read/i, 'book-open'],
  [/concentrate|focus/i, 'focus'],
  [/energ/i, 'sunrise'],
  [/dim|sunset/i, 'sunset'],
  [/bright|day|morning/i, 'sun'],
];

export function SceneIcon({ name, icon, color }: { name: string; icon?: string; color?: string }) {
  const glyph = customIcons.get(icon ?? '') ?? sceneIcons.find(([rule]) => rule.test(name))?.[1];
  return <UiIcon name={glyph ?? 'sparkles'} size={20} color={color} strokeWidth={1.75} />;
}

const white = rgba(255, 255, 255, 0.94);
const glass = new SolidMaterial(rgba(0, 0, 0, 0.35));
const artCorners = { ...corners(15), bottomLeft: 0, bottomRight: 0 };
const badgeStyle: UiStyleSpec = {
  layout: { direction: 'row', alignItems: 'center', gap: px(4), padding: insets(3, 7) },
  typography: { size: 9, weight: 600, color: white },
  material: glass,
  corners: corners(20),
};
const swatchPattern = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i;
const hotspots = [
  { x: 15, y: 100, fade: 65 },
  { x: 80, y: 0, fade: 72 },
  { x: 90, y: 100, fade: 65 },
] as const;

function SceneArtwork({ colors, portable }: { colors: readonly string[]; portable: boolean }) {
  const stops = colors.length
    ? hotspots.map((spot, index) => ({ ...spot, color: colors[index] ?? colors[0] }))
    : [];
  const palette = stops
    .map(
      ({ x, y, color, fade }) =>
        `radial-gradient(ellipse at ${x}% ${y}%, ${color}, transparent ${fade}%)`,
    )
    .join(', ');
  const [layers, setLayers] = useState({ current: palette, previous: '' });
  if (layers.current !== palette) setLayers({ current: palette, previous: layers.current });
  if (portable) {
    if (!stops.length) {
      return (
        <Box
          ariaHidden
          style={{
            layout: { width: pct(100), height: px(76), position: 'absolute', inset: insets(0) },
            corners: artCorners,
            material: new GradientMaterial([
              { offset: 0, color: rgba(255, 255, 255, 0.05) },
              { offset: 1, color: rgba(0, 0, 0, 0.28) },
            ]),
          }}
        />
      );
    }
    const gradients = stops
      .map(
        ({ x, y, fade, color }, index) =>
          `<radialGradient id="scene-${index}" cx="${x}%" cy="${y}%" r="100%"><stop stop-color="${color}"/><stop offset="${fade}%" stop-color="${color}" stop-opacity="0"/></radialGradient>`,
      )
      .join('');
    const layers = stops
      .map((_, index) => `<rect width="100%" height="100%" fill="url(#scene-${index})"/>`)
      .reverse()
      .join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="76" viewBox="0 0 240 76" preserveAspectRatio="none"><defs>${gradients}<linearGradient id="shade" x1="0" x2="0" y1="0.3" y2="1"><stop stop-opacity="0"/><stop offset="1" stop-opacity="0.3"/></linearGradient></defs>${layers}<rect width="100%" height="100%" fill="url(#shade)"/></svg>`;
    return (
      <Image
        src={`data:image/svg+xml,${encodeURIComponent(svg)}`}
        ariaHidden
        style={{
          layout: { width: pct(100), height: px(76), position: 'absolute', inset: insets(0) },
          corners: artCorners,
        }}
      />
    );
  }
  return (
    <>
      <Text
        className="scene-artwork-layer"
        surfaceTokens={{ backgroundImage: layers.previous || undefined }}
        ariaHidden
      />
      <Text
        key={layers.current || 'neutral'}
        className="scene-artwork-layer scene-artwork-current"
        surfaceTokens={{ backgroundImage: layers.current || undefined }}
        ariaHidden
      />
    </>
  );
}

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
  dark,
  active,
  match,
  applying,
  completed,
  disabled,
  details,
  showAccessoryCount = true,
  portable = true,
  menuOpen,
  options,
  onContextOptions,
  onActivate,
}: SceneCardProps) {
  const [hovered, setHovered] = useState(false);
  const action = `${details ? 'Details for' : 'Apply'} ${name}`;
  const swatches = colors.slice(0, 5).flatMap((color) => {
    const rgb = swatchPattern.exec(color)?.slice(1).map(Number);
    return rgb?.length === 3 && rgb.every((channel) => channel <= 255)
      ? [{ color, material: new SolidMaterial(rgba(rgb[0], rgb[1], rgb[2])) }]
      : [];
  });
  const caption = completed
    ? 'Applied'
    : showAccessoryCount
      ? `${count ? `${count} ${count === 1 ? 'accessory' : 'accessories'}` : 'Scene'}${match ? ' · Settings match' : ''}`
      : undefined;
  const Art = portable ? Box : Text;
  return (
    <Box
      semantic="article"
      className={`mood-card ${active ? 'is-active-scene' : ''} ${dark ? 'is-dark-scene' : ''}`}
      dataAttrs={{
        'data-haus-glass-rim': 'managed',
        'data-menu-open': menuOpen || undefined,
        'data-pending': applying || undefined,
      }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onSecondaryPress={onContextOptions}
      style={
        portable
          ? {
              layout: {
                width: pct(100),
                overflow: 'hidden',
                minHeight: px(178),
                position: 'relative',
              },
              corners: corners(16),
              border: {
                width: 1,
                color: active
                  ? mixColor(colorToken('border'), colorToken('ink'), 0.42)
                  : colorToken('border'),
              },
              material: new SolidMaterial(colorToken('surfaceSecondary')),
            }
          : undefined
      }
    >
      <Pressable
        id={id}
        className="mood-activate"
        title={action}
        ariaLabel={`${action}${source ? `, ${source}` : ''}${active ? ', active settings' : ''}`}
        ariaBusy={applying}
        disabled={disabled}
        onActivate={onActivate}
        style={portable ? { layout: { width: pct(100), flexGrow: 1 } } : undefined}
      >
        <Art
          className="mood-art"
          style={
            portable
              ? {
                  layout: {
                    position: 'relative',
                    height: px(76),
                    direction: 'row',
                    justifyContent: 'between',
                    alignItems: 'end',
                    padding: insets(12, 14),
                  },
                  corners: artCorners,
                  material: new SolidMaterial(
                    dark ? mixColor(colorToken('card'), rgba(8, 8, 8), 0.3) : colorToken('soft'),
                  ),
                }
              : undefined
          }
        >
          <SceneArtwork colors={swatches.map(({ color }) => color)} portable={portable} />
          {source && (
            <Text
              className="scene-source-badge"
              style={
                portable
                  ? {
                      ...badgeStyle,
                      layout: {
                        ...badgeStyle.layout,
                        position: 'absolute',
                        inset: { top: px(10), left: px(14) },
                      },
                    }
                  : undefined
              }
            >
              {source}
            </Text>
          )}
          {(active || applying) && (
            <Art
              className="scene-active-badge"
              style={
                portable
                  ? {
                      ...badgeStyle,
                      layout: {
                        ...badgeStyle.layout,
                        position: 'absolute',
                        inset: { top: px(10), right: px(14) },
                      },
                    }
                  : undefined
              }
            >
              <UiIcon
                size={11}
                name={applying ? 'loader-circle' : 'check'}
                className={applying ? 'spin' : ''}
                color={portable ? '#fff' : undefined}
              />
              {portable ? (
                <Text style={{ typography: badgeStyle.typography }}>
                  {applying ? 'Applying…' : 'Active'}
                </Text>
              ) : applying ? (
                'Applying…'
              ) : (
                'Active'
              )}
            </Art>
          )}
          <Art
            className="mood-icon"
            style={
              portable
                ? {
                    layout: {
                      width: px(32),
                      height: px(32),
                      alignItems: 'center',
                      justifyContent: 'center',
                    },
                    corners: corners(10),
                    material: glass,
                  }
                : undefined
            }
          >
            {applying || completed ? (
              <UiIcon
                name={applying ? 'loader-circle' : 'check'}
                size={20}
                className={applying ? 'spin' : ''}
                color={portable ? '#fff' : undefined}
              />
            ) : (
              <SceneIcon name={name} icon={icon} color={portable ? '#fff' : undefined} />
            )}
          </Art>
          <Art
            className="scene-swatches"
            ariaLabel={swatches.length ? 'Configured light colors' : 'No scene colors provided'}
            style={portable ? { layout: { direction: 'row', gap: px(3) } } : undefined}
          >
            {swatches.map(({ color, material }, index) => (
              <Text
                semantic="swatch"
                key={index}
                surfaceTokens={{ background: color }}
                style={
                  portable
                    ? {
                        layout: { width: px(11), height: px(11) },
                        material,
                        corners: corners(6),
                        border: { width: 1, color: colorToken('border') },
                      }
                    : undefined
                }
              />
            ))}
          </Art>
        </Art>
        <Art
          className="mood-preview"
          style={
            portable
              ? { layout: { width: pct(100), padding: insets(13, 14, 15, 14), gap: px(4) } }
              : undefined
          }
        >
          <Text
            semantic="small"
            size={portable ? 10 : undefined}
            tone={portable ? 'muted' : undefined}
          >
            {room}
          </Text>
          <Text
            semantic="strong"
            size={portable ? 13 : undefined}
            weight={portable ? 600 : undefined}
            style={portable ? { typography: { maxLines: 1 } } : undefined}
          >
            {title}
          </Text>
          {caption && (
            <Text size={portable ? 10 : undefined} tone={portable ? 'muted' : undefined}>
              {caption}
            </Text>
          )}
        </Art>
      </Pressable>
      {portable && !options && onContextOptions ? (
        <Pressable
          id={id ? `${id}-options` : undefined}
          ariaLabel={`Options for ${name}`}
          onActivate={onContextOptions}
          style={{
            layout: {
              position: 'absolute',
              inset: { bottom: px(12), right: px(10) },
              width: px(28),
              height: px(28),
              alignItems: 'center',
              justifyContent: 'center',
            },
            corners: corners(8),
            states: { hover: { material: new SolidMaterial(colorToken('surfaceHover')) } },
          }}
        >
          <UiIcon name="more-horizontal" size={15} />
        </Pressable>
      ) : (
        options
      )}
      <GlassRim preset="card" radiusPx={portable ? 15 : 25} opacity={hovered ? 0.72 : 0.48} />
    </Box>
  );
}

export function SceneRooms({
  groups,
  portable = true,
}: {
  groups: readonly { id: string; name: string; count: number; children: ReactNode }[];
  portable?: boolean;
}) {
  return (
    <Box className="scene-room-groups" style={portable ? { layout: { gap: px(27) } } : undefined}>
      {groups.map(({ id, name, count, children }) => (
        <Box
          semantic="section"
          id={`scene-group-${id}`}
          key={id}
          style={portable ? { layout: { gap: px(14) } } : undefined}
        >
          <Box
            className="scene-room-heading"
            style={
              portable
                ? { layout: { direction: 'row', alignItems: 'center', gap: px(10) } }
                : undefined
            }
          >
            <Heading
              level={2}
              style={portable ? { typography: { whiteSpace: 'nowrap' } } : undefined}
            >
              {name}
            </Heading>
            <Text
              size={portable ? 11 : undefined}
              tone={portable ? 'muted' : undefined}
              style={portable ? { typography: { whiteSpace: 'nowrap' } } : undefined}
            >
              {`${count} scenes`}
            </Text>
          </Box>
          {children}
        </Box>
      ))}
    </Box>
  );
}
