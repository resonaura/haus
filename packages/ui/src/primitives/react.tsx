/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import * as React from 'react';
import type { UiNode, UiStyleSpec } from '../ir/node.js';
import {
  BadgeBlueprint,
  GlassSurfaceBlueprint,
  ModalBlueprint,
  ProgressBarBlueprint,
  QrCardBlueprint,
  SplitPaneBlueprint,
  SurfaceBlueprint,
  UpdateCardBlueprint,
  type BadgeBlueprintProps,
  type GlassSurfaceBlueprintProps,
  type ModalBlueprintProps,
  type ProgressBarBlueprintProps,
  type QrCardBlueprintProps,
  type SplitPaneBlueprintProps,
  type SurfaceBlueprintProps,
  type UpdateCardBlueprintProps,
} from './blueprints.js';
import { useHausUi } from './context.js';
import { Box, Heading, Row, Stack, Text } from './elements.js';
import { renderUiNodeThroughHost } from './node-bridge.js';

export {
  HausUiProvider,
  useHausStyles,
  useHausUi,
  type HausUiContextValue,
  type HausUiProviderProps,
} from './context.js';

/** Renders any pure OOP `UiNode` scene graph through the active platform host adapter. */
export function HausNodeView({ node }: { readonly node: UiNode }): React.ReactElement {
  const ctx = useHausUi();
  return renderUiNodeThroughHost(node, ctx);
}

const SURFACE_BLUEPRINT = new SurfaceBlueprint();
const GLASS_BLUEPRINT = new GlassSurfaceBlueprint();
const BADGE_BLUEPRINT = new BadgeBlueprint();
const SPLIT_BLUEPRINT = new SplitPaneBlueprint();
const MODAL_BLUEPRINT = new ModalBlueprint();
const PROGRESS_BLUEPRINT = new ProgressBarBlueprint();
const UPDATE_BLUEPRINT = new UpdateCardBlueprint();
const QR_BLUEPRINT = new QrCardBlueprint();

export interface HausSurfaceProps extends Omit<SurfaceBlueprintProps, 'children'> {
  readonly className?: string;
  readonly children?: React.ReactNode;
}

export function HausSurface({
  className,
  children,
  ...blueprintProps
}: HausSurfaceProps): React.ReactElement {
  const ctx = useHausUi();
  const node = SURFACE_BLUEPRINT.build(blueprintProps, ctx.theme);
  return (
    <Box id={node.id} className={className} style={node.style} dataKind="surface">
      {children}
    </Box>
  );
}

export interface HausGlassSurfaceProps extends Omit<GlassSurfaceBlueprintProps, 'children'> {
  readonly className?: string;
  readonly children?: React.ReactNode;
}

export function HausGlassSurface({
  className,
  children,
  ...blueprintProps
}: HausGlassSurfaceProps): React.ReactElement {
  const ctx = useHausUi();
  const node = GLASS_BLUEPRINT.build(blueprintProps, ctx.theme);
  return (
    <Box id={node.id} className={className} style={node.style} dataKind="glass-surface">
      {children}
    </Box>
  );
}

export function HausBadge(props: BadgeBlueprintProps): React.ReactElement {
  const ctx = useHausUi();
  const node = BADGE_BLUEPRINT.build(props, ctx.theme);
  return (
    <Text id={node.id} style={node.style}>
      {props.label}
    </Text>
  );
}

export interface HausCardProps {
  readonly id?: string;
  readonly title?: string;
  readonly subtitle?: string;
  readonly badge?: { readonly label: string; readonly tone?: BadgeBlueprintProps['tone'] };
  readonly glass?: boolean;
  readonly paddingPx?: number;
  readonly style?: UiStyleSpec;
  readonly className?: string;
  readonly headerRight?: React.ReactNode;
  readonly children?: React.ReactNode;
}

export function HausCard({
  id,
  title,
  subtitle,
  badge,
  glass = true,
  paddingPx = 14,
  style,
  className,
  headerRight,
  children,
}: HausCardProps): React.ReactElement {
  const SurfaceComp = glass ? HausGlassSurface : HausSurface;
  return (
    <SurfaceComp id={id} paddingPx={paddingPx} style={style} className={className}>
      {(title || subtitle || badge || headerRight) && (
        <Row
          justify="between"
          gapPx={10}
          style={
            children ? { layout: { margin: { bottom: { unit: 'px', value: 10 } } } } : undefined
          }
        >
          <Stack gapPx={2} style={{ layout: { minWidth: { unit: 'px', value: 0 } } }}>
            {title && (
              <Heading level={4} size={13}>
                {title}
              </Heading>
            )}
            {subtitle && (
              <Text tone="muted" size={11.5}>
                {subtitle}
              </Text>
            )}
          </Stack>
          <Row gapPx={8} style={{ layout: { flexShrink: 0 } }}>
            {badge && <HausBadge label={badge.label} tone={badge.tone} />}
            {headerRight}
          </Row>
        </Row>
      )}
      {children}
    </SurfaceComp>
  );
}

export interface HausSplitPaneProps extends Omit<SplitPaneBlueprintProps, 'children'> {
  readonly className?: string;
  readonly children?: React.ReactNode;
}

export function HausSplitPane({
  className,
  children,
  ...rest
}: HausSplitPaneProps): React.ReactElement {
  const ctx = useHausUi();
  const childCount = React.Children.count(children);
  const placeholderNodes = Array.from({ length: Math.max(1, childCount) }, () =>
    SURFACE_BLUEPRINT.build({}, ctx.theme),
  );
  const node = SPLIT_BLUEPRINT.build(
    { ...rest, children: placeholderNodes },
    ctx.theme,
    ctx.viewport,
  );
  return (
    <Box id={node.id} className={className} style={node.style} dataKind="split">
      {children}
    </Box>
  );
}

export interface HausModalProps extends Omit<
  ModalBlueprintProps,
  'children' | 'headerActions' | 'footer'
> {
  readonly className?: string;
  readonly headerActions?: React.ReactNode;
  readonly footer?: React.ReactNode;
  readonly children?: React.ReactNode;
}

export function HausModal({
  className,
  title,
  subtitle,
  size = 'adaptive',
  glass = true,
  richContentCount,
  style: customStyle,
  headerActions,
  footer,
  children,
}: HausModalProps): React.ReactElement {
  const ctx = useHausUi();
  const node = MODAL_BLUEPRINT.build(
    {
      title,
      subtitle,
      size,
      glass,
      richContentCount: richContentCount ?? React.Children.count(children),
      style: customStyle,
    },
    ctx.theme,
    ctx.viewport,
  );
  return (
    <Box className={className} style={node.style} role="dialog" ariaLabel={title} dataKind="modal">
      <Row justify="between" gapPx={12}>
        <Stack gapPx={4}>
          <Heading level={2}>{title}</Heading>
          {subtitle && (
            <Text tone="muted" size={13}>
              {subtitle}
            </Text>
          )}
        </Stack>
        {headerActions}
      </Row>
      {children}
      {footer}
    </Box>
  );
}

export function HausProgressBar(props: ProgressBarBlueprintProps): React.ReactElement {
  const ctx = useHausUi();
  const node = PROGRESS_BLUEPRINT.build(props);
  return renderUiNodeThroughHost(node, ctx);
}

export function HausUpdateCard(props: UpdateCardBlueprintProps): React.ReactElement {
  const ctx = useHausUi();
  const node = UPDATE_BLUEPRINT.build(props, ctx.theme, ctx.viewport);
  return renderUiNodeThroughHost(node, ctx);
}

export function HausQrCard(props: QrCardBlueprintProps): React.ReactElement {
  const ctx = useHausUi();
  const node = QR_BLUEPRINT.build(props, ctx.theme);
  return renderUiNodeThroughHost(node, ctx);
}
