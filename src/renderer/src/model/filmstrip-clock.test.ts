import { expect, it } from 'vitest';
import { FilmstripClock } from './filmstrip-clock';

const sample = {
  id: 'clip',
  now: 0,
  seconds: 0,
  duration: 60,
  advancing: true,
};

it('moves on every display frame between coarse decoder samples without velocity pulses', () => {
  for (const hz of [60, 120]) {
    const clock = new FilmstripClock();
    let previous = clock.sample(sample);
    for (let frame = 1; frame <= hz * 3; frame++) {
      const now = (frame * 1000) / hz;
      const seconds = Math.floor(now / 100) / 10;
      const output = clock.sample({ ...sample, now, seconds });
      expect(output - previous).toBeGreaterThan(0.8 / hz);
      expect(output - previous).toBeLessThan(1.2 / hz);
      expect(Math.abs(output - now / 1000)).toBeLessThan(0.03);
      previous = output;
    }
  }
});

it('freezes for waiting/paused media and immediately represents a seek or new clip', () => {
  const clock = new FilmstripClock();
  clock.sample(sample);
  clock.sample({ ...sample, now: 100, seconds: 0.1 });
  expect(clock.sample({ ...sample, now: 116, seconds: 0.1, advancing: false })).toBe(0.1);
  expect(clock.sample({ ...sample, now: 300, seconds: 0.1, advancing: false })).toBe(0.1);
  expect(clock.sample({ ...sample, now: 316, seconds: 24, seeking: true })).toBe(24);
  expect(clock.sample({ ...sample, now: 332, seconds: 40 })).toBe(40);
  expect(clock.sample({ ...sample, now: 348, id: 'next', seconds: 0 })).toBe(0);
});

it('bounds prediction if a decoder stops without sending a waiting event', () => {
  const clock = new FilmstripClock();
  clock.sample(sample);
  for (let now = 16; now <= 5000; now += 16) {
    const seconds = clock.sample({ ...sample, now });
    expect(seconds).toBeGreaterThanOrEqual(0);
    expect(seconds).toBeLessThanOrEqual(0.2);
  }
  expect(clock.sample({ ...sample, now: 5016 })).toBeCloseTo(0.2);
});

it('honours playback speed and the clip end without carrying time across rate changes', () => {
  const clock = new FilmstripClock();
  clock.sample({ ...sample, rate: 2 });
  expect(clock.sample({ ...sample, now: 16, rate: 2 })).toBeCloseTo(0.032);
  expect(clock.sample({ ...sample, now: 32, seconds: 0.032, rate: 0.5 })).toBe(0.032);
  expect(clock.sample({ ...sample, now: 48, seconds: 0.032, rate: 0.5 })).toBeCloseTo(0.04);
  expect(clock.sample({ ...sample, now: 64, seconds: 59.99, duration: 60, rate: 2 })).toBe(59.99);
  expect(clock.sample({ ...sample, now: 80, seconds: 59.99, duration: 60, rate: 2 })).toBe(60);
});
