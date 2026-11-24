/* @jsxImportSource @gpuix/react */
/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { StyleDesc } from '@gpuix/react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@gpuix/react/select';
import { colorToken } from '../ir/geometry.js';
import { resolveColorToCss, type RenderContext } from '../renderers/contract.js';
import type { HostSelectProps } from '../renderers/host.js';

export function GpuiSelect({
  props,
  style,
  context,
}: {
  props: HostSelectProps;
  style: StyleDesc;
  context: RenderContext;
}) {
  const foreground = resolveColorToCss(colorToken('textPrimary'), context.theme, false);
  const surface = resolveColorToCss(colorToken('surfaceElevated'), context.theme, false);
  const border = resolveColorToCss(colorToken('border'), context.theme, false);
  const hover = resolveColorToCss(colorToken('surfaceHover'), context.theme, false);
  const active = resolveColorToCss(colorToken('surfaceActive'), context.theme, false);

  return (
    <Select
      value={props.value}
      disabled={props.disabled}
      items={props.options.map((option) => ({
        value: option.value,
        label: option.label,
        textValue: option.label,
      }))}
      onValueChange={props.onChange}
    >
      <SelectTrigger
        testId={props.id}
        aria-label={props.ariaLabel}
        disabled={props.disabled}
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          minHeight: 34,
          paddingLeft: 10,
          paddingRight: 10,
          paddingTop: 6,
          paddingBottom: 6,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: border,
          backgroundColor: surface,
          color: foreground,
          ...style,
        }}
      >
        <SelectValue placeholder="Select…" />
      </SelectTrigger>
      <SelectContent
        style={{
          backgroundColor: surface,
          borderColor: border,
          borderWidth: 1,
          borderRadius: 12,
          paddingTop: 4,
          paddingBottom: 4,
          paddingLeft: 4,
          paddingRight: 4,
          gap: 2,
          color: foreground,
        }}
      >
        {props.options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            disabled={option.disabled}
            style={(state) => ({
              paddingLeft: 10,
              paddingRight: 10,
              paddingTop: 6,
              paddingBottom: 6,
              borderRadius: 8,
              color: foreground,
              backgroundColor: state.selected ? active : state.highlighted ? hover : undefined,
            })}
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
