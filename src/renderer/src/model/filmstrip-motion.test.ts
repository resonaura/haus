import { expect, it } from 'vitest';
import { FilmstripMotion, FilmstripPlayback } from './filmstrip-motion';
const frame = {
  now: 0,
  delta: 16,
  target: 0,
  nativeLeft: 0,
  dragging: false,
  playing: true,
  reduced: false,
  live: false,
  width: 900,
};
it('keeps subpixel motion even when native scrolling rounds to whole pixels', () => {
  const motion = new FilmstripMotion();
  motion.step(frame);
  let previous = 0;
  for (let index = 1; index < 60; index++) {
    const result = motion.step({
      ...frame,
      now: index * 16,
      target: index / 30,
      nativeLeft: Math.round(previous),
    });
    expect(result.left).toBeGreaterThan(previous);
    expect(result.left - previous).toBeLessThan(0.1);
    previous = result.left;
  }
});
it('never eases a gesture, seeks during the gesture, then pins its final position while paused', () => {
  const motion = new FilmstripMotion();
  motion.step(frame);
  let seeks = 0;
  for (let now = 100; now <= 1000; now += 16) {
    motion.gesture(now, now);
    const result = motion.step({ ...frame, now, nativeLeft: now, target: 0 });
    expect(result.left).toBe(now);
    if (result.seek) seeks++;
  }
  expect(seeks).toBeGreaterThan(5);
  expect(seeks).toBeLessThan(11);
  expect(motion.step({ ...frame, now: 1300, nativeLeft: 996, playing: false }).settled).toBe(true);
  expect(motion.step({ ...frame, now: 1500, nativeLeft: 996, playing: false }).left).toBe(996);
  motion.follow();
  expect(motion.step({ ...frame, now: 1600, live: true, target: 2000 }).left).toBe(2000);
});

it('preserves live/playing or paused intent throughout preview seeks and resets for the next gesture', () => {
  const playback = new FilmstripPlayback();
  playback.begin(true); // Live, or a playing recording.
  playback.begin(false); // Preview temporarily paused the media element.
  expect(playback.finish()).toBe(true);
  playback.begin(false); // Explicit pause before this gesture.
  playback.begin(true);
  expect(playback.finish()).toBe(false);
  playback.begin(true);
  expect(playback.finish()).toBe(true);
});
