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
import { FilmstripMotion, FilmstripPlayback, FilmstripRaster } from '../../model/filmstrip-motion';
import { FilmstripClock } from '../../model/filmstrip-clock';
const CANVAS_BUFFER = 64;
const stampFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const stamp = (at: number) => stampFormatter.format(at);
export function HistoryFilmstrip(props: {
  events: CameraEvent[];
  offline: CameraAvailability[];
  selected?: CameraEvent;
  playback: { seconds: number; duration: number; playing: boolean };
  playbackElement?: RefObject<HTMLVideoElement | null>;
  centerRef?: RefObject<HTMLElement | null>;
  playbackIntent?: boolean;
  clock?: {
    host?: RefObject<HTMLElement | null>;
    time: RefObject<HTMLElement | null>;
    day: RefObject<HTMLElement | null>;
  };
  onSelect: (event: CameraEvent) => void;
  onScrub: (event: CameraEvent, seconds: number, playing: boolean) => void;
  onEarlier?: () => void;
  hasEarlier?: boolean;
  hasLater?: boolean;
  followRevision?: number;
  onLater?: () => void;
  onDayChange?: (at: number) => void;
  loading?: boolean;
}) {
  const scroll = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null);
  const rendering = useRef<{
    surface: HTMLCanvasElement | OffscreenCanvas;
    context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  } | null>(null);
  const layout = useMemo(
    () => filmstripLayout(props.events, props.offline),
    [props.events, props.offline],
  );
  const latest = useRef({ props, layout });
  latest.current = { props, layout };
  const dirty = useRef(true);
  const wake = useRef(() => {});
  const motion = useRef(new FilmstripMotion());
  const scrubPlayback = useRef(new FilmstripPlayback());
  const raster = useRef(new FilmstripRaster(CANVAS_BUFFER));
  const suppressClickUntil = useRef(0);
  const directInput = useRef(false);
  const nativeLeft = useRef(0);
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const [range, setRange] = useState({ start: 0, end: 0 });
  useEffect(() => {
    dirty.current = true;
    wake.current();
  }, [layout, props.selected?.id, props.playback]);
  useEffect(() => {
    // Live resets navigation, not the canvas, bitmap pool or input listeners.
    motion.current.follow();
    scrubPlayback.current.finish();
    drag.current = null;
    dirty.current = true;
    wake.current();
  }, [props.followRevision]);
  useEffect(() => {
    const viewport = scroll.current,
      element = canvas.current;
    if (!viewport || !element) return;
    if (!rendering.current) {
      const surface =
        typeof element.transferControlToOffscreen === 'function'
          ? element.transferControlToOffscreen()
          : element;
      // Canvas paints and its compositor translation must commit together when
      // the buffered origin changes; desynchronized canvases can expose a jump.
      const context = surface.getContext('2d', { alpha: true, desynchronized: false });
      if (!context) return;
      rendering.current = { surface, context };
    }
    const { surface, context } = rendering.current;
    const stage = viewport.firstElementChild as HTMLElement;
    const shell = viewport.parentElement!;
    const centerHost = latest.current.props.centerRef?.current;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const playbackClock = new FilmstripClock();
    let width = 0,
      center = 0,
      surfaceWidth = 0,
      frame = 0,
      previous = 0,
      wasFading = false,
      rangeKey = '',
      poolKey = '',
      poolAt = 0,
      rangeAt = 0,
      subpixel = '',
      positioned = false,
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
    let canvasTransform = '';
    const canvasPosition = (left: number) => {
      const position = raster.current.sample(left);
      const transform = `translate3d(${-position.fraction}px, 0, 0)`;
      if (transform !== canvasTransform) {
        canvasTransform = transform;
        element.style.transform = transform;
      }
      return position;
    };
    const pool = new ThumbnailPool(() => {
      dirty.current = true;
      schedule();
    });
    const resize = () => {
      width = viewport.clientWidth;
      // Scroll offsets are media coordinates, independent of animated control gutters.
      // Anchor the canvas, hit targets and playhead to the bar, not its changing viewport.
      const host = centerHost?.getBoundingClientRect();
      const bounds = viewport.getBoundingClientRect();
      // Modal entry scales visual rects without changing layout or firing another
      // ResizeObserver afterward. Keep canvas and hit targets in layout pixels.
      const scale = bounds.width / (viewport.offsetWidth || width) || 1;
      surfaceWidth = centerHost?.offsetWidth ?? width;
      center = host ? (host.left - bounds.left) / scale + surfaceWidth / 2 : width / 2;
      center = Math.max(0, Math.min(width, center));
      shell.style.setProperty('--filmstrip-pad', `${center}px`);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      // The canvas spans the bar, not the animated scroll viewport. Changing
      // the control gutter only changes clipping, never reallocates its texture.
      element.style.left = `${(host ? (host.left - shell.getBoundingClientRect().left) / scale : 0) - CANVAS_BUFFER}px`;
      if (
        surface.width !== Math.ceil((surfaceWidth + CANVAS_BUFFER * 2) * dpr) ||
        surface.height !== Math.ceil(47 * dpr)
      ) {
        surface.width = Math.ceil((surfaceWidth + CANVAS_BUFFER * 2) * dpr);
        surface.height = Math.ceil(47 * dpr);
        element.style.width = `${surfaceWidth + CANVAS_BUFFER * 2}px`;
        element.style.height = '47px';
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        dirty.current = true;
      }
      if (width && !positioned) {
        const { props: current, layout: data } = latest.current;
        motion.current.left = filmstripTarget(
          data,
          current.selected?.id,
          current.playback.seconds,
          current.playback.duration || current.selected?.duration || 1,
        );
        positioned = true;
      }
      const position = canvasPosition(motion.current.left);
      if (dirty.current)
        paintFilmstrip(
          context,
          latest.current.layout,
          surfaceWidth + CANVAS_BUFFER * 2,
          position.pixel,
          latest.current.props.selected?.id,
          (id) => pool.get(id, performance.now()),
        );
      schedule();
    };
    const schedule = () => {
      if (active && visible && !frame) frame = requestAnimationFrame(tick);
    };
    const tick = (now: number) => {
      frame = 0;
      if (!width) {
        previous = 0;
        return; // ResizeObserver wakes a collapsed/hidden viewport when it becomes visible.
      }
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
            if (drag.current) drag.current.left += shift;
            if (!directInput.current && nativeLeft.current > 0) {
              nativeLeft.current += shift;
              viewport.scrollTo({ left: nativeLeft.current, behavior: 'instant' });
            }
          }
        }
        previousLayout = data;
        rangeKey = '';
        poolKey = '';
        dirty.current = true;
      }
      const media = current.playbackElement?.current;
      const duration =
        media && Number.isFinite(media.duration)
          ? media.duration
          : current.playback.duration || current.selected?.duration || 1;
      const seconds = playbackClock.sample({
        id: current.selected?.id,
        now,
        seconds: media && media.readyState >= 2 ? media.currentTime : current.playback.seconds,
        duration,
        advancing: Boolean(
          current.selected && media && !media.paused && !media.ended && media.readyState >= 3,
        ),
        seeking: media?.seeking,
        rate: media?.playbackRate,
      });
      const target = filmstripTarget(data, current.selected?.id, seconds, duration);
      const update = motion.current.step({
        now,
        delta,
        target,
        nativeLeft: directInput.current ? motion.current.left : nativeLeft.current,
        dragging: Boolean(drag.current?.moved),
        playing: current.playback.playing,
        reduced: reduced.matches,
        live: !current.selected,
        width,
      });
      const { left, manual } = update;
      const position = canvasPosition(left);
      // Mouse/trackpad input owns a virtual offset: no scrollTo/layout read in
      // the frame loop. Native touch scrolling is sampled only by scroll events.
      const offset = nativeLeft.current - left;
      const nextSubpixel = `${offset}px`;
      const index = filmstripIndex(data, left);
      const item = data.items[index];
      const preview = manual && item?.type === 'recording' ? item.event : undefined;
      const previewSeconds = preview
        ? Math.max(0, Math.min(1, (left - data.offsets[index]) / data.widths[index])) *
          Math.max(0, preview.duration - 0.05)
        : seconds;
      const clockEvent = preview ?? current.selected;
      const resume = update.settled ? scrubPlayback.current.finish() : false;
      if (update.seek) {
        if (item?.type === 'recording' && item.event.status === 'ready')
          current.onScrub(item.event, previewSeconds, resume);
        else if (update.settled && current.selected)
          current.onScrub(current.selected, seconds, resume);
      }
      const next = filmstripRange(data, left, width, 180, center);
      const key = `${next.start}:${next.end}`;
      if (key !== rangeKey && (!manual || now - rangeAt >= 70)) {
        rangeKey = key;
        rangeAt = now;
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
      if (dirty.current || position.shouldPaint || fading || wasFading) {
        paintFilmstrip(
          context,
          data,
          surfaceWidth + CANVAS_BUFFER * 2,
          position.pixel,
          preview?.id ?? current.selected?.id,
          (id) => pool.get(id, now),
        );
        dirty.current = false;
      }
      if (subpixel !== nextSubpixel) {
        subpixel = nextSubpixel;
        stage.style.setProperty('--filmstrip-subpixel', subpixel);
      }
      if (current.clock?.host?.current && current.clock.host.current.hidden !== !clockEvent)
        current.clock.host.current.hidden = !clockEvent;
      const at = clockEvent ? recordingStart(clockEvent) + previewSeconds * 1000 : 0;
      const second = Math.floor(at / 1000);
      if (second !== clockSecond) {
        clockSecond = second;
        if (clockEvent && recordingDay(at) !== calendarDay) {
          calendarDay = recordingDay(at);
          current.onDayChange?.(at);
        }
        if (current.clock?.time.current)
          current.clock.time.current.textContent = timeFormat.format(at);
        if (current.clock?.day.current)
          current.clock.day.current.textContent = dayFormat.format(at);
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
      // Keep one scheduler through React timeupdates, but sleep when the view is static.
      if (
        update.animating ||
        (current.selected && current.playback.playing) ||
        fading ||
        poolKey !== key
      )
        schedule();
      else previous = 0;
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
      directInput.current = true;
      const factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? width : 1;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      const next = Math.max(
        0,
        Math.min(latest.current.layout.size, motion.current.left + delta * factor),
      );
      userInput(next);
    };
    const scrollEnd = () => {
      dirty.current = true;
      schedule();
    };
    wake.current = schedule;
    reduced.addEventListener('change', scrollEnd);
    viewport.addEventListener('wheel', wheel, { passive: false });
    viewport.addEventListener('scrollend', scrollEnd);
    const observer = new ResizeObserver(resize);
    observer.observe(viewport);
    if (centerHost) observer.observe(centerHost);
    resize();
    document.addEventListener('visibilitychange', visibility);
    return () => {
      active = false;
      wake.current = () => {};
      cancelAnimationFrame(frame);
      observer.disconnect();
      pool.dispose();
      viewport.removeEventListener('wheel', wheel);
      viewport.removeEventListener('scrollend', scrollEnd);
      document.removeEventListener('visibilitychange', visibility);
      reduced.removeEventListener('change', scrollEnd);
    };
  }, []);
  const userInput = (left = motion.current.left) => {
    const media = latest.current.props.playbackElement?.current;
    const current = latest.current.props;
    scrubPlayback.current.begin(
      !current.selected ||
        (current.playbackIntent ?? (media ? !media.paused : current.playback.playing)),
    );
    if (media && !media.paused) media.pause();
    motion.current.gesture(performance.now(), left);
    dirty.current = true;
    wake.current();
  };
  return (
    <div className="history-canvas-shell">
      <canvas ref={canvas} aria-hidden="true" />
      <div
        className="history-canvas-viewport"
        ref={scroll}
        tabIndex={0}
        role="group"
        aria-label="Recording timeline. Use arrow keys to choose a clip."
        onScroll={(event) => {
          nativeLeft.current = event.currentTarget.scrollLeft;
          dirty.current = true;
          wake.current();
          if (!directInput.current && motion.current.interacting(performance.now()))
            userInput(nativeLeft.current);
        }}
        onTouchStart={(event) => {
          directInput.current = false;
          const left = motion.current.left;
          event.currentTarget.scrollTo({ left, behavior: 'instant' });
          nativeLeft.current = left;
          (event.currentTarget.firstElementChild as HTMLElement).style.setProperty(
            '--filmstrip-subpixel',
            '0px',
          );
          userInput(left);
        }}
        onTouchMove={() => userInput(nativeLeft.current)}
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
          if (event.pointerType === 'mouse' && event.button === 0) {
            directInput.current = true;
            drag.current = { x: event.clientX, left: motion.current.left, moved: false };
          }
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (!start || !event.buttons) return;
          const delta = event.clientX - start.x;
          if (Math.abs(delta) < 4 && !start.moved) return;
          start.moved = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          const next = Math.max(0, Math.min(layout.size, start.left - delta));
          userInput(next);
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
    </div>
  );
}
