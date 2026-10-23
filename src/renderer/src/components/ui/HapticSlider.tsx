import { Slider } from '@heroui/react';
import { useRef, type ComponentProps } from 'react';
import { sliderHasDetents, triggerHaptic } from './haptics';

type Props = ComponentProps<typeof Slider> & { hapticDetents?: boolean };
const key = (value: number | number[] | undefined) => JSON.stringify(value);

/** Same accessible HeroUI slider, with ResoStage-style discrete detents. */
function Root({ hapticDetents, onChange, onChangeEnd, ...props }: Props) {
  const last = useRef<string | undefined>(undefined);
  const changed = useRef(false);
  const ticks =
    hapticDetents ?? sliderHasDetents(props.minValue ?? 0, props.maxValue ?? 100, props.step ?? 1);
  return (
    <Slider
      {...props}
      onChange={(value) => {
        const next = key(value);
        const previous =
          last.current ?? key(props.value ?? props.defaultValue ?? props.minValue ?? 0);
        if (next !== previous) {
          changed.current = true;
          if (ticks && !props.isDisabled) triggerHaptic('alignment');
        }
        last.current = next;
        onChange?.(value);
      }}
      onChangeEnd={(value) => {
        if (changed.current && !ticks && !props.isDisabled) triggerHaptic('generic');
        last.current = undefined;
        changed.current = false;
        onChangeEnd?.(value);
      }}
    />
  );
}

export const HapticSlider = Object.assign(Root, {
  Root,
  Track: Slider.Track,
  Fill: Slider.Fill,
  Thumb: Slider.Thumb,
  Output: Slider.Output,
  Marks: Slider.Marks,
});
