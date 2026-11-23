/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type * as React from 'react';
import type { ShaderRegistry } from '../ir/materials.js';
import type { UiStyleSpec } from '../ir/node.js';
import type { RenderContext } from './contract.js';
import type {
  HostCanvasProps,
  HostSurfacePointerEvent,
  HostVectorProps,
  HostVideoProps,
} from './host-media.js';

export type {
  HostCanvasProps,
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
  HostVideoProps,
} from './host-media.js';

export interface HostPointerEvent {
  readonly target: unknown;
  readonly currentTarget: { contains(node: unknown): boolean };
  stopPropagation(): void;
}

export type HostDataAttrs = Readonly<Record<string, string | boolean | undefined>>;
export type HostSurfaceTokens = Readonly<Record<string, string | number | undefined>>;

export type HostBoxSemantic =
  | 'box'
  | 'section'
  | 'header'
  | 'footer'
  | 'main'
  | 'aside'
  | 'nav'
  | 'article'
  | 'list'
  | 'ordered-list'
  | 'listitem'
  | 'dl'
  | 'dt'
  | 'dd'
  | 'fieldset'
  | 'legend'
  | 'table'
  | 'colgroup'
  | 'col'
  | 'thead'
  | 'tbody'
  | 'tr'
  | 'th'
  | 'td';

export type HostTextSemantic =
  | 'span'
  | 'p'
  | 'strong'
  | 'small'
  | 'em'
  | 'label'
  | 'swatch'
  | 'kbd'
  | 'time'
  | 'output'
  | 'bold'
  | 'break';

export interface HostBlurEvent {
  readonly currentTarget: { contains(node: unknown): boolean };
  readonly relatedTarget: unknown;
}

export interface HostKeyEvent {
  readonly key: string;
  readonly altKey?: boolean;
  readonly shiftKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly target: unknown;
  readonly currentTarget: unknown;
  preventDefault(): void;
  stopPropagation(): void;
}

export interface HostScrollEvent {
  readonly scrollLeft: number;
  readonly scrollTop: number;
}

export interface HostTouchEvent {
  readonly currentTarget: {
    scrollTo(options: { left: number; behavior: 'instant' }): void;
    setChildStyleProperty(name: string, value: string): void;
  };
}

export interface HostBoxProps {
  readonly id?: string;
  readonly className?: string;
  readonly semantic?: HostBoxSemantic;
  readonly style?: UiStyleSpec;
  readonly surfaceTokens?: HostSurfaceTokens;
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
  readonly onPress?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  readonly onDoublePress?: () => void;
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
  readonly hideScrollBar?: boolean;
  readonly hidden?: boolean;
  readonly isEnabled?: boolean;
  readonly role?: string;
  readonly ariaLabel?: string;
  readonly onScroll?: () => void;
  readonly scrollRef?: React.Ref<unknown>;
  readonly style?: UiStyleSpec;
  readonly children?: React.ReactNode;
}

export interface HostImageProps {
  readonly id?: string;
  readonly src: string;
  readonly alt?: string;
  readonly className?: string;
  readonly ariaHidden?: boolean;
  readonly onLoad?: () => void;
  readonly style?: UiStyleSpec;
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
  renderVector(props: HostVectorProps, context: RenderContext): React.ReactElement;
  renderVideo(props: HostVideoProps, context: RenderContext): React.ReactElement;
  renderCanvas(props: HostCanvasProps, context: RenderContext): React.ReactElement;
  renderLink(props: HostLinkProps, context: RenderContext): React.ReactElement;
  renderDivider(props: HostDividerProps, context: RenderContext): React.ReactElement;
  renderForm(props: HostFormProps, context: RenderContext): React.ReactElement;
  renderCode(props: HostCodeProps, context: RenderContext): React.ReactElement;
  renderDisclosure(props: HostDisclosureProps, context: RenderContext): React.ReactElement;
  renderShaderDefs?(registry: ShaderRegistry): React.ReactElement | null;
  subscribeEscape?(onEscape: () => void): () => void;
}
