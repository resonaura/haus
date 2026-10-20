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
  const itemKey = useCallback((index: number) => getKey(items[index]), [items, getKey]);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: itemKey,
    estimateSize: (index) => estimateHeight(items[index], columns),
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
    <div
      className="virtual-sections"
      ref={containerRef}
      data-section-count={items.length}
      style={{ height: virtualizer.getTotalSize() }}
    >
      <div className="accessory-grid virtual-grid-probe" ref={probeRef} aria-hidden="true" />
      {virtualizer.getVirtualItems().map((row) => {
        const item = items[row.index];
        const key = getKey(item);
        return (
          <div
            className="virtual-section"
            key={row.key}
            data-index={row.index}
            ref={virtualizer.measureElement}
            style={{ transform: `translateY(${row.start - scrollMargin}px)` }}
            onFocusCapture={() => setRetainedKey(key)}
            onBlurCapture={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setRetainedKey(null);
              }
            }}
            onDragStartCapture={() => setRetainedKey(key)}
            onDragEndCapture={() => setRetainedKey(null)}
          >
            {renderSection(item)}
          </div>
        );
      })}
    </div>
  );
}
