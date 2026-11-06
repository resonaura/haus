/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { EntitySchema } from 'typeorm';
import type {
  RawStatisticSampleRow,
  StatisticMetadataRow,
  StatisticRollupRow,
} from './stats.types.js';

export const StatisticMetadataEntity = new EntitySchema<StatisticMetadataRow>({
  name: 'StatisticMetadata',
  tableName: 'stats-metadata',
  columns: {
    id: { type: 'text', primary: true },
    statisticId: { type: 'text', name: 'statistic-id', unique: true },
    source: { type: 'text' },
    unit: { type: 'text', nullable: true },
    kind: { type: 'text' },
    displayName: { type: 'text', name: 'display-name', nullable: true },
    hasMean: { type: 'boolean', name: 'has-mean' },
    hasSum: { type: 'boolean', name: 'has-sum' },
    createdAt: { type: 'integer', name: 'created-at' },
  },
  indices: [
    {
      name: 'idx_stats_metadata_statistic_id',
      columns: ['statisticId'],
      unique: true,
    },
    {
      name: 'idx_stats_metadata_source',
      columns: ['source'],
    },
  ],
});

export const RawStatisticSampleEntity = new EntitySchema<RawStatisticSampleRow>({
  name: 'RawStatisticSample',
  tableName: 'stats-raw',
  columns: {
    metadataId: { type: 'text', name: 'metadata-id', primary: true },
    timestamp: { type: 'integer', primary: true },
    value: { type: 'real' },
  },
  indices: [
    {
      name: 'idx_stats_raw_time',
      columns: ['metadataId', 'timestamp'],
    },
  ],
});

export const Statistic5mRollupEntity = new EntitySchema<StatisticRollupRow>({
  name: 'Statistic5mRollup',
  tableName: 'stats-5m',
  columns: {
    metadataId: { type: 'text', name: 'metadata-id', primary: true },
    startTs: { type: 'integer', name: 'start-ts', primary: true },
    min: { type: 'real' },
    max: { type: 'real' },
    mean: { type: 'real', nullable: true },
    first: { type: 'real' },
    last: { type: 'real' },
    sum: { type: 'real', nullable: true },
    count: { type: 'integer' },
  },
  indices: [
    {
      name: 'idx_stats_5m_time',
      columns: ['metadataId', 'startTs'],
    },
  ],
});

export const Statistic1hRollupEntity = new EntitySchema<StatisticRollupRow>({
  name: 'Statistic1hRollup',
  tableName: 'stats-1h',
  columns: {
    metadataId: { type: 'text', name: 'metadata-id', primary: true },
    startTs: { type: 'integer', name: 'start-ts', primary: true },
    min: { type: 'real' },
    max: { type: 'real' },
    mean: { type: 'real', nullable: true },
    first: { type: 'real' },
    last: { type: 'real' },
    sum: { type: 'real', nullable: true },
    count: { type: 'integer' },
  },
  indices: [
    {
      name: 'idx_stats_1h_time',
      columns: ['metadataId', 'startTs'],
    },
  ],
});
