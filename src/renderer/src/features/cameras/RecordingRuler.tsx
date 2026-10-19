import { useEffect, useMemo, useRef } from 'react';
import {
  chronologicalRecordings,
  type CameraEvent,
  type CameraAvailability,
} from '../../model/camera-history';
export function RecordingRuler({
  events,
  offline,
  from,
  to,
  selected,
  onSelect,
}: {
  events: CameraEvent[];
  offline: CameraAvailability[];
  from: number;
  to: number;
  selected?: CameraEvent;
  onSelect: (event: CameraEvent) => void;
}) {
  const element = useRef<HTMLCanvasElement>(null);
  const ordered = useMemo(
    () => chronologicalRecordings(events).filter((event) => event.status === 'ready'),
    [events],
  );
  useEffect(() => {
    const canvas = element.current;
    if (!canvas) return;
    const draw = () => {
      const width = canvas.clientWidth,
        dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.ceil(width * dpr);
      canvas.height = 26 * dpr;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, 26);
      ctx.fillStyle = 'rgba(255,255,255,.07)';
      ctx.fillRect(0, 4, width, 18);
      const filled = new Uint8Array(Math.ceil(width));
      for (const event of ordered) {
        const start = Math.max(0, Math.floor(((event.startAt - from) / (to - from)) * width)),
          end = Math.min(width, Math.ceil(((event.endAt - from) / (to - from)) * width));
        filled.fill(1, start, end);
      }
      ctx.fillStyle = 'rgba(255,255,255,.42)';
      for (let i = 0; i < filled.length;) {
        if (!filled[i]) {
          i++;
          continue;
        }
        const start = i;
        while (i < filled.length && filled[i]) i++;
        ctx.fillRect(start, 4, i - start, 18);
      }
      ctx.fillStyle = 'rgba(255,255,255,.18)';
      for (const period of offline) {
        const x = Math.max(0, ((period.startAt - from) / (to - from)) * width),
          w = Math.max(
            1,
            ((Math.min(to, period.endAt) - Math.max(from, period.startAt)) / (to - from)) * width,
          );
        ctx.fillRect(x, 1, w, 24);
      }
      if (selected) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(((selected.startAt - from) / (to - from)) * width, 0, 2, 26);
      }
    };
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    draw();
    return () => observer.disconnect();
  }, [ordered, offline, from, to, selected]);
  const chooseAt = (at: number) => {
    let low = 0,
      high = ordered.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (ordered[mid].startAt < at) low = mid + 1;
      else high = mid;
    }
    const next = ordered[low],
      previous = ordered[low - 1];
    const chosen =
      previous && (!next || at - previous.startAt < next.startAt - at) ? previous : next;
    if (chosen) onSelect(chosen);
  };
  return (
    <div className="recording-ruler is-canvas">
      <canvas
        ref={element}
        style={{ width: '100%', height: 26, display: 'block' }}
        role="slider"
        tabIndex={0}
        aria-label="Recording time"
        aria-valuemin={from}
        aria-valuemax={to}
        aria-valuenow={selected?.startAt ?? to}
        aria-valuetext={selected ? new Date(selected.startAt).toLocaleString() : 'End of day'}
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          chooseAt(from + ((event.clientX - bounds.left) / bounds.width) * (to - from));
        }}
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const index = selected ? ordered.findIndex((item) => item.id === selected.id) : -1;
          const next =
            ordered[
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? ordered.length - 1
                  : Math.max(
                      0,
                      Math.min(ordered.length - 1, index + (event.key === 'ArrowLeft' ? -1 : 1)),
                    )
            ];
          if (next) onSelect(next);
        }}
      />
      <div className="recording-hours">
        {['00:00', '06:00', '12:00', '18:00', '24:00'].map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
    </div>
  );
}
