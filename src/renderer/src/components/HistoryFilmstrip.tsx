import { useEffect, useMemo, useRef, useState } from 'react';
import {
  chronologicalRecordings,
  type CameraAvailability,
  type CameraEvent,
} from '../model/camera-history';

const THUMB_WIDTH = 86;
const OFFLINE_WIDTH = 58;
const GAP = 5;
const THUMB_HEIGHT = 37;
const stamp = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const dayLabel = (at: number) =>
  new Date(at).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });

type Item =
  { type: 'recording'; event: CameraEvent } | { type: 'offline'; period: CameraAvailability };

export function HistoryFilmstrip({
  events,
  offline,
  selected,
  playback,
  onSelect,
}: {
  events: CameraEvent[];
  offline: CameraAvailability[];
  selected?: CameraEvent;
  playback: { seconds: number; duration: number; playing: boolean };
  onSelect: (event: CameraEvent) => void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const userScrollUntil = useRef(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  const items = useMemo<Item[]>(
    () =>
      [
        ...chronologicalRecordings(events).map((event) => ({ type: 'recording' as const, event })),
        ...offline
          .filter((period) => period.state === 'offline' && period.endAt > period.startAt)
          .map((period) => ({ type: 'offline' as const, period })),
      ].sort(
        (a, b) =>
          (a.type === 'recording' ? a.event.startAt : a.period.startAt) -
          (b.type === 'recording' ? b.event.startAt : b.period.startAt),
      ),
    [events, offline],
  );
  const offsets: number[] = [];
  const widths: number[] = [];
  let content = 0;
  for (const item of items) {
    offsets.push(content);
    const width = item.type === 'recording' ? THUMB_WIDTH : OFFLINE_WIDTH;
    widths.push(width);
    content += width + GAP;
  }
  if (items.length) content -= GAP;
  const pad = Math.max(0, viewportWidth / 2 - THUMB_WIDTH / 2);
  // Keep half a viewport after the newest event so the live edge can sit under the fixed playhead.
  const canvasWidth = viewportWidth + Math.max(0, content);

  useEffect(() => {
    const element = scroll.current;
    if (!element) return;
    const measure = () => setViewportWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const viewport = scroll.current;
    if (!viewport || !viewportWidth) return;
    const index = selected
      ? items.findIndex((item) => item.type === 'recording' && item.event.id === selected.id)
      : -1;
    if (selected && index < 0) return;
    if (selected && Date.now() < userScrollUntil.current) return;
    const progress = selected
      ? Math.min(1, Math.max(0, playback.seconds / (playback.duration || selected.duration || 1)))
      : 1;
    const target =
      index >= 0
        ? pad + offsets[index] + THUMB_WIDTH * progress - viewport.clientWidth / 2
        : viewport.scrollWidth - viewport.clientWidth;
    viewport.scrollTo({
      left: Math.max(0, target),
      behavior:
        selected && playback.playing
          ? 'instant'
          : window.matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 'instant'
            : 'smooth',
    });
  }, [
    items,
    selected?.id,
    playback.seconds,
    playback.duration,
    playback.playing,
    viewportWidth,
    pad,
  ]);

  useEffect(() => {
    const element = canvas.current;
    if (!element || !viewportWidth) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const height = 47;
    element.width = Math.ceil(canvasWidth * dpr);
    element.height = Math.ceil(height * dpr);
    element.style.width = `${canvasWidth}px`;
    element.style.height = `${height}px`;
    const context = element.getContext('2d', { alpha: true, desynchronized: true });
    if (!context) return;
    context.scale(dpr, dpr);
    const thumbnails: Array<HTMLImageElement | undefined> = [];
    const paint = () => {
      context.clearRect(0, 0, canvasWidth, height);
      items.forEach((item, index) => {
        const x = pad + offsets[index];
        const width = widths[index];
        const y = 5;
        context.save();
        context.beginPath();
        context.roundRect(x, y, width, THUMB_HEIGHT, 7);
        context.clip();
        if (item.type === 'offline') {
          context.fillStyle = 'rgba(232, 235, 242, .11)';
          context.fillRect(x, y, width, THUMB_HEIGHT);
          context.strokeStyle = 'rgba(232, 235, 242, .36)';
          context.lineWidth = 1;
          for (let stripe = -THUMB_HEIGHT; stripe < width + THUMB_HEIGHT; stripe += 8) {
            context.beginPath();
            context.moveTo(x + stripe, y + THUMB_HEIGHT);
            context.lineTo(x + stripe + THUMB_HEIGHT, y);
            context.stroke();
          }
          context.fillStyle = '#fff';
          context.font = '600 8px system-ui';
          context.textAlign = 'center';
          context.fillText('OFFLINE', x + width / 2, y + 21);
        } else {
          const image = thumbnails[index];
          context.fillStyle = '#26262b';
          context.fillRect(x, y, width, THUMB_HEIGHT);
          if (image?.complete && image.naturalWidth > 0) {
            context.imageSmoothingEnabled = true;
            context.imageSmoothingQuality = 'high';
            const scale = Math.max(width / image.naturalWidth, THUMB_HEIGHT / image.naturalHeight);
            const imageWidth = image.naturalWidth * scale;
            const imageHeight = image.naturalHeight * scale;
            context.drawImage(
              image,
              x + (width - imageWidth) / 2,
              y + (THUMB_HEIGHT - imageHeight) / 2,
              imageWidth,
              imageHeight,
            );
          } else {
            const gradient = context.createLinearGradient(x, y, x + width, y + THUMB_HEIGHT);
            gradient.addColorStop(0, '#414148');
            gradient.addColorStop(1, '#1b1b20');
            context.fillStyle = gradient;
            context.fillRect(x, y, width, THUMB_HEIGHT);
          }
          context.fillStyle = 'rgba(0, 0, 0, .44)';
          context.fillRect(x, y + THUMB_HEIGHT - 13, width, 13);
          context.fillStyle = '#fff';
          context.font = '500 8px system-ui';
          context.textAlign = 'left';
          context.fillText(stamp(item.event.startAt), x + 5, y + THUMB_HEIGHT - 4, width - 10);
        }
        context.restore();
        if (item.type === 'recording' && selected?.id === item.event.id) {
          context.strokeStyle = 'rgba(255, 255, 255, .96)';
          context.lineWidth = 2;
          context.beginPath();
          context.roundRect(x + 1, y + 1, width - 2, THUMB_HEIGHT - 2, 6);
          context.stroke();
        }
      });
    };
    items.forEach((item, index) => {
      if (item.type !== 'recording' || item.event.status !== 'ready') return;
      const image = new Image();
      thumbnails[index] = image;
      image.onload = paint;
      image.src = `haus-media://recordings/${item.event.id}/thumbnail`;
    });
    paint();
    return () =>
      thumbnails.forEach((image) => {
        if (image) image.onload = null;
      });
  }, [canvasWidth, viewportWidth, items, pad, selected?.id]);

  return (
    <div
      className="history-canvas-viewport"
      ref={scroll}
      onPointerDown={() => {
        userScrollUntil.current = Date.now() + 8000;
      }}
      onWheel={() => {
        userScrollUntil.current = Date.now() + 8000;
      }}
    >
      <div className="history-canvas-stage" style={{ width: canvasWidth }}>
        <canvas ref={canvas} aria-hidden="true" />
        {items.map((item, index) =>
          item.type === 'recording' ? (
            <button
              key={item.event.id}
              className="history-canvas-hit-target"
              style={{ left: pad + offsets[index], width: THUMB_WIDTH }}
              aria-label={`${item.event.kinds.join(', ')} at ${stamp(item.event.startAt)}, ${dayLabel(item.event.startAt)}`}
              aria-current={selected?.id === item.event.id ? 'true' : undefined}
              disabled={item.event.status !== 'ready'}
              onClick={() => {
                userScrollUntil.current = 0;
                onSelect(item.event);
              }}
            />
          ) : (
            <span
              key={`offline-${item.period.startAt}`}
              className="history-canvas-offline-label"
              style={{ left: pad + offsets[index], width: OFFLINE_WIDTH }}
              title={`Camera offline · ${stamp(item.period.startAt)}–${stamp(item.period.endAt)}`}
              aria-label={`Camera offline from ${stamp(item.period.startAt)} to ${stamp(item.period.endAt)}`}
            />
          ),
        )}
      </div>
      <span className="history-centered-playhead" aria-hidden="true" />
    </div>
  );
}
