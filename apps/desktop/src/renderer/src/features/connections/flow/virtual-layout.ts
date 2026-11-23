/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { IntegrationCatalogItem } from './catalog';

export const INTEGRATION_INITIAL_BATCH = 48;
export const INTEGRATION_BATCH_STEP = 48;
export const INTEGRATION_PREFETCH_ROWS = 5;

export const INTEGRATION_HEADER_ROW_HEIGHT = 40;
export const INTEGRATION_ITEM_ROW_HEIGHT = 60;
export const INTEGRATION_ITEM_ROW_GAP = 8;
export const INTEGRATION_ITEM_ROW_STRIDE = INTEGRATION_ITEM_ROW_HEIGHT + INTEGRATION_ITEM_ROW_GAP;

export const INTEGRATION_ALPHABET: readonly string[] = '#ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export type IntegrationVirtualRow =
  | {
      readonly kind: 'header';
      readonly key: string;
      readonly letter: string;
      readonly count: number;
      readonly firstItemIndex: number;
    }
  | {
      readonly kind: 'items';
      readonly key: string;
      readonly letter: string;
      readonly items: readonly IntegrationCatalogItem[];
      readonly startItemIndex: number;
      readonly endItemIndex: number;
    };

export interface IntegrationLetterSection {
  readonly letter: string;
  readonly count: number;
  readonly rowIndex: number;
  readonly firstItemIndex: number;
  readonly endItemIndex: number;
}

export interface IntegrationVirtualLayout {
  readonly rows: readonly IntegrationVirtualRow[];
  readonly sections: readonly IntegrationLetterSection[];
  readonly sectionByLetter: ReadonlyMap<string, IntegrationLetterSection>;
}

export function computeIntegrationGridColumns(widthPx: number): number {
  if (widthPx >= 690) return 3;
  if (widthPx >= 430) return 2;
  return 1;
}

export function buildIntegrationVirtualLayout(
  items: readonly IntegrationCatalogItem[],
  columns: number,
  grouped: boolean,
): IntegrationVirtualLayout {
  const safeColumns = Math.max(1, columns);
  const rows: IntegrationVirtualRow[] = [];
  const sections: IntegrationLetterSection[] = [];
  const sectionByLetter = new Map<string, IntegrationLetterSection>();

  if (items.length === 0) return { rows, sections, sectionByLetter };

  if (!grouped) {
    for (let start = 0; start < items.length; start += safeColumns) {
      const slice = items.slice(start, start + safeColumns);
      rows.push({
        kind: 'items',
        key: `flat-${start}`,
        letter: slice[0]?.letter ?? '#',
        items: slice,
        startItemIndex: start,
        endItemIndex: start + slice.length,
      });
    }
    return { rows, sections, sectionByLetter };
  }

  const buckets = new Map<string, IntegrationCatalogItem[]>();
  for (const item of items) {
    const existing = buckets.get(item.letter);
    if (existing) existing.push(item);
    else buckets.set(item.letter, [item]);
  }

  let runningIndex = 0;
  for (const letter of INTEGRATION_ALPHABET) {
    const group = buckets.get(letter);
    if (!group || group.length === 0) continue;
    const rowIndex = rows.length;
    const firstItemIndex = runningIndex;
    rows.push({
      kind: 'header',
      key: `header-${letter}`,
      letter,
      count: group.length,
      firstItemIndex,
    });

    for (let offset = 0; offset < group.length; offset += safeColumns) {
      const slice = group.slice(offset, offset + safeColumns);
      const startItemIndex = runningIndex;
      runningIndex += slice.length;
      rows.push({
        kind: 'items',
        key: `items-${letter}-${offset}`,
        letter,
        items: slice,
        startItemIndex,
        endItemIndex: runningIndex,
      });
    }
    const section: IntegrationLetterSection = {
      letter,
      count: group.length,
      rowIndex,
      firstItemIndex,
      endItemIndex: runningIndex,
    };
    sections.push(section);
    sectionByLetter.set(letter, section);
  }
  return { rows, sections, sectionByLetter };
}

export function sliceProgressiveVirtualRows(
  rows: readonly IntegrationVirtualRow[],
  loadedItemCount: number,
  totalItemCount: number,
): readonly IntegrationVirtualRow[] {
  if (loadedItemCount <= 0 || totalItemCount <= 0) return [];
  if (loadedItemCount >= totalItemCount) return rows;
  const visible: IntegrationVirtualRow[] = [];
  let emitted = 0;
  for (const row of rows) {
    if (emitted >= loadedItemCount) break;
    if (row.kind === 'header') {
      visible.push(row);
      continue;
    }
    const remaining = loadedItemCount - emitted;
    const take = Math.min(row.items.length, remaining);
    visible.push(
      take === row.items.length
        ? row
        : { ...row, items: row.items.slice(0, take), endItemIndex: row.startItemIndex + take },
    );
    emitted += take;
  }
  return visible;
}

export function nextProgressiveLoadedCount(
  currentLoaded: number,
  totalCount: number,
  lastVisibleRowIndex: number,
  columns: number,
  batchStep = INTEGRATION_BATCH_STEP,
  prefetchRows = INTEGRATION_PREFETCH_ROWS,
): number {
  if (totalCount <= 0) return 0;
  const clamped = Math.min(currentLoaded, totalCount);
  if (clamped >= totalCount) return totalCount;
  const loadedRows = Math.ceil(clamped / Math.max(1, columns));
  return lastVisibleRowIndex >= loadedRows - prefetchRows
    ? Math.min(totalCount, clamped + batchStep)
    : clamped;
}

export function nextProgressiveLoadedCountForRows(
  currentLoaded: number,
  totalItemCount: number,
  lastVisibleRowIndex: number,
  visibleRowCount: number,
  batchStep = INTEGRATION_BATCH_STEP,
  prefetchRows = INTEGRATION_PREFETCH_ROWS,
): number {
  if (totalItemCount <= 0) return 0;
  const clamped = Math.min(currentLoaded, totalItemCount);
  if (clamped >= totalItemCount) return totalItemCount;
  if (visibleRowCount <= 0 || lastVisibleRowIndex >= Math.max(0, visibleRowCount - prefetchRows)) {
    return Math.min(totalItemCount, clamped + batchStep);
  }
  return clamped;
}

export function loadedCountForSectionJump(
  currentLoaded: number,
  section: IntegrationLetterSection,
  totalItemCount: number,
  extraBuffer = INTEGRATION_BATCH_STEP,
): number {
  return Math.max(currentLoaded, Math.min(totalItemCount, section.endItemIndex + extraBuffer));
}
