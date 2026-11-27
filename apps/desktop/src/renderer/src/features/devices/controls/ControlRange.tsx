/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useRef, useState } from 'react';
import { Box, HausLabel as Label, Row, Text } from '@haus/ui';
import { HapticSlider as Slider } from '../../../components/ui/HapticSlider';
import { sliderHasDetents, triggerHaptic } from '../../../components/ui/haptics';
import { Glyph } from './ControlGlyph';
import { clamp } from './control-values';
/** Sends one command at the end of a drag; arrow keys and a focused mouse wheel work too. */
export function ControlRange({
  label,
  value,
  min = 0,
  max = 100,
  step = 1,
  unit = '%',
  disabled,
  unknown = false,
  vertical = false,
  onCommit,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  disabled: boolean;
  unknown?: boolean;
  vertical?: boolean;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(value);
  const wrapper = useRef<HTMLDivElement>(null);
  const draftRef = useRef(value);
  const editing = useRef(false);
  const commitRef = useRef(onCommit);
  useEffect(() => {
    if (editing.current) return;
    setDraft(value);
    draftRef.current = value;
  }, [value]);
  useEffect(() => {
    commitRef.current = onCommit;
  }, [onCommit]);
  useEffect(() => {
    const element = wrapper.current;
    if (!element) return;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const onWheel = (event: WheelEvent) => {
      if (disabled || !element.contains(document.activeElement)) return;
      event.preventDefault();
      const next =
        Math.round(clamp(draftRef.current + (event.deltaY < 0 ? step : -step), min, max) * 1000) /
        1000;
      if (next !== draftRef.current && sliderHasDetents(min, max, step)) {
        triggerHaptic('alignment');
      }
      draftRef.current = next;
      editing.current = true;
      setDraft(next);
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        editing.current = false;
        commitRef.current(next);
      }, 180);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      element.removeEventListener('wheel', onWheel);
      clearTimeout(timeout);
    };
  }, [disabled, min, max, step]);
  return (
    <Box
      boxRef={wrapper}
      className={vertical ? 'haus-range-wrap haus-range-wrap--vertical' : 'haus-range-wrap'}
    >
      <Slider
        className={vertical ? 'haus-brightness' : 'haus-control-range'}
        value={draft}
        minValue={min}
        maxValue={max}
        step={step}
        orientation={vertical ? 'vertical' : 'horizontal'}
        isDisabled={disabled}
        aria-label={label}
        onChange={(next) => {
          if (typeof next === 'number') {
            editing.current = true;
            setDraft(next);
            draftRef.current = next;
          }
        }}
        onChangeEnd={(next) => {
          editing.current = false;
          if (typeof next === 'number') onCommit(next);
        }}
      >
        {vertical ? (
          <Box className="haus-range-label">
            <Label>{label}</Label>
            <Text semantic="output">{unknown ? '—' : `${draft}${unit}`}</Text>
          </Box>
        ) : (
          <Row justify="between" align="center" gapPx={8}>
            <Label>{label}</Label>
            <Slider.Output>{unknown ? '—' : `${draft}${unit}`}</Slider.Output>
          </Row>
        )}
        <Slider.Track>
          <Slider.Fill />
          <Slider.Thumb />
        </Slider.Track>
      </Slider>
      {vertical && <Glyph name="light" className="haus-brightness-icon" />}
    </Box>
  );
}
