import { useEffect, useRef, useState } from 'react';
import { Label } from '@heroui/react';
import { HapticSlider as Slider } from '../../../components/ui/HapticSlider';
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
    <div
      ref={wrapper}
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
        <div className="haus-range-label">
          <Label>{label}</Label>
          <output>
            {draft}
            {unit}
          </output>
        </div>
        <Slider.Track>
          <Slider.Fill />
          <Slider.Thumb />
        </Slider.Track>
      </Slider>
      {vertical && <Glyph name="light" className="haus-brightness-icon" />}
    </div>
  );
}
