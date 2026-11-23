/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Box, Pressable, Text } from '@haus/ui';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronRight, Search } from 'lucide-react';
import { BrandIcon } from '../../../components/brand/BrandIcon';
import { formatStabilityMedal } from '../../apps/vendor-grouping';
import {
  buildIntegrationVirtualLayout,
  computeIntegrationGridColumns,
  INTEGRATION_ALPHABET,
  INTEGRATION_HEADER_ROW_HEIGHT,
  INTEGRATION_INITIAL_BATCH,
  INTEGRATION_ITEM_ROW_GAP,
  INTEGRATION_ITEM_ROW_STRIDE,
  loadedCountForSectionJump,
  nextProgressiveLoadedCountForRows,
  sliceProgressiveVirtualRows,
  type IntegrationCatalogItem,
  type IntegrationLetterSection,
} from './catalog';

export * from './catalog';

const IntegrationGridCard = memo(function IntegrationGridCard({
  item,
  busy,
  onSelect,
}: {
  item: IntegrationCatalogItem;
  busy: boolean;
  onSelect: (id: string, title: string, item: IntegrationCatalogItem) => void;
}) {
  const hint = useMemo(
    () => ({
      name: item.title,
      ...(item.vendorId ? { supportedBy: item.vendorId } : {}),
      ...(item.repositoryUrl ? { repositoryUrl: item.repositoryUrl } : {}),
    }),
    [item.title, item.vendorId, item.repositoryUrl],
  );
  const count = item.driverCount ?? item.groupItems?.length ?? 1;
  const iconKind =
    count > 1 || item.runtime === 'ha'
      ? 'integration'
      : item.runtime === 'hacs'
        ? 'hacs'
        : item.runtime === 'homebridge'
          ? 'homebridge'
          : item.runtime === 'scrypted'
            ? 'scrypted'
            : 'app';
  const iconId = item.iconId ?? item.packageName ?? item.appId ?? item.id;
  const medal = formatStabilityMedal(item.stabilityTier, item.trustScore, item.verified);
  const subtitle = item.isCombinedHausGovee
    ? 'Govee2MQTT + Homebridge Govee · Combined setup'
    : count > 1
      ? `${count} drivers ranked by stability`
      : (item.packageName ?? item.id);
  return (
    <Pressable
      className="integration-grid-card"
      disabled={busy}
      onPress={() => onSelect(item.id, item.title, item)}
    >
      <Text className="integration-logo">
        <BrandIcon kind={iconKind} id={iconId} size={36} hint={hint} />
      </Text>
      <Text className="integration-grid-card-copy">
        <Text className="integration-grid-card-head">
          <Text semantic="strong">{item.title}</Text>
          {count > 1 && <Text className="integration-runtime-pill">{count}</Text>}
          <Text className={`stability-medal-pill is-${medal.tier}`}>{medal.shortLabel}</Text>
        </Text>
        {subtitle.toLowerCase() !== item.lowerTitle && <Text semantic="small">{subtitle}</Text>}
      </Text>
      <ChevronRight size={15} className="integration-grid-card-chevron" />
    </Pressable>
  );
});

const IntegrationLetterHeaderRow = memo(function IntegrationLetterHeaderRow({
  letter,
  count,
  startY,
  highlighted,
  onOpenIndex,
}: {
  letter: string;
  count: number;
  startY: number;
  highlighted: boolean;
  onOpenIndex: () => void;
}) {
  return (
    <Box
      className={`integration-letter-header-row${highlighted ? ' is-highlighted' : ''}`}
      surfaceTokens={{ transform: `translate3d(0, ${startY}px, 0)` }}
    >
      <Pressable
        className="integration-letter-pill"
        title="Jump to letter"
        ariaLabel={`Section ${letter}, ${count} integrations. Open alphabet index`}
        onPress={onOpenIndex}
      >
        {letter}
      </Pressable>
      <Text className="integration-letter-divider" ariaHidden />
      <Text className="integration-letter-count">{count}</Text>
    </Box>
  );
});

const IntegrationGridRow = memo(function IntegrationGridRow({
  rowItems,
  columns,
  startY,
  busy,
  onSelect,
}: {
  rowItems: readonly IntegrationCatalogItem[];
  columns: number;
  startY: number;
  busy: boolean;
  onSelect: (id: string, title: string, item: IntegrationCatalogItem) => void;
}) {
  return (
    <Box
      className="integration-grid-virtual-row"
      surfaceTokens={{
        transform: `translate3d(0, ${startY}px, 0)`,
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
      }}
    >
      {rowItems.map((item) => (
        <IntegrationGridCard key={item.id} item={item} busy={busy} onSelect={onSelect} />
      ))}
    </Box>
  );
});

const IntegrationAlphabetOverlay = memo(function IntegrationAlphabetOverlay({
  open,
  activeLetter,
  selectedLetter,
  sectionByLetter,
  onPickLetter,
}: {
  open: boolean;
  activeLetter: string | null;
  selectedLetter: string | null;
  sectionByLetter: ReadonlyMap<string, IntegrationLetterSection>;
  onPickLetter: (letter: string) => void;
}) {
  return (
    <Box
      className="integration-alphabet-overlay"
      dataAttrs={{ open: open ? 'true' : 'false' }}
      ariaHidden={!open}
      role="region"
      ariaLabel="Jump to letter"
    >
      <Box className="integration-alphabet-head">
        <Text className="integration-alphabet-title">Jump to letter</Text>
        <Text className="integration-alphabet-hint">Click a letter or press A–Z</Text>
      </Box>
      <Box className="integration-alphabet-grid">
        {INTEGRATION_ALPHABET.map((letter, idx) => {
          const section = sectionByLetter.get(letter);
          const count = section?.count ?? 0;
          const isCurrent = activeLetter === letter && count > 0;
          const isSelected = selectedLetter === letter;
          return (
            <Pressable
              key={letter}
              className={`integration-letter-tile${isCurrent ? ' is-current' : ''}${isSelected ? ' is-selected' : ''}`}
              surfaceTokens={{ '--tile-index': idx }}
              disabled={!open || count === 0}
              tabIndex={open && count > 0 ? 0 : -1}
              ariaLabel={
                count > 0
                  ? `Jump to ${letter}, ${count} ${count === 1 ? 'integration' : 'integrations'}`
                  : `${letter}, no integrations`
              }
              onPress={() => onPickLetter(letter)}
            >
              <Text className="integration-letter-tile-glyph">{letter}</Text>
              <Text className="integration-letter-tile-count">{count > 0 ? count : '—'}</Text>
            </Pressable>
          );
        })}
      </Box>
    </Box>
  );
});

export const VirtualizedIntegrationGrid = memo(function VirtualizedIntegrationGrid({
  items,
  query,
  busy = false,
  loading = false,
  grouped,
  indexOpen: controlledIndexOpen,
  onIndexOpenChange,
  onSelect,
}: {
  items: readonly IntegrationCatalogItem[];
  query: string;
  busy?: boolean;
  loading?: boolean;
  grouped?: boolean;
  indexOpen?: boolean;
  onIndexOpenChange?: (open: boolean) => void;
  onSelect: (id: string, title: string, item: IntegrationCatalogItem) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const revealRafRef = useRef<number | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [columns, setColumns] = useState(3);
  const [loadedCount, setLoadedCount] = useState(() =>
    Math.min(INTEGRATION_INITIAL_BATCH, items.length),
  );
  const [uncontrolledIndexOpen, setUncontrolledIndexOpen] = useState(false);
  const [selectedLetter, setSelectedLetter] = useState<string | null>(null);
  const [highlightedLetter, setHighlightedLetter] = useState<string | null>(null);
  const [pendingJump, setPendingJump] = useState<{
    readonly rowIndex: number;
    readonly letter: string;
    readonly token: number;
  } | null>(null);

  const trimmedQuery = query.trim();
  const isGrouped = grouped ?? trimmedQuery.length === 0;
  const indexOpen = isGrouped ? (controlledIndexOpen ?? uncontrolledIndexOpen) : false;

  const setIndexOpen = useCallback(
    (next: boolean) => {
      if (onIndexOpenChange) {
        onIndexOpenChange(next);
      } else {
        setUncontrolledIndexOpen(next);
      }
    },
    [onIndexOpenChange],
  );

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const updateColumns = () => {
      const next = computeIntegrationGridColumns(element.clientWidth);
      setColumns((prev) => (prev === next ? prev : next));
    };
    updateColumns();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateColumns);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setLoadedCount(Math.min(INTEGRATION_INITIAL_BATCH, items.length));
    setPendingJump(null);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [query, items.length]);

  useEffect(() => {
    return () => {
      if (revealRafRef.current !== null) cancelAnimationFrame(revealRafRef.current);
      if (highlightTimerRef.current !== null) clearTimeout(highlightTimerRef.current);
    };
  }, []);

  const effectiveLoadedCount = Math.min(loadedCount, items.length);

  const layout = useMemo(
    () => buildIntegrationVirtualLayout(items, columns, isGrouped),
    [items, columns, isGrouped],
  );

  const visibleRows = useMemo(
    () => sliceProgressiveVirtualRows(layout.rows, effectiveLoadedCount, items.length),
    [layout.rows, effectiveLoadedCount, items.length],
  );

  const virtualizer = useVirtualizer({
    count: visibleRows.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => visibleRows[index]?.key ?? index,
    estimateSize: (index) =>
      visibleRows[index]?.kind === 'header'
        ? INTEGRATION_HEADER_ROW_HEIGHT
        : INTEGRATION_ITEM_ROW_STRIDE,
    overscan: 5,
  });

  useEffect(() => {
    virtualizer.measure();
  }, [virtualizer, columns, isGrouped]);

  const virtualRows = virtualizer.getVirtualItems();
  const lastVisibleRowIndex =
    virtualRows.length > 0 ? virtualRows[virtualRows.length - 1]!.index : -1;
  const firstVisibleRow = virtualRows.length > 0 ? visibleRows[virtualRows[0]!.index] : undefined;
  const activeLetter = isGrouped
    ? (firstVisibleRow?.letter ?? layout.sections[0]?.letter ?? null)
    : null;

  useEffect(() => {
    if (effectiveLoadedCount >= items.length || indexOpen) return;
    const nextCount = nextProgressiveLoadedCountForRows(
      effectiveLoadedCount,
      items.length,
      lastVisibleRowIndex,
      visibleRows.length,
    );
    if (nextCount > effectiveLoadedCount) {
      startTransition(() => {
        setLoadedCount(nextCount);
      });
    }
  }, [effectiveLoadedCount, items.length, lastVisibleRowIndex, visibleRows.length, indexOpen]);

  useLayoutEffect(() => {
    if (!pendingJump || visibleRows.length <= pendingJump.rowIndex) return;
    virtualizer.measure();
    virtualizer.scrollToIndex(pendingJump.rowIndex, { align: 'start', behavior: 'auto' });
    const jumpedLetter = pendingJump.letter;
    setPendingJump(null);
    if (revealRafRef.current !== null) cancelAnimationFrame(revealRafRef.current);
    revealRafRef.current = requestAnimationFrame(() => {
      revealRafRef.current = null;
      setIndexOpen(false);
      setSelectedLetter(null);
      setHighlightedLetter(jumpedLetter);
      if (highlightTimerRef.current !== null) clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = setTimeout(() => {
        highlightTimerRef.current = null;
        setHighlightedLetter(null);
      }, 1100);
    });
  }, [pendingJump, visibleRows.length, virtualizer, setIndexOpen]);

  const handlePickLetter = useCallback(
    (letter: string) => {
      const section = layout.sectionByLetter.get(letter);
      if (!section) return;
      const nextLoaded = loadedCountForSectionJump(effectiveLoadedCount, section, items.length);
      if (nextLoaded > effectiveLoadedCount) setLoadedCount(nextLoaded);
      setSelectedLetter(letter);
      setPendingJump((prev) => ({
        rowIndex: section.rowIndex,
        letter,
        token: (prev?.token ?? 0) + 1,
      }));
    },
    [layout.sectionByLetter, effectiveLoadedCount, items.length],
  );

  const handleOpenIndex = useCallback(() => {
    if (!isGrouped || layout.sections.length === 0) return;
    setSelectedLetter(null);
    setIndexOpen(true);
  }, [isGrouped, layout.sections.length, setIndexOpen]);

  useEffect(() => {
    if (!indexOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setIndexOpen(false);
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const key = event.key.toUpperCase();
      if (key.length === 1 && ((key >= 'A' && key <= 'Z') || key === '#')) {
        if (layout.sectionByLetter.has(key)) {
          event.preventDefault();
          handlePickLetter(key);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [indexOpen, layout.sectionByLetter, handlePickLetter, setIndexOpen]);

  if (items.length === 0) {
    return (
      <Box className="integration-grid-empty">
        <Search size={20} />
        <Text semantic="strong">
          {loading ? 'Loading integrations…' : 'No matching integrations'}
        </Text>
        <Text semantic="p">
          {loading
            ? 'Fetching the integration catalog from your Hub.'
            : trimmedQuery
              ? `No brands or integrations matched “${trimmedQuery}”. Try another keyword or domain slug.`
              : 'No configurable integrations are available yet.'}
        </Text>
      </Box>
    );
  }

  const lastRow = visibleRows[visibleRows.length - 1];
  const trailingGap = lastRow?.kind === 'items' ? INTEGRATION_ITEM_ROW_GAP : 0;

  return (
    <Box className="integration-grid-shell">
      <Box className="integration-grid-stage">
        <Box
          boxRef={(node) => {
            scrollRef.current = node instanceof HTMLDivElement ? node : null;
          }}
          className="integration-grid-viewport"
          dataAttrs={{ 'index-open': indexOpen ? 'true' : 'false' }}
          ariaHidden={indexOpen}
          role="region"
          ariaLabel="Available integrations"
        >
          <Box
            className="integration-grid-canvas"
            surfaceTokens={{ height: Math.max(0, virtualizer.getTotalSize() - trailingGap) }}
          >
            {virtualRows.map((virtualRow) => {
              const row = visibleRows[virtualRow.index];
              if (!row) return null;
              if (row.kind === 'header') {
                return (
                  <IntegrationLetterHeaderRow
                    key={virtualRow.key}
                    letter={row.letter}
                    count={row.count}
                    startY={virtualRow.start}
                    highlighted={highlightedLetter === row.letter}
                    onOpenIndex={handleOpenIndex}
                  />
                );
              }
              return (
                <IntegrationGridRow
                  key={virtualRow.key}
                  rowItems={row.items}
                  columns={columns}
                  startY={virtualRow.start}
                  busy={busy}
                  onSelect={onSelect}
                />
              );
            })}
          </Box>
        </Box>

        {isGrouped && (
          <IntegrationAlphabetOverlay
            open={indexOpen}
            activeLetter={activeLetter}
            selectedLetter={selectedLetter}
            sectionByLetter={layout.sectionByLetter}
            onPickLetter={handlePickLetter}
          />
        )}
      </Box>

      <Box className="integration-grid-footer">
        <Text>
          {effectiveLoadedCount < items.length
            ? `Showing ${effectiveLoadedCount.toLocaleString()} of ${items.length.toLocaleString()} integrations`
            : trimmedQuery
              ? `${items.length.toLocaleString()} ${items.length === 1 ? 'match' : 'matches'} for “${trimmedQuery}”`
              : `${items.length.toLocaleString()} integrations available`}
        </Text>
        {effectiveLoadedCount < items.length && !indexOpen && (
          <Text className="integration-grid-scroll-hint">Scroll to load more</Text>
        )}
      </Box>
    </Box>
  );
});
