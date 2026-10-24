import { useId, useMemo, useState } from 'react';
import {
  historyChart,
  nearestHistoryPoint,
  numericState,
  type HistoryPoint,
} from '../../model/device-history';
export function DeviceHistoryChart({
  points,
  from,
  to,
  unit,
  precision = 3,
}: {
  points: HistoryPoint[];
  from: number;
  to: number;
  unit: string;
  precision?: number;
}) {
  const chart = useMemo(() => historyChart(points, from, to), [points, from, to]);
  const [selected, setSelected] = useState<number>();
  const [keyboard, setKeyboard] = useState(false);
  const hint = useId();
  const point = selected === undefined ? undefined : points[Math.min(points.length - 1, selected)];
  const value = point ? numericState(point.state) : undefined;
  const x = point ? 10 + ((Math.max(from, point.at) - from) / Math.max(1, to - from)) * 580 : 0;
  const number = (value: number) =>
    value.toLocaleString(undefined, { maximumFractionDigits: precision });
  const time = (at: number) =>
    new Date(at).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  if (!chart.count) return null;
  return (
    <div
      className="device-history-chart"
      tabIndex={0}
      role="group"
      aria-label="Explore measurement history"
      aria-describedby={hint}
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(event.key)) return;
        event.preventDefault();
        setKeyboard(true);
        if (event.key === 'Escape') setSelected(undefined);
        else
          setSelected(
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? points.length - 1
                : Math.max(
                    0,
                    Math.min(
                      points.length - 1,
                      (selected ?? points.length - 1) + (event.key === 'ArrowLeft' ? -1 : 1),
                    ),
                  ),
          );
      }}
      onPointerLeave={() => {
        if (!keyboard) setSelected(undefined);
      }}
    >
      <div className="history-chart-summary">
        <span>
          Lowest
          <strong>
            {number(chart.low)} <small>{unit}</small>
          </strong>
        </span>
        <span>
          Highest
          <strong>
            {number(chart.high)} <small>{unit}</small>
          </strong>
        </span>
      </div>
      <span id={hint} className="sr-only">
        Use the left and right arrow keys to explore readings. Home and End jump to the first and
        last reading.
      </span>
      <svg
        viewBox="0 0 600 160"
        role="img"
        aria-label={`Recorded range ${number(chart.low)} to ${number(chart.high)} ${unit}. Breaks in the line indicate unavailable or unknown readings.`}
        onPointerMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const fraction = Math.max(
            0,
            Math.min(1, (((event.clientX - bounds.left) / bounds.width) * 600 - 10) / 580),
          );
          setKeyboard(false);
          setSelected(nearestHistoryPoint(points, from + fraction * (to - from)));
        }}
      >
        {[15, 80, 145].map((y) => (
          <line className="history-grid-line" key={y} x1="10" x2="590" y1={y} y2={y} />
        ))}
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
          d={chart.path}
        />
        {chart.samples.length === 1 && (
          <circle
            cx={10 + ((chart.samples[0].at - from) / Math.max(1, to - from)) * 580}
            cy="80"
            r="3"
            fill="currentColor"
          />
        )}
        {point && <line className="history-cursor" x1={x} x2={x} y1="8" y2="152" />}
        {point && value !== undefined && (
          <circle
            cx={x}
            cy={
              chart.high === chart.low
                ? 80
                : 145 - ((value - chart.low) / (chart.high - chart.low)) * 130
            }
            r="3.5"
            fill="currentColor"
          />
        )}
      </svg>
      <div className="history-chart-axis">
        <time dateTime={new Date(from).toISOString()}>{time(from)}</time>
        <time dateTime={new Date(to).toISOString()}>{time(to)}</time>
      </div>
      <output className="history-chart-reading" aria-live={keyboard ? 'polite' : 'off'}>
        {point ? (
          <>
            <time dateTime={new Date(point.at).toISOString()}>{time(point.at)}</time>
            <strong>
              {value === undefined ? point.state.replaceAll('_', ' ') : `${number(value)} ${unit}`}
            </strong>
          </>
        ) : (
          <span>Move over the chart or use the arrow keys to explore.</span>
        )}
      </output>
    </div>
  );
}
