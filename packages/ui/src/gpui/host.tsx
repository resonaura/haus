/* @jsxImportSource @gpuix/react */
/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type {
  EventPayload,
  KeyEvent,
  MotionEase,
  MotionStyle,
  MotionTargetStyle,
  MotionTargetValue,
  PublicInstance,
} from '@gpuix/react';
import { Button } from '@gpuix/react/button';
import { colorToken } from '../ir/geometry.js';
import type { UiMotionEase, UiMotionSpec, UiMotionTarget, UiMotionValue } from '../ir/motion.js';
import { resolveColorToCss } from '../renderers/contract.js';
import type { HostKeyEvent, UiContentHost } from '../renderers/host.js';
import { assignRef } from '../renderers/scroll-handle.js';
import { GpuiCanvas } from './canvas/index.js';
import { renderGpuiDialogFrame } from './dialog-frame.js';
import { GpuiSelect } from './select.js';
import { GpuiGlassRim } from './glass-rim.js';
import { GpuiLayoutBox } from './layout-motion.js';
import { GpuiPopover } from './popover.js';
import { GpuiScrollView } from './scroll-view.js';
import { styleFor } from './style.js';
import { buildGpuiSvgSource } from './vector.js';
import { GpuiVideo } from './video.js';
import { motion } from '@gpuix/react';
import { renderProgressiveBlur } from './progressive-blur.js';
import { GpuiRange } from './range.js';

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

function gpuiMotionEase(ease: UiMotionEase | undefined): MotionEase | undefined {
  if (!ease) return undefined;
  return Array.isArray(ease) ? [ease[0], ease[1], ease[2], ease[3]] : (ease as MotionEase);
}

function gpuiMotionValue(value: UiMotionValue, scale = 1): MotionTargetValue {
  if (typeof value === 'number') return value * scale;
  return value.map((item) => (typeof item === 'number' ? item * scale : item));
}

function gpuiMotionInitial(initial: UiMotionSpec['initial']): MotionStyle | false | undefined {
  if (initial === undefined) return false;
  if (initial === false) return false;
  return {
    ...initial,
    ...(initial.blur !== undefined ? { blur: initial.blur * 0.5 } : {}),
  };
}

function gpuiMotionTarget(animate: UiMotionTarget): MotionTargetStyle {
  const out: MotionTargetStyle = {};
  if (animate.opacity !== undefined) out.opacity = gpuiMotionValue(animate.opacity);
  if (animate.left !== undefined) out.left = gpuiMotionValue(animate.left);
  if (animate.x !== undefined) out.x = gpuiMotionValue(animate.x);
  if (animate.y !== undefined) out.y = gpuiMotionValue(animate.y);
  if (animate.scale !== undefined) out.scale = gpuiMotionValue(animate.scale);
  if (animate.scaleX !== undefined) out.scaleX = gpuiMotionValue(animate.scaleX);
  if (animate.scaleY !== undefined) out.scaleY = gpuiMotionValue(animate.scaleY);
  if (animate.rotate !== undefined) out.rotate = gpuiMotionValue(animate.rotate);
  if (animate.blur !== undefined) out.blur = gpuiMotionValue(animate.blur, 0.5);
  return out;
}

function gpuiStaticMotionStyle(motion: UiMotionSpec): MotionStyle {
  const end = (value: UiMotionTarget[keyof UiMotionTarget]): number | undefined => {
    if (value === undefined) return undefined;
    if (typeof value === 'number') return value;
    for (let i = value.length - 1; i >= 0; i--) {
      if (typeof value[i] === 'number') return value[i] as number;
    }
    return undefined;
  };
  const endBlur = end(motion.animate.blur);
  return {
    opacity: end(motion.animate.opacity),
    left: end(motion.animate.left),
    x: end(motion.animate.x),
    y: end(motion.animate.y),
    scale: end(motion.animate.scale),
    scaleX: end(motion.animate.scaleX),
    scaleY: end(motion.animate.scaleY),
    rotate: end(motion.animate.rotate),
    blur: endBlur !== undefined ? endBlur * 0.5 : undefined,
  };
}

export const GPUIX_CONTENT_HOST: UiContentHost = {
  nativeInteractiveStates: true,
  renderProgressiveBlur,
  renderGlassRim: (props, context) => <GpuiGlassRim props={props} context={context} />,
  renderPopover: (props, context) => <GpuiPopover {...props} context={context} />,
  renderDialogFrame: renderGpuiDialogFrame,
  renderScrollView: (props, context) => <GpuiScrollView props={props} context={context} />,
  renderRangeInput: (props) => <GpuiRange {...props} />,
  renderSelect: (props, context) => (
    <GpuiSelect props={props} style={styleFor(props.style, context)} context={context} />
  ),
  renderImage: ({ id, src, alt, ariaHidden, objectFit, transitionMs, style }, context) => (
    <img
      testId={id}
      src={src}
      alt={alt}
      role={ariaHidden ? 'presentation' : 'img'}
      aria-label={ariaHidden ? undefined : alt}
      style={styleFor(style, context)}
      objectFit={objectFit ?? 'fill'}
      transitionMs={transitionMs}
    />
  ),
  renderVideo: (props, context) => (
    <GpuiVideo video={props} style={styleFor(props.style, context)} />
  ),
  renderCanvas: (props, context) => (
    <GpuiCanvas canvas={props} style={styleFor(props.style, context)} />
  ),
  renderBox: (
    {
      children,
      style,
      motion: boxMotion,
      layoutTransition,
      id,
      ariaLabel,
      ariaLevel,
      role,
      boxRef,
      onPress,
      onBackdropPress,
      onSecondaryPress,
      onKeyDown,
      onPointerEnter,
      onPointerLeave,
    },
    context,
  ) => {
    const resolvedStyle = styleFor(style, context);
    const forwardBoxRef = boxRef
      ? (node: PublicInstance | null) => assignRef(boxRef, node)
      : undefined;
    const props = {
      ref: forwardBoxRef,
      testId: id,
      'aria-label': ariaLabel,
      'aria-level': ariaLevel,
      role: role ?? (ariaLabel ? 'group' : undefined),
      onClick: onPress ?? onBackdropPress,
      onAuxClick: gpuiSecondaryHandler(onSecondaryPress),
      onKeyDown: gpuiKeyHandler(onKeyDown),
      onMouseEnter: onPointerEnter,
      onMouseLeave: onPointerLeave,
      style: boxMotion
        ? {
            ...resolvedStyle,
            ...(boxMotion.originX !== undefined || boxMotion.originY !== undefined
              ? { transformOrigin: { x: boxMotion.originX ?? 0.5, y: boxMotion.originY ?? 0.5 } }
              : {}),
          }
        : resolvedStyle,
      children,
    };
    if (boxMotion) {
      if (context.viewport.reducedMotion) {
        const staticMotion = gpuiStaticMotionStyle(boxMotion);
        return (
          <div
            {...props}
            style={{
              ...props.style,
              ...(staticMotion.opacity !== undefined ? { opacity: staticMotion.opacity } : {}),
              ...(staticMotion.left !== undefined ? { left: staticMotion.left } : {}),
              ...(staticMotion.blur !== undefined ? { blur: staticMotion.blur } : {}),
              ...(staticMotion.scale !== undefined ||
              staticMotion.x !== undefined ||
              staticMotion.y !== undefined ||
              staticMotion.rotate !== undefined
                ? {
                    transform: {
                      ...props.style.transform,
                      ...(staticMotion.x !== undefined ? { translateX: staticMotion.x } : {}),
                      ...(staticMotion.y !== undefined ? { translateY: staticMotion.y } : {}),
                      ...(staticMotion.scale !== undefined ? { scale: staticMotion.scale } : {}),
                      ...(staticMotion.rotate !== undefined ? { rotate: staticMotion.rotate } : {}),
                    },
                  }
                : {}),
            }}
          />
        );
      }
      const effectiveEase = boxMotion.ease ?? boxMotion.propertyEases?.transform;
      return (
        <motion.div
          {...props}
          initial={gpuiMotionInitial(boxMotion.initial)}
          animate={gpuiMotionTarget(boxMotion.animate)}
          transition={{
            duration: boxMotion.durationMs / 1000,
            ...(boxMotion.delayMs !== undefined ? { delay: boxMotion.delayMs / 1000 } : {}),
            ...(effectiveEase ? { ease: gpuiMotionEase(effectiveEase) } : {}),
            ...(boxMotion.times ? { times: [...boxMotion.times] } : {}),
            ...(boxMotion.repeat !== undefined ? { repeat: boxMotion.repeat } : {}),
            ...(boxMotion.repeatType ? { repeatType: boxMotion.repeatType } : {}),
          }}
        />
      );
    }
    const hasAnimatableTransform =
      style?.transform?.translateX !== undefined ||
      style?.transform?.translateY !== undefined ||
      style?.transform?.scale !== undefined;
    if (
      style?.transitionMs &&
      (style.opacity !== undefined || hasAnimatableTransform) &&
      !context.viewport.reducedMotion
    ) {
      return (
        <motion.div
          {...props}
          initial={false}
          animate={{
            ...(style.opacity !== undefined ? { opacity: style.opacity } : {}),
            ...(style.transform?.translateX !== undefined ? { x: style.transform.translateX } : {}),
            ...(style.transform?.translateY !== undefined ? { y: style.transform.translateY } : {}),
            ...(style.transform?.scale !== undefined ? { scale: style.transform.scale } : {}),
          }}
          transition={{ duration: style.transitionMs / 1000, ease: [0.22, 1, 0.36, 1] }}
        />
      );
    }
    if (layoutTransition !== undefined) {
      const { ref: _unusedRef, style: elementStyle, ...elementProps } = props;
      return (
        <GpuiLayoutBox
          layoutTransition={layoutTransition}
          reducedMotion={context.viewport.reducedMotion}
          boxRef={boxRef}
          style={elementStyle}
          elementProps={elementProps}
        />
      );
    }
    return <div {...props} />;
  },
  renderDivider: ({ id, style }, context) => <div testId={id} style={styleFor(style, context)} />,
  renderText: ({ id, children, style, role, ariaLabel }, context) => (
    <text
      testId={id}
      role={role}
      aria-label={ariaLabel}
      style={{
        color: resolveColorToCss(colorToken('textPrimary'), context.theme, false),
        ...styleFor(style, context),
        textOverflow: style?.typography?.maxLines === 1 ? 'ellipsis' : undefined,
        lineClamp: style?.typography?.maxLines === 1 ? 1 : undefined,
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
  renderTextArea: (
    { id, value, style, ariaLabel, placeholder, rows, readOnly, disabled, onChange },
    context,
  ) => (
    <textarea
      testId={id}
      aria-label={ariaLabel}
      value={value}
      placeholder={placeholder}
      minRows={rows ?? 4}
      maxRows={rows ?? 8}
      readOnly={disabled || readOnly}
      onChange={
        onChange && !disabled ? (event: EventPayload) => onChange(event.value ?? '') : undefined
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
      pressableRef,
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
    const nativeHover = disabled
      ? undefined
      : (resolved.hover ?? (style ? undefined : { backgroundColor: '#32333e' }));
    const nativeActive = disabled ? undefined : resolved.active;
    const nativeFocusVisible = {
      outlineColor: '#9bb6ff',
      outlineWidth: 2,
      ...resolved.focusVisible,
    };
    const forwardRef = pressableRef
      ? (node: PublicInstance | null) => assignRef(pressableRef, node)
      : undefined;
    return (
      <Button
        ref={forwardRef}
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
  renderVector: (props, context) => {
    const { id, width, height, stroke, ariaHidden, ariaLabel, style } = props;
    const resolved = style ? styleFor(style, context) : undefined;
    return (
      <svg
        testId={id}
        source={buildGpuiSvgSource(props)}
        role={ariaHidden ? 'presentation' : 'img'}
        aria-label={ariaHidden ? undefined : ariaLabel}
        style={{
          ...resolved,
          width: typeof width === 'number' || width === '100%' ? width : resolved?.width,
          height: typeof height === 'number' ? height : resolved?.height,
          color:
            stroke && stroke !== 'currentColor'
              ? stroke
              : (resolved?.color ??
                resolveColorToCss(colorToken('textPrimary'), context.theme, false)),
        }}
      />
    );
  },
};
