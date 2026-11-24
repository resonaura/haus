/* @jsxImportSource @gpuix/react */
/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { EventPayload, KeyEvent, StyleDesc } from '@gpuix/react';
import { Button } from '@gpuix/react/button';
import { Dialog, DialogBackdrop, DialogPopup, DialogPortal } from '@gpuix/react/dialog';
import { colorToken } from '../ir/geometry.js';
import { normalizeMaterialIR, UiNode, type UiInteractiveStateStyle, type UiStyleSpec } from '../ir/node.js';
import { resolveColorToCss, type RenderContext } from '../renderers/contract.js';
import type { HostKeyEvent, UiContentHost } from '../renderers/host.js';
import { ReactNativeRenderer } from '../renderers/react-native.js';
import { GpuiSelect } from './select.js';
import { GpuiVideo } from './video.js';
import { GpuiRange } from './range.js';

const renderer = new ReactNativeRenderer();

function backgroundForMaterial(
  style: UiStyleSpec | undefined,
  context: RenderContext,
): StyleDesc['background'] {
  const material = normalizeMaterialIR(style?.material);
  const first = material?.kind === 'gradient' ? material.stops[0] : undefined;
  const last = material?.kind === 'gradient' ? material.stops.at(-1) : undefined;
  if (
    material?.kind === 'gradient' &&
    material.gradientType === 'linear' &&
    material.stops.length === 2 &&
    first &&
    last
  ) {
    return {
      type: 'linear-gradient',
      angle: material.angleDeg,
      stops: [
        { position: first.offset, color: resolveColorToCss(first.color, context.theme, false) },
        { position: last.offset, color: resolveColorToCss(last.color, context.theme, false) },
      ],
    };
  }
  return undefined;
}

function overlayStyleDesc(
  overlay: UiInteractiveStateStyle | undefined,
  context: RenderContext,
): StyleDesc | undefined {
  if (!overlay) return undefined;
  const overlaySpec: UiStyleSpec = {
    ...(overlay.material ? { material: overlay.material } : {}),
    ...(overlay.border ? { border: overlay.border } : {}),
    ...(overlay.opacity !== undefined ? { opacity: overlay.opacity } : {}),
    ...(overlay.transform ? { transform: overlay.transform } : {}),
    ...(overlay.shadows ? { shadows: overlay.shadows } : {}),
    ...(overlay.cursor ? { cursor: overlay.cursor } : {}),
    ...(overlay.textColor ? { typography: { color: overlay.textColor } } : {}),
  };
  const rendered = renderer.render(new UiNode({ kind: 'box', style: overlaySpec }), context).style;
  const background = backgroundForMaterial(overlaySpec, context);
  const resolved: StyleDesc = {
    ...rendered,
    ...(background ? { background } : {}),
    ...(overlay.cursor ? { cursor: overlay.cursor } : {}),
  };
  return resolved;
}

function styleFor(style: UiStyleSpec | undefined, context: RenderContext): StyleDesc {
  const { layout } = style ?? {};
  const background = backgroundForMaterial(style, context);
  const hover = overlayStyleDesc(style?.states?.hover, context);
  const active = overlayStyleDesc(style?.states?.pressed, context);
  const focusVisible = overlayStyleDesc(style?.states?.focus, context);
  return {
    display: layout?.display === 'grid' || layout?.display === 'none' ? layout.display : 'flex',
    flexDirection: 'column',
    ...renderer.render(new UiNode({ kind: 'box', style }), context).style,
    background,
    gridTemplateColumns: typeof layout?.gridColumns === 'number' ? layout.gridColumns : undefined,
    overflowX: layout?.overflowX,
    overflowY: layout?.overflowY,
    pointerEvents: style?.pointerEvents,
    ...(style?.cursor ? { cursor: style.cursor } : {}),
    ...(hover ? { hover } : {}),
    ...(active ? { active } : {}),
    ...(focusVisible ? { focusVisible } : {}),
  };
}

function gpuiSecondaryHandler(onSecondaryPress?: () => void) {
  if (!onSecondaryPress) return undefined;
  return (event: EventPayload) => {
    if (event.isRightClick || event.button === 2) onSecondaryPress();
  };
}

function gpuiKeyHandler(onKeyDown?: (event: HostKeyEvent) => void) {
  if (!onKeyDown) return undefined;
  return (event: KeyEvent) => {
    onKeyDown({
      key: event.key ?? '',
      altKey: event.modifiers?.alt ?? false,
      shiftKey: event.modifiers?.shift ?? false,
      ctrlKey: event.modifiers?.ctrl ?? false,
      metaKey: event.modifiers?.cmd ?? false,
      target: event.elementId,
      currentTarget: event.elementId,
      preventDefault: () => event.preventDefault(),
      stopPropagation: () => event.stopPropagation(),
    });
  };
}

export const GPUIX_CONTENT_HOST: UiContentHost = {
  nativeInteractiveStates: true,
  renderDialogFrame: ({ title, onClose, backdrop, panel, children }, context) => {
    const backdropStyle = styleFor(backdrop, context);
    return (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <DialogPortal
          style={{
            paddingTop: backdropStyle.paddingTop,
            paddingRight: backdropStyle.paddingRight,
            paddingBottom: backdropStyle.paddingBottom,
            paddingLeft: backdropStyle.paddingLeft,
            alignItems: backdropStyle.alignItems,
            justifyContent: backdropStyle.justifyContent,
          }}
        >
          <DialogBackdrop style={{ backgroundColor: backdropStyle.backgroundColor }} />
          <DialogPopup testId="dialog-panel" aria-label={title} style={styleFor(panel, context)}>
            {children}
          </DialogPopup>
        </DialogPortal>
      </Dialog>
    );
  },
  renderScrollView: (
    { id, style, orientation, role, ariaLabel, children, hidden, isEnabled = true, onScroll },
    context,
  ) => (
    <div
      testId={id}
      role={role}
      aria-label={ariaLabel}
      onScrollChange={onScroll}
      style={{
        ...styleFor(style, context),
        display: hidden ? 'none' : 'flex',
        overflowX: orientation === 'horizontal' && isEnabled ? 'scroll' : undefined,
        overflowY: orientation !== 'horizontal' && isEnabled ? 'scroll' : undefined,
        flexShrink: 1,
      }}
    >
      {children}
    </div>
  ),
  renderRangeInput: (props) => <GpuiRange {...props} />,
  renderSelect: (props, context) => (
    <GpuiSelect props={props} style={styleFor(props.style, context)} context={context} />
  ),
  renderImage: ({ id, src, alt, ariaHidden, objectFit, style }, context) => (
    <img
      testId={id}
      src={src}
      alt={alt}
      role={ariaHidden ? 'presentation' : 'img'}
      aria-label={ariaHidden ? undefined : alt}
      style={styleFor(style, context)}
      objectFit={objectFit ?? 'fill'}
    />
  ),
  renderVideo: (props, context) => (
    <GpuiVideo video={props} style={styleFor(props.style, context)} />
  ),
  renderBox: (
    { children, style, id, ariaLabel, ariaLevel, role, onPress, onSecondaryPress, onKeyDown },
    context,
  ) => (
    <div
      testId={id}
      aria-label={ariaLabel}
      aria-level={ariaLevel}
      role={role ?? (ariaLabel ? 'group' : undefined)}
      onClick={onPress}
      onAuxClick={gpuiSecondaryHandler(onSecondaryPress)}
      onKeyDown={gpuiKeyHandler(onKeyDown)}
      style={styleFor(style, context)}
    >
      {children}
    </div>
  ),
  renderDivider: ({ id, style }, context) => <div testId={id} style={styleFor(style, context)} />,
  renderText: ({ children, style, role, ariaLabel }, context) => (
    <text
      role={role}
      aria-label={ariaLabel}
      style={{
        color: resolveColorToCss(colorToken('textPrimary'), context.theme, false),
        ...styleFor(style, context),
        textOverflow: style?.typography?.maxLines ? 'ellipsis' : undefined,
        lineClamp: style?.typography?.maxLines,
      }}
    >
      {children}
    </text>
  ),
  renderHeading: ({ id, level, children, style }, context) => (
    <text testId={id} role="heading" aria-level={level} style={styleFor(style, context)}>
      {children}
    </text>
  ),
  renderTextInput: (
    {
      id,
      value,
      style,
      ariaLabel,
      placeholder,
      readOnly,
      disabled,
      autoFocus,
      maxLength,
      onChange,
      onSubmit,
    },
    context,
  ) => (
    <input
      testId={id}
      aria-label={ariaLabel}
      value={value}
      placeholder={placeholder}
      readOnly={disabled || readOnly}
      autoFocus={autoFocus}
      onChange={
        onChange && !disabled
          ? (event: EventPayload) => onChange(event.value?.slice(0, maxLength) ?? '')
          : undefined
      }
      onSubmit={disabled ? undefined : onSubmit}
      style={styleFor(style, context)}
    />
  ),
  renderTextArea: ({ id, value, style, ariaLabel, placeholder, rows, readOnly, disabled, onChange }, context) => (
    <textarea
      testId={id}
      aria-label={ariaLabel}
      value={value}
      placeholder={placeholder}
      minRows={rows ?? 4}
      readOnly={disabled || readOnly}
      onChange={
        onChange && !disabled
          ? (event: EventPayload) => onChange(event.value ?? '')
          : undefined
      }
      style={styleFor(style, context)}
    />
  ),
  renderPressable: (
    {
      children,
      style,
      id,
      role,
      ariaLabel,
      ariaChecked,
      ariaExpanded,
      ariaPressed,
      disabled,
      onActivate,
      onSecondaryPress,
      onKeyDown,
      onPointerEnter,
      onPointerLeave,
      onPointerDown,
      onPointerUp,
    },
    context,
  ) => {
    const resolved = styleFor(style, context);
    const nativeHover = disabled ? undefined : (resolved.hover ?? (style ? undefined : { backgroundColor: '#32333e' }));
    const nativeActive = disabled ? undefined : resolved.active;
    const nativeFocusVisible = { outlineColor: '#9bb6ff', outlineWidth: 2, ...resolved.focusVisible };
    return (
      <Button
        testId={id}
        role={role}
        aria-label={ariaLabel}
        aria-expanded={ariaExpanded}
        aria-selected={ariaPressed ?? ariaChecked}
        disabled={disabled}
        onClick={onActivate}
        onAuxClick={gpuiSecondaryHandler(onSecondaryPress)}
        onKeyDown={gpuiKeyHandler(onKeyDown)}
        onMouseEnter={onPointerEnter}
        onMouseLeave={onPointerLeave}
        onMouseDown={onPointerDown}
        onMouseUp={onPointerUp}
        style={{
          color: resolveColorToCss(colorToken('textPrimary'), context.theme, false),
          ...resolved,
          cursor: disabled ? 'default' : (resolved.cursor ?? 'pointer'),
          hover: nativeHover,
          active: nativeActive,
          focusVisible: nativeFocusVisible,
        }}
      >
        {children}
      </Button>
    );
  },
  renderVector: ({ id, rawSvgMarkup, width, height, stroke, ariaHidden, ariaLabel }, context) => (
    <svg
      testId={id}
      source={rawSvgMarkup?.replaceAll('="currentColor"', '="#000"')}
      role={ariaHidden ? 'presentation' : 'img'}
      aria-label={ariaLabel}
      style={{
        width: typeof width === 'number' || width === '100%' ? width : undefined,
        height: typeof height === 'number' ? height : undefined,
        color:
          stroke && stroke !== 'currentColor'
            ? stroke
            : resolveColorToCss(colorToken('textPrimary'), context.theme, false),
      }}
    />
  ),
};
