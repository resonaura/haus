/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useEffect, useRef, type ReactNode, type Ref } from 'react';
import type { DeviceCategory } from '../categories/index.js';
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
import {
  BackdropMaterial,
  GradientMaterial,
  LiquidGlassMaterial,
  SolidMaterial,
} from '../ir/materials.js';
import { useHausUi } from '../primitives/context.js';
import { Box, Pressable, Text } from '../primitives/elements.js';
import { GlassRim } from '../primitives/glass-rim.js';
import { ProgressiveBlur, ScrollView } from '../primitives/media.js';
import { resolveColorToCss } from '../renderers/contract.js';
import type { HostSurfaceTokens } from '../renderers/host.js';
import { keepElementVisibleInScroll } from '../renderers/scroll-handle.js';
import { SCROLL_SHADOW_PRESETS } from '../renderers/scroll-shadow.js';
import { UiIcon } from './icon.js';
import { DEVICE_ICONS, type UiIconName } from './icons.js';

export interface HomeCategoryDockItem {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly icon?: ReactNode;
}

export interface HomeCategoryDockGlass {
  readonly enabled: boolean;
  readonly blurPx?: number;
  readonly refractionStrength?: number;
  readonly dispersion?: number;
}

function categoryIconName(id: string): UiIconName {
  if (id === 'servers') return 'server';
  if (id in DEVICE_ICONS) return DEVICE_ICONS[id as DeviceCategory];
  return 'layout-grid';
}

export function CategoryFilter({
  id,
  name,
  summary,
  icon,
  selected,
  onSelect,
  buttonRef,
}: {
  readonly id?: string;
  readonly name: string;
  readonly summary: string;
  readonly icon: ReactNode;
  readonly selected: boolean;
  readonly onSelect: () => void;
  readonly buttonRef?: Ref<unknown>;
  /** @deprecated Unified across Electron and GPUIX; retained for backwards compatibility. */
  readonly portable?: boolean;
}) {
  const { theme, viewport } = useHausUi();
  const dark = theme.mode === 'dark';
  const compact = viewport.width <= 760;

  return (
    <Pressable
      id={id ? `category-${id}` : 'category-all'}
      className={`home-category-filter ${id ? '' : 'home-category-all'}`.trim()}
      dataAttrs={{
        'data-category': id,
        'data-haus-category-filter': 'shared',
      }}
      ariaPressed={selected}
      selected={selected}
      onActivate={onSelect}
      pressableRef={buttonRef}
      style={{
        layout: {
          display: 'flex',
          direction: 'row',
          alignItems: 'center',
          gap: px(9),
          minHeight: px(compact ? 48 : 50),
          padding: compact ? insets(8, 12) : insets(8, 14),
          position: 'relative',
          flexShrink: 0,
        },
        corners: corners(26, 'superellipse', 1.4),
        border: {
          width: 1,
          style: 'solid',
          color: selected ? colorToken('materialEdge') : transparentColor,
        },
        material: selected
          ? new GradientMaterial(
              [
                {
                  offset: 0,
                  color: mixColor(transparentColor, colorToken('ink'), dark ? 0.08 : 0.12),
                },
                {
                  offset: 1,
                  color: mixColor(transparentColor, colorToken('ink'), dark ? 0.04 : 0.06),
                },
              ],
              155,
              'linear',
            )
          : undefined,
        shadows: selected
          ? [{ offsetX: 0, offsetY: 1, blurRadius: 4, color: rgba(0, 0, 0, 0.08) }]
          : undefined,
        states: selected
          ? undefined
          : {
              hover: {
                material: new SolidMaterial(mixColor(transparentColor, colorToken('ink'), 0.05)),
              },
            },
      }}
    >
      {icon}
      <Box style={{ layout: { display: 'flex', direction: 'column', gap: px(1) } }}>
        <Text
          semantic="strong"
          tone="primary"
          size={11}
          weight={600}
          style={{ typography: { lineHeight: 1.4, whiteSpace: 'nowrap' } }}
        >
          {name}
        </Text>
        <Text
          semantic="small"
          tone={selected ? 'primary' : 'muted'}
          size={9}
          style={{
            typography: { lineHeight: 1.4, whiteSpace: 'nowrap' },
            opacity: selected ? 0.78 : 1,
          }}
        >
          {summary}
        </Text>
      </Box>
      {selected && <GlassRim preset="pill" radiusPx={25} opacity={0.7} />}
    </Pressable>
  );
}

/**
 * Sticky floating Home category dock shared identically across Electron and GPUIX:
 * pins at the top of the main scrollport with a top-down progressive blur veil,
 * frosted / Liquid Glass pill surface, horizontal scroll shadows, and automatic
 * `scrollTo` centering of the active category filter.
 */
export function HomeCategoryDock({
  categories,
  selected,
  onSelect,
  bleedX,
  railScrollId = 'home-category-rail',
  liquidGlass,
  dockRef,
  dockSurfaceTokens,
  filterOverlay,
}: {
  readonly categories: readonly HomeCategoryDockItem[];
  readonly selected: string | null;
  readonly onSelect: (id: string | null) => void;
  /** Horizontal bleed matching the page container padding so progressive blur spans full width. */
  readonly bleedX?: number;
  readonly railScrollId?: string;
  readonly liquidGlass?: HomeCategoryDockGlass;
  readonly dockRef?: Ref<unknown>;
  readonly dockSurfaceTokens?: HostSurfaceTokens;
  readonly filterOverlay?: ReactNode;
}) {
  const { theme, viewport } = useHausUi();
  const dark = theme.mode === 'dark';
  const compact = viewport.width <= 760;
  const railRef = useRef<unknown>(null);
  const activeButtonRef = useRef<unknown>(null);

  const glassEnabled = Boolean(liquidGlass?.enabled && !viewport.reducedTransparency);
  const resolvedBleedX = bleedX ?? (compact ? 19 : viewport.width <= 1180 ? 25 : 32);
  const primaryInk = resolveColorToCss(colorToken('textPrimary'), theme, false);
  const mutedInk = resolveColorToCss(colorToken('textMuted'), theme, false);

  useEffect(() => {
    const container = railRef.current;
    const button = activeButtonRef.current;
    if (!container || !button) return undefined;

    const keepVisible = () => {
      keepElementVisibleInScroll(container, button, {
        axis: 'x',
        align: 'center',
        reducedMotion: viewport.reducedMotion,
      });
    };
    keepVisible();

    if (
      typeof ResizeObserver !== 'undefined' &&
      typeof Element !== 'undefined' &&
      container instanceof Element
    ) {
      const observer = new ResizeObserver(keepVisible);
      observer.observe(container);
      return () => observer.disconnect();
    }
    return undefined;
  }, [selected, viewport.width, viewport.reducedMotion]);

  const dockMaterial = viewport.reducedTransparency
    ? new SolidMaterial(colorToken('card'))
    : glassEnabled
      ? new LiquidGlassMaterial({
          tintColor: dark ? rgba(14, 14, 14, 0.56) : rgba(250, 250, 250, 0.56),
          blurRadius: liquidGlass?.blurPx ?? 16,
          refractionStrength: liquidGlass?.refractionStrength ?? 16,
          chromaticDispersion: liquidGlass?.dispersion ?? 0.55,
          saturation: 1.35,
          tintOpacity: dark ? 0.56 : 0.5,
          rimPreset: 'none',
        })
      : new BackdropMaterial(
          {
            blurRadius: 30,
            saturation: 1.45,
            tintColor: dark ? rgba(14, 14, 14, 0.86) : rgba(250, 250, 250, 0.72),
            tintOpacity: dark ? 0.86 : 0.72,
          },
          { fallbackColor: colorToken('card') },
        );

  return (
    <Box
      id="home-category-layer"
      className="home-category-layer"
      dataAttrs={{
        'data-haus-category-layer': 'shared',
        'data-liquid-glass': glassEnabled || undefined,
      }}
      style={{
        layout: {
          position: 'sticky',
          inset: { top: px(0) },
          zIndex: 20,
          width: pct(100),
          padding: compact ? insets(8, 0, 16, 0) : insets(12, 0, 17, 0),
          margin: compact ? insets(-8, -5, 0, -5) : insets(-12, 0, 0, 0),
          overflow: 'visible',
        },
      }}
    >
      {filterOverlay}
      {!viewport.reducedTransparency && (
        <Box
          className="home-category-progressive-blur"
          ariaHidden
          dataAttrs={{ 'data-haus-category-blur': 'shared' }}
          style={{
            layout: {
              position: 'absolute',
              inset: {
                top: px(-12),
                right: px(-resolvedBleedX),
                bottom: px(-14),
                left: px(-resolvedBleedX),
              },
            },
            pointerEvents: 'none',
          }}
        >
          <ProgressiveBlur
            edge="top"
            maxRadius={18}
            start={0.1}
            style={{ layout: { position: 'absolute', inset: insets(0) } }}
          />
          <Box
            ariaHidden
            style={{
              layout: { position: 'absolute', inset: insets(0) },
              pointerEvents: 'none',
              material: new GradientMaterial(
                [
                  { offset: 0, color: colorToken('canvas') },
                  { offset: 0.58, color: colorToken('canvas', 0.25) },
                  { offset: 1, color: transparentColor },
                ],
                180,
                'linear',
              ),
            }}
          />
        </Box>
      )}
      <Box
        id="home-category-dock"
        semantic="nav"
        boxRef={dockRef}
        className="home-category-dock"
        ariaLabel="Home categories"
        dataAttrs={{ 'data-haus-category-dock': 'shared' }}
        surfaceTokens={dockSurfaceTokens}
        style={{
          layout: {
            position: 'relative',
            alignSelf: 'start',
            maxWidth: pct(100),
            padding: insets(5),
          },
          corners: corners(32, 'superellipse', 1.4),
          border: {
            width: 1,
            style: 'solid',
            color: viewport.highContrast ? colorToken('textMuted') : colorToken('materialEdge'),
          },
          material: dockMaterial,
          shadows: [{ offsetX: 0, offsetY: 6, blurRadius: 22, color: rgba(0, 0, 0, 0.15) }],
        }}
      >
        {!viewport.reducedTransparency && !glassEnabled && (
          <Box
            ariaHidden
            style={{
              layout: { position: 'absolute', inset: insets(0) },
              corners: corners(31, 'superellipse', 1.4),
              pointerEvents: 'none',
              material: new GradientMaterial(
                [
                  { offset: 0, color: rgba(255, 255, 255, dark ? 0.025 : 0.05) },
                  { offset: 0.55, color: transparentColor },
                ],
                165,
                'linear',
              ),
            }}
          />
        )}
        <ScrollView
          id={railScrollId}
          scrollId={railScrollId}
          className="home-category-rail"
          orientation="horizontal"
          shadowSizePx={SCROLL_SHADOW_PRESETS.rail}
          hideScrollBar
          scrollRef={railRef}
          style={{
            layout: {
              display: 'flex',
              direction: 'row',
              alignItems: 'center',
              gap: px(3),
              maxWidth: pct(100),
              minWidth: px(0),
            },
            corners: corners(26, 'superellipse', 1.4),
          }}
        >
          <CategoryFilter
            name="All"
            summary="Your home"
            selected={selected === null}
            icon={
              <UiIcon
                name="house"
                size={19}
                strokeWidth={1.8}
                color={selected === null ? primaryInk : mutedInk}
              />
            }
            onSelect={() => onSelect(null)}
            buttonRef={selected === null ? activeButtonRef : undefined}
          />
          <Box
            className="home-category-divider"
            ariaHidden
            style={{
              layout: {
                width: px(1),
                height: px(24),
                margin: insets(0, 3),
                flexShrink: 0,
              },
              material: new SolidMaterial(colorToken('border')),
            }}
          />
          {categories.map((category) => {
            const active = selected === category.id;
            const icon = category.icon ?? (
              <UiIcon
                name={categoryIconName(category.id)}
                size={19}
                strokeWidth={1.8}
                color={active ? primaryInk : mutedInk}
              />
            );
            return (
              <CategoryFilter
                key={category.id}
                id={category.id}
                name={category.name}
                summary={category.summary}
                selected={active}
                icon={icon}
                onSelect={() => onSelect(active ? null : category.id)}
                buttonRef={active ? activeButtonRef : undefined}
              />
            );
          })}
        </ScrollView>
        <GlassRim preset="dock" radiusPx={31} opacity={0.76} />
      </Box>
    </Box>
  );
}

/** @deprecated Prefer `HomeCategoryDock`; retained for legacy callers. */
export function CategoryRail({ children }: { children: ReactNode }) {
  return (
    <ScrollView
      orientation="horizontal"
      shadowSizePx={SCROLL_SHADOW_PRESETS.rail}
      hideScrollBar
      role="navigation"
      ariaLabel="Home categories"
      style={{
        layout: {
          direction: 'row',
          alignItems: 'center',
          gap: px(3),
          width: pct(100),
          minWidth: px(0),
          padding: insets(5),
          margin: insets(0, 0, 17, 0),
        },
        material: new SolidMaterial(colorToken('card')),
        border: { width: 1, color: colorToken('border') },
        corners: corners(32, 'superellipse', 1.4),
      }}
    >
      {children}
    </ScrollView>
  );
}
