import { useId } from 'react';
import type { PreparedBrandArtwork } from '../model/brand-artwork';

/** Lighting follows the foreground alpha contour, not the icon's rectangular bounds. */
export function BrandArtwork({ artwork }: { artwork: PreparedBrandArtwork }) {
  const id = useId().replaceAll(':', '');
  const [x, y, width, height] = artwork.viewBox.split(' ').map(Number);
  const unit = Math.min(width, height) / 32;
  const image = (
    <image
      href={artwork.src}
      width={artwork.sourceWidth}
      height={artwork.sourceHeight}
      preserveAspectRatio="none"
    />
  );
  return (
    <svg className="brand-icon" viewBox={artwork.viewBox} overflow="visible" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-tone`} x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0" className="brand-tone-top" />
          <stop offset="0.48" className="brand-tone-middle" />
          <stop offset="1" className="brand-tone-bottom" />
        </linearGradient>
        <mask
          id={`${id}-shape`}
          maskUnits="userSpaceOnUse"
          x={x}
          y={y}
          width={width}
          height={height}
          style={{ maskType: 'alpha' }}
        >
          {image}
        </mask>
        <filter
          id={`${id}-glass`}
          x="-18%"
          y="-18%"
          width="136%"
          height="142%"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur in="SourceAlpha" stdDeviation={unit * 0.38} result="height-map" />
          <feSpecularLighting
            in="height-map"
            surfaceScale={unit * 1.2}
            specularConstant="0.75"
            specularExponent="24"
            lightingColor="#ffffff"
            result="light"
          >
            <feDistantLight azimuth="235" elevation="54" />
          </feSpecularLighting>
          <feMorphology in="SourceAlpha" operator="erode" radius={unit * 0.6} result="interior" />
          <feComposite in="SourceAlpha" in2="interior" operator="out" result="contour" />
          <feComposite in="light" in2="contour" operator="in" result="edge-light" />
          <feBlend in="SourceGraphic" in2="edge-light" mode="screen" result="lit" />
          <feDropShadow
            in="lit"
            dx="0"
            dy={unit * 0.55}
            stdDeviation={unit * 0.65}
            floodColor="#000000"
            floodOpacity="0.24"
          />
        </filter>
      </defs>
      <g filter={artwork.layout === 'inset' ? `url(#${id}-glass)` : undefined}>
        <g className={artwork.template ? 'brand-original is-template-original' : 'brand-original'}>
          {image}
        </g>
        {artwork.template && (
          <rect
            className="brand-template"
            x={x}
            y={y}
            width={width}
            height={height}
            fill={`url(#${id}-tone)`}
            mask={`url(#${id}-shape)`}
          />
        )}
      </g>
    </svg>
  );
}
