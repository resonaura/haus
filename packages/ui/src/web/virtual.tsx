/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import { Box } from '../primitives/index.js';

/** Window whole rooms so controls keep their grid and drag/drop scope intact. */
export function VirtualSections<T>({
  items,
  getKey,
  estimateHeight,
  renderSection,
  scrollRef,
}: {
  items: T[];
  getKey: (item: T) => string;
  estimateHeight: (item: T, columns: number) => number;
  renderSection: (item: T) => ReactNode;
  scrollRef: RefObject<HTMLDivElement | null>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const [columns, setColumns] = useState(4);
  const [retainedKey, setRetainedKey] = useState<string | null>(null);
  useEffect(() => {
    const container = containerRef.current;
    const scroll = scrollRef.current;
    if (!container || !scroll) return;
    const measure = () => {
      const margin =
        container.getBoundingClientRect().top -
        scroll.getBoundingClientRect().top +
        scroll.scrollTop;
      setScrollMargin((previous) => (Math.abs(previous - margin) > 0.5 ? margin : previous));
      const tracks =
        probeRef.current &&
        getComputedStyle(probeRef.current).gridTemplateColumns.split(' ').length;
      if (tracks) setColumns(tracks);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroll);
    if (container.parentElement) observer.observe(container.parentElement);
    return () => observer.disconnect();
  }, [scrollRef]);
  const itemKey = useCallback(
    (index: number) => {
      const item = items[index];
      return item === undefined ? String(index) : getKey(item);
    },
    [items, getKey],
  );
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: itemKey,
    estimateSize: (index) => {
      const item = items[index];
      return item === undefined ? 137 : estimateHeight(item, columns);
    },
    scrollMargin,
    overscan: 1,
    rangeExtractor: (range) => {
      const indexes = defaultRangeExtractor(range);
      const retained =
        retainedKey === null ? -1 : items.findIndex((item) => getKey(item) === retainedKey);
      if (retained >= 0 && !indexes.includes(retained)) indexes.push(retained);
      return indexes.sort((a, b) => a - b);
    },
  });
  useLayoutEffect(() => {
    virtualizer.measure();
  }, [columns, virtualizer]);

  return (
    <Box
      className="virtual-sections"
      boxRef={containerRef}
      dataAttrs={{ 'data-section-count': String(items.length) }}
      surfaceTokens={{ height: virtualizer.getTotalSize() }}
    >
      <Box className="accessory-grid virtual-grid-probe" boxRef={probeRef} ariaHidden />
      {virtualizer.getVirtualItems().map((row) => {
        const item = items[row.index];
        if (item === undefined) return null;
        const key = getKey(item);
        return (
          <Box
            className="virtual-section"
            key={row.key}
            dataAttrs={{ 'data-index': String(row.index) }}
            boxRef={(node) => {
              if (node instanceof Element || node === null) virtualizer.measureElement(node);
            }}
            surfaceTokens={{ transform: `translateY(${row.start - scrollMargin}px)` }}
            onFocusCapture={() => setRetainedKey(key)}
            onBlurCapture={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) {
                setRetainedKey(null);
              }
            }}
            onDragStartCapture={() => setRetainedKey(key)}
            onDragEndCapture={() => setRetainedKey(null)}
          >
            {renderSection(item)}
          </Box>
        );
      })}
    </Box>
  );
}
