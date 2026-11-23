/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  VectorGraphic,
  type HostVectorCircle,
  type HostVectorPath,
  type HostVectorRect,
} from '@haus/ui';

interface GlyphDefinition {
  readonly paths?: readonly HostVectorPath[];
  readonly rects?: readonly HostVectorRect[];
  readonly circles?: readonly HostVectorCircle[];
}

const GLYPHS: Readonly<Record<string, GlyphDefinition>> = {
  light: {
    paths: [
      {
        d: 'M9 18h6m-5 3h4M8.1 13.7a6 6 0 1 1 7.8 0c-1 .9-1.9 1.6-1.9 3.3h-4c0-1.7-.9-2.4-1.9-3.3Z',
      },
      { d: 'M12 1v1M3.5 4.5l1 1m15-1-1 1M1 12h1m20 0h1' },
    ],
  },
  power: {
    paths: [{ d: 'M12 2v9' }, { d: 'M6 5.5a9 9 0 1 0 12 0' }],
  },
  lock: {
    rects: [{ x: 5, y: 10, width: 14, height: 11, rx: 3 }],
    paths: [{ d: 'M8 10V7a4 4 0 0 1 8 0v3m-4 5v2' }],
  },
  media: {
    rects: [{ x: 3, y: 3, width: 18, height: 18, rx: 5 }],
    paths: [{ d: 'm10 8 6 4-6 4Z' }],
  },
  cover: {
    paths: [{ d: 'M4 3h16v18H4zM4 7h16M4 11h16M4 15h16M12 18v3' }],
  },
  climate: {
    paths: [{ d: 'M10 14.5V5a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0Z' }, { d: 'M12 9v8m6-11h3m-3 5h3' }],
  },
  fan: {
    circles: [{ cx: 12, cy: 12, r: 2 }],
    paths: [
      {
        d: 'M10 10C5 5 10 1 13 3c2 1 0 5-1 7m2 1c7-1 8 5 5 7-2 1-4-2-6-4m-2 0c-2 6-8 5-8 1 0-3 4-3 7-3',
      },
    ],
  },
  sensor: {
    circles: [
      { cx: 12, cy: 12, r: 8 },
      { cx: 12, cy: 12, r: 1 },
    ],
    paths: [{ d: 'm12 12 4-4M7 16h10' }],
  },
  star: {
    paths: [{ d: 'm12 2 3 6.1 6.7 1-4.8 4.7 1.1 6.6-6-3.1-6 3.1 1.1-6.6-4.8-4.7 6.7-1Z' }],
  },
  chevron: { paths: [{ d: 'm9 5 7 7-7 7' }] },
  previous: { paths: [{ d: 'm17 5-9 7 9 7Z' }, { d: 'M5 5v14' }] },
  next: { paths: [{ d: 'm7 5 9 7-9 7Z' }, { d: 'M19 5v14' }] },
  play: { paths: [{ d: 'm7 4 13 8-13 8Z' }] },
  pause: { paths: [{ d: 'M8 5v14M16 5v14' }] },
  check: { paths: [{ d: 'm5 12 4 4L19 6' }] },
  minus: { paths: [{ d: 'M5 12h14' }] },
  plus: { paths: [{ d: 'M5 12h14M12 5v14' }] },
};

export function Glyph({ name, className = '' }: { name: string; className?: string }) {
  const def = GLYPHS[name] ?? GLYPHS.sensor!;
  return (
    <VectorGraphic
      className={className}
      width={24}
      height={24}
      viewWidth={24}
      viewHeight={24}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.65}
      strokeLinecap="round"
      strokeLinejoin="round"
      ariaHidden
      rects={def.rects}
      paths={def.paths}
      circles={def.circles}
    />
  );
}
