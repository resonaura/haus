/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type * as React from 'react';
import type { UiStyleSpec } from '../ir/node.js';

export type HostMediaDataAttrs = Readonly<Record<string, string | boolean | undefined>>;
export type HostMediaSurfaceTokens = Readonly<Record<string, string | number | undefined>>;

export interface HostImageDropShadow {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly blurRadius: number;
  readonly color: string;
}

export interface HostImageProps {
  readonly id?: string;
  readonly src: string;
  readonly alt?: string;
  readonly className?: string;
  readonly ariaHidden?: boolean;
  readonly objectFit?: 'cover' | 'contain' | 'fill';
  readonly transitionMs?: number;
  readonly dropShadow?: HostImageDropShadow;
  readonly onLoad?: () => void;
  readonly style?: UiStyleSpec;
}

export interface HostProgressiveBlurProps {
  readonly maxRadius: number;
  readonly start: number;
  readonly edge?: 'bottom' | 'top';
  readonly style: UiStyleSpec;
}

export interface HostSurfacePointerEvent {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly button: number;
  readonly buttons: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly rect: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  };
  setPointerCapture(): void;
  hasPointerCapture(): boolean;
  releasePointerCapture(): void;
}

export interface HostMediaKeyEvent {
  readonly key: string;
  readonly target: unknown;
  readonly currentTarget: unknown;
  preventDefault(): void;
  stopPropagation(): void;
}

export interface HostVectorPath {
  readonly d: string;
  readonly fill?: string;
  readonly stroke?: string;
  readonly strokeWidth?: number;
  readonly strokeLinecap?: 'butt' | 'round' | 'square';
  readonly strokeLinejoin?: 'miter' | 'round' | 'bevel';
  readonly vectorEffect?: 'non-scaling-stroke' | 'none';
  readonly opacity?: number;
  readonly className?: string;
  readonly pathRef?: React.Ref<unknown>;
  readonly inGroup?: boolean;
  readonly afterGroup?: boolean;
}

export interface HostVectorRect {
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
  readonly rx?: number;
  readonly ry?: number;
  readonly fill?: string;
  readonly stroke?: string;
  readonly className?: string;
  readonly clipPathId?: string;
  readonly styleWidth?: number;
  readonly inGroup?: boolean;
}

export interface HostVectorLine {
  readonly x1: number;
  readonly x2: number;
  readonly y1: number;
  readonly y2: number;
  readonly className?: string;
}

export interface HostVectorCircle {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly fill?: string;
  readonly stroke?: string;
  readonly opacity?: number;
  readonly transform?: string;
  readonly strokeDasharray?: string;
  readonly strokeDashoffset?: number;
  readonly className?: string;
  readonly groupClassName?: string;
}

export interface HostVectorText {
  readonly x: number;
  readonly y: number;
  readonly content: string;
  readonly className?: string;
}

export interface HostVectorGradient {
  readonly id: string;
  readonly color: string;
  readonly topOpacity: number;
  readonly bottomOpacity: number;
}

export interface HostVectorClipPath {
  readonly id: string;
  readonly path: string;
}

export interface HostVectorMask {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly cutoutPath: string;
  readonly cutoutClassName?: string;
  readonly cutoutStrokeWidth?: number;
}

export interface HostVectorProps {
  readonly id?: string;
  readonly viewX?: number;
  readonly viewY?: number;
  readonly viewWidth: number;
  readonly viewHeight: number;
  readonly width?: number | string;
  readonly height?: number | string;
  readonly preserveAspectRatio?: string;
  readonly shapeRendering?: 'auto' | 'optimizeSpeed' | 'crispEdges' | 'geometricPrecision';
  readonly fill?: string;
  readonly stroke?: string;
  readonly strokeWidth?: number | string;
  readonly strokeLinecap?: 'butt' | 'round' | 'square';
  readonly strokeLinejoin?: 'miter' | 'round' | 'bevel';
  readonly focusable?: boolean;
  readonly background?: string;
  readonly backgroundRadius?: number;
  readonly linearGradient?: HostVectorGradient;
  readonly clipPaths?: readonly HostVectorClipPath[];
  readonly masks?: readonly HostVectorMask[];
  readonly groupRef?: React.Ref<unknown>;
  readonly groupMaskId?: string;
  readonly groupTransform?: string;
  readonly innerGroupTransform?: string;
  readonly rects?: readonly HostVectorRect[];
  readonly lines?: readonly HostVectorLine[];
  readonly paths?: readonly HostVectorPath[];
  readonly circles?: readonly HostVectorCircle[];
  readonly circleGroupClassName?: string;
  readonly texts?: readonly HostVectorText[];
  readonly rawSvgMarkup?: string;
  readonly role?: string;
  readonly tabIndex?: number;
  readonly ariaLabel?: string;
  readonly ariaHidden?: boolean;
  readonly ariaValueMin?: number;
  readonly ariaValueMax?: number;
  readonly ariaValueNow?: number;
  readonly ariaValueText?: string;
  readonly ariaDisabled?: boolean;
  readonly className?: string;
  readonly style?: UiStyleSpec;
  readonly surfaceTokens?: HostMediaSurfaceTokens;
  readonly svgRef?: React.Ref<unknown>;
  readonly onPointerMoveRatio?: (ratioX: number, ratioY: number) => void;
  readonly onPointerDownEvent?: (event: HostSurfacePointerEvent) => void;
  readonly onPointerMoveEvent?: (event: HostSurfacePointerEvent) => void;
  readonly onPointerUpEvent?: (event: HostSurfacePointerEvent) => void;
  readonly onPointerCancel?: () => void;
  readonly onKeyDown?: (event: HostMediaKeyEvent) => void;
}

export interface HostVideoEvent {
  readonly currentTime: number;
  readonly duration: number;
  readonly errorCode?: number;
  readonly target: unknown;
}

export interface HostVideoFrame {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
  readonly format: 'bgra' | 'rgba';
}

export interface HostVideoProps {
  readonly id?: string;
  readonly videoRef?: React.Ref<unknown>;
  readonly className?: string;
  readonly style?: UiStyleSpec;
  readonly surfaceTokens?: HostMediaSurfaceTokens;
  readonly dataAttrs?: HostMediaDataAttrs;
  readonly src?: string;
  /** Native frames are pulled until the surface unmounts or its source changes. */
  readonly frameSource?: (signal: AbortSignal) => AsyncIterable<HostVideoFrame>;
  readonly poster?: string;
  readonly autoPlay?: boolean;
  readonly muted?: boolean;
  readonly playsInline?: boolean;
  readonly loop?: boolean;
  readonly controls?: boolean;
  readonly preload?: 'none' | 'metadata' | 'auto';
  readonly objectFit?: 'cover' | 'contain' | 'fill';
  readonly onTimeUpdate?: (event: HostVideoEvent) => void;
  readonly onPlay?: () => void;
  readonly onPlaying?: () => void;
  readonly onWaiting?: () => void;
  readonly onPause?: () => void;
  readonly onEnded?: () => void;
  readonly onLoadedMetadata?: (event: HostVideoEvent) => void;
  readonly onSeeked?: (event: HostVideoEvent) => void;
  readonly onLoadedData?: (event: HostVideoEvent) => void;
  readonly onError?: (event: HostVideoEvent) => void;
}

export interface HostCanvasProps {
  readonly id?: string;
  readonly canvasRef?: React.Ref<unknown>;
  readonly width?: number;
  readonly height?: number;
  readonly className?: string;
  readonly style?: UiStyleSpec;
  readonly surfaceTokens?: HostMediaSurfaceTokens;
  readonly dataAttrs?: HostMediaDataAttrs;
  readonly role?: string;
  readonly tabIndex?: number;
  readonly ariaHidden?: boolean;
  readonly ariaLabel?: string;
  readonly ariaValueMin?: number;
  readonly ariaValueMax?: number;
  readonly ariaValueNow?: number;
  readonly ariaValueText?: string;
  readonly onClickRatio?: (ratioX: number, ratioY: number) => void;
  readonly onKeyDown?: (event: HostMediaKeyEvent) => void;
}
