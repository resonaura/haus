/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useLayoutEffect, useRef } from 'react';
import { LayoutAnimation, Pressable, Text, TextInput, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { buildGpuiSvgSource } from '../gpui/vector.js';
import { UiNode, type UiStyleSpec } from '../ir/node.js';
import type { RenderContext } from '../renderers/contract.js';
import type { HostBoxProps, UiContentHost } from '../renderers/host.js';
import { ReactNativeRenderer } from '../renderers/react-native.js';

const renderer = new ReactNativeRenderer();
const styleFor = (style: UiStyleSpec | undefined, context: RenderContext) =>
  renderer.render(new UiNode({ kind: 'box', style }), context).style;

let lastConfiguredTransition = '';

function NativeLayoutBox({
  props,
  context,
}: {
  readonly props: HostBoxProps;
  readonly context: RenderContext;
}) {
  const prevTokenRef = useRef(props.layoutTransition);
  useLayoutEffect(() => {
    const next = props.layoutTransition;
    if (
      next &&
      prevTokenRef.current !== undefined &&
      prevTokenRef.current !== next &&
      !context.viewport.reducedMotion &&
      lastConfiguredTransition !== next
    ) {
      lastConfiguredTransition = next;
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    }
    prevTokenRef.current = next;
  }, [context.viewport.reducedMotion, props.layoutTransition]);

  const viewProps = {
    nativeID: props.id,
    style: styleFor(props.style, context),
    accessible: props.ariaLabel ? true : undefined,
    accessibilityLabel: props.ariaLabel,
    children: props.children,
  };
  return props.onPress ? (
    <Pressable {...viewProps} onPress={props.onPress} accessibilityRole="button" />
  ) : (
    <View {...viewProps} />
  );
}

export const REACT_NATIVE_CONTENT_HOST: UiContentHost = {
  renderBox: (boxProps, context) => {
    if (boxProps.layoutTransition !== undefined) {
      return <NativeLayoutBox props={boxProps} context={context} />;
    }
    const { children, style, id, ariaLabel, onPress } = boxProps;
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
  renderHeading: ({ children, style, id }, context) => (
    <Text nativeID={id} accessibilityRole="header" style={styleFor(style, context)}>
      {children}
    </Text>
  ),
  renderTextInput: (
    {
      id,
      value,
      placeholder,
      disabled,
      readOnly,
      maxLength,
      inputType,
      autoFocus,
      ariaLabel,
      style,
      onChange,
      onSubmit,
      onFocus,
      onBlur,
    },
    context,
  ) => (
    <TextInput
      nativeID={id}
      accessibilityLabel={ariaLabel}
      value={value}
      placeholder={placeholder}
      placeholderTextColor={context.theme.mode === 'dark' ? '#7d7d85' : '#8a8a8e'}
      editable={!disabled && !readOnly}
      maxLength={maxLength}
      autoFocus={autoFocus}
      autoCapitalize="none"
      autoCorrect={false}
      secureTextEntry={inputType === 'password'}
      keyboardType={
        inputType === 'url' ? 'url' : inputType === 'email' ? 'email-address' : 'default'
      }
      returnKeyType="go"
      onChangeText={onChange}
      onSubmitEditing={onSubmit}
      onFocus={onFocus}
      onBlur={onBlur}
      style={styleFor(style, context)}
    />
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
  renderVector: (vectorProps) => {
    const { rawSvgMarkup, width, height, stroke, ariaHidden, ariaLabel } = vectorProps;
    const xml = rawSvgMarkup ?? buildGpuiSvgSource(vectorProps) ?? null;
    return (
      <SvgXml
        xml={xml}
        width={width}
        height={height}
        color={stroke}
        accessible={!ariaHidden}
        accessibilityLabel={ariaLabel}
        importantForAccessibility={ariaHidden ? 'no-hide-descendants' : 'auto'}
      />
    );
  },
};
