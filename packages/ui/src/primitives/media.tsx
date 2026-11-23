/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import * as React from 'react';
import type {
  HostCanvasProps,
  HostCheckboxProps,
  HostFileInputProps,
  HostImageProps,
  HostLinkProps,
  HostRangeInputProps,
  HostScrollViewProps,
  HostSelectProps,
  HostTextAreaProps,
  HostTextInputProps,
  HostVectorProps,
  HostVideoProps,
} from '../renderers/host.js';
import { useHausUi } from './context.js';

/** Platform-neutral range input leaf delegated strictly to `UiHostAdapter`. */
export function RangeInput(props: HostRangeInputProps): React.ReactElement {
  const ctx = useHausUi();
  return ctx.host.renderRangeInput(props, ctx);
}

/** Platform-neutral text input leaf delegated strictly to `UiHostAdapter`. */
export function TextInput(props: HostTextInputProps): React.ReactElement {
  const ctx = useHausUi();
  return ctx.host.renderTextInput(props, ctx);
}

/** Platform-neutral multi-line text area leaf delegated strictly to `UiHostAdapter`. */
export function TextArea(props: HostTextAreaProps): React.ReactElement {
  const ctx = useHausUi();
  return ctx.host.renderTextArea(props, ctx);
}

/** Platform-neutral select leaf delegated strictly to `UiHostAdapter`. */
export function SelectInput(props: HostSelectProps): React.ReactElement {
  const ctx = useHausUi();
  return ctx.host.renderSelect(props, ctx);
}

/** Platform-neutral checkbox leaf delegated strictly to `UiHostAdapter`. */
export function CheckboxInput(props: HostCheckboxProps): React.ReactElement {
  const ctx = useHausUi();
  return ctx.host.renderCheckbox(props, ctx);
}

/** Platform-neutral file input leaf delegated strictly to `UiHostAdapter`. */
export function FileInput(props: HostFileInputProps): React.ReactElement {
  const ctx = useHausUi();
  return ctx.host.renderFileInput(props, ctx);
}

/** Platform-neutral scrollable viewport delegated strictly to `UiHostAdapter`. */
export function ScrollView(props: HostScrollViewProps): React.ReactElement {
  const ctx = useHausUi();
  return ctx.host.renderScrollView(props, ctx);
}

/** Platform-neutral image leaf delegated strictly to `UiHostAdapter`. */
export function Image(props: HostImageProps): React.ReactElement {
  const ctx = useHausUi();
  return ctx.host.renderImage(props, ctx);
}

/** Platform-neutral vector graphic leaf (QR matrices, charts, icons) delegated to `UiHostAdapter`. */
export function VectorGraphic(props: HostVectorProps): React.ReactElement {
  const ctx = useHausUi();
  return ctx.host.renderVector(props, ctx);
}

/** Platform-neutral video surface delegated strictly to `UiHostAdapter` (DOM video / native decoder texture). */
export function VideoSurface(props: HostVideoProps): React.ReactElement {
  const ctx = useHausUi();
  return ctx.host.renderVideo(props, ctx);
}

/** Platform-neutral raster canvas surface delegated strictly to `UiHostAdapter` (DOM canvas / native GPU surface). */
export function CanvasSurface(props: HostCanvasProps): React.ReactElement {
  const ctx = useHausUi();
  return ctx.host.renderCanvas(props, ctx);
}

/** Platform-neutral link leaf delegated strictly to `UiHostAdapter`. */
export function HausLink(props: HostLinkProps): React.ReactElement {
  const ctx = useHausUi();
  return ctx.host.renderLink(props, ctx);
}
