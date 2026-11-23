/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { HausRangeSlider, type HausRangeSliderProps } from '@haus/ui';
import { useRef } from 'react';
import { sliderHasDetents, triggerHaptic } from './haptics';

type Props = HausRangeSliderProps & { hapticDetents?: boolean };
const key = (value: number | number[] | undefined) => JSON.stringify(value);

/** Accessible Haus range slider with discrete haptic detents. */
function Root({ hapticDetents, onChange, onChangeEnd, ...props }: Props) {
  const last = useRef<string | null>(null);
  const ticks =
    hapticDetents ?? sliderHasDetents(props.minValue ?? 0, props.maxValue ?? 100, props.step ?? 1);
  return (
    <HausRangeSlider
      {...props}
      onChange={(value) => {
        const next = key(value);
        if (ticks && !props.isDisabled && last.current !== null && last.current !== next)
          triggerHaptic('alignment');
        if (ticks) last.current = next;
        onChange?.(value);
      }}
      onChangeEnd={(value) => {
        last.current = null;
        onChangeEnd?.(value);
      }}
    />
  );
}

export const HapticSlider = Object.assign(Root, {
  Root,
  Track: HausRangeSlider.Track,
  Fill: HausRangeSlider.Fill,
  Thumb: HausRangeSlider.Thumb,
  Output: HausRangeSlider.Output,
  Marks: HausRangeSlider.Marks,
});
