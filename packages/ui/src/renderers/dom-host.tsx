/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import * as React from 'react';
import type { RenderContext } from './contract.js';
import type {
  HostBoxProps,
  HostCanvasProps,
  HostCheckboxProps,
  HostCodeProps,
  HostDisclosureProps,
  HostDividerProps,
  HostFileInputProps,
  HostFormProps,
  HostGlassRimProps,
  HostHeadingProps,
  HostImageProps,
  HostPopoverProps,
  HostProgressiveBlurProps,
  HostLinkProps,
  HostPressableProps,
  HostRangeInputProps,
  HostScrollViewProps,
  HostSelectProps,
  HostTextAreaProps,
  HostTextInputProps,
  HostTextProps,
  HostVectorProps,
  HostVideoProps,
  UiHostAdapter,
} from './host.js';
import {
  BOX_SEMANTIC_TAG,
  buildDomBoxProps,
  collectDataAttrs,
  mergeSurfaceStyle,
  TEXT_SEMANTIC_TAG,
} from './dom-helpers.js';
import { DomCheckbox, DomFileInput, DomSelect, DomTextArea, DomTextInput } from './dom-inputs.js';
import { DomGlassRim } from './dom-glass-rim.js';
import { DomCanvas, DomVector, DomVideo } from './dom-media.js';
import { DomMotionBox } from './dom-motion.js';
import { DomPopover } from './dom-popover.js';
import { DomScrollView } from './dom-scroll.js';
import { compileStyleToReactCss, renderSvgShaderDefs } from './react-dom.js';

/**
 * Browser / Electron DOM implementation of `UiHostAdapter`.
 * This is the sole boundary that emits HTML elements for `@haus/ui` TSX components.
 */
export class DomHostAdapter implements UiHostAdapter {
  readonly target = 'react-dom' as const;
  private readonly escapeStack: Array<() => void> = [];

  private readonly handleEscapeKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    const top = this.escapeStack[this.escapeStack.length - 1];
    if (!top) return;
    event.preventDefault();
    top();
  };

  renderBox(props: HostBoxProps, context: RenderContext): React.ReactElement {
    const { style, shaderId } = compileStyleToReactCss(props.style ?? {}, context);
    const mergedStyle = mergeSurfaceStyle(style, props.surfaceTokens);
    if (props.motion) {
      return (
        <DomMotionBox
          props={props}
          motion={props.motion}
          mergedStyle={mergedStyle}
          shaderId={shaderId}
          reducedMotion={context.viewport.reducedMotion}
        />
      );
    }
    const tag = BOX_SEMANTIC_TAG[props.semantic ?? 'box'];
    const elementProps = buildDomBoxProps(props, mergedStyle, shaderId);
    return tag === 'col'
      ? React.createElement(tag, elementProps)
      : React.createElement(tag, elementProps, props.children);
  }

  renderText(props: HostTextProps, context: RenderContext): React.ReactElement {
    const { style } = compileStyleToReactCss(props.style ?? {}, context);
    const mergedStyle = mergeSurfaceStyle(style, props.surfaceTokens);
    const dataProps = collectDataAttrs(props.dataAttrs);
    const tag = TEXT_SEMANTIC_TAG[props.semantic ?? (props.asParagraph ? 'p' : 'span')];
    if (tag === 'br') {
      return React.createElement('br', { id: props.id, className: props.className });
    }
    return React.createElement(
      tag,
      {
        ref: props.textRef as React.Ref<HTMLElement> | undefined,
        id: props.id,
        htmlFor: props.htmlFor,
        dateTime: props.dateTime,
        className: props.className,
        style: mergedStyle,
        role: props.role,
        title: props.title,
        'aria-label': props.ariaLabel,
        'aria-hidden': props.ariaHidden,
        'aria-live': props.ariaLive,
        'data-haus-kind': props.dataKind ?? 'text',
        ...dataProps,
      },
      props.children,
    );
  }

  renderHeading(props: HostHeadingProps, context: RenderContext): React.ReactElement {
    const { style } = compileStyleToReactCss(props.style ?? {}, context);
    const dataProps = collectDataAttrs(props.dataAttrs);
    const tag = `h${props.level ?? 3}`;
    return React.createElement(
      tag,
      {
        ref: props.headingRef as React.Ref<HTMLHeadingElement> | undefined,
        id: props.id,
        title: props.title,
        tabIndex: props.tabIndex,
        className: props.className,
        style: { margin: 0, ...style },
        'data-haus-kind': props.dataKind ?? 'heading',
        ...dataProps,
      },
      props.children,
    );
  }

  renderPressable(props: HostPressableProps, context: RenderContext): React.ReactElement {
    const { style, shaderId } = compileStyleToReactCss(props.style ?? {}, context);
    const mergedStyle = mergeSurfaceStyle(style, props.surfaceTokens);
    const dataProps = collectDataAttrs(props.dataAttrs);
    return (
      <button
        ref={props.pressableRef as React.Ref<HTMLButtonElement> | undefined}
        id={props.id}
        type={props.type ?? 'button'}
        form={props.form}
        className={props.className}
        style={mergedStyle}
        role={props.role}
        title={props.title}
        tabIndex={props.tabIndex}
        disabled={props.disabled}
        aria-label={props.ariaLabel}
        aria-labelledby={props.ariaLabelledBy}
        aria-busy={props.ariaBusy}
        aria-current={props.ariaCurrent}
        aria-haspopup={props.ariaHasPopup}
        aria-checked={props.ariaChecked}
        aria-selected={props.ariaSelected}
        aria-pressed={props.ariaPressed}
        aria-expanded={props.ariaExpanded}
        aria-controls={props.ariaControls}
        data-haus-kind={props.dataKind ?? 'button'}
        data-haus-variant={props.dataVariant}
        data-haus-shader={shaderId}
        {...dataProps}
        onMouseEnter={props.onPointerEnter}
        onMouseLeave={props.onPointerLeave}
        onPointerDown={props.onPointerDown}
        onPointerUp={props.onPointerUp}
        onFocus={props.onFocus}
        onBlur={props.onBlur}
        onContextMenu={
          props.onContextMenu || props.onSecondaryPress
            ? (event) => {
                props.onContextMenu?.(event);
                if (props.onSecondaryPress && !event.defaultPrevented) {
                  event.preventDefault();
                  props.onSecondaryPress();
                }
              }
            : undefined
        }
        onDoubleClick={props.disabled ? undefined : props.onDoublePress}
        onKeyDown={
          props.onKeyDown
            ? (event) =>
                props.onKeyDown?.({
                  key: event.key,
                  target: event.target,
                  currentTarget: event.currentTarget,
                  preventDefault: () => event.preventDefault(),
                  stopPropagation: () => event.stopPropagation(),
                })
            : undefined
        }
        onClick={
          props.disabled
            ? undefined
            : (event) => {
                if (props.stopPropagation) event.stopPropagation();
                props.onPress?.(event);
                props.onActivate?.();
              }
        }
      >
        {props.children}
      </button>
    );
  }

  renderRangeInput(props: HostRangeInputProps): React.ReactElement {
    return (
      <input
        id={props.id}
        type="range"
        aria-label={props.ariaLabel}
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        disabled={props.disabled}
        data-haus-kind="range-input"
        onChange={(event) => props.onChange?.(Number(event.target.value))}
        onPointerUp={(event) => props.onChangeEnd?.(Number(event.currentTarget.value))}
        onKeyUp={(event) => props.onChangeEnd?.(Number(event.currentTarget.value))}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          margin: 0,
          opacity: 0,
          cursor: props.disabled ? 'not-allowed' : 'pointer',
        }}
      />
    );
  }

  renderTextInput(props: HostTextInputProps, context: RenderContext): React.ReactElement {
    return <DomTextInput props={props} context={context} />;
  }

  renderSelect(props: HostSelectProps, context: RenderContext): React.ReactElement {
    return <DomSelect props={props} context={context} />;
  }

  renderCheckbox(props: HostCheckboxProps, context: RenderContext): React.ReactElement {
    return <DomCheckbox props={props} context={context} />;
  }

  renderFileInput(props: HostFileInputProps, context: RenderContext): React.ReactElement {
    return <DomFileInput props={props} context={context} />;
  }

  renderScrollView(props: HostScrollViewProps, context: RenderContext): React.ReactElement {
    return <DomScrollView props={props} context={context} />;
  }

  renderImage(props: HostImageProps, context: RenderContext): React.ReactElement {
    const { style } = compileStyleToReactCss(props.style ?? {}, context);
    const filter = props.dropShadow
      ? `drop-shadow(${props.dropShadow.offsetX}px ${props.dropShadow.offsetY}px ${props.dropShadow.blurRadius}px ${props.dropShadow.color})`
      : style.filter;
    const mergedStyle: React.CSSProperties = {
      ...style,
      ...(props.objectFit ? { objectFit: props.objectFit } : {}),
      ...(filter !== undefined ? { filter } : {}),
    };
    return (
      <img
        id={props.id}
        className={props.className}
        src={props.src}
        alt={props.alt ?? ''}
        aria-hidden={props.ariaHidden}
        onLoad={props.onLoad}
        data-haus-kind="image"
        style={mergedStyle}
      />
    );
  }

  renderProgressiveBlur(
    { maxRadius, start, edge = 'bottom', style }: HostProgressiveBlurProps,
    context: RenderContext,
  ) {
    const { style: css } = compileStyleToReactCss(style, context);
    const layers =
      edge === 'top'
        ? [
            { amount: 1, mask: 'linear-gradient(#000 20%, transparent 75%)' },
            { amount: 0.5, mask: 'linear-gradient(#000 45%, transparent 90%)' },
            { amount: 1 / 6, mask: 'linear-gradient(#000 70%, transparent)' },
          ]
        : [0.25, 0.53, 1].map((amount, index) => {
            const begin = start + (1 - start) * index * 0.27;
            const end = start + ((1 - start) * (index + 1)) / 3;
            return {
              amount,
              mask: `linear-gradient(transparent ${begin * 100}%, black ${end * 100}%)`,
            };
          });
    return (
      <span aria-hidden="true" style={{ ...css, pointerEvents: 'none', overflow: 'hidden' }}>
        {layers.map((layer) => (
          <span
            key={layer.amount}
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: 'inherit',
              backdropFilter: `blur(${Number((maxRadius * layer.amount).toFixed(2))}px)`,
              WebkitBackdropFilter: `blur(${Number((maxRadius * layer.amount).toFixed(2))}px)`,
              maskImage: layer.mask,
              WebkitMaskImage: layer.mask,
            }}
          />
        ))}
      </span>
    );
  }

  renderVector(props: HostVectorProps, context: RenderContext): React.ReactElement {
    return <DomVector props={props} context={context} />;
  }

  renderVideo(props: HostVideoProps, context: RenderContext): React.ReactElement {
    return <DomVideo props={props} context={context} />;
  }

  renderCanvas(props: HostCanvasProps, context: RenderContext): React.ReactElement {
    return <DomCanvas props={props} context={context} />;
  }

  renderLink(props: HostLinkProps, context: RenderContext): React.ReactElement {
    const { style } = compileStyleToReactCss(props.style ?? {}, context);
    return (
      <a
        id={props.id}
        href={props.href}
        target={props.target}
        rel={props.rel}
        title={props.title}
        className={props.className}
        data-haus-kind="link"
        style={style}
        onClick={
          props.onPress
            ? (event) => {
                event.preventDefault();
                props.onPress?.();
              }
            : undefined
        }
      >
        {props.children}
      </a>
    );
  }

  renderDivider(props: HostDividerProps, context: RenderContext): React.ReactElement {
    const { style } = compileStyleToReactCss(props.style ?? {}, context);
    return (
      <hr
        id={props.id}
        className={props.className}
        data-haus-kind="divider"
        style={{ border: 'none', margin: 0, ...style }}
      />
    );
  }

  renderTextArea(props: HostTextAreaProps, context: RenderContext): React.ReactElement {
    return <DomTextArea props={props} context={context} />;
  }

  renderForm(props: HostFormProps, context: RenderContext): React.ReactElement {
    const { style } = compileStyleToReactCss(props.style ?? {}, context);
    return (
      <form
        id={props.id}
        className={props.className}
        noValidate={props.noValidate}
        data-haus-kind="form"
        style={style}
        onSubmit={(event) => {
          event.preventDefault();
          props.onSubmit?.();
        }}
      >
        {props.children}
      </form>
    );
  }

  renderCode(props: HostCodeProps, context: RenderContext): React.ReactElement {
    const { style } = compileStyleToReactCss(props.style ?? {}, context);
    if (props.block) {
      return (
        <pre
          id={props.id}
          title={props.title}
          aria-label={props.ariaLabel}
          className={props.className}
          data-haus-kind="code-block"
          style={style}
        >
          <code>{props.children}</code>
        </pre>
      );
    }
    return (
      <code
        id={props.id}
        title={props.title}
        aria-label={props.ariaLabel}
        className={props.className}
        data-haus-kind="code"
        style={style}
      >
        {props.children}
      </code>
    );
  }

  renderDisclosure(props: HostDisclosureProps, context: RenderContext): React.ReactElement {
    const { style } = compileStyleToReactCss(props.style ?? {}, context);
    return (
      <details
        id={props.id}
        className={props.className}
        open={props.defaultOpen}
        data-haus-kind="disclosure"
        style={style}
        onToggle={
          props.onToggle ? (event) => props.onToggle?.(event.currentTarget.open) : undefined
        }
      >
        <summary>{props.summary}</summary>
        {props.children}
      </details>
    );
  }

  renderShaderDefs(registry: Parameters<typeof renderSvgShaderDefs>[0]): React.ReactElement | null {
    return renderSvgShaderDefs(registry);
  }

  renderPopover(props: HostPopoverProps, context: RenderContext): React.ReactElement {
    return <DomPopover props={props} context={context} />;
  }

  renderGlassRim(props: HostGlassRimProps, context: RenderContext): React.ReactElement | null {
    return <DomGlassRim props={props} context={context} />;
  }

  subscribeEscape(onEscape: () => void): () => void {
    if (typeof window === 'undefined') return () => undefined;
    const entry = () => {
      onEscape();
    };
    if (this.escapeStack.length === 0) {
      window.addEventListener('keydown', this.handleEscapeKeyDown);
    }
    this.escapeStack.push(entry);
    return () => {
      const index = this.escapeStack.lastIndexOf(entry);
      if (index !== -1) this.escapeStack.splice(index, 1);
      if (this.escapeStack.length === 0) {
        window.removeEventListener('keydown', this.handleEscapeKeyDown);
      }
    };
  }
}

export const DOM_HOST_ADAPTER: UiHostAdapter = new DomHostAdapter();
