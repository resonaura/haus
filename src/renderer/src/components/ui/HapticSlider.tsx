import { Slider } from '@heroui/react';
import { useRef, type ComponentProps } from 'react';
import { sliderHasDetents, triggerHaptic } from './haptics';

type Props = ComponentProps<typeof Slider> & { hapticDetents?: boolean };
const key = (value: number | number[] | undefined) => JSON.stringify(value);

/** Same accessible HeroUI slider, with ResoStage-style discrete detents. */
function Root({ hapticDetents, onChange, onChangeEnd, ...props }: Props) {
  const last = useRef<string | null>(null);
  const ticks =
    hapticDetents ?? sliderHasDetents(props.minValue ?? 0, props.maxValue ?? 100, props.step ?? 1);
  return (
    <Slider
      {...props}
      onChange={(value) => {
        const next = key(value);
        // HeroUI's first report is the grab/start value. The OS already gives
        // primary-click feedback; tick only when the thumb crosses a later step.
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
  Track: Slider.Track,
  Fill: Slider.Fill,
  Thumb: Slider.Thumb,
  Output: Slider.Output,
  Marks: Slider.Marks,
});
