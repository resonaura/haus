/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { Pressable, Text, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { UiNode, type UiStyleSpec } from '../ir/node.js';
import type { RenderContext } from '../renderers/contract.js';
import type { UiContentHost } from '../renderers/host.js';
import { ReactNativeRenderer } from '../renderers/react-native.js';

const renderer = new ReactNativeRenderer();
const styleFor = (style: UiStyleSpec | undefined, context: RenderContext) =>
  renderer.render(new UiNode({ kind: 'box', style }), context).style;

export const REACT_NATIVE_CONTENT_HOST: UiContentHost = {
  renderBox: ({ children, style, id, ariaLabel, onPress }, context) => {
    const props = {
      nativeID: id,
      style: styleFor(style, context),
      accessible: ariaLabel ? true : undefined,
      accessibilityLabel: ariaLabel,
      children,
    };
    return onPress ? (
      <Pressable {...props} onPress={onPress} accessibilityRole="button" />
    ) : (
      <View {...props} />
    );
  },
  renderText: ({ children, style }, context) => (
    <Text style={styleFor(style, context)} numberOfLines={style?.typography?.maxLines}>
      {children}
    </Text>
  ),
  renderPressable: (
    { children, style, id, ariaLabel, ariaExpanded, ariaPressed, disabled, onActivate },
    context,
  ) => (
    <Pressable
      nativeID={id}
      accessibilityRole="button"
      accessibilityLabel={ariaLabel}
      accessibilityState={{ disabled, selected: ariaPressed, expanded: ariaExpanded }}
      disabled={disabled}
      onPress={onActivate}
      style={styleFor(style, context)}
    >
      {children}
    </Pressable>
  ),
  renderVector: ({ rawSvgMarkup, width, height, stroke, ariaHidden, ariaLabel }) => (
    <SvgXml
      xml={rawSvgMarkup ?? null}
      width={width}
      height={height}
      color={stroke}
      accessible={!ariaHidden}
      accessibilityLabel={ariaLabel}
      importantForAccessibility={ariaHidden ? 'no-hide-descendants' : 'auto'}
    />
  ),
};
