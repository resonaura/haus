/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { StatisticKind, StatisticSource } from '@haus/core';

export interface StatisticMetadataRow {
  readonly id: string;
  readonly statisticId: string;
  readonly source: StatisticSource;
  readonly unit: string | null;
  readonly kind: StatisticKind;
  readonly displayName: string | null;
  readonly hasMean: boolean;
  readonly hasSum: boolean;
  readonly createdAt: number;
}

export interface RawStatisticSampleRow {
  readonly metadataId: string;
  readonly timestamp: number;
  readonly value: number;
}

export interface StatisticRollupRow {
  readonly metadataId: string;
  readonly startTs: number;
  readonly min: number;
  readonly max: number;
  readonly mean: number | null;
  readonly first: number;
  readonly last: number;
  readonly sum: number | null;
  readonly count: number;
}
