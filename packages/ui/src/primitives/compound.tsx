/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import * as React from 'react';
import { pct, px } from '../ir/geometry.js';
import type { UiStyleSpec } from '../ir/node.js';
import { segmentedStyles, sliderStyles } from '../styles/controls.js';
import { composeStyles } from '../styles/sheet.js';
import { useHausStyles } from './context.js';
import { Box, Pressable, RangeInput, Row, Stack, Text } from './elements.js';

interface TabsCtx {
  readonly selectedKey: string;
  readonly onSelect: (key: string) => void;
}

const TabsContext = React.createContext<TabsCtx | null>(null);

function TabsRoot({
  selectedKey,
  defaultSelectedKey = '',
  className,
  style,
  onSelectionChange,
  children,
}: {
  readonly selectedKey?: string;
  readonly defaultSelectedKey?: string;
  readonly className?: string;
  readonly style?: UiStyleSpec;
  readonly onSelectionChange?: (key: string) => void;
  readonly children?: React.ReactNode;
}): React.ReactElement {
  const [internal, setInternal] = React.useState(defaultSelectedKey);
  const current = selectedKey ?? internal;
  const onSelect = React.useCallback(
    (key: string) => {
      if (selectedKey === undefined) setInternal(key);
      onSelectionChange?.(key);
    },
    [selectedKey, onSelectionChange],
  );
  return (
    <TabsContext.Provider value={{ selectedKey: current, onSelect }}>
      <Stack className={['tabs', className].filter(Boolean).join(' ')} gapPx={12} style={style}>
        {children}
      </Stack>
    </TabsContext.Provider>
  );
}

function TabsListContainer({
  className,
  children,
}: {
  readonly className?: string;
  readonly children?: React.ReactNode;
}): React.ReactElement {
  return (
    <Box className={['tabs__list-container', className].filter(Boolean).join(' ')}>{children}</Box>
  );
}

function TabsList({
  'aria-label': ariaLabel,
  className,
  children,
}: {
  readonly 'aria-label'?: string;
  readonly className?: string;
  readonly children?: React.ReactNode;
}): React.ReactElement {
  const styles = useHausStyles(segmentedStyles, false);
  return (
    <Row
      role="tablist"
      ariaLabel={ariaLabel}
      className={['tabs__list', className].filter(Boolean).join(' ')}
      style={styles.root}
    >
      {children}
    </Row>
  );
}

function TabsTab({
  id,
  className,
  children,
}: {
  readonly id: string;
  readonly className?: string;
  readonly children?: React.ReactNode;
}): React.ReactElement {
  const ctx = React.useContext(TabsContext);
  const selected = ctx?.selectedKey === id;
  const styles = useHausStyles(segmentedStyles, selected);
  return (
    <Pressable
      role="tab"
      ariaSelected={selected}
      selected={selected}
      className={['tabs__tab', selected ? 'is-selected' : '', className].filter(Boolean).join(' ')}
      style={styles.option}
      onActivate={() => ctx?.onSelect(id)}
    >
      {children}
    </Pressable>
  );
}

function TabsIndicator(): React.ReactElement | null {
  return null;
}

function TabsPanel({
  id,
  className,
  children,
}: {
  readonly id: string;
  readonly className?: string;
  readonly children?: React.ReactNode;
}): React.ReactElement | null {
  const ctx = React.useContext(TabsContext);
  if (ctx && ctx.selectedKey !== id) return null;
  return (
    <Box role="tabpanel" className={['tabs__panel', className].filter(Boolean).join(' ')}>
      {children}
    </Box>
  );
}

/**
 * Compound adapter-backed Tabs (`HausTabsView.ListContainer`, `.List`, `.Tab`, `.Indicator`, `.Panel`)
 * — ZERO direct HTML tags.
 */
export const HausTabsView = Object.assign(TabsRoot, {
  ListContainer: TabsListContainer,
  List: TabsList,
  Tab: TabsTab,
  Indicator: TabsIndicator,
  Panel: TabsPanel,
});

interface SliderCtx {
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly ratioPct: number;
  readonly vertical: boolean;
  readonly disabled: boolean;
  readonly ariaLabel?: string;
  readonly onChange?: (value: number) => void;
  readonly onChangeEnd?: (value: number) => void;
}

const SliderContext = React.createContext<SliderCtx | null>(null);

export interface HausRangeSliderProps {
  readonly value?: number | number[];
  readonly defaultValue?: number | number[];
  readonly minValue?: number;
  readonly maxValue?: number;
  readonly step?: number;
  readonly orientation?: 'horizontal' | 'vertical';
  readonly isDisabled?: boolean;
  readonly className?: string;
  readonly 'aria-label'?: string;
  readonly style?: UiStyleSpec;
  readonly onChange?: (value: number) => void;
  readonly onChangeEnd?: (value: number) => void;
  readonly children?: React.ReactNode;
}

function RangeSliderRoot({
  value,
  defaultValue,
  minValue = 0,
  maxValue = 100,
  step = 1,
  orientation = 'horizontal',
  isDisabled = false,
  className,
  'aria-label': ariaLabel,
  style,
  onChange,
  onChangeEnd,
  children,
}: HausRangeSliderProps): React.ReactElement {
  const raw = Array.isArray(value)
    ? (value[0] ?? minValue)
    : (value ?? (Array.isArray(defaultValue) ? defaultValue[0] : defaultValue) ?? minValue);
  const clamped = Math.max(minValue, Math.min(maxValue, raw));
  const span = Math.max(1e-9, maxValue - minValue);
  const ratioPct = ((clamped - minValue) / span) * 100;
  const vertical = orientation === 'vertical';
  const styles = useHausStyles(sliderStyles, { ratioPct, disabled: isDisabled });

  return (
    <SliderContext.Provider
      value={{
        value: clamped,
        min: minValue,
        max: maxValue,
        step,
        ratioPct,
        vertical,
        disabled: isDisabled,
        ariaLabel,
        onChange,
        onChangeEnd,
      }}
    >
      <Box
        className={['slider', vertical ? 'is-vertical' : '', className].filter(Boolean).join(' ')}
        style={composeStyles(styles.root, style)}
        dataKind="slider"
      >
        {children}
      </Box>
    </SliderContext.Provider>
  );
}

function RangeSliderTrack({
  className,
  children,
}: {
  readonly className?: string;
  readonly children?: React.ReactNode;
}): React.ReactElement {
  const ctx = React.useContext(SliderContext);
  const styles = useHausStyles(sliderStyles, {
    ratioPct: ctx?.ratioPct ?? 0,
    disabled: ctx?.disabled,
  });
  return (
    <Box
      className={['slider__track', className].filter(Boolean).join(' ')}
      style={
        ctx?.vertical
          ? composeStyles(styles.trackHost, {
              layout: { width: px(48), height: px(160), justifyContent: 'center' },
            })
          : styles.trackHost
      }
    >
      {ctx?.vertical ? (
        <Box style={composeStyles(styles.track, { layout: { width: px(32), height: pct(100) } })}>
          {children}
        </Box>
      ) : (
        <Box style={styles.track}>
          <Box className="slider__fill" style={styles.fill}>
            <Box className="slider__thumb" style={styles.thumb} />
          </Box>
          <Box style={styles.spacer} />
        </Box>
      )}
      {ctx && (
        <RangeInput
          ariaLabel={ctx.ariaLabel}
          value={ctx.value}
          min={ctx.min}
          max={ctx.max}
          step={ctx.step}
          disabled={ctx.disabled}
          onChange={ctx.onChange}
          onChangeEnd={ctx.onChangeEnd}
        />
      )}
    </Box>
  );
}

function RangeSliderFill(): React.ReactElement | null {
  const ctx = React.useContext(SliderContext);
  const styles = useHausStyles(sliderStyles, {
    ratioPct: ctx?.ratioPct ?? 0,
    disabled: ctx?.disabled,
  });
  if (!ctx?.vertical) return null;
  return (
    <Box
      className="slider__fill"
      style={composeStyles(styles.fill, {
        layout: {
          position: 'absolute',
          inset: { bottom: px(0), left: px(0), right: px(0) },
          width: pct(100),
          minWidth: px(0),
          height: pct(ctx.ratioPct),
          padding: undefined,
        },
      })}
    />
  );
}

function RangeSliderThumb(): React.ReactElement | null {
  return null;
}

function RangeSliderOutput({
  className,
  children,
}: {
  readonly className?: string;
  readonly children?: React.ReactNode;
}): React.ReactElement {
  return (
    <Text
      className={['slider__output', className].filter(Boolean).join(' ')}
      mono
      size={12}
      tone="muted"
    >
      {children}
    </Text>
  );
}

function RangeSliderMarks(): React.ReactElement | null {
  return null;
}

/**
 * Compound adapter-backed Slider (`HausRangeSlider.Track`, `.Fill`, `.Thumb`, `.Output`, `.Marks`)
 * — ZERO direct HTML tags.
 */
export const HausRangeSlider = Object.assign(RangeSliderRoot, {
  Root: RangeSliderRoot,
  Track: RangeSliderTrack,
  Fill: RangeSliderFill,
  Thumb: RangeSliderThumb,
  Output: RangeSliderOutput,
  Marks: RangeSliderMarks,
});
