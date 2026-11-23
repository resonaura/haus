/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import * as React from 'react';
import { UiNode, type UiNodeKind, type UiStyleSpec } from '../ir/node.js';
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
  HostHeadingProps,
  HostImageProps,
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
  NativeSceneGraphRenderer,
  type NativeCompiledShaderIR,
  type NativeSceneNodeIR,
} from './native-ir.js';

export interface NativeHostRecord {
  readonly kind: UiNodeKind;
  readonly node: NativeSceneNodeIR;
  readonly shaders: readonly NativeCompiledShaderIR[];
  readonly props: Readonly<Record<string, unknown>>;
}

/**
 * Pure renderer-neutral `UiHostAdapter` targeting native C++ / Rust GPU renderers.
 * Converts every TSX host primitive call into deterministic `NativeSceneNode` records
 * (resolved sRGB colors, superellipse corners, blur/Liquid Glass materials, WGSL/GLSL shaders)
 * with ZERO HTML/DOM involvement.
 */
export class NativeIrHostAdapter implements UiHostAdapter {
  readonly target = 'native-ir' as const;
  private readonly renderer = new NativeSceneGraphRenderer();
  private readonly records: NativeHostRecord[] = [];

  takeRecords(): readonly NativeHostRecord[] {
    return this.records.splice(0);
  }

  peekRecords(): readonly NativeHostRecord[] {
    return [...this.records];
  }

  private emit(
    kind: UiNodeKind,
    style: UiStyleSpec | undefined,
    meta: Record<string, unknown>,
    context: RenderContext,
    children?: React.ReactNode,
  ): React.ReactElement {
    const uiNode = new UiNode({
      kind,
      id: typeof meta.id === 'string' ? meta.id : undefined,
      style: style ?? {},
    });
    const compiled = this.renderer.render(uiNode, context);
    const rootNode = compiled.nodes[compiled.rootNodeIndex];
    if (rootNode) {
      this.records.push({ kind, node: rootNode, shaders: compiled.shaders, props: meta });
    }
    return React.createElement(React.Fragment, null, children);
  }

  renderBox(props: HostBoxProps, context: RenderContext): React.ReactElement {
    return this.emit(
      props.role === 'dialog' ? 'modal' : 'box',
      props.style,
      {
        id: props.id,
        semantic: props.semantic ?? 'box',
        role: props.role,
        ariaLabel: props.ariaLabel,
        dataKind: props.dataKind,
        dataAttrs: props.dataAttrs,
        surfaceTokens: props.surfaceTokens,
      },
      context,
      props.children,
    );
  }

  renderText(props: HostTextProps, context: RenderContext): React.ReactElement {
    return this.emit(
      'text',
      props.style,
      {
        id: props.id,
        semantic: props.semantic ?? (props.asParagraph ? 'p' : 'span'),
        text: typeof props.children === 'string' ? props.children : undefined,
        asParagraph: props.asParagraph,
        dataAttrs: props.dataAttrs,
        surfaceTokens: props.surfaceTokens,
      },
      context,
      props.children,
    );
  }

  renderHeading(props: HostHeadingProps, context: RenderContext): React.ReactElement {
    return this.emit(
      'heading',
      props.style,
      { id: props.id, level: props.level ?? 3 },
      context,
      props.children,
    );
  }

  renderPressable(props: HostPressableProps, context: RenderContext): React.ReactElement {
    const kind: UiNodeKind = props.role === 'switch' ? 'switch' : 'button';
    return this.emit(
      kind,
      props.style,
      {
        id: props.id,
        role: props.role,
        disabled: props.disabled,
        ariaChecked: props.ariaChecked,
        ariaLabel: props.ariaLabel,
        dataVariant: props.dataVariant,
      },
      context,
      props.children,
    );
  }

  renderRangeInput(props: HostRangeInputProps, context: RenderContext): React.ReactElement {
    return this.emit(
      'slider',
      undefined,
      {
        id: props.id,
        value: props.value,
        min: props.min,
        max: props.max,
        step: props.step,
        disabled: props.disabled,
      },
      context,
    );
  }

  renderTextInput(props: HostTextInputProps, context: RenderContext): React.ReactElement {
    return this.emit(
      'input',
      props.style,
      {
        id: props.id,
        value: props.value,
        placeholder: props.placeholder,
        inputType: props.inputType ?? 'text',
        disabled: props.disabled,
      },
      context,
    );
  }

  renderSelect(props: HostSelectProps, context: RenderContext): React.ReactElement {
    return this.emit(
      'select',
      props.style,
      {
        id: props.id,
        value: props.value,
        values: props.values,
        multiple: props.multiple,
        options: props.options,
        disabled: props.disabled,
      },
      context,
    );
  }

  renderCheckbox(props: HostCheckboxProps, context: RenderContext): React.ReactElement {
    return this.emit(
      'switch',
      props.style,
      { id: props.id, checked: props.checked, disabled: props.disabled, role: 'checkbox' },
      context,
    );
  }

  renderFileInput(props: HostFileInputProps, context: RenderContext): React.ReactElement {
    return this.emit(
      'input',
      props.style,
      { id: props.id, accept: props.accept, disabled: props.disabled, role: 'file' },
      context,
    );
  }

  renderScrollView(props: HostScrollViewProps, context: RenderContext): React.ReactElement {
    return this.emit(
      'scroll',
      props.style,
      {
        id: props.id,
        orientation: props.orientation ?? 'vertical',
        shadowSizePx: props.shadowSizePx ?? 24,
        hideScrollBar: Boolean(props.hideScrollBar),
      },
      context,
      props.children,
    );
  }

  renderImage(props: HostImageProps, context: RenderContext): React.ReactElement {
    return this.emit(
      'image',
      props.style,
      { id: props.id, src: props.src, alt: props.alt ?? '' },
      context,
    );
  }

  renderVector(props: HostVectorProps, context: RenderContext): React.ReactElement {
    return this.emit(
      'image',
      props.style,
      {
        id: props.id,
        vector: true,
        viewWidth: props.viewWidth,
        viewHeight: props.viewHeight,
        background: props.background,
        paths: props.paths,
        rawSvgMarkup: props.rawSvgMarkup,
      },
      context,
    );
  }

  renderVideo(props: HostVideoProps, context: RenderContext): React.ReactElement {
    return this.emit(
      'image',
      props.style,
      {
        id: props.id,
        surface: 'video',
        src: props.src,
        poster: props.poster,
        autoPlay: Boolean(props.autoPlay),
        muted: Boolean(props.muted),
        playsInline: Boolean(props.playsInline),
        dataAttrs: props.dataAttrs,
      },
      context,
    );
  }

  renderCanvas(props: HostCanvasProps, context: RenderContext): React.ReactElement {
    return this.emit(
      'image',
      props.style,
      {
        id: props.id,
        surface: 'canvas',
        width: props.width,
        height: props.height,
        role: props.role,
        ariaLabel: props.ariaLabel,
        dataAttrs: props.dataAttrs,
      },
      context,
    );
  }

  renderLink(props: HostLinkProps, context: RenderContext): React.ReactElement {
    return this.emit(
      'button',
      props.style,
      { id: props.id, href: props.href, role: 'link' },
      context,
      props.children,
    );
  }

  renderDivider(props: HostDividerProps, context: RenderContext): React.ReactElement {
    return this.emit('divider', props.style, { id: props.id }, context);
  }

  renderTextArea(props: HostTextAreaProps, context: RenderContext): React.ReactElement {
    return this.emit(
      'input',
      props.style,
      { id: props.id, multiline: true, rows: props.rows ?? 4, value: props.value },
      context,
    );
  }

  renderForm(props: HostFormProps, context: RenderContext): React.ReactElement {
    return this.emit('box', props.style, { id: props.id, role: 'form' }, context, props.children);
  }

  renderCode(props: HostCodeProps, context: RenderContext): React.ReactElement {
    return this.emit(
      'text',
      props.style,
      { id: props.id, monospace: true, block: Boolean(props.block) },
      context,
      props.children,
    );
  }

  renderDisclosure(props: HostDisclosureProps, context: RenderContext): React.ReactElement {
    return this.emit(
      'box',
      props.style,
      { id: props.id, disclosure: true, defaultOpen: Boolean(props.defaultOpen) },
      context,
      props.children,
    );
  }
}
