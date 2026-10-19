import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  filmstripIndex,
  filmstripLayout,
  filmstripRange,
  filmstripTarget,
} from '../../model/filmstrip';
import {
  recordingStart,
  type CameraAvailability,
  type CameraEvent,
} from '../../model/camera-history';
import { paintFilmstrip } from './filmstrip-paint';
import { ThumbnailPool } from './thumbnail-pool';
import { recordingDay } from '../../model/recording-calendar';
import { FilmstripMotion, FilmstripPlayback } from '../../model/filmstrip-motion';
const stamp = (at: number) =>
  new Date(at).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
export function HistoryFilmstrip(props: {
  events: CameraEvent[];
  offline: CameraAvailability[];
  selected?: CameraEvent;
  playback: { seconds: number; duration: number; playing: boolean };
  playbackElement?: RefObject<HTMLVideoElement | null>;
  playbackIntent?: boolean;
  clock?: {
    time: RefObject<HTMLElement | null>;
    day: RefObject<HTMLElement | null>;
  };
  onSelect: (event: CameraEvent) => void;
  onScrub: (event: CameraEvent, seconds: number, playing: boolean) => void;
  onEarlier?: () => void;
  hasEarlier?: boolean;
  hasLater?: boolean;
  onLater?: () => void;
  onDayChange?: (at: number) => void;
  loading?: boolean;
}) {
  const scroll = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null);
  const layout = useMemo(
    () => filmstripLayout(props.events, props.offline),
    [props.events, props.offline],
  );
  const latest = useRef({ props, layout });
  latest.current = { props, layout };
  const dirty = useRef(true);
  const motion = useRef(new FilmstripMotion());
  const scrubPlayback = useRef(new FilmstripPlayback());
  const suppressClickUntil = useRef(0);
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const [range, setRange] = useState({ start: 0, end: 0 });
  useEffect(() => {
    dirty.current = true;
  }, [layout, props.selected?.id, props.playback]);
  useEffect(() => {
    const viewport = scroll.current,
      element = canvas.current;
    if (!viewport || !element) return;
    const context = element.getContext('2d', { alpha: true, desynchronized: true });
    if (!context) return;
    const stage = viewport.firstElementChild as HTMLElement;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let width = 0,
      frame = 0,
      previous = 0,
      wasFading = false,
      lastLeft = -1,
      rangeKey = '',
      poolKey = '',
      poolAt = 0,
      previousLayout = latest.current.layout;
    const timeFormat = new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const dayFormat = new Intl.DateTimeFormat(undefined, {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    });
    let clockSecond = -1;
    let calendarDay = '';
    let active = true,
      visible = document.visibilityState === 'visible';
    const pool = new ThumbnailPool(() => {
      dirty.current = true;
      schedule();
    });
    const resize = () => {
      width = viewport.clientWidth;
      viewport.style.setProperty('--filmstrip-pad', `${width / 2}px`);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      element.width = Math.ceil(width * dpr);
      element.height = Math.ceil(47 * dpr);
      element.style.width = `${width}px`;
      element.style.height = '47px';
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      dirty.current = true;
      schedule();
    };
    const schedule = () => {
      if (active && visible && !frame) frame = requestAnimationFrame(tick);
    };
    const tick = (now: number) => {
      frame = 0;
      const { props: current, layout: data } = latest.current;
      const delta = Math.min(64, previous ? now - previous : 16);
      previous = now;
      if (previousLayout !== data) {
        const oldIndex = filmstripIndex(previousLayout, motion.current.left);
        const anchor = previousLayout.items[oldIndex];
        if (anchor?.type === 'recording') {
          const newIndex = data.byId.get(anchor.event.id);
          if (newIndex !== undefined) {
            const shift = data.offsets[newIndex] - previousLayout.offsets[oldIndex];
            motion.current.shift(shift);
            viewport.scrollTo({ left: viewport.scrollLeft + shift, behavior: 'instant' });
          }
        }
        previousLayout = data;
        rangeKey = '';
        poolKey = '';
        dirty.current = true;
      }
      const media = current.playbackElement?.current;
      const seconds = media && media.readyState >= 2 ? media.currentTime : current.playback.seconds;
      const duration =
        media && Number.isFinite(media.duration)
          ? media.duration
          : current.playback.duration || current.selected?.duration || 1;
      if (!current.selected) calendarDay = '';
      const at = current.selected ? recordingStart(current.selected) + seconds * 1000 : 0;
      const second = Math.floor(at / 1000);
      if (second !== clockSecond) {
        clockSecond = second;
        if (current.selected && recordingDay(at) !== calendarDay) {
          calendarDay = recordingDay(at);
          current.onDayChange?.(at);
        }
        if (current.clock?.time.current)
          current.clock.time.current.textContent = timeFormat.format(at);
        if (current.clock?.day.current)
          current.clock.day.current.textContent = dayFormat.format(at);
      }
      const target = filmstripTarget(data, current.selected?.id, seconds, duration);
      const update = motion.current.step({
        now,
        delta,
        target,
        nativeLeft: viewport.scrollLeft,
        dragging: Boolean(drag.current?.moved),
        playing: current.playback.playing,
        reduced: reduced.matches,
        live: !current.selected,
        width,
      });
      const { left, manual } = update;
      if (!manual) viewport.scrollTo({ left, behavior: 'instant' });
      stage.style.setProperty('--filmstrip-subpixel', `${viewport.scrollLeft - left}px`);
      const resume = update.settled ? scrubPlayback.current.finish() : false;
      if (update.seek) {
        let index = filmstripIndex(data, left);
        let item = data.items[index];
        if (item?.type === 'recording' && item.event.status === 'ready')
          current.onScrub(
            item.event,
            Math.max(0, Math.min(1, (left - data.offsets[index]) / data.widths[index])) *
              Math.max(0, item.event.duration - 0.05),
            resume,
          );
        else if (update.settled && current.selected)
          current.onScrub(current.selected, seconds, resume);
      }
      const next = filmstripRange(data, left, width);
      const key = `${next.start}:${next.end}`;
      if (key !== rangeKey) {
        rangeKey = key;

        setRange((old) => (old.start === next.start && old.end === next.end ? old : next));
      }
      if (key !== poolKey && now - poolAt > 70 && (manual || Math.abs(target - left) < width * 2)) {
        poolAt = now;
        poolKey = key;
        pool.setVisible(
          data.items
            .slice(next.start, next.end)
            .flatMap((item) =>
              item.type === 'recording' && item.event.status === 'ready' ? [item.event.id] : [],
            ),
        );
      }
      const fading = pool.fading(now);
      if (dirty.current || lastLeft !== left || fading || wasFading) {
        paintFilmstrip(context, data, width, left, current.selected?.id, (id) => pool.get(id, now));
        dirty.current = false;
        lastLeft = left;
      }
      wasFading = fading;
      if (current.hasEarlier && !current.loading && next.start < 4 && manual) current.onEarlier?.();
      if (
        current.hasLater &&
        !current.loading &&
        next.end >= data.items.length - 4 &&
        (manual || current.playback.playing)
      )
        current.onLater?.();
      // A single persistent scheduler: never restarted by React timeupdate renders.
      schedule();
    };
    const visibility = () => {
      visible = document.visibilityState === 'visible';
      if (!visible) {
        cancelAnimationFrame(frame);
        frame = 0;
        previous = 0;
      } else {
        dirty.current = true;
        schedule();
      }
    };
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      event.preventDefault();
      const factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? width : 1;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      viewport.scrollTo({ left: viewport.scrollLeft + delta * factor, behavior: 'instant' });
      userInput();
    };
    const scrollEnd = () => {
      dirty.current = true;
    };
    viewport.addEventListener('wheel', wheel, { passive: false });
    viewport.addEventListener('scrollend', scrollEnd);
    const observer = new ResizeObserver(resize);
    observer.observe(viewport);
    resize();
    document.addEventListener('visibilitychange', visibility);
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      pool.dispose();
      viewport.removeEventListener('wheel', wheel);
      viewport.removeEventListener('scrollend', scrollEnd);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  const userInput = () => {
    const media = latest.current.props.playbackElement?.current;
    const current = latest.current.props;
    scrubPlayback.current.begin(
      !current.selected ||
        (current.playbackIntent ?? (media ? !media.paused : current.playback.playing)),
    );
    if (media && !media.paused) media.pause();
    motion.current.gesture(performance.now(), scroll.current?.scrollLeft ?? 0);
    dirty.current = true;
  };
  return (
    <div className="history-canvas-shell">
      <div
        className="history-canvas-viewport"
        ref={scroll}
        tabIndex={0}
        role="group"
        aria-label="Recording timeline. Use arrow keys to choose a clip."
        onScroll={() => {
          dirty.current = true;
          if (motion.current.interacting(performance.now())) userInput();
        }}
        onTouchStart={userInput}
        onTouchMove={userInput}
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const direction = event.key === 'ArrowLeft' || event.key === 'End' ? -1 : 1;
          let index =
            event.key === 'Home'
              ? -1
              : event.key === 'End'
                ? layout.items.length
                : props.selected
                  ? (layout.byId.get(props.selected.id) ?? layout.items.length)
                  : layout.items.length;
          let next: (typeof layout.items)[number] | undefined;
          for (index += direction; index >= 0 && index < layout.items.length; index += direction) {
            const item = layout.items[index];
            if (item.type === 'recording' && item.event.status === 'ready') {
              next = item;
              break;
            }
          }
          motion.current.follow();
          if (next?.type === 'recording') props.onSelect(next.event);
        }}
        onPointerDown={(event) => {
          if (event.pointerType === 'mouse' && event.button === 0)
            drag.current = { x: event.clientX, left: event.currentTarget.scrollLeft, moved: false };
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (!start || !event.buttons) return;
          const delta = event.clientX - start.x;
          if (Math.abs(delta) < 4 && !start.moved) return;
          start.moved = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          event.currentTarget.scrollLeft = start.left - delta;
          userInput();
        }}
        onPointerUp={(event) => {
          if (drag.current?.moved) {
            userInput();
            suppressClickUntil.current = performance.now() + 150;
          }
          drag.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <div className="history-canvas-stage" style={{ width: `calc(100% + ${layout.size}px)` }}>
          <canvas ref={canvas} aria-hidden="true" />
          {layout.items.slice(range.start, range.end).map((item, local) => {
            const index = range.start + local;
            return item.type === 'recording' ? (
              <button
                key={item.event.id}
                className="history-canvas-hit-target"
                style={{
                  left: `calc(var(--filmstrip-pad) + ${layout.offsets[index]}px)`,
                  width: layout.widths[index],
                }}
                aria-label={`${item.event.kinds.join(', ')} at ${stamp(item.event.startAt)}`}
                aria-current={props.selected?.id === item.event.id ? 'true' : undefined}
                disabled={item.event.status !== 'ready'}
                onClick={() => {
                  if (performance.now() < suppressClickUntil.current) return;
                  motion.current.follow();
                  props.onSelect(item.event);
                }}
              />
            ) : (
              <span
                key={`offline-${item.period.startAt}`}
                className="history-canvas-offline-label"
                style={{
                  left: `calc(var(--filmstrip-pad) + ${layout.offsets[index]}px)`,
                  width: layout.widths[index],
                }}
                title={`${item.periods && item.periods > 1 ? `${item.periods} observed offline periods` : 'Camera offline'} · ${stamp(item.period.startAt)}–${stamp(item.period.endAt)}`}
              />
            );
          })}
        </div>
      </div>
      <span className="history-centered-playhead" aria-hidden="true" />
    </div>
  );
}
