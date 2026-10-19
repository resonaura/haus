import { describe, expect, it } from 'vitest';
import { historyPoints, historyChart, nearestHistoryPoint } from './device-history';
describe('bounded device history charts', () => {
  it('normalizes compact HA timestamps, orders readings and keeps the final value at equal timestamps', () => {
    expect(
      historyPoints([
        { s: '21', lu: 2 },
        { s: '19', lc: 1 },
        { state: '22', last_updated: '1970-01-01T00:00:02Z' },
        { s: 'bad', lu: NaN },
      ]),
    ).toEqual([
      { at: 1000, state: '19' },
      { at: 2000, state: '22' },
    ]);
  });
  it('never joins numeric values through known unavailable periods, even within one pixel bucket', () => {
    const points = [
      { at: 0, state: '20.01' },
      { at: 1, state: 'unavailable' },
      { at: 2, state: '20.02' },
      { at: 1000, state: '20.03' },
    ];
    const chart = historyChart(points, 0, 1000, 10);
    expect(chart.path.match(/M/g)).toHaveLength(2);
    expect(chart.path).toContain('145.00');
    expect(chart.path).toContain('15.00');
    expect(chart.low).toBe(20.01);
    expect(chart.high).toBe(20.03);
  });
  it('preserves short peaks while keeping a 200,000-point history within a viewport-sized path budget', () => {
    const points = Array.from({ length: 200000 }, (_, at) => ({
      at,
      state: at === 50234 ? '900' : String(at % 20),
    }));
    const chart = historyChart(points, 0, 200000);
    expect(chart.high).toBe(900);
    expect(chart.samples.some((point) => point.at === 50234)).toBe(true);
    expect(chart.samples.length).toBeLessThanOrEqual(581 * 4);
    expect(chart.path.length).toBeLessThan(50000);
  });
  it('carries the last known state into the period and handles constant readings and edge selection', () => {
    const points = [
      { at: -100, state: '10' },
      { at: -1, state: '21' },
      { at: 50, state: '21' },
    ];
    const chart = historyChart(points, 0, 100);
    expect(
      historyPoints(
        points.map((point) => ({ state: point.state, lu: point.at / 1000 })),
        0,
        100,
      ),
    ).toEqual(points.slice(1));
    expect(chart.low).toBe(21);
    expect(chart.path).not.toContain('NaN');
    expect(chart.path).toContain('80.00');
    expect(nearestHistoryPoint(points, -1000)).toBe(0);
    expect(nearestHistoryPoint(points, 1000)).toBe(2);
    expect(nearestHistoryPoint(points, 45)).toBe(2);
  });
});
