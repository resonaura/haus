/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { DatabaseSync } from 'node:sqlite';

export const STATS_SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS "stats-metadata" (
  "id" TEXT PRIMARY KEY,
  "statistic-id" TEXT NOT NULL UNIQUE,
  "source" TEXT NOT NULL,
  "unit" TEXT,
  "kind" TEXT NOT NULL,
  "display-name" TEXT,
  "has-mean" INTEGER NOT NULL,
  "has-sum" INTEGER NOT NULL,
  "created-at" INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_stats_metadata_statistic_id" ON "stats-metadata"("statistic-id");
CREATE INDEX IF NOT EXISTS "idx_stats_metadata_source" ON "stats-metadata"("source");

CREATE TABLE IF NOT EXISTS "stats-raw" (
  "metadata-id" TEXT NOT NULL,
  "timestamp" INTEGER NOT NULL,
  "value" REAL NOT NULL,
  PRIMARY KEY ("metadata-id", "timestamp")
);
CREATE INDEX IF NOT EXISTS "idx_stats_raw_time" ON "stats-raw"("metadata-id", "timestamp");

CREATE TABLE IF NOT EXISTS "stats-5m" (
  "metadata-id" TEXT NOT NULL,
  "start-ts" INTEGER NOT NULL,
  "min" REAL NOT NULL,
  "max" REAL NOT NULL,
  "mean" REAL,
  "first" REAL NOT NULL,
  "last" REAL NOT NULL,
  "sum" REAL,
  "count" INTEGER NOT NULL,
  PRIMARY KEY ("metadata-id", "start-ts")
);
CREATE INDEX IF NOT EXISTS "idx_stats_5m_time" ON "stats-5m"("metadata-id", "start-ts");

CREATE TABLE IF NOT EXISTS "stats-1h" (
  "metadata-id" TEXT NOT NULL,
  "start-ts" INTEGER NOT NULL,
  "min" REAL NOT NULL,
  "max" REAL NOT NULL,
  "mean" REAL,
  "first" REAL NOT NULL,
  "last" REAL NOT NULL,
  "sum" REAL,
  "count" INTEGER NOT NULL,
  PRIMARY KEY ("metadata-id", "start-ts")
);
CREATE INDEX IF NOT EXISTS "idx_stats_1h_time" ON "stats-1h"("metadata-id", "start-ts");
`;

/**
 * Initializes physical database tables and indexes for the high-performance statistics tiers.
 */
export function initStatsSchema(db: DatabaseSync): void {
  db.exec(STATS_SCHEMA_DDL);
}
