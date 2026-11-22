/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { EntitySchema } from 'typeorm';
import type {
  EndpointHistoryEventRow,
  RawStatisticSampleRow,
  StatisticMetadataRow,
  StatisticRollupRow,
} from './stats.types.js';

export const StatisticMetadataEntity = new EntitySchema<StatisticMetadataRow>({
  name: 'StatisticMetadata',
  tableName: 'stats_metadata',
  columns: {
    id: { type: 'text', primary: true },
    statisticId: { type: 'text', name: 'statistic_id' },
    source: { type: 'text' },
    unit: { type: 'text', nullable: true },
    kind: { type: 'text' },
    displayName: { type: 'text', name: 'display_name', nullable: true },
    hasMean: { type: 'boolean', name: 'has_mean' },
    hasSum: { type: 'boolean', name: 'has_sum' },
    createdAt: { type: 'integer', name: 'created_at' },
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
  tableName: 'stats_raw',
  columns: {
    metadataId: { type: 'text', name: 'metadata_id', primary: true },
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
  tableName: 'stats_5m',
  columns: {
    metadataId: { type: 'text', name: 'metadata_id', primary: true },
    startTs: { type: 'integer', name: 'start_ts', primary: true },
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
  tableName: 'stats_1h',
  columns: {
    metadataId: { type: 'text', name: 'metadata_id', primary: true },
    startTs: { type: 'integer', name: 'start_ts', primary: true },
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

export const EndpointHistoryEventEntity = new EntitySchema<EndpointHistoryEventRow>({
  name: 'EndpointHistoryEvent',
  tableName: 'endpoint_history_events',
  columns: {
    endpointId: { type: 'text', name: 'endpoint_id', primary: true },
    tsMs: { type: 'bigint', name: 'ts_ms', primary: true },
    stateJson: { type: 'text', name: 'state_json' },
  },
  indices: [
    {
      name: 'idx_endpoint_history_ep_ts',
      columns: ['endpointId', 'tsMs'],
    },
    {
      name: 'idx_endpoint_history_ts',
      columns: ['tsMs'],
    },
  ],
});
