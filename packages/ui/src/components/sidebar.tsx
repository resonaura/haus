/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
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
import { SolidMaterial } from '../ir/materials.js';
import type { UiMotionSpec } from '../ir/motion.js';
import { useHausUi } from '../primitives/context.js';
import { Box, Pressable, Row, ScrollView, Stack, Text } from '../primitives/elements.js';
import { resolveColorToCss } from '../renderers/contract.js';
import { SCROLL_SHADOW_PRESETS } from '../renderers/scroll-shadow.js';
import { SidebarNavButton } from './chrome.js';
import { UiIcon } from './icon.js';
import type { UiIconName } from './icons.js';

export interface SidebarItem<Route extends string> {
  readonly id: Route;
  readonly label: string;
  readonly icon: UiIconName;
  readonly badge?: string | number;
}

export interface SidebarGroup<Route extends string> {
  readonly title?: string;
  readonly count?: number;
  readonly items: readonly SidebarItem<Route>[];
}

export interface SidebarContextualItem {
  readonly id: string;
  readonly testId?: string;
  readonly label: string;
  readonly icon: UiIconName;
}

export interface SidebarContextualNav {
  readonly backId?: string;
  readonly backLabel: string;
  readonly eyebrow?: string;
  readonly title: string;
  readonly icon?: ReactNode;
  readonly iconName?: UiIconName;
  readonly status?: 'online' | 'offline' | 'paused' | 'unknown';
  readonly activeId: string;
  readonly items: readonly SidebarContextualItem[];
  readonly onSelect: (id: string) => void;
  readonly onBack: () => void;
}

export const sidebarWidths = { compact: 56, expanded: 232 };

export function SidebarLayout<Route extends string>({
  items,
  groups,
  footer,
  contextual,
  expandedWidth = sidebarWidths.expanded,
  selected,
  onSelect,
  backedByWindow = false,
  children,
}: {
  readonly items?: readonly SidebarItem<Route>[];
  readonly groups?: readonly SidebarGroup<Route>[];
  readonly footer?: SidebarItem<Route>;
  readonly contextual?: SidebarContextualNav;
  readonly expandedWidth?: number;
  readonly selected: Route;
  readonly onSelect: (route: Route) => void;
  readonly backedByWindow?: boolean;
  readonly children: ReactNode;
}) {
  const { theme } = useHausUi();
  const dark = theme.mode === 'dark';
  const primaryCss = resolveColorToCss(colorToken('textPrimary'), theme, false);
  const mutedCss = resolveColorToCss(colorToken('textMuted'), theme, false);

  // Retain the outgoing contextual pane while sliding out, matching Electron's Sidebar.tsx 1:1.
  const [lastContextual, setLastContextual] = useState(contextual);
  const [sliding, setSliding] = useState(false);
  const [slideEpoch, setSlideEpoch] = useState(0);
  const contextOpen = Boolean(contextual);
  const wasOpen = useRef(contextOpen);

  useLayoutEffect(() => {
    if (wasOpen.current === contextOpen) return;
    wasOpen.current = contextOpen;
    setSliding(true);
    setSlideEpoch((count) => count + 1);
    const timer = setTimeout(() => setSliding(false), 340);
    return () => clearTimeout(timer);
  }, [contextOpen]);

  useLayoutEffect(() => {
    if (contextual) setLastContextual(contextual);
  }, [contextual]);

  const activeContextual = contextual ?? lastContextual;
  const sidebarWidth = expandedWidth;
  const padX = 14;

  const paneBlurMotion: UiMotionSpec = sliding
    ? {
        initial: { blur: 0 },
        animate: { blur: [0, slideEpoch % 2 === 0 ? 1.5 : 1.501, 0] },
        times: [0, 0.35, 1],
        durationMs: 320,
        ease: 'easeOut',
      }
    : {
        initial: false,
        animate: { blur: 0 },
        durationMs: 1,
      };

  const renderItem = (item: SidebarItem<Route>) => {
    const isActive = selected === item.id;
    return (
      <SidebarNavButton
        key={item.id}
        id={`sidebar-${item.id}`}
        label={item.label}
        icon={<UiIcon name={item.icon} size={18} color={isActive ? primaryCss : mutedCss} />}
        active={isActive}
        onSelect={() => onSelect(item.id)}
        badge={item.badge}
        portable
      />
    );
  };

  const statusColor =
    activeContextual?.status === 'online'
      ? dark
        ? rgba(255, 255, 255, 1)
        : colorToken('textPrimary')
      : activeContextual?.status === 'offline'
        ? rgba(237, 130, 123, 1)
        : colorToken('textMuted');

  const paneBaseLayout = {
    display: 'flex' as const,
    direction: 'column' as const,
    width: px(sidebarWidth),
    height: pct(100),
    flexShrink: 0,
    minWidth: px(0),
    minHeight: px(0),
    padding: insets(0, padX),
  };

  return (
    <Row gapPx={0} align="stretch" style={{ layout: { width: pct(100), height: pct(100) } }}>
      <Stack
        id="sidebar"
        semantic="nav"
        role="navigation"
        ariaLabel="Haus"
        gapPx={0}
        style={{
          layout: {
            width: px(sidebarWidth),
            flexShrink: 0,
            overflow: 'hidden',
          },
          material: backedByWindow ? undefined : new SolidMaterial(colorToken('surfaceSecondary')),
        }}
      >
        <Box ariaHidden style={{ layout: { height: px(45), flexShrink: 0 } }} />

        <Box
          className={`sidebar-context-viewport ${sliding ? 'is-sliding' : ''}`}
          dataAttrs={{ 'data-server-open': String(contextOpen) }}
          style={{
            layout: {
              flexGrow: 1,
              minHeight: px(0),
              width: pct(100),
              overflow: 'hidden',
              position: 'relative',
            },
          }}
        >
          <Box
            className="sidebar-context-track"
            motion={{
              initial: false,
              animate: { left: contextOpen ? -sidebarWidth : 0 },
              durationMs: 320,
              ease: [0.22, 1, 0.36, 1],
            }}
            style={{
              layout: {
                position: 'absolute',
                inset: { top: px(0), bottom: px(0), left: px(0) },
                display: 'flex',
                direction: 'row',
                width: px(sidebarWidth * 2),
                height: pct(100),
              },
            }}
          >
            <Box
              className="sidebar-context-pane"
              inert={contextOpen}
              ariaHidden={contextOpen}
              motion={paneBlurMotion}
              style={{ layout: paneBaseLayout, pointerEvents: contextOpen ? 'none' : 'auto' }}
            >
              <ScrollView
                orientation="vertical"
                shadowSizePx={SCROLL_SHADOW_PRESETS.sidebar}
                hideScrollBar
                style={{
                  layout: {
                    flexGrow: 1,
                    minHeight: px(0),
                    direction: 'column',
                    gap: px(14),
                    padding: insets(0, 0, 12, 0),
                  },
                }}
              >
                {(groups ?? [{ items: items ?? [] }]).map((group) => (
                  <Stack key={group.title ?? group.items[0]?.id} gapPx={3}>
                    {group.title && (
                      <Text
                        tone="muted"
                        size={9}
                        weight={600}
                        style={{
                          layout: { padding: insets(12, 11, 7, 11) },
                          typography: { letterSpacing: 0.11, lineHeight: 1.5 },
                        }}
                      >
                        {group.count !== undefined ? `${group.title} ${group.count}` : group.title}
                      </Text>
                    )}
                    {group.items.map(renderItem)}
                  </Stack>
                ))}
              </ScrollView>
              {footer && (
                <>
                  <Box
                    style={{
                      layout: { height: px(1), flexShrink: 0 },
                      material: new SolidMaterial(colorToken('borderSubtle')),
                    }}
                  />
                  <Box style={{ layout: { padding: insets(10, 0, 10, 0), flexShrink: 0 } }}>
                    {renderItem(footer)}
                  </Box>
                </>
              )}
            </Box>

            <Box
              className="sidebar-context-pane"
              inert={!contextOpen}
              ariaHidden={!contextOpen}
              motion={paneBlurMotion}
              style={{ layout: paneBaseLayout, pointerEvents: contextOpen ? 'auto' : 'none' }}
            >
              {activeContextual && (
                <ScrollView
                  orientation="vertical"
                  shadowSizePx={SCROLL_SHADOW_PRESETS.sidebar}
                  hideScrollBar
                  ariaLabel={`${activeContextual.title} navigation`}
                  style={{
                    layout: {
                      flexGrow: 1,
                      minHeight: px(0),
                      direction: 'column',
                      gap: px(0),
                      padding: insets(0, 0, 12, 0),
                    },
                  }}
                >
                  <Pressable
                    id={activeContextual.backId}
                    onActivate={activeContextual.onBack}
                    style={{
                      layout: {
                        display: 'flex',
                        direction: 'row',
                        alignItems: 'center',
                        gap: px(9),
                        width: pct(100),
                        minHeight: px(36),
                        padding: insets(8, 11),
                      },
                      corners: corners(9),
                      border: { width: 0, style: 'none', color: transparentColor },
                      material: new SolidMaterial(transparentColor),
                      states: {
                        hover: {
                          material: new SolidMaterial(
                            mixColor(transparentColor, colorToken('ink'), 0.04),
                          ),
                        },
                      },
                    }}
                  >
                    <UiIcon name="arrow-left" size={18} color={mutedCss} />
                    <Text size={12} tone="muted">
                      {activeContextual.backLabel}
                    </Text>
                  </Pressable>

                  <Row
                    align="center"
                    gapPx={10}
                    style={{ layout: { margin: insets(17, 8, 23, 8) } }}
                  >
                    <Box
                      style={{
                        layout: {
                          width: px(40),
                          height: px(40),
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          position: 'relative',
                        },
                        corners: corners(12),
                        material: new SolidMaterial(
                          mixColor(transparentColor, colorToken('ink'), 0.05),
                        ),
                      }}
                    >
                      {activeContextual.icon ?? (
                        <UiIcon
                          name={activeContextual.iconName ?? 'server'}
                          size={22}
                          color={primaryCss}
                        />
                      )}
                      {activeContextual.status && (
                        <Box
                          role="img"
                          ariaLabel={`Server ${activeContextual.status}`}
                          style={{
                            layout: {
                              position: 'absolute',
                              inset: { right: px(-1), bottom: px(-1) },
                              width: px(7),
                              height: px(7),
                            },
                            corners: corners(999, 'round'),
                            material: new SolidMaterial(statusColor),
                            opacity: activeContextual.status === 'unknown' ? 0.45 : 1,
                            shadows:
                              activeContextual.status === 'online' && dark
                                ? [
                                    {
                                      offsetX: 0,
                                      offsetY: 0,
                                      blurRadius: 5,
                                      color: rgba(255, 255, 255, 0.55),
                                    },
                                  ]
                                : undefined,
                          }}
                        />
                      )}
                    </Box>
                    <Stack gapPx={4} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
                      <Text
                        size={8}
                        weight={600}
                        tone="muted"
                        style={{ typography: { letterSpacing: 0.12, uppercase: true } }}
                      >
                        {activeContextual.eyebrow ?? 'HOME SERVER'}
                      </Text>
                      <Text
                        size={14}
                        weight={600}
                        style={{
                          typography: {
                            maxLines: 1,
                            truncate: true,
                            color: colorToken('textPrimary'),
                          },
                        }}
                      >
                        {activeContextual.title}
                      </Text>
                    </Stack>
                  </Row>

                  <Stack gapPx={3}>
                    {activeContextual.items.map((item) => {
                      const isActive = activeContextual.activeId === item.id;
                      return (
                        <SidebarNavButton
                          key={item.id}
                          id={item.testId}
                          label={item.label}
                          icon={
                            <UiIcon
                              name={item.icon}
                              size={18}
                              color={isActive ? primaryCss : mutedCss}
                            />
                          }
                          active={isActive}
                          onSelect={() => activeContextual.onSelect(item.id)}
                          portable
                        />
                      );
                    })}
                  </Stack>
                </ScrollView>
              )}
            </Box>
          </Box>
        </Box>
      </Stack>
      <Box
        semantic="main"
        style={{
          layout: { flexGrow: 1, width: px(0), minWidth: px(0) },
          material: new SolidMaterial(colorToken('canvas')),
        }}
      >
        {children}
      </Box>
    </Row>
  );
}
