/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  countBrandCatalogEcosystems,
  filterBrandIntegrationCatalog,
  INTEGRATION_CATALOG_ALPHABET,
  type BrandCatalogItem,
  type IntegrationEcosystem,
} from '@haus/core/transport';
import { colorToken, corners, insets, pct, px } from '../../../ir/geometry.js';
import { SolidMaterial } from '../../../ir/materials.js';
import {
  Box,
  HausButton,
  Pressable,
  Row,
  ScrollView,
  Stack,
  Text,
  useHausUi,
} from '../../../primitives/index.js';
import { resolveColorToCss } from '../../../renderers/contract.js';
import {
  ManagementEmptyCard,
  ManagementFilterBar,
  ManagementSearchBar,
  type ManagementFilterTabItem,
} from '../../brand/index.js';
import { DashboardGrid } from '../../home.js';
import { UiIcon } from '../../icon.js';
import { IntegrationAlphabetOverlay, IntegrationLetterSectionHeader } from './alphabet-overlay.js';
import { BrandPickerCard } from './picker-card.js';

const PAGE_SIZE = 24;

function pickerToolbarPillStyle(active: boolean) {
  return {
    layout: {
      height: px(38),
      padding: insets(0, 12),
      display: 'inline-flex' as const,
      direction: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      gap: px(6),
      flexShrink: 0,
    },
    material: new SolidMaterial(active ? colorToken('accent') : colorToken('surface')),
    border: { width: 1, color: active ? colorToken('accent') : colorToken('border') },
    corners: corners(14, 'superellipse', 1.4),
    transitionMs: 140,
    states: {
      hover: {
        material: new SolidMaterial(
          active ? colorToken('accentHover') : colorToken('controlFillHover'),
        ),
      },
      pressed: { transform: { scale: 0.97 } },
    },
  };
}

/**
 * Shared glass integration brand catalog picker with ecosystem filter tabs,
 * grouped A–Z sections with counts, animated semantic-zoom alphabet overlay,
 * stability medals, driver counts, and `<BrandIcon />`.
 */
export function IntegrationCatalogPicker({
  catalog,
  query,
  busy = false,
  onQueryChange,
  onSelectBrand,
  onAddCustomRepo,
}: {
  readonly catalog: readonly BrandCatalogItem[];
  readonly query: string;
  readonly busy?: boolean;
  readonly onQueryChange: (query: string) => void;
  readonly onSelectBrand: (item: BrandCatalogItem) => void;
  readonly onAddCustomRepo?: () => void;
}) {
  const { theme } = useHausUi();
  const accentFg = resolveColorToCss(colorToken('accentForeground'), theme, false);
  const [ecosystem, setEcosystem] = useState<IntegrationEcosystem>('all');
  const [letter, setLetter] = useState<string>('');
  const [indexOpen, setIndexOpen] = useState(false);
  const [selectedLetter, setSelectedLetter] = useState<string | null>(null);
  const [highlightedLetter, setHighlightedLetter] = useState<string | null>(null);
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE);
  const jumpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (jumpTimerRef.current) clearTimeout(jumpTimerRef.current);
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    },
    [],
  );

  const counts = useMemo(() => countBrandCatalogEcosystems(catalog), [catalog]);
  const ecosystemTabs = useMemo<readonly ManagementFilterTabItem<IntegrationEcosystem>[]>(() => {
    const tabs: ManagementFilterTabItem<IntegrationEcosystem>[] = [
      { id: 'all', label: 'All Brands', count: counts.all },
      { id: 'ha', label: 'Home Assistant', count: counts.ha },
    ];
    if (counts.hacs > 0) tabs.push({ id: 'hacs', label: 'HACS', count: counts.hacs });
    if (counts.homebridge > 0) {
      tabs.push({ id: 'homebridge', label: 'Homebridge', count: counts.homebridge });
    }
    if (counts.scrypted > 0) {
      tabs.push({ id: 'scrypted', label: 'Scrypted', count: counts.scrypted });
    }
    return tabs;
  }, [counts]);

  const inEcosystem = useMemo(
    () => filterBrandIntegrationCatalog(catalog, '', ecosystem),
    [catalog, ecosystem],
  );

  const sectionCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of inEcosystem) {
      map.set(item.letter, (map.get(item.letter) ?? 0) + 1);
    }
    return map;
  }, [inEcosystem]);

  const deferredQuery = useDeferredValue(query);
  const hasQuery = deferredQuery.trim().length > 0;
  const filtered = useMemo(
    () =>
      filterBrandIntegrationCatalog(
        catalog,
        deferredQuery,
        ecosystem,
        hasQuery ? undefined : letter || undefined,
      ),
    [catalog, deferredQuery, ecosystem, hasQuery, letter],
  );

  const displayed = useMemo(() => filtered.slice(0, visibleLimit), [filtered, visibleLimit]);
  const remaining = Math.max(0, filtered.length - displayed.length);

  const groupedSections = useMemo(() => {
    if (hasQuery) return [];
    const sections: Array<{
      readonly letter: string;
      readonly totalCount: number;
      readonly items: BrandCatalogItem[];
    }> = [];
    for (const item of displayed) {
      const last = sections[sections.length - 1];
      if (last && last.letter === item.letter) {
        last.items.push(item);
      } else {
        sections.push({
          letter: item.letter,
          totalCount: sectionCounts.get(item.letter) ?? 1,
          items: [item],
        });
      }
    }
    return sections;
  }, [displayed, hasQuery, sectionCounts]);

  const handleOpenIndex = useCallback(() => setIndexOpen(true), []);
  const handleCloseIndex = useCallback(() => setIndexOpen(false), []);
  const handleClearLetter = useCallback(() => {
    setLetter('');
    setVisibleLimit(PAGE_SIZE);
  }, []);
  const handleShowAllFromOverlay = useCallback(() => {
    setLetter('');
    setVisibleLimit(PAGE_SIZE);
    setIndexOpen(false);
  }, []);

  const handlePickLetter = useCallback(
    (nextLetter: string) => {
      if ((sectionCounts.get(nextLetter) ?? 0) === 0) return;
      setSelectedLetter(nextLetter);
      if (jumpTimerRef.current) clearTimeout(jumpTimerRef.current);
      jumpTimerRef.current = setTimeout(() => {
        jumpTimerRef.current = null;
        setLetter(nextLetter);
        setVisibleLimit(PAGE_SIZE);
        setIndexOpen(false);
        setSelectedLetter(null);
        setHighlightedLetter(nextLetter);
        if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = setTimeout(() => {
          highlightTimerRef.current = null;
          setHighlightedLetter(null);
        }, 950);
      }, 90);
    },
    [sectionCounts],
  );

  const handleToggleAlphabet = () => {
    if (indexOpen) {
      setIndexOpen(false);
      return;
    }
    if (query.length > 0) onQueryChange('');
    setIndexOpen(true);
  };

  const activeLetter = letter || groupedSections[0]?.letter || null;
  const canOpenAlphabet = inEcosystem.length > 0;

  return (
    <Box
      onKeyDown={(event) => {
        if (!indexOpen) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          setIndexOpen(false);
          return;
        }
        const upper = event.key.length === 1 ? event.key.toUpperCase() : '';
        if (upper && (INTEGRATION_CATALOG_ALPHABET as readonly string[]).includes(upper)) {
          event.preventDefault();
          handlePickLetter(upper);
        }
      }}
      style={{ layout: { width: pct(100) } }}
    >
      <Stack gapPx={12} style={{ layout: { width: pct(100) } }}>
        <Row align="center" gapPx={8} style={{ layout: { width: pct(100) } }}>
          <Box style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
            <ManagementSearchBar
              id="flow-picker-search"
              ariaLabel="Search integrations and ecosystems"
              placeholder={
                catalog.length > 0
                  ? `Search ${catalog.length.toLocaleString()} brands across HA, HACS, Homebridge & Scrypted…`
                  : 'Search brands & integrations…'
              }
              value={query}
              onChange={(next) => {
                if (next.trim().length > 0 && indexOpen) setIndexOpen(false);
                setVisibleLimit(PAGE_SIZE);
                onQueryChange(next);
              }}
              countBadge={
                catalog.length > 0
                  ? hasQuery || ecosystem !== 'all' || letter
                    ? `${filtered.length.toLocaleString()} / ${catalog.length.toLocaleString()}`
                    : catalog.length.toLocaleString()
                  : undefined
              }
            />
          </Box>
          <Pressable
            id="flow-picker-alpha-trigger"
            disabled={!canOpenAlphabet}
            ariaPressed={indexOpen}
            ariaLabel={indexOpen ? 'Return to integrations list' : 'Browse integrations by letter'}
            onActivate={handleToggleAlphabet}
            style={pickerToolbarPillStyle(indexOpen)}
          >
            <UiIcon name="layout-grid" size={14} color={indexOpen ? accentFg : undefined} />
            <Text
              size={12}
              weight={600}
              style={{
                typography: {
                  size: 12,
                  weight: 600,
                  color: indexOpen ? colorToken('accentForeground') : colorToken('textPrimary'),
                },
              }}
            >
              {letter && !indexOpen ? `A–Z · ${letter}` : 'A–Z'}
            </Text>
          </Pressable>
          {onAddCustomRepo && (
            <Pressable
              id="flow-picker-custom-repo"
              disabled={busy}
              ariaLabel="Add custom HACS repository"
              onActivate={onAddCustomRepo}
              style={pickerToolbarPillStyle(false)}
            >
              <UiIcon name="plus" size={14} />
              <Text size={12} weight={600}>
                Custom repo
              </Text>
            </Pressable>
          )}
        </Row>

        {ecosystemTabs.length > 2 && (
          <Stack gapPx={6} style={{ layout: { width: pct(100) } }}>
            <ManagementFilterBar
              idPrefix="flow-picker-eco"
              tabs={ecosystemTabs}
              activeId={ecosystem}
              onChange={(nextEco) => {
                setEcosystem(nextEco);
                setLetter('');
                setIndexOpen(false);
                setVisibleLimit(PAGE_SIZE);
              }}
            />
            <Row align="center" gapPx={6}>
              <UiIcon name="shield-check" size={12} />
              <Text size={11} tone="muted">
                Grouped by brand &amp; ranked by stability — tap A–Z or any letter pill to zoom
                across letters
              </Text>
            </Row>
          </Stack>
        )}

        <ScrollView style={{ layout: { width: pct(100), maxHeight: px(420) } }}>
          {indexOpen ? (
            <IntegrationAlphabetOverlay
              sectionCounts={sectionCounts}
              activeLetter={activeLetter}
              selectedLetter={selectedLetter}
              onPickLetter={handlePickLetter}
              onShowAll={letter ? handleShowAllFromOverlay : undefined}
              onClose={handleCloseIndex}
            />
          ) : displayed.length === 0 ? (
            <ManagementEmptyCard
              icon="search"
              title="No matching integrations"
              subtitle="Try another brand name, protocol, or switch ecosystem filter."
            />
          ) : (
            <Stack gapPx={14} style={{ layout: { width: pct(100), flexShrink: 0 } }}>
              {hasQuery ? (
                <DashboardGrid columns={2}>
                  {displayed.map((item) => (
                    <BrandPickerCard
                      key={item.id}
                      item={item}
                      busy={busy}
                      onSelectBrand={onSelectBrand}
                    />
                  ))}
                </DashboardGrid>
              ) : (
                groupedSections.map((section) => (
                  <Stack
                    key={section.letter}
                    gapPx={8}
                    style={{ layout: { width: pct(100), flexShrink: 0 } }}
                  >
                    <IntegrationLetterSectionHeader
                      letter={section.letter}
                      count={section.totalCount}
                      highlighted={highlightedLetter === section.letter}
                      filteredSingle={Boolean(letter)}
                      onOpenIndex={handleOpenIndex}
                      onClearLetter={letter ? handleClearLetter : undefined}
                    />
                    <DashboardGrid columns={2}>
                      {section.items.map((item) => (
                        <BrandPickerCard
                          key={item.id}
                          item={item}
                          busy={busy}
                          onSelectBrand={onSelectBrand}
                        />
                      ))}
                    </DashboardGrid>
                  </Stack>
                ))
              )}

              {remaining > 0 && (
                <Row
                  justify="center"
                  style={{ layout: { width: pct(100), padding: insets(4, 0) } }}
                >
                  <HausButton
                    id="flow-picker-load-more"
                    variant="secondary"
                    size="sm"
                    onPress={() => setVisibleLimit((prev) => prev + PAGE_SIZE)}
                  >
                    <Text size={12}>{`Show more (${remaining.toLocaleString()} remaining)`}</Text>
                  </HausButton>
                </Row>
              )}
            </Stack>
          )}
        </ScrollView>
      </Stack>
    </Box>
  );
}
