/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { HostVectorProps } from '../renderers/host-media.js';

function escapeAttr(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}

function normalizePaint(paint: string | undefined, fallback: string): string {
  if (!paint) return fallback;
  return paint === 'currentColor' ? '#000' : paint;
}

/**
 * Serializes structured `HostVectorProps` (paths, circles, rects, lines, polylines)
 * into standalone SVG markup so GPUI's native `<svg>` element renders sparklines,
 * DuoBar gauges, and charts without falling back to empty boxes.
 */
const RAW_SVG_CACHE = new Map<string, string>();
const MAX_RAW_SVG_CACHE = 512;

export function buildGpuiSvgSource(props: HostVectorProps): string | undefined {
  if (props.rawSvgMarkup) {
    const cached = RAW_SVG_CACHE.get(props.rawSvgMarkup);
    if (cached !== undefined) return cached;
    const normalized = props.rawSvgMarkup.replaceAll('="currentColor"', '="#000"');
    if (RAW_SVG_CACHE.size >= MAX_RAW_SVG_CACHE) RAW_SVG_CACHE.clear();
    RAW_SVG_CACHE.set(props.rawSvgMarkup, normalized);
    return normalized;
  }
  const hasShapes =
    Boolean(props.paths?.length) ||
    Boolean(props.circles?.length) ||
    Boolean(props.rects?.length) ||
    Boolean(props.lines?.length);
  if (!hasShapes) return undefined;

  const vw = props.viewWidth ?? 24;
  const vh = props.viewHeight ?? 24;
  const parts: string[] = [];

  for (const line of props.lines ?? []) {
    parts.push(
      `<line x1="${line.x1}" y1="${line.y1}" x2="${line.x2}" y2="${line.y2}" stroke="#000" stroke-width="${props.strokeWidth ?? 1.5}"/>`,
    );
  }
  for (const rect of props.rects ?? []) {
    const attrs = [
      rect.x !== undefined ? `x="${rect.x}"` : '',
      rect.y !== undefined ? `y="${rect.y}"` : '',
      rect.width !== undefined ? `width="${rect.width}"` : '',
      rect.height !== undefined ? `height="${rect.height}"` : '',
      rect.rx !== undefined ? `rx="${rect.rx}"` : '',
      rect.ry !== undefined ? `ry="${rect.ry}"` : '',
      `fill="${escapeAttr(normalizePaint(rect.fill, '#000'))}"`,
      rect.stroke ? `stroke="${escapeAttr(normalizePaint(rect.stroke, '#000'))}"` : '',
    ]
      .filter(Boolean)
      .join(' ');
    parts.push(`<rect ${attrs}/>`);
  }
  for (const path of props.paths ?? []) {
    if (!path.d) continue;
    const effectiveFill = path.fill ?? props.fill;
    const hasFill = Boolean(effectiveFill && effectiveFill !== 'none');
    const rawStroke = path.stroke ?? props.stroke;
    const effectiveStroke = rawStroke ?? (hasFill ? 'none' : '#000');
    const attrs = [
      `d="${escapeAttr(path.d)}"`,
      `fill="${escapeAttr(normalizePaint(effectiveFill, 'none'))}"`,
      `stroke="${escapeAttr(normalizePaint(effectiveStroke, 'none'))}"`,
      ...(effectiveStroke !== 'none'
        ? [
            `stroke-width="${path.strokeWidth ?? props.strokeWidth ?? 1.5}"`,
            `stroke-linecap="${path.strokeLinecap ?? 'round'}"`,
            `stroke-linejoin="${path.strokeLinejoin ?? 'round'}"`,
          ]
        : []),
      path.opacity !== undefined ? `opacity="${path.opacity}"` : '',
    ]
      .filter(Boolean)
      .join(' ');
    parts.push(`<path ${attrs}/>`);
  }
  for (const circle of props.circles ?? []) {
    const attrs = [
      `cx="${circle.cx}"`,
      `cy="${circle.cy}"`,
      `r="${circle.r}"`,
      `fill="${escapeAttr(normalizePaint(circle.fill, '#000'))}"`,
      circle.stroke
        ? `stroke="${escapeAttr(normalizePaint(circle.stroke, '#000'))}"`
        : 'stroke="none"',
      circle.opacity !== undefined ? `opacity="${circle.opacity}"` : '',
    ]
      .filter(Boolean)
      .join(' ');
    parts.push(`<circle ${attrs}/>`);
  }

  const preserve = props.preserveAspectRatio
    ? ` preserveAspectRatio="${escapeAttr(props.preserveAspectRatio)}"`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vw} ${vh}"${preserve} fill="none">${parts.join('')}</svg>`;
}
