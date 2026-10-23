import { expect, it } from 'vitest';
import { glassDisplacement } from './liquid-glass-map';

const channel = (map: ReturnType<typeof glassDisplacement>, x: number, y: number) =>
  Array.from(map.pixels.slice((y * map.width + x) * 4, (y * map.width + x) * 4 + 4));

it('keeps the reading surface flat and bends opposing edges inward', () => {
  const map = glassDisplacement(300, 200, 24);
  expect(channel(map, 150, 100)).toEqual([128, 128, 128, 255]);
  expect(channel(map, 1, 100)[0]).toBeGreaterThan(240);
  expect(channel(map, 298, 100)[0]).toBeLessThan(16);
  expect(channel(map, 150, 1)[1]).toBeGreaterThan(240);
  expect(channel(map, 150, 198)[1]).toBeLessThan(16);
  expect(channel(map, 40, 100)).toEqual([128, 128, 128, 255]);
});

it('follows the rounded rim without distorting pixels outside its silhouette', () => {
  const map = glassDisplacement(200, 100, 24);
  expect(channel(map, 0, 0)).toEqual([128, 128, 128, 255]);
  const corner = channel(map, 9, 9);
  expect(corner[0]).toBeGreaterThan(200);
  expect(corner[1]).toBeGreaterThan(200);
  expect(Math.abs(corner[0] - corner[1])).toBeLessThan(2);
});

it('bounds allocation for very large panels while preserving their aspect ratio', () => {
  const map = glassDisplacement(7680, 4320, 24);
  expect(map.width).toBe(512);
  expect(map.height).toBe(288);
  expect(map.pixels.length).toBe(512 * 288 * 4);
  expect(channel(map, 256, 144)).toEqual([128, 128, 128, 255]);
});

it('handles hidden/tiny panels and invalid sizes without unbounded allocation or NaN', () => {
  for (const dimensions of [
    [0, 0, 24],
    [-100, 20, -10],
    [NaN, Infinity, NaN],
    [1, 1, 10000],
  ]) {
    const map = glassDisplacement(...(dimensions as [number, number, number]));
    expect(map.width).toBeGreaterThanOrEqual(1);
    expect(map.height).toBeGreaterThanOrEqual(1);
    expect(map.pixels.length).toBeLessThanOrEqual(512 * 512 * 4);
    for (let index = 3; index < map.pixels.length; index += 4) {
      expect(map.pixels[index]).toBe(255);
    }
  }
});
