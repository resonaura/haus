/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useRef, useState } from 'react';
import {
  Box,
  HausButton,
  Pressable,
  Text,
  VectorGraphic,
  type HostSurfacePointerEvent,
} from '@haus/ui';
import { Glyph } from './ControlGlyph';
import { snapTemperature, temperatureFromDialPoint } from './temperature-dial';
import { formatTemperature } from '../../../model/format-temperature';

export function TemperatureDial({
  value,
  min,
  max,
  step,
  unit,
  current,
  disabled,
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  current?: number;
  disabled: boolean;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(value);
  const editing = useRef(false);
  const commitRef = useRef(onCommit);
  const range = max - min;
  const progress = range > 0 ? (draft - min) / range : 0;
  const circumference = 2 * Math.PI * 74;
  const arcLength = (circumference * 270) / 360;
  const angle = ((135 + progress * 270) * Math.PI) / 180;
  const knobX = 90 + 74 * Math.cos(angle);
  const knobY = 90 + 74 * Math.sin(angle);

  useEffect(() => {
    commitRef.current = onCommit;
  }, [onCommit]);
  useEffect(() => {
    if (editing.current) return;
    const next = snapTemperature(value, min, max, step);
    setDraft(next);
    draftRef.current = next;
  }, [value, min, max, step]);

  const update = (next: number) => {
    const snapped = snapTemperature(next, min, max, step);
    draftRef.current = snapped;
    setDraft(snapped);
  };
  const adjustFromPointer = (event: HostSurfacePointerEvent) => {
    const x = ((event.clientX - event.rect.left) / event.rect.width) * 180;
    const y = ((event.clientY - event.rect.top) / event.rect.height) * 180;
    update(temperatureFromDialPoint(x, y, min, max, step));
  };
  const presets = [0, 1 / 3, 2 / 3, 1]
    .map((fraction) => snapTemperature(min + range * fraction, min, max, step))
    .filter((temperature, index, options) => options.indexOf(temperature) === index);

  return (
    <Box semantic="section" className="haus-temperature-dial" ariaLabel="Target temperature">
      {current !== undefined && (
        <Box className="haus-temperature-dial__current">
          <Text>Current water</Text>
          <Text semantic="strong">
            {formatTemperature(current) ?? current}
            {unit}
          </Text>
        </Box>
      )}
      <Box className="haus-temperature-dial__face">
        <VectorGraphic
          className="haus-temperature-dial__svg"
          viewWidth={180}
          viewHeight={180}
          role="slider"
          tabIndex={disabled ? -1 : 0}
          ariaLabel="Adjust target temperature"
          ariaValueMin={min}
          ariaValueMax={max}
          ariaValueNow={draft}
          ariaValueText={`${draft}${unit}`}
          ariaDisabled={disabled}
          onPointerDownEvent={(event) => {
            if (disabled) return;
            event.setPointerCapture();
            editing.current = true;
            adjustFromPointer(event);
          }}
          onPointerMoveEvent={(event) => {
            if (event.hasPointerCapture()) adjustFromPointer(event);
          }}
          onPointerUpEvent={(event) => {
            if (!event.hasPointerCapture()) return;
            event.releasePointerCapture();
            editing.current = false;
            commitRef.current(draftRef.current);
          }}
          onPointerCancel={() => {
            editing.current = false;
            update(value);
          }}
          onKeyDown={(event) => {
            if (disabled) return;
            const direction =
              event.key === 'ArrowUp' || event.key === 'ArrowRight'
                ? 1
                : event.key === 'ArrowDown' || event.key === 'ArrowLeft'
                  ? -1
                  : 0;
            if (direction) {
              event.preventDefault();
              const next = snapTemperature(draftRef.current + direction * step, min, max, step);
              update(next);
              commitRef.current(next);
            } else if (event.key === 'Home' || event.key === 'End') {
              event.preventDefault();
              const next = event.key === 'Home' ? min : max;
              update(next);
              commitRef.current(next);
            }
          }}
          circles={[
            {
              className: 'haus-temperature-dial__track',
              cx: 90,
              cy: 90,
              r: 74,
              transform: 'rotate(135 90 90)',
              strokeDasharray: `${arcLength} ${circumference}`,
            },
            {
              className: 'haus-temperature-dial__progress',
              cx: 90,
              cy: 90,
              r: 74,
              transform: 'rotate(135 90 90)',
              strokeDasharray: `${arcLength} ${circumference}`,
              strokeDashoffset: arcLength * (1 - progress),
            },
            {
              className: 'haus-temperature-dial__knob',
              cx: knobX,
              cy: knobY,
              r: 8,
            },
          ]}
        />
        <Box className="haus-temperature-dial__readout" ariaHidden>
          <Text>Target</Text>
          <Text semantic="strong">
            {formatTemperature(draft) ?? draft}
            <Text semantic="small">{unit}</Text>
          </Text>
        </Box>
      </Box>
      <Box className="haus-temperature-dial__stepper">
        <HausButton
          isIconOnly
          variant="secondary"
          isDisabled={disabled || draft <= min}
          aria-label="Lower target temperature"
          onPress={() => {
            const next = snapTemperature(draftRef.current - step, min, max, step);
            update(next);
            commitRef.current(next);
          }}
        >
          <Glyph name="minus" />
        </HausButton>
        <Text>Swipe the dial or adjust</Text>
        <HausButton
          isIconOnly
          variant="secondary"
          isDisabled={disabled || draft >= max}
          aria-label="Raise target temperature"
          onPress={() => {
            const next = snapTemperature(draftRef.current + step, min, max, step);
            update(next);
            commitRef.current(next);
          }}
        >
          <Glyph name="plus" />
        </HausButton>
      </Box>
      <Box className="haus-temperature-dial__presets" ariaLabel="Temperature presets">
        {presets.map((temperature) => (
          <Pressable
            key={temperature}
            disabled={disabled || temperature === draft}
            ariaPressed={temperature === draft}
            onPress={() => {
              update(temperature);
              commitRef.current(temperature);
            }}
          >
            {formatTemperature(temperature) ?? temperature}
            {unit}
          </Pressable>
        ))}
      </Box>
    </Box>
  );
}
