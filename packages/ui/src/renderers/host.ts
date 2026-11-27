/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type * as React from 'react';
import type { ColorValue } from '../ir/geometry.js';
import type { GlassRimEffectMotion, GlassRimPresetName } from '../ir/glass-rim.js';
import type { ShaderRegistry } from '../ir/materials.js';
import type { UiMotionSpec } from '../ir/motion.js';
import type { UiStyleSpec } from '../ir/node.js';
import type { RenderContext } from './contract.js';
import type { ScrollShadowEdge } from './scroll-shadow.js';
import type {
  HostBlurEvent,
  HostBoxSemantic,
  HostDataAttrs,
  HostKeyEvent,
  HostPointerEvent,
  HostScrollEvent,
  HostSurfaceTokens,
  HostTextSemantic,
  HostTouchEvent,
} from './host-events.js';
import type {
  HostCanvasProps,
  HostImageProps,
  HostProgressiveBlurProps,
  HostSurfacePointerEvent,
  HostVectorProps,
  HostVideoProps,
} from './host-media.js';

export type {
  HostBlurEvent,
  HostBoxSemantic,
  HostDataAttrs,
  HostKeyEvent,
  HostPointerEvent,
  HostScrollEvent,
  HostSurfaceTokens,
  HostTextSemantic,
  HostTouchEvent,
} from './host-events.js';
export type {
  HostCanvasProps,
  HostImageProps,
  HostProgressiveBlurProps,
  HostSurfacePointerEvent,
  HostVectorCircle,
  HostVectorClipPath,
  HostVectorGradient,
  HostVectorLine,
  HostVectorMask,
  HostVectorPath,
  HostVectorProps,
  HostVectorRect,
  HostVectorText,
  HostVideoEvent,
  HostVideoFrame,
  HostVideoProps,
} from './host-media.js';

export interface HostBoxProps {
  readonly id?: string;
  readonly className?: string;
  readonly semantic?: HostBoxSemantic;
  readonly style?: UiStyleSpec;
  readonly surfaceTokens?: HostSurfaceTokens;
  readonly motion?: UiMotionSpec;
  readonly layoutTransition?: string;
  readonly role?: string;
  readonly title?: string;
  readonly tabIndex?: number;
  readonly hidden?: boolean;
  readonly inert?: boolean;
  readonly disabled?: boolean;
  readonly draggable?: boolean;
  readonly ariaLabel?: string;
  readonly ariaLabelledBy?: string;
  readonly ariaDescribedBy?: string;
  readonly ariaModal?: boolean;
  readonly ariaHidden?: boolean;
  readonly ariaBusy?: boolean;
  readonly ariaSelected?: boolean;
  readonly ariaExpanded?: boolean;
  readonly ariaLevel?: number;
  readonly ariaLive?: 'polite' | 'assertive' | 'off';
  readonly ariaSort?: 'none' | 'ascending' | 'descending' | 'other';
  readonly ariaKeyShortcuts?: string;
  readonly ariaValueMin?: number;
  readonly ariaValueMax?: number;
  readonly ariaValueNow?: number;
  readonly dataKind?: string;
  readonly dataAttrs?: HostDataAttrs;
  readonly boxRef?: React.Ref<unknown>;
  readonly onPress?: () => void;
  readonly stopPropagation?: boolean;
  readonly onBackdropPress?: () => void;
  readonly onPointerDown?: () => void;
  readonly onPointerDownEvent?: (event: HostSurfacePointerEvent) => void;
  readonly onPointerMoveEvent?: (event: HostSurfacePointerEvent) => void;
  readonly onPointerUpEvent?: (event: HostSurfacePointerEvent) => void;
  readonly onPointerCancel?: () => void;
  readonly onScroll?: (event: HostScrollEvent) => void;
  readonly onTouchStart?: (event: HostTouchEvent) => void;
  readonly onTouchMove?: () => void;
  readonly onSecondaryPress?: () => void;
  readonly onContextMenu?: (event: React.MouseEvent<HTMLElement>) => void;
  readonly onDragStart?: (event: React.DragEvent<HTMLElement>) => void;
  readonly onDragOver?: (event: React.DragEvent<HTMLElement>) => void;
  readonly onDragEnd?: (event: React.DragEvent<HTMLElement>) => void;
  readonly onDrop?: (event: React.DragEvent<HTMLElement>) => void;
  readonly onPointerDownCapture?: (event: HostPointerEvent) => void;
  readonly onPointerEnter?: () => void;
  readonly onPointerLeave?: () => void;
  readonly onKeyDown?: (event: HostKeyEvent) => void;
  readonly onFocusCapture?: () => void;
  readonly onBlurCapture?: (event: HostBlurEvent) => void;
  readonly onDragStartCapture?: () => void;
  readonly onDragEndCapture?: () => void;
  readonly children?: React.ReactNode;
}

export interface HostTextProps {
  readonly id?: string;
  readonly className?: string;
  readonly semantic?: HostTextSemantic;
  readonly htmlFor?: string;
  readonly dateTime?: string;
  readonly style?: UiStyleSpec;
  readonly surfaceTokens?: HostSurfaceTokens;
  readonly role?: string;
  readonly title?: string;
  readonly ariaLabel?: string;
  readonly ariaHidden?: boolean;
  readonly ariaLive?: 'polite' | 'assertive' | 'off';
  readonly asParagraph?: boolean;
  readonly dataKind?: string;
  readonly dataAttrs?: HostDataAttrs;
  readonly textRef?: React.Ref<unknown>;
  readonly children?: React.ReactNode;
}

export interface HostHeadingProps {
  readonly id?: string;
  readonly className?: string;
  readonly title?: string;
  readonly tabIndex?: number;
  readonly headingRef?: React.Ref<unknown>;
  readonly style?: UiStyleSpec;
  readonly level?: 1 | 2 | 3 | 4 | 5;
  readonly dataKind?: string;
  readonly dataAttrs?: HostDataAttrs;
  readonly children?: React.ReactNode;
}

export interface HostGlassRimProps {
  readonly preset?: GlassRimPresetName;
  readonly radiusPx?: number;
  readonly opacity?: number;
  readonly zIndex?: number;
  readonly tintColor?: ColorValue;
  readonly effectColors?: readonly [ColorValue?, ColorValue?, ColorValue?];
  readonly effectMotion?: GlassRimEffectMotion;
  readonly variant?: 'card' | 'panel';
  readonly continuous?: boolean;
}

export interface HostPressableProps {
  readonly id?: string;
  readonly className?: string;
  readonly style?: UiStyleSpec;
  readonly surfaceTokens?: HostSurfaceTokens;
  readonly type?: 'button' | 'submit' | 'reset';
  readonly form?: string;
  readonly role?: string;
  readonly title?: string;
  readonly tabIndex?: number;
  readonly ariaLabel?: string;
  readonly ariaLabelledBy?: string;
  readonly ariaBusy?: boolean;
  readonly ariaCurrent?: 'page' | 'step' | 'location' | 'date' | 'time' | boolean;
  readonly ariaHasPopup?: 'menu' | 'listbox' | 'tree' | 'grid' | 'dialog' | boolean;
  readonly ariaChecked?: boolean;
  readonly ariaSelected?: boolean;
  readonly ariaPressed?: boolean;
  readonly ariaExpanded?: boolean;
  readonly ariaControls?: string;
  readonly disabled?: boolean;
  readonly stopPropagation?: boolean;
  readonly pressableRef?: React.Ref<unknown>;
  readonly dataKind?: string;
  readonly dataVariant?: string;
  readonly dataAttrs?: HostDataAttrs;
  readonly onActivate?: () => void;
  readonly onPress?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  readonly onDoublePress?: () => void;
  readonly onSecondaryPress?: () => void;
  readonly onContextMenu?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  readonly onKeyDown?: (event: HostKeyEvent) => void;
  readonly onPointerEnter?: () => void;
  readonly onPointerLeave?: () => void;
  readonly onPointerDown?: () => void;
  readonly onPointerUp?: () => void;
  readonly onFocus?: () => void;
  readonly onBlur?: () => void;
  readonly children?: React.ReactNode;
}

export interface HostRangeInputProps {
  readonly id?: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly disabled?: boolean;
  readonly ariaLabel?: string;
  readonly onChange?: (value: number) => void;
  readonly onChangeEnd?: (value: number) => void;
}

export interface HostTextInputProps {
  readonly id?: string;
  readonly name?: string;
  readonly value: string;
  readonly inputType?:
    | 'text'
    | 'password'
    | 'email'
    | 'url'
    | 'number'
    | 'search'
    | 'color'
    | 'date'
    | 'time'
    | 'datetime-local';
  readonly inputMode?: 'none' | 'text' | 'tel' | 'url' | 'email' | 'numeric' | 'decimal' | 'search';
  readonly placeholder?: string;
  readonly pattern?: string;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number | 'any';
  readonly maxLength?: number;
  readonly autoComplete?: string;
  readonly autoCapitalize?: string;
  readonly spellCheck?: boolean;
  readonly disabled?: boolean;
  readonly readOnly?: boolean;
  readonly required?: boolean;
  readonly autoFocus?: boolean;
  readonly role?: string;
  readonly ariaLabel?: string;
  readonly ariaInvalid?: boolean;
  readonly ariaAutoComplete?: 'none' | 'inline' | 'list' | 'both';
  readonly ariaExpanded?: boolean;
  readonly ariaControls?: string;
  readonly ariaActiveDescendant?: string;
  readonly suggestions?: readonly (string | { readonly value: string; readonly label?: string })[];
  readonly className?: string;
  readonly style?: UiStyleSpec;
  readonly surfaceTokens?: HostSurfaceTokens;
  readonly inputRef?: React.Ref<unknown>;
  readonly onChange?: (value: string) => void;
  readonly onSubmit?: () => void;
  readonly onFocus?: () => void;
  readonly onBlur?: () => void;
  readonly onKeyDown?: (event: HostKeyEvent) => void;
}

export interface HostSelectOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

export interface HostSelectProps {
  readonly id?: string;
  readonly name?: string;
  readonly value: string;
  readonly values?: readonly string[];
  readonly multiple?: boolean;
  readonly options: readonly HostSelectOption[];
  readonly disabled?: boolean;
  readonly required?: boolean;
  readonly ariaLabel?: string;
  readonly ariaInvalid?: boolean;
  readonly className?: string;
  readonly style?: UiStyleSpec;
  readonly surfaceTokens?: HostSurfaceTokens;
  readonly onChange?: (value: string) => void;
  readonly onMultiChange?: (values: string[]) => void;
}

export interface HostCheckboxProps {
  readonly id?: string;
  readonly name?: string;
  readonly checked: boolean;
  readonly indeterminate?: boolean;
  readonly disabled?: boolean;
  readonly stopPropagation?: boolean;
  readonly ariaLabel?: string;
  readonly className?: string;
  readonly style?: UiStyleSpec;
  readonly onChange?: (checked: boolean) => void;
}

export interface HostFileInputProps {
  readonly id?: string;
  readonly accept?: string;
  readonly disabled?: boolean;
  readonly ariaLabel?: string;
  readonly className?: string;
  readonly style?: UiStyleSpec;
  readonly onFileChange?: (file: File | undefined) => void;
}

export interface HostScrollViewProps {
  readonly id?: string;
  readonly className?: string;
  readonly orientation?: 'vertical' | 'horizontal';
  readonly shadowSizePx?: number;
  readonly edges?: readonly ScrollShadowEdge[];
  readonly transitionMs?: number;
  readonly hideScrollBar?: boolean;
  readonly overscrollBehavior?: 'auto' | 'contain' | 'none';
  readonly scrollPolicy?: 'auto' | 'vertical' | 'horizontal' | 'both' | 'directionLocked' | 'free';
  readonly scrollId?: string;
  readonly hidden?: boolean;
  readonly isEnabled?: boolean;
  readonly role?: string;
  readonly ariaLabel?: string;
  readonly onScroll?: () => void;
  readonly scrollRef?: React.Ref<unknown>;
  readonly style?: UiStyleSpec;
  readonly children?: React.ReactNode;
}

export interface HostLinkProps {
  readonly id?: string;
  readonly href: string;
  readonly target?: string;
  readonly rel?: string;
  readonly className?: string;
  readonly title?: string;
  readonly style?: UiStyleSpec;
  readonly onPress?: () => void;
  readonly children?: React.ReactNode;
}

export interface HostDividerProps {
  readonly id?: string;
  readonly className?: string;
  readonly style?: UiStyleSpec;
}

export interface HostFormProps {
  readonly id?: string;
  readonly className?: string;
  readonly noValidate?: boolean;
  readonly style?: UiStyleSpec;
  readonly onSubmit?: () => void;
  readonly children?: React.ReactNode;
}

export interface HostTextAreaProps {
  readonly id?: string;
  readonly name?: string;
  readonly value: string;
  readonly rows?: number;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly readOnly?: boolean;
  readonly required?: boolean;
  readonly spellCheck?: boolean;
  readonly customValidity?: string;
  readonly ariaLabel?: string;
  readonly className?: string;
  readonly style?: UiStyleSpec;
  readonly textAreaRef?: React.Ref<unknown>;
  readonly onChange?: (value: string) => void;
}

export interface HostCodeProps {
  readonly id?: string;
  readonly className?: string;
  readonly title?: string;
  readonly ariaLabel?: string;
  readonly style?: UiStyleSpec;
  readonly block?: boolean;
  readonly children?: React.ReactNode;
}

export interface HostDisclosureProps {
  readonly id?: string;
  readonly className?: string;
  readonly summary: React.ReactNode;
  readonly defaultOpen?: boolean;
  readonly onToggle?: (open: boolean) => void;
  readonly style?: UiStyleSpec;
  readonly children?: React.ReactNode;
}

export interface HostPopoverProps {
  readonly id?: string;
  readonly open: boolean;
  readonly placement: 'top' | 'bottom' | 'left' | 'right';
  readonly align?: 'start' | 'center' | 'end';
  readonly className?: string;
  readonly portal?: (node: React.ReactNode) => React.ReactNode;
  readonly onOpenChange: (open: boolean) => void;
  readonly anchorStyle: UiStyleSpec;
  readonly surfaceStyle: UiStyleSpec;
  readonly trigger: React.ReactNode;
  readonly children: React.ReactNode;
}

/**
 * Pure platform host adapter contract.
 * Every TSX component in `@haus/ui` delegates leaf rendering strictly through `UiHostAdapter`,
 * keeping components 100% free of direct HTML/DOM tags so the exact same component tree can
 * target React DOM, React Native, or a custom native Rust/C++ GPU renderer from scratch.
 */
export interface UiHostAdapter {
  readonly target: 'react-dom' | 'react-native' | 'native-ir' | 'custom';
  renderBox(props: HostBoxProps, context: RenderContext): React.ReactElement;
  renderText(props: HostTextProps, context: RenderContext): React.ReactElement;
  renderHeading(props: HostHeadingProps, context: RenderContext): React.ReactElement;
  renderPressable(props: HostPressableProps, context: RenderContext): React.ReactElement;
  renderRangeInput(props: HostRangeInputProps, context: RenderContext): React.ReactElement;
  renderTextInput(props: HostTextInputProps, context: RenderContext): React.ReactElement;
  renderTextArea(props: HostTextAreaProps, context: RenderContext): React.ReactElement;
  renderSelect(props: HostSelectProps, context: RenderContext): React.ReactElement;
  renderCheckbox(props: HostCheckboxProps, context: RenderContext): React.ReactElement;
  renderFileInput(props: HostFileInputProps, context: RenderContext): React.ReactElement;
  renderScrollView(props: HostScrollViewProps, context: RenderContext): React.ReactElement;
  renderImage(props: HostImageProps, context: RenderContext): React.ReactElement;
  renderProgressiveBlur?(
    props: HostProgressiveBlurProps,
    context: RenderContext,
  ): React.ReactElement;
  renderVector(props: HostVectorProps, context: RenderContext): React.ReactElement;
  renderVideo(props: HostVideoProps, context: RenderContext): React.ReactElement;
  renderCanvas(props: HostCanvasProps, context: RenderContext): React.ReactElement;
  renderLink(props: HostLinkProps, context: RenderContext): React.ReactElement;
  renderDivider(props: HostDividerProps, context: RenderContext): React.ReactElement;
  renderForm(props: HostFormProps, context: RenderContext): React.ReactElement;
  renderCode(props: HostCodeProps, context: RenderContext): React.ReactElement;
  renderDisclosure(props: HostDisclosureProps, context: RenderContext): React.ReactElement;
  renderPopover?(props: HostPopoverProps, context: RenderContext): React.ReactElement;
  renderGlassRim?(props: HostGlassRimProps, context: RenderContext): React.ReactElement | null;
  renderShaderDefs?(registry: ShaderRegistry): React.ReactElement | null;
  subscribeEscape?(onEscape: () => void): () => void;
}

export type UiContentHost = Pick<
  UiHostAdapter,
  'renderBox' | 'renderText' | 'renderPressable' | 'renderVector'
> &
  Partial<
    Pick<
      UiHostAdapter,
      | 'renderCanvas'
      | 'renderDivider'
      | 'renderGlassRim'
      | 'renderHeading'
      | 'renderImage'
      | 'renderPopover'
      | 'renderProgressiveBlur'
      | 'renderRangeInput'
      | 'renderScrollView'
      | 'renderSelect'
      | 'renderTextArea'
      | 'renderTextInput'
      | 'renderVideo'
    >
  > & {
    readonly nativeInteractiveStates?: boolean;
    renderDialogFrame?(
      props: {
        title: string;
        onClose: () => void;
        closing?: boolean;
        backdrop: UiStyleSpec;
        panel: UiStyleSpec;
        children: React.ReactNode;
      },
      context: RenderContext,
    ): React.ReactElement;
  };
