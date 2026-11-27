/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import * as React from 'react';
import type { ColorValue } from '../ir/geometry.js';
import type { UiStyleSpec } from '../ir/node.js';
import {
  buttonStyles,
  segmentedStyles,
  sliderStyles,
  switchStyles,
  type HausButtonVariant,
  type HausControlSize,
} from '../styles/controls.js';
import { composeStyles } from '../styles/sheet.js';
import { useHausStyles } from './context.js';
import { Box, Pressable, RangeInput, Row, Stack, Text } from './elements.js';

export interface HausButtonProps {
  readonly id?: string;
  readonly label?: string;
  readonly variant?: HausButtonVariant;
  readonly size?: HausControlSize;
  readonly type?: 'button' | 'submit' | 'reset';
  readonly form?: string;
  readonly disabled?: boolean;
  readonly isDisabled?: boolean;
  readonly isPending?: boolean;
  readonly isIconOnly?: boolean;
  readonly fullWidth?: boolean;
  readonly title?: string;
  readonly 'aria-label'?: string;
  readonly 'aria-pressed'?: boolean;
  readonly 'aria-expanded'?: boolean;
  readonly 'aria-controls'?: string;
  readonly ref?: React.Ref<unknown>;
  readonly className?: string;
  readonly style?: UiStyleSpec;
  readonly onPress?: () => void;
  readonly onClick?: () => void;
  readonly children?: React.ReactNode;
}

export function HausButton({
  id,
  label,
  variant = 'primary',
  size = 'md',
  type = 'button',
  form,
  disabled,
  isDisabled,
  isPending,
  isIconOnly,
  fullWidth,
  title,
  'aria-label': ariaLabel,
  'aria-pressed': ariaPressed,
  'aria-expanded': ariaExpanded,
  'aria-controls': ariaControls,
  ref,
  className,
  style,
  onPress,
  onClick,
  children,
}: HausButtonProps): React.ReactElement {
  const effectiveDisabled = Boolean(disabled ?? isDisabled ?? isPending);
  const styles = useHausStyles(buttonStyles, {
    variant,
    size,
    disabled: effectiveDisabled,
    fullWidth,
    isIconOnly,
  });

  return (
    <Pressable
      id={id}
      type={type}
      form={form}
      className={className}
      title={title}
      ariaLabel={ariaLabel ?? label}
      ariaPressed={ariaPressed}
      ariaExpanded={ariaExpanded}
      ariaControls={ariaControls}
      pressableRef={ref}
      disabled={effectiveDisabled}
      dataKind="button"
      dataVariant={variant}
      style={composeStyles(styles.root, style)}
      onActivate={() => {
        onClick?.();
        onPress?.();
      }}
    >
      {children ?? label}
    </Pressable>
  );
}

export interface HausSwitchProps {
  readonly id?: string;
  readonly checked?: boolean;
  readonly isSelected?: boolean;
  readonly disabled?: boolean;
  readonly isDisabled?: boolean;
  readonly size?: HausControlSize;
  readonly accentColor?: ColorValue;
  readonly label?: React.ReactNode;
  readonly description?: string;
  readonly 'aria-label'?: string;
  readonly className?: string;
  readonly style?: UiStyleSpec;
  readonly onChange?: (checked: boolean) => void;
}

export function HausSwitch({
  id,
  checked,
  isSelected,
  disabled,
  isDisabled,
  size = 'md',
  accentColor,
  label,
  description,
  'aria-label': ariaLabel,
  className,
  style,
  onChange,
}: HausSwitchProps): React.ReactElement {
  const active = Boolean(checked ?? isSelected);
  const effectiveDisabled = Boolean(disabled ?? isDisabled);
  const styles = useHausStyles(switchStyles, {
    checked: active,
    disabled: effectiveDisabled,
    size,
    accentColor,
  });

  const control = (
    <Pressable
      id={id}
      role="switch"
      ariaChecked={active}
      ariaLabel={ariaLabel ?? (typeof label === 'string' ? label : undefined)}
      disabled={effectiveDisabled}
      dataKind="switch"
      className={label || description ? undefined : className}
      style={composeStyles(styles.track, style)}
      onActivate={() => onChange?.(!active)}
    >
      <Box style={styles.thumb} />
    </Pressable>
  );

  if (!label && !description) return control;

  return (
    <Row className={className} style={styles.wrapper} gapPx={10}>
      {control}
      <Stack gapPx={2}>
        {label && <Text style={styles.label}>{label}</Text>}
        {description && <Text style={styles.description}>{description}</Text>}
      </Stack>
    </Row>
  );
}

export interface HausSliderProps {
  readonly id?: string;
  readonly value: number;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly size?: HausControlSize;
  readonly accentColor?: ColorValue;
  readonly disabled?: boolean;
  readonly label?: string;
  readonly valueLabel?: string;
  readonly minLabel?: string;
  readonly maxLabel?: string;
  readonly 'aria-label'?: string;
  readonly className?: string;
  readonly style?: UiStyleSpec;
  readonly onChange?: (value: number) => void;
  readonly onChangeEnd?: (value: number) => void;
}

export function HausSlider({
  id,
  value,
  min = 0,
  max = 100,
  step = 1,
  size = 'md',
  accentColor,
  disabled,
  label,
  valueLabel,
  minLabel,
  maxLabel,
  'aria-label': ariaLabel,
  className,
  style,
  onChange,
  onChangeEnd,
}: HausSliderProps): React.ReactElement {
  const span = Math.max(1e-9, max - min);
  const clamped = Math.max(min, Math.min(max, value));
  const ratioPct = ((clamped - min) / span) * 100;
  const styles = useHausStyles(sliderStyles, { ratioPct, disabled, size, accentColor });

  return (
    <Box id={id} className={className} style={composeStyles(styles.root, style)}>
      {(label || valueLabel) && (
        <Row style={styles.header}>
          {label ? <Text style={styles.label}>{label}</Text> : <Box />}
          {valueLabel && <Text style={styles.valueLabel}>{valueLabel}</Text>}
        </Row>
      )}
      <Box style={styles.trackHost}>
        <Box style={styles.track}>
          <Box style={styles.fill}>
            <Box style={styles.thumb} />
          </Box>
          <Box style={styles.spacer} />
        </Box>
        <RangeInput
          id={id && `${id}-input`}
          ariaLabel={ariaLabel ?? label}
          min={min}
          max={max}
          step={step}
          value={clamped}
          disabled={disabled}
          onChange={onChange}
          onChangeEnd={onChangeEnd}
        />
      </Box>
      {(minLabel || maxLabel) && (
        <Row style={styles.boundsRow}>
          <Text style={styles.boundText}>{minLabel ?? ''}</Text>
          <Text style={styles.boundText}>{maxLabel ?? ''}</Text>
        </Row>
      )}
    </Box>
  );
}

export interface HausSegmentedOption<T extends string = string> {
  readonly value: T;
  readonly label: string;
  readonly disabled?: boolean;
}

export interface HausSegmentedControlProps<T extends string = string> {
  readonly id?: string;
  readonly value: T;
  readonly options: readonly HausSegmentedOption<T>[];
  readonly 'aria-label'?: string;
  readonly className?: string;
  readonly style?: UiStyleSpec;
  readonly onChange: (value: T) => void;
}

export function HausSegmentedControl<T extends string = string>({
  id,
  value,
  options,
  'aria-label': ariaLabel,
  className,
  style,
  onChange,
}: HausSegmentedControlProps<T>): React.ReactElement {
  const rootStyles = useHausStyles(segmentedStyles, false);
  const selectedStyles = useHausStyles(segmentedStyles, true);

  return (
    <Row
      id={id}
      role="radiogroup"
      ariaLabel={ariaLabel}
      className={className}
      style={composeStyles(rootStyles.root, style)}
    >
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            id={id && `${id}-${opt.value}`}
            role="radio"
            ariaChecked={selected}
            ariaPressed={selected}
            selected={selected}
            disabled={opt.disabled}
            dataKind="segmented-option"
            style={selected ? selectedStyles.option : rootStyles.option}
            onActivate={() => onChange(opt.value)}
          >
            <Text
              style={{
                typography: (selected ? selectedStyles.option : rootStyles.option).typography,
              }}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </Row>
  );
}

export interface HausTabItem {
  readonly key: string;
  readonly label: string;
  readonly disabled?: boolean;
  readonly content?: React.ReactNode;
}

export interface HausTabsProps {
  readonly id?: string;
  readonly items: readonly HausTabItem[];
  readonly selectedKey?: string;
  readonly defaultSelectedKey?: string;
  readonly 'aria-label'?: string;
  readonly className?: string;
  readonly style?: UiStyleSpec;
  readonly onSelectionChange?: (key: string) => void;
}

export function HausTabs({
  id,
  items,
  selectedKey,
  defaultSelectedKey,
  'aria-label': ariaLabel,
  className,
  style,
  onSelectionChange,
}: HausTabsProps): React.ReactElement {
  const [internalKey, setInternalKey] = React.useState(defaultSelectedKey ?? items[0]?.key ?? '');
  const activeKey = selectedKey ?? internalKey;
  const activeItem = items.find((item) => item.key === activeKey) ?? items[0];

  const select = (key: string) => {
    if (selectedKey === undefined) setInternalKey(key);
    onSelectionChange?.(key);
  };

  return (
    <Stack id={id} className={className} gapPx={12} style={style}>
      <HausSegmentedControl
        aria-label={ariaLabel}
        value={activeKey}
        options={items.map((item) => ({
          value: item.key,
          label: item.label,
          disabled: item.disabled,
        }))}
        onChange={select}
      />
      {activeItem?.content !== undefined && (
        <Box role="tabpanel" ariaLabel={activeItem.label}>
          {activeItem.content}
        </Box>
      )}
    </Stack>
  );
}
