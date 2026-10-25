import { bytes, ratio } from './presentation';
import { useLayoutEffect, useRef } from 'react';
import { duoUsageArc, duoUsageGeometry as glyph } from './duobar-geometry';
import { serviceCpuPercent, serviceUsageScore } from './service-usage-score';

type UsageProps = {
  cpu: number | null;
  memory: number | null;
  totalMemory: number | null;
  inactive?: boolean;
  system?: boolean;
  cpuIncomplete?: boolean;
  memoryIncomplete?: boolean;
};

/** DuoBar-inspired compact glyph: independent CPU arc and memory dots. */
export function ServiceUsageGauge({
  cpu,
  memory,
  totalMemory,
  inactive = false,
  system = false,
  cpuIncomplete = false,
  memoryIncomplete = false,
}: UsageProps) {
  const cpuRatio = ratio(cpu, 100);
  const memoryRatio = ratio(memory, totalMemory);
  const usage = system ? cpuRatio : serviceUsageScore(cpu, memory, totalMemory);
  const pressure = system
    ? Math.min(1, ((cpuRatio ?? 0) ** 4 + 0.1 * (memoryRatio ?? 0) ** 4) ** 0.25)
    : Math.max(cpuRatio ?? 0, memoryRatio ?? 0);
  const arc = useRef<SVGPathElement>(null);
  const drawnProgress = useRef(cpuRatio ?? 0);
  useLayoutEffect(() => {
    const node = arc.current;
    if (!node) return;
    const from = drawnProgress.current;
    const target = cpuRatio ?? 0;
    const draw = (value: number) => {
      drawnProgress.current = value;
      node.setAttribute('d', duoUsageArc(value));
    };
    if (
      Math.abs(target - from) < 0.00001 ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      draw(target);
      return;
    }
    draw(from);
    const started = performance.now();
    let frame = 0;
    const animate = (now: number) => {
      const t = Math.min(1, (now - started) / 400);
      draw(from + (target - from) * (1 - (1 - t) ** 3));
      if (t < 1) frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [cpuRatio]);
  const detail = `CPU arc: ${cpuRatio === null ? 'not reported' : `${Math.round(cpuRatio * 100)}% of host capacity`} · Memory dots: ${memoryRatio === null ? 'not reported' : `${Math.round(memoryRatio * 100)}% · ${bytes(memory)}`}`;
  const level = (value: number | null) =>
    value !== null && value >= 0.85
      ? 'danger'
      : value !== null && value >= 0.65
        ? 'warning'
        : undefined;
  return (
    <span
      className={`server-usage-gauge${inactive || usage === null ? ' is-inactive has-pulse' : ''}`}
      data-level={inactive || usage === null ? undefined : level(pressure)}
      title={detail}
      aria-label={detail}
    >
      <svg viewBox="0 0 32 32" style={{ strokeWidth: glyph.stroke }} aria-hidden="true">
        <path className="server-usage-track" d={glyph.arc} />
        <path
          ref={arc}
          className="server-usage-fill"
          d={duoUsageArc(cpuRatio ?? 0)}
          opacity={cpuRatio !== null && cpuRatio > 0 ? 1 : 0}
        />
        <g className="server-usage-memory">
          {glyph.dots.map(({ x, y }, index) => (
            <circle
              key={index}
              cx={x}
              cy={y}
              r={glyph.dotRadius}
              style={{
                opacity:
                  glyph.inactiveOpacity +
                  (1 - glyph.inactiveOpacity) *
                    Math.min(1, Math.max(0, (memoryRatio ?? 0) * 4 - index)),
              }}
            />
          ))}
        </g>
        <text className="server-usage-percentage" x="16" y={glyph.centerY}>
          {usage === null
            ? '—'
            : `${cpuIncomplete || memoryIncomplete ? '≥' : ''}${Math.round(usage * 100)}%`}
        </text>
        <path
          className="server-usage-pulse"
          d="M10 15h3l2-5 3 10 2-5h2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export function ServiceUsage(props: UsageProps) {
  return (
    <span className="server-service-usage">
      <ServiceUsageGauge {...props} />
      <span className="server-service-usage-values">
        <span>
          <small>CPU</small>
          <span
            title={
              props.cpuIncomplete
                ? 'Measured services only; additional usage is not reported.'
                : undefined
            }
          >
            {props.cpuIncomplete ? '≥ ' : ''}
            {serviceCpuPercent(props.cpu)}
          </span>
        </span>
        <span>
          <small>Memory</small>
          <span
            title={
              props.memoryIncomplete
                ? 'Measured services only; additional usage is not reported.'
                : undefined
            }
          >
            {props.memoryIncomplete ? '≥ ' : ''}
            {props.memory === null ? '—' : bytes(props.memory)}
          </span>
        </span>
      </span>
    </span>
  );
}
