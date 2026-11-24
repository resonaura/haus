/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import * as React from 'react';
import type { RenderContext } from './contract.js';
import { collectDataAttrs, mergeSurfaceStyle } from './dom-helpers.js';
import type {
  HostCanvasProps,
  HostSurfacePointerEvent,
  HostVectorProps,
  HostVideoEvent,
  HostVideoProps,
} from './host-media.js';
import { compileStyleToReactCss } from './react-dom.js';

export function wrapSurfacePointerEvent(
  event: React.PointerEvent<Element>,
): HostSurfacePointerEvent {
  const target = event.currentTarget;
  const pointerId = event.pointerId;
  const rect = target.getBoundingClientRect();
  return {
    pointerId,
    pointerType: event.pointerType,
    button: event.button,
    buttons: event.buttons,
    clientX: event.clientX,
    clientY: event.clientY,
    rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    setPointerCapture: () => target.setPointerCapture(pointerId),
    hasPointerCapture: () => target.hasPointerCapture(pointerId),
    releasePointerCapture: () => target.releasePointerCapture(pointerId),
  };
}

function wrapVideoEvent(event: React.SyntheticEvent<HTMLVideoElement>): HostVideoEvent {
  const el = event.currentTarget;
  return {
    currentTime: el.currentTime,
    duration: el.duration,
    errorCode: el.error?.code,
    target: el,
  };
}

function renderPathElement(
  entry: NonNullable<HostVectorProps['paths']>[number],
  idx: number,
  rootFill?: string,
  rootStroke?: string,
): React.ReactElement {
  const fill =
    entry.fill !== undefined
      ? entry.fill
      : rootFill !== undefined || rootStroke !== undefined
        ? undefined
        : entry.stroke
          ? 'none'
          : 'currentColor';
  return (
    <path
      key={`p-${idx}`}
      ref={entry.pathRef as React.Ref<SVGPathElement> | undefined}
      d={entry.d}
      fill={fill}
      stroke={entry.stroke}
      strokeWidth={entry.strokeWidth}
      strokeLinecap={entry.strokeLinecap}
      strokeLinejoin={entry.strokeLinejoin}
      vectorEffect={entry.vectorEffect}
      opacity={entry.opacity}
      className={entry.className}
    />
  );
}

export function DomVector({
  props,
  context,
}: {
  readonly props: HostVectorProps;
  readonly context: RenderContext;
}): React.ReactElement {
  const { style } = compileStyleToReactCss(props.style ?? {}, context);
  const mergedStyle = mergeSurfaceStyle(style, props.surfaceTokens);

  if (props.rawSvgMarkup !== undefined) {
    return (
      <span
        id={props.id}
        className={props.className}
        style={
          props.stroke
            ? { color: props.stroke, display: 'inline-flex', ...mergedStyle }
            : mergedStyle
        }
        role={props.role}
        aria-label={props.ariaLabel}
        aria-hidden={props.ariaHidden}
        data-haus-kind="vector-markup"
        dangerouslySetInnerHTML={{ __html: props.rawSvgMarkup }}
      />
    );
  }

  const pathsList = props.paths ?? [];
  const hasGroup =
    Boolean(props.groupRef) ||
    Boolean(props.groupMaskId) ||
    Boolean(props.groupTransform) ||
    Boolean(props.innerGroupTransform);
  const groupedPaths = hasGroup
    ? pathsList.filter((p) => p.inGroup !== false && !p.afterGroup)
    : [];
  const afterGroupPaths = hasGroup ? pathsList.filter((p) => p.afterGroup) : [];
  const standalonePaths = hasGroup
    ? pathsList.filter((p) => p.inGroup === false && !p.afterGroup)
    : pathsList;
  const groupedRects = hasGroup ? (props.rects ?? []).filter((r) => r.inGroup !== false) : [];
  const standaloneRects = hasGroup
    ? (props.rects ?? []).filter((r) => r.inGroup === false)
    : (props.rects ?? []);

  const renderRect = (rect: NonNullable<HostVectorProps['rects']>[number], idx: number) => (
    <rect
      key={`r-${idx}`}
      x={rect.x}
      y={rect.y}
      width={rect.width}
      height={rect.height}
      rx={rect.rx}
      ry={rect.ry}
      fill={rect.fill}
      stroke={rect.stroke}
      className={rect.className}
      clipPath={rect.clipPathId ? `url(#${rect.clipPathId})` : undefined}
      style={rect.styleWidth !== undefined ? { width: rect.styleWidth } : undefined}
    />
  );

  const circlesNode = props.circles?.length ? (
    props.circleGroupClassName ? (
      <g className={props.circleGroupClassName}>
        {props.circles.map((c, idx) => (
          <circle
            key={`c-${idx}`}
            cx={c.cx}
            cy={c.cy}
            r={c.r}
            fill={c.fill}
            stroke={c.stroke}
            transform={c.transform}
            strokeDasharray={c.strokeDasharray}
            strokeDashoffset={c.strokeDashoffset}
            className={c.className}
            style={c.opacity !== undefined ? { opacity: c.opacity } : undefined}
          />
        ))}
      </g>
    ) : (
      props.circles.map((c, idx) => (
        <circle
          key={`c-${idx}`}
          cx={c.cx}
          cy={c.cy}
          r={c.r}
          fill={c.fill}
          stroke={c.stroke}
          transform={c.transform}
          strokeDasharray={c.strokeDasharray}
          strokeDashoffset={c.strokeDashoffset}
          className={c.className}
          style={c.opacity !== undefined ? { opacity: c.opacity } : undefined}
        />
      ))
    )
  ) : null;

  const hasDefs =
    Boolean(props.linearGradient) ||
    Boolean(props.clipPaths?.length) ||
    Boolean(props.masks?.length);

  const innerGroupContent = (
    <>
      {groupedPaths.map((p, idx) => renderPathElement(p, idx, props.fill, props.stroke))}
      {groupedRects.map(renderRect)}
    </>
  );

  return (
    <svg
      ref={props.svgRef as React.Ref<SVGSVGElement> | undefined}
      id={props.id}
      width={props.width}
      height={props.height}
      viewBox={`${props.viewX ?? 0} ${props.viewY ?? 0} ${props.viewWidth} ${props.viewHeight}`}
      preserveAspectRatio={props.preserveAspectRatio}
      shapeRendering={props.shapeRendering}
      fill={props.fill}
      stroke={props.stroke}
      strokeWidth={props.strokeWidth}
      strokeLinecap={props.strokeLinecap}
      strokeLinejoin={props.strokeLinejoin}
      role={props.ariaHidden ? undefined : (props.role ?? 'img')}
      tabIndex={props.tabIndex}
      aria-label={props.ariaLabel}
      aria-hidden={props.ariaHidden}
      aria-valuemin={props.ariaValueMin}
      aria-valuemax={props.ariaValueMax}
      aria-valuenow={props.ariaValueNow}
      aria-valuetext={props.ariaValueText}
      aria-disabled={props.ariaDisabled}
      focusable={props.focusable === false ? 'false' : undefined}
      className={props.className}
      data-haus-kind="vector"
      style={mergedStyle}
      onPointerDown={
        props.onPointerDownEvent
          ? (event) => props.onPointerDownEvent?.(wrapSurfacePointerEvent(event))
          : undefined
      }
      onPointerMove={
        props.onPointerMoveRatio || props.onPointerMoveEvent
          ? (event) => {
              if (props.onPointerMoveRatio) {
                const bounds = event.currentTarget.getBoundingClientRect();
                const rx = bounds.width > 0 ? (event.clientX - bounds.left) / bounds.width : 0;
                const ry = bounds.height > 0 ? (event.clientY - bounds.top) / bounds.height : 0;
                props.onPointerMoveRatio(rx, ry);
              }
              if (props.onPointerMoveEvent) {
                props.onPointerMoveEvent(wrapSurfacePointerEvent(event));
              }
            }
          : undefined
      }
      onPointerUp={
        props.onPointerUpEvent
          ? (event) => props.onPointerUpEvent?.(wrapSurfacePointerEvent(event))
          : undefined
      }
      onPointerCancel={props.onPointerCancel}
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
    >
      {hasDefs && (
        <defs>
          {props.linearGradient && (
            <linearGradient id={props.linearGradient.id} x1="0" x2="0" y1="0" y2="1">
              <stop
                offset="0%"
                stopColor={props.linearGradient.color}
                stopOpacity={props.linearGradient.topOpacity}
              />
              <stop
                offset="100%"
                stopColor={props.linearGradient.color}
                stopOpacity={props.linearGradient.bottomOpacity}
              />
            </linearGradient>
          )}
          {props.clipPaths?.map((cp) => (
            <clipPath key={cp.id} id={cp.id}>
              <path d={cp.path} />
            </clipPath>
          ))}
          {props.masks?.map((m) => (
            <mask
              key={m.id}
              id={m.id}
              maskUnits="userSpaceOnUse"
              maskContentUnits="userSpaceOnUse"
              style={{ maskType: 'luminance' }}
              x="0"
              y="0"
              width={m.width}
              height={m.height}
            >
              <rect width={m.width} height={m.height} fill="white" />
              <path
                className={m.cutoutClassName}
                d={m.cutoutPath}
                fill="black"
                stroke="black"
                strokeWidth={m.cutoutStrokeWidth ?? 2}
                strokeLinejoin="round"
              />
            </mask>
          ))}
        </defs>
      )}
      {props.background && (
        <rect
          width={props.viewWidth}
          height={props.viewHeight}
          fill={props.background}
          rx={props.backgroundRadius ?? 0}
        />
      )}
      {props.lines?.map((line, idx) => (
        <line
          key={`l-${idx}`}
          x1={line.x1}
          x2={line.x2}
          y1={line.y1}
          y2={line.y2}
          className={line.className}
        />
      ))}
      {standaloneRects.map(renderRect)}
      {hasGroup ? (
        <g
          ref={props.groupRef as React.Ref<SVGGElement> | undefined}
          mask={props.groupMaskId ? `url(#${props.groupMaskId})` : undefined}
          transform={props.groupTransform}
        >
          {props.innerGroupTransform ? (
            <g transform={props.innerGroupTransform}>{innerGroupContent}</g>
          ) : (
            innerGroupContent
          )}
          {standalonePaths.map((p, idx) => renderPathElement(p, idx, props.fill, props.stroke))}
        </g>
      ) : (
        standalonePaths.map((p, idx) => renderPathElement(p, idx, props.fill, props.stroke))
      )}
      {afterGroupPaths.map((p, idx) => renderPathElement(p, idx, props.fill, props.stroke))}
      {circlesNode}
      {props.texts?.map((t, idx) => (
        <text key={`t-${idx}`} x={t.x} y={t.y} className={t.className}>
          {t.content}
        </text>
      ))}
    </svg>
  );
}

export function DomVideo({
  props,
  context,
}: {
  readonly props: HostVideoProps;
  readonly context: RenderContext;
}): React.ReactElement {
  const { style } = compileStyleToReactCss(props.style ?? {}, context);
  const baseStyle = mergeSurfaceStyle(style, props.surfaceTokens);
  const mergedStyle = props.objectFit ? { ...baseStyle, objectFit: props.objectFit } : baseStyle;
  const dataProps = collectDataAttrs(props.dataAttrs);
  return (
    <video
      ref={props.videoRef as React.Ref<HTMLVideoElement> | undefined}
      id={props.id}
      className={props.className}
      style={mergedStyle}
      src={props.src}
      poster={props.poster}
      autoPlay={props.autoPlay}
      muted={props.muted}
      playsInline={props.playsInline}
      loop={props.loop}
      controls={props.controls}
      preload={props.preload}
      data-haus-kind="video"
      {...dataProps}
      onTimeUpdate={props.onTimeUpdate ? (e) => props.onTimeUpdate?.(wrapVideoEvent(e)) : undefined}
      onPlay={props.onPlay}
      onPlaying={props.onPlaying}
      onWaiting={props.onWaiting}
      onPause={props.onPause}
      onEnded={props.onEnded}
      onLoadedMetadata={
        props.onLoadedMetadata ? (e) => props.onLoadedMetadata?.(wrapVideoEvent(e)) : undefined
      }
      onSeeked={props.onSeeked ? (e) => props.onSeeked?.(wrapVideoEvent(e)) : undefined}
      onLoadedData={props.onLoadedData ? (e) => props.onLoadedData?.(wrapVideoEvent(e)) : undefined}
      onError={props.onError ? (e) => props.onError?.(wrapVideoEvent(e)) : undefined}
    />
  );
}

export function DomCanvas({
  props,
  context,
}: {
  readonly props: HostCanvasProps;
  readonly context: RenderContext;
}): React.ReactElement {
  const { style } = compileStyleToReactCss(props.style ?? {}, context);
  const mergedStyle = mergeSurfaceStyle(style, props.surfaceTokens);
  const dataProps = collectDataAttrs(props.dataAttrs);
  return (
    <canvas
      ref={props.canvasRef as React.Ref<HTMLCanvasElement> | undefined}
      id={props.id}
      width={props.width}
      height={props.height}
      className={props.className}
      style={mergedStyle}
      role={props.role}
      tabIndex={props.tabIndex}
      aria-hidden={props.ariaHidden}
      aria-label={props.ariaLabel}
      aria-valuemin={props.ariaValueMin}
      aria-valuemax={props.ariaValueMax}
      aria-valuenow={props.ariaValueNow}
      aria-valuetext={props.ariaValueText}
      data-haus-kind="canvas"
      {...dataProps}
      onClick={
        props.onClickRatio
          ? (event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              const rx = bounds.width > 0 ? (event.clientX - bounds.left) / bounds.width : 0;
              const ry = bounds.height > 0 ? (event.clientY - bounds.top) / bounds.height : 0;
              props.onClickRatio?.(rx, ry);
            }
          : undefined
      }
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
    />
  );
}
