import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Button } from '@heroui/react';
import { Glyph } from './ControlGlyph';
import { snapTemperature, temperatureFromDialPoint } from './temperature-dial';

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
  const adjustFromPointer = (event: ReactPointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 180;
    const y = ((event.clientY - rect.top) / rect.height) * 180;
    update(temperatureFromDialPoint(x, y, min, max, step));
  };
  const presets = [0, 1 / 3, 2 / 3, 1]
    .map((fraction) => snapTemperature(min + range * fraction, min, max, step))
    .filter((temperature, index, options) => options.indexOf(temperature) === index);

  return (
    <section className="haus-temperature-dial" aria-label="Target temperature">
      {current !== undefined && (
        <div className="haus-temperature-dial__current">
          <span>Current water</span>
          <strong>
            {current}
            {unit}
          </strong>
        </div>
      )}
      <div className="haus-temperature-dial__face">
        <svg
          className="haus-temperature-dial__svg"
          viewBox="0 0 180 180"
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-label="Adjust target temperature"
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={draft}
          aria-valuetext={`${draft}${unit}`}
          aria-disabled={disabled}
          onPointerDown={(event) => {
            if (disabled) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            editing.current = true;
            adjustFromPointer(event);
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) adjustFromPointer(event);
          }}
          onPointerUp={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
            event.currentTarget.releasePointerCapture(event.pointerId);
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
        >
          <circle
            className="haus-temperature-dial__track"
            cx="90"
            cy="90"
            r="74"
            transform="rotate(135 90 90)"
            strokeDasharray={`${arcLength} ${circumference}`}
          />
          <circle
            className="haus-temperature-dial__progress"
            cx="90"
            cy="90"
            r="74"
            transform="rotate(135 90 90)"
            strokeDasharray={`${arcLength} ${circumference}`}
            strokeDashoffset={arcLength * (1 - progress)}
          />
          <circle className="haus-temperature-dial__knob" cx={knobX} cy={knobY} r="8" />
        </svg>
        <div className="haus-temperature-dial__readout" aria-hidden="true">
          <span>Target</span>
          <strong>
            {draft}
            <small>{unit}</small>
          </strong>
        </div>
      </div>
      <div className="haus-temperature-dial__stepper">
        <Button
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
        </Button>
        <span>Swipe the dial or adjust</span>
        <Button
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
        </Button>
      </div>
      <div className="haus-temperature-dial__presets" aria-label="Temperature presets">
        {presets.map((temperature) => (
          <button
            key={temperature}
            type="button"
            disabled={disabled || temperature === draft}
            aria-pressed={temperature === draft}
            onClick={() => {
              update(temperature);
              commitRef.current(temperature);
            }}
          >
            {temperature}
            {unit}
          </button>
        ))}
      </div>
    </section>
  );
}
