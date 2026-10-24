import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { glassDisplacement } from './liquid-glass-map';

interface GlassMap {
  width: number;
  height: number;
  image: string;
}

function canRefract() {
  // Safari/Firefox accept the CSS grammar but do not render SVG backdrop filters.
  return (
    /(?:Chrome|Chromium|Edg|Electron)\//.test(navigator.userAgent) &&
    CSS.supports('backdrop-filter', 'url("#haus-glass")')
  );
}

/** Absolute, non-interactive backdrop. Mount first inside a positioned rounded panel. */
export function LiquidGlass({
  className = '',
  blur = 10,
  strength = 18,
  dispersion = 0.65,
}: {
  className?: string;
  blur?: number;
  strength?: number;
  dispersion?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const id = `haus-liquid-${useId().replace(/[^a-z0-9_-]/gi, '')}`;
  const [map, setMap] = useState<GlassMap>();
  useEffect(() => {
    const element = host.current;
    if (!element || !canRefract()) return;
    const preferences = [
      matchMedia('(prefers-reduced-motion: reduce)'),
      matchMedia('(prefers-reduced-transparency: reduce)'),
      matchMedia('(forced-colors: active)'),
    ];
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let previous = '';
    let width = element.clientWidth;
    let height = element.clientHeight;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (preferences.some((query) => query.matches)) {
          previous = '';
          setMap(undefined);
          return;
        }
        if (width <= 0 || height <= 0) return;
        const radius = parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0;
        const key = `${Math.round(width)}:${Math.round(height)}:${radius}`;
        if (key === previous) return;
        const field = glassDisplacement(width, height, radius);
        const canvas = document.createElement('canvas');
        canvas.width = field.width;
        canvas.height = field.height;
        const context = canvas.getContext('2d');
        if (!context) return;
        const pixels = context.createImageData(field.width, field.height);
        pixels.data.set(field.pixels);
        context.putImageData(pixels, 0, 0);
        setMap({ width, height, image: canvas.toDataURL('image/png') });
        previous = key;
      });
    };
    const observer = new ResizeObserver(([entry]) => {
      width = entry.contentRect.width;
      height = entry.contentRect.height;
      clearTimeout(timer);
      timer = setTimeout(update, 90);
    });
    observer.observe(element);
    preferences.forEach((query) => query.addEventListener('change', update));
    update();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      preferences.forEach((query) => query.removeEventListener('change', update));
    };
  }, []);

  const scale = Math.max(0, Math.min(40, strength)) * 2;
  const spread = Math.max(0, Math.min(2, dispersion)) * 2;
  const style = {
    '--liquid-glass-blur': `${Math.max(0, Math.min(32, blur))}px`,
    '--liquid-glass-filter': `url("#${id}")`,
  } as CSSProperties;
  return (
    <>
      {map &&
        createPortal(
          <svg
            aria-hidden="true"
            focusable="false"
            className="liquid-glass-definitions"
            width="0"
            height="0"
          >
            <defs>
              <filter
                id={id}
                x="0"
                y="0"
                width="1"
                height="1"
                filterUnits="objectBoundingBox"
                primitiveUnits="userSpaceOnUse"
                colorInterpolationFilters="sRGB"
              >
                <feImage
                  href={map.image}
                  x="0"
                  y="0"
                  width={map.width}
                  height={map.height}
                  preserveAspectRatio="none"
                  result="rim"
                />
                <feDisplacementMap
                  in="SourceGraphic"
                  in2="rim"
                  scale={Math.max(0, scale - spread)}
                  xChannelSelector="R"
                  yChannelSelector="G"
                  result="red-shift"
                />
                <feColorMatrix
                  in="red-shift"
                  type="matrix"
                  values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
                  result="red"
                />
                <feDisplacementMap
                  in="SourceGraphic"
                  in2="rim"
                  scale={scale}
                  xChannelSelector="R"
                  yChannelSelector="G"
                  result="green-shift"
                />
                <feColorMatrix
                  in="green-shift"
                  type="matrix"
                  values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
                  result="green"
                />
                <feDisplacementMap
                  in="SourceGraphic"
                  in2="rim"
                  scale={scale + spread}
                  xChannelSelector="R"
                  yChannelSelector="G"
                  result="blue-shift"
                />
                <feColorMatrix
                  in="blue-shift"
                  type="matrix"
                  values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
                  result="blue"
                />
                <feBlend in="red" in2="green" mode="screen" result="red-green" />
                <feBlend in="red-green" in2="blue" mode="screen" />
              </filter>
            </defs>
          </svg>,
          document.body,
        )}
      <div
        ref={host}
        aria-hidden="true"
        className={`liquid-glass ${className}`.trim()}
        data-refraction={Boolean(map)}
        style={style}
      >
        <div className="liquid-glass__backdrop" />
        <div className="liquid-glass__finish" />
      </div>
    </>
  );
}
